import { sign } from 'hono/jwt'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { defineCms } from '../define'
import { createCmsApi } from './index'

const cms = defineCms({
  site: {
    id: 'test',
    name: 'Test',
    url: 'https://example.com',
    locales: ['is'],
    defaultLocale: 'is',
  },
  collections: {},
})

const TEAM = 'team.cloudflareaccess.com'
const AUD = 'test-aud'
const env = { ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }

async function keyPair() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { publicJwk, privateJwk }
}

let trusted: Awaited<ReturnType<typeof keyPair>>
let attacker: Awaited<ReturnType<typeof keyPair>>

beforeAll(async () => {
  trusted = await keyPair()
  attacker = await keyPair()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function serveCerts() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url !== `https://${TEAM}/cdn-cgi/access/certs`)
      return Promise.resolve(new Response('', { status: 404 }))
    return Promise.resolve(
      Response.json({ keys: [{ ...trusted.publicJwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function token(privateJwk: JsonWebKey, claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return sign(
    {
      iss: `https://${TEAM}`,
      aud: [AUD],
      email: 'editor@example.com',
      iat: now,
      exp: now + 600,
      ...claims,
    },
    { ...privateJwk, kid: 'k1' },
    'RS256',
  )
}

function adminRequest(jwt?: string) {
  const app = createCmsApi(cms)
  return app.request(
    '/admin/config',
    { headers: jwt ? { 'cf-access-jwt-assertion': jwt } : {} },
    env,
  )
}

describe('admin API behind Cloudflare Access', () => {
  it('rejects a request without the Access header', async () => {
    serveCerts()
    expect((await adminRequest()).status).toBe(401)
  })

  it('rejects a forged header', async () => {
    serveCerts()
    expect((await adminRequest('not.a.jwt')).status).toBe(401)
  })

  it('rejects a token signed with a key Access did not issue', async () => {
    serveCerts()
    expect((await adminRequest(await token(attacker.privateJwk))).status).toBe(401)
  })

  it('rejects a token for another Access application', async () => {
    serveCerts()
    expect((await adminRequest(await token(trusted.privateJwk, { aud: ['other'] }))).status).toBe(
      401,
    )
  })

  it('rejects an expired token', async () => {
    serveCerts()
    const past = Math.floor(Date.now() / 1000) - 3600
    expect(
      (await adminRequest(await token(trusted.privateJwk, { iat: past - 600, exp: past }))).status,
    ).toBe(401)
  })

  it('accepts a valid Access token', async () => {
    serveCerts()
    expect((await adminRequest(await token(trusted.privateJwk))).status).toBe(200)
  })

  it('fails closed when the Access settings are missing in production', async () => {
    serveCerts()
    const app = createCmsApi(cms)
    const res = await app.request(
      '/admin/config',
      { headers: { 'cf-access-jwt-assertion': await token(trusted.privateJwk) } },
      { ENVIRONMENT: 'production' },
    )
    expect(res.status).toBe(401)
  })
})
