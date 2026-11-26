import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { defineCms } from '../define'
import { gallery, text } from '../fields'
import { MAX_VIDEO_BYTES } from '../gallery'
import type { MediaInfo } from '../media'
import { testDatabase } from '../test/d1'
import { createCmsApi, createVideoRoute, type VideoTicket } from './index'
import { parseRange, PRESIGN_SECONDS, presignVideo, putLocalVideo, videoKey } from './video'

const cms = defineCms({
  site: {
    id: 'test',
    name: 'Test',
    url: 'https://example.com',
    locales: ['is', 'en'],
    defaultLocale: 'is',
  },
  collections: {
    projects: { fields: { title: text({ required: true }), photos: gallery() } },
  },
})

let db: Awaited<ReturnType<typeof testDatabase>>
const app = createCmsApi(cms)
const video = createVideoRoute()

beforeAll(async () => {
  db = await testDatabase()
})
afterAll(async () => {
  await db.dispose()
})
beforeEach(async () => {
  await db.reset()
})

const local = () => ({ DB: db.d1, MEDIA: db.r2, ENVIRONMENT: 'development' })
const withToken = () => ({
  ...local(),
  R2_BUCKET: 'berghald-media',
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
})

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

function ticket(body: unknown, env: Record<string, unknown> = local()) {
  return app.request('/admin/media/video', json('POST', body), env)
}

const mp4 = (size: number) => new Uint8Array(size).fill(7)

/** The whole flow against the Worker's stand-in for R2: URL, PUT, media row. */
async function uploaded(bytes: Uint8Array<ArrayBuffer>) {
  const res = await ticket({ size: bytes.byteLength, type: 'video/mp4' })
  expect(res.status).toBe(201)
  const t = await res.json<VideoTicket>()
  const put = await app.request(
    t.url.replace(/^\/api\/cms/, ''),
    { method: 'PUT', headers: t.headers, body: bytes },
    local(),
  )
  expect(put.status).toBe(200)
  const done = await app.request(
    `/admin/media/video/${t.id}`,
    json('POST', { filename: 'klippa.mp4', width: 1920, height: 1080 }),
    local(),
  )
  expect(done.status).toBe(201)
  return done.json<MediaInfo>()
}

describe('POST /admin/media/video', () => {
  it('signs a PUT of exactly the declared size and type, valid for 15 minutes', async () => {
    const res = await ticket({ size: 150 * 1024 * 1024, type: 'video/mp4' }, withToken())
    expect(res.status).toBe(201)
    const t = await res.json<VideoTicket>()
    const url = new URL(t.url)
    expect(url.origin).toBe('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com')
    expect(url.pathname).toBe(`/berghald-media/${videoKey(t.id)}`)
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(PRESIGN_SECONDS))
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^test-key\/\d{8}\/auto\/s3\//)
    expect(t.headers).toEqual({ 'content-type': 'video/mp4' })
  })

  it('refuses anything over 200 MB, other types and empty files', async () => {
    expect((await ticket({ size: MAX_VIDEO_BYTES + 1, type: 'video/mp4' })).status).toBe(413)
    expect((await ticket({ size: MAX_VIDEO_BYTES, type: 'video/mp4' })).status).toBe(201)
    expect((await ticket({ size: 1000, type: 'video/quicktime' })).status).toBe(415)
    expect((await ticket({ size: 0, type: 'video/mp4' })).status).toBe(422)
    expect((await ticket({ size: '10', type: 'video/mp4' })).status).toBe(422)
  })

  it('is an error in production without the S3 token, never a PUT to the Worker', async () => {
    // Called directly: in production the API itself sits behind the Access check.
    const result = await presignVideo(
      { ...local(), ENVIRONMENT: 'production' },
      { size: 10, type: 'video/mp4' },
      () => '/local',
    )
    expect(result).toEqual({ error: 'noVideoUpload', status: 501 })
  })
})

