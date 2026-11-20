import { decode, verifyWithJwks } from 'hono/jwt'
import type { HonoJsonWebKey } from 'hono/utils/jwt/jws'

/**
 * Cloudflare Access puts a signed JWT in `cf-access-jwt-assertion` on every request it lets
 * through. Checking only that the header exists would trust anyone who reaches the Worker
 * another way, so the signature, audience, issuer and expiry are verified against the
 * team's public certs.
 * https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

export interface AccessSettings {
  /** e.g. "norduo.cloudflareaccess.com" */
  teamDomain: string
  /** The Access application's AUD tag. */
  aud: string
}

const CERTS_TTL_MS = 60 * 60 * 1000
/** Access rotates keys; an unknown `kid` refetches, at most this often. */
const REFRESH_MIN_MS = 60 * 1000

const certsCache = new Map<string, { keys: HonoJsonWebKey[]; fetchedAt: number }>()

async function certs(teamDomain: string, kid: string | undefined): Promise<HonoJsonWebKey[]> {
  const cached = certsCache.get(teamDomain)
  const age = cached ? Date.now() - cached.fetchedAt : Infinity
  const known = cached?.keys.some((k) => k.kid === kid) ?? false
  if (cached && age < CERTS_TTL_MS && (known || age < REFRESH_MIN_MS)) return cached.keys

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`)
  const { keys } = await res.json<{ keys: HonoJsonWebKey[] }>()
  certsCache.set(teamDomain, { keys, fetchedAt: Date.now() })
  return keys
}

/** Returns the editor's email for a valid Access token, or null. Never throws. */
export async function verifyAccessJwt(
  token: string | undefined,
  settings: AccessSettings,
): Promise<string | null> {
  if (!token) return null
  try {
    const { header } = decode(token)
    const payload = await verifyWithJwks(token, {
      keys: await certs(settings.teamDomain, header.kid),
      allowedAlgorithms: ['RS256'],
      verification: { iss: `https://${settings.teamDomain}`, aud: settings.aud },
    })
    return typeof payload.email === 'string' ? payload.email : ''
  } catch {
    return null
  }
}