describe('PUT /admin/media/video/:id/local', () => {
  async function localTicket(size: number) {
    return (await ticket({ size, type: 'video/mp4' })).json<VideoTicket>()
  }
  const putTo = (url: string, body: Uint8Array<ArrayBuffer>, type = 'video/mp4', env = local()) =>
    app.request(
      url.replace(/^\/api\/cms/, ''),
      { method: 'PUT', headers: { 'content-type': type }, body },
      env,
    )

  it('refuses a body larger or smaller than declared, or of another type, like R2', async () => {
    const t = await localTicket(1000)
    expect((await putTo(t.url, mp4(1001))).status).toBe(403)
    expect((await putTo(t.url, mp4(999))).status).toBe(403)
    expect((await putTo(t.url, mp4(1000), 'video/webm')).status).toBe(403)
    expect(await db.r2.head(videoKey(t.id))).toBeNull()
    expect((await putTo(t.url, mp4(1000))).status).toBe(200)
  })

  it('does not exist in production or once the S3 token is set', async () => {
    const t = await localTicket(10)
    expect((await putTo(t.url, mp4(10), 'video/mp4', withToken())).status).toBe(404)
    const request = new Request('https://example.com', {
      method: 'PUT',
      headers: { 'content-type': 'video/mp4' },
      body: mp4(10),
    })
    expect(
      await putLocalVideo({ ...local(), ENVIRONMENT: 'production' }, request, t.id, 10),
    ).toEqual({ error: 'notFound', status: 404 })
  })
})

describe('POST /admin/media/video/:id', () => {
  it('adds the media row only once the object is in R2, and is safe to retry', async () => {
    const res = await ticket({ size: 10, type: 'video/mp4' })
    const t = await res.json<VideoTicket>()
    const early = await app.request(`/admin/media/video/${t.id}`, json('POST', {}), local())
    expect(early.status).toBe(404)

    const media = await uploaded(mp4(2048))
    expect(media).toMatchObject({ width: 1920, height: 1080, lqip: null })
    const row = await db.d1
      .prepare('select key, mime, size, filename from media where id = ?')
      .bind(media.id)
      .first()
    expect(row).toEqual({
      key: videoKey(media.id),
      mime: 'video/mp4',
      size: 2048,
      filename: 'klippa.mp4',
    })
    const again = await app.request(`/admin/media/video/${media.id}`, json('POST', {}), local())
    expect(again.status).toBe(200)
  })

  it('lets a gallery be saved with the video and a link, and refuses an unknown video', async () => {
    const media = await uploaded(mp4(100))
    const save = (photos: unknown) =>
      app.request(
        '/admin/content/projects',
        json('POST', { data: { title: 'Verk', photos } }),
        local(),
      )
    const ok = await save([
      { kind: 'video', mediaId: media.id },
      { kind: 'embed', url: 'https://vimeo.com/76979871' },
    ])
    expect(ok.status).toBe(201)
    const refs = await db.d1.prepare('select media_id from media_refs').all()
    expect(refs.results).toEqual([{ media_id: media.id }])

    const unknown = await save([{ kind: 'video', mediaId: crypto.randomUUID() }])
    expect(unknown.status).toBe(422)
  })
})

describe('/video/<id>.mp4', () => {
  const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256)
  const get = (path: string, range?: string) =>
    video.request(path, range ? { headers: { range } } : {}, local())

  it('serves the whole file, or the byte range a browser asks for', async () => {
    const id = crypto.randomUUID()
    await db.r2.put(videoKey(id), bytes, { httpMetadata: { contentType: 'video/mp4' } })

    const whole = await get(`/${id}.mp4`)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-type')).toBe('video/mp4')
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes)

    const part = await get(`/${id}.mp4`, 'bytes=100-199')
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 100-199/1000')
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(100, 200))

    const tail = await get(`/${id}.mp4`, 'bytes=-10')
    expect(tail.headers.get('content-range')).toBe('bytes 990-999/1000')
    const open = await get(`/${id}.mp4`, 'bytes=900-')
    expect(open.headers.get('content-range')).toBe('bytes 900-999/1000')
  })

  it('is 404 for unknown or malformed ids', async () => {
    expect((await get(`/${crypto.randomUUID()}.mp4`)).status).toBe(404)
    expect((await get('/../secret.mp4')).status).toBe(404)
    expect((await get(`/${crypto.randomUUID()}.webp`)).status).toBe(404)
  })
})

describe('parseRange', () => {
  it('reads single byte ranges and ignores anything else', () => {
    expect(parseRange('bytes=0-99')).toEqual({ offset: 0, length: 100 })
    expect(parseRange('bytes=5-')).toEqual({ offset: 5 })
    expect(parseRange('bytes=-5')).toEqual({ suffix: 5 })
    expect(parseRange('bytes=9-5')).toBeUndefined()
    expect(parseRange('bytes=0-1,5-6')).toBeUndefined()
    expect(parseRange(undefined)).toBeUndefined()
  })
})
