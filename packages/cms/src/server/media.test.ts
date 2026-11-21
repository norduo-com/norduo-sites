import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { defineCms } from '../define'
import { image, text } from '../fields'
import type { MediaInfo } from '../media'
import { testDatabase } from '../test/d1'
import { createCmsApi, createImageRoute, mediaByIds } from './index'

const cms = defineCms({
  site: {
    id: 'test',
    name: 'Test',
    url: 'https://example.com',
    locales: ['is', 'en'],
    defaultLocale: 'is',
  },
  collections: {
    equipment: {
      drafts: true,
      fields: { name: text({ required: true, i18n: true }), photo: image() },
    },
  },
})

let db: Awaited<ReturnType<typeof testDatabase>>
const api = createCmsApi(cms)
const img = createImageRoute()

beforeAll(async () => {
  db = await testDatabase()
})
afterAll(async () => {
  await db.dispose()
})
beforeEach(async () => {
  await db.reset()
})

const env = () => ({ DB: db.d1, MEDIA: db.r2, IMAGES: db.images, ENVIRONMENT: 'development' })

/** A synthetic photo; `exif` adds camera and GPS tags like a phone's. */
async function photo(
  format: 'webp' | 'jpeg',
  width: number,
  height: number,
  { exif = false } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  let s = sharp({ create: { width, height, channels: 3, background: '#4a7' } })
  if (exif) {
    s = s.withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone 15' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '64/1 8/1 0/1' },
    })
  }
  return new Uint8Array(await s.toFormat(format).toBuffer())
}

function upload(bytes: Uint8Array<ArrayBuffer>, type: string, name = 'mynd.jpg') {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type }))
  return api.request('/admin/media', { method: 'POST', body: form }, env())
}

async function uploaded(bytes: Uint8Array<ArrayBuffer>, type: string) {
  const res = await upload(bytes, type)
  expect(res.status).toBe(201)
  return res.json<MediaInfo>()
}

function getImage(path: string, accept?: string) {
  return img.request(path, accept ? { headers: { accept } } : {}, env())
}

const sizeOf = async (res: Response) => sharp(await res.arrayBuffer()).metadata()

describe('POST /admin/media', () => {
  it('stores a browser-made WebP master with its size and a blurred preview', async () => {
    const media = await uploaded(await photo('webp', 1600, 1200), 'image/webp')
    expect(media).toMatchObject({ width: 1600, height: 1200 })
    expect(media.lqip).toMatch(/^data:image\/webp;base64,/)
    const stored = await db.r2.head(`media/${media.id}.webp`)
    expect(stored?.httpMetadata?.contentType).toBe('image/webp')
  })

  it('turns a JPEG (from a browser that cannot encode WebP) into a WebP master', async () => {
    const media = await uploaded(await photo('jpeg', 1200, 900), 'image/jpeg')
    const stored = await db.r2.get(`media/${media.id}.webp`)
    const meta = await sharp((await stored?.arrayBuffer()) ?? new ArrayBuffer(0)).metadata()
    expect(meta.format).toBe('webp')
    expect([meta.width, meta.height]).toEqual([1200, 900])
  })

  it('refuses a file that still has EXIF, so no location data reaches R2', async () => {
    for (const format of ['webp', 'jpeg'] as const) {
      const res = await upload(await photo(format, 800, 600, { exif: true }), `image/${format}`)
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ error: 'metadata' })
    }
    expect((await db.r2.list()).objects).toEqual([])
  })

  it('refuses a master wider than 2560 px, since the browser shrinks it first', async () => {
    const res = await upload(await photo('webp', 3000, 2000), 'image/webp')
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'tooLarge' })
  })

  it('refuses files that are not WebP or JPEG', async () => {
    const res = await upload(new TextEncoder().encode('hello'), 'text/plain', 'a.txt')
    expect(res.status).toBe(415)
  })
})

describe('raw HEIC the browser cannot decode', () => {
  const raw = (bytes: Uint8Array<ArrayBuffer>) =>
    api.request(
      '/admin/media/raw?filename=IMG_0001.HEIC',
      { method: 'POST', body: bytes, headers: { 'content-type': 'image/heic' } },
      env(),
    )
  const process = (id: string) => api.request(`/admin/media/raw/${id}`, { method: 'POST' }, env())

  it('goes to tmp/, becomes a WebP master, and tmp/ is emptied', async () => {
    // The local binding can't decode HEIC, so a JPEG stands in for one.
    const res = await raw(await photo('jpeg', 3200, 2400))
    expect(res.status).toBe(201)
    const { id } = await res.json<{ id: string }>()
    expect(await db.r2.head(`tmp/${id}`)).not.toBeNull()

    const made = await process(id)
    expect(made.status).toBe(201)
    expect(await made.json<MediaInfo>()).toMatchObject({ id, width: 2560, height: 1920 })
    expect(await db.r2.head(`tmp/${id}`)).toBeNull()
    expect(await db.r2.head(`media/${id}.webp`)).not.toBeNull()

    // A retry after a lost response gets the same photo back.
    const again = await process(id)
    expect(again.status).toBe(200)
    expect(await again.json<MediaInfo>()).toMatchObject({ id, width: 2560 })
  })

  it('refuses a file over 20 MB before it reaches the Images binding', async () => {
    const res = await raw(new Uint8Array(20 * 1024 * 1024 + 1))
    expect(res.status).toBe(413)
    expect((await db.r2.list()).objects).toEqual([])
  })

  it('reports a file the Worker cannot read either, and deletes it', async () => {
    const { id } = await (await raw(new TextEncoder().encode('not a photo'))).json<{ id: string }>()
    const res = await process(id)
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({ error: 'undecodable' })
    expect(await db.r2.head(`tmp/${id}`)).toBeNull()
  })
})

describe('GET /img/<width>/<id>', () => {
  it('serves each of the four widths, with format chosen from Accept', async () => {
    const { id } = await uploaded(await photo('webp', 2560, 1920), 'image/webp')
    for (const width of [480, 960, 1440, 1920]) {
      const res = await getImage(`/${String(width)}/${id}`, 'image/webp,*/*')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(res.headers.get('vary')).toBe('Accept')
      expect(res.headers.get('cache-control')).toContain('immutable')
      expect((await sizeOf(res)).width).toBe(width)
    }
    const avif = await getImage(`/960/${id}`, 'image/avif,image/webp')
    expect(avif.headers.get('content-type')).toBe('image/avif')
    // AVIF output stops at 1,200 px.
    const wide = await getImage(`/1440/${id}`, 'image/avif,image/webp')
    expect(wide.headers.get('content-type')).toBe('image/webp')
    const old = await getImage(`/480/${id}`)
    expect(old.headers.get('content-type')).toBe('image/jpeg')
  })

  it('never upscales a small master', async () => {
    const { id } = await uploaded(await photo('webp', 600, 400), 'image/webp')
    expect((await sizeOf(await getImage(`/1920/${id}`, 'image/webp'))).width).toBe(600)
  })

  it('serves only the fixed widths, so nobody can use up the transformation quota', async () => {
    const { id } = await uploaded(await photo('webp', 800, 600), 'image/webp')
    expect((await getImage(`/500/${id}`)).status).toBe(404)
    expect((await getImage(`/480/${crypto.randomUUID()}`)).status).toBe(404)
    expect((await getImage('/480/..%2Fbackups%2Fx')).status).toBe(404)
  })
})

describe('media_refs', () => {
  const save = (
    method: 'POST' | 'PUT',
    path: string,
    data: Record<string, unknown>,
    locale = 'is',
  ) =>
    api.request(
      `/admin/content/equipment${path}`,
      {
        method,
        body: JSON.stringify({ status: 'published', locale, data }),
        headers: { 'content-type': 'application/json' },
      },
      env(),
    )
  const refs = async () =>
    (
      await db.d1
        .prepare('select media_id, doc_slug, locale from media_refs order by locale')
        .all<{ media_id: string; doc_slug: string; locale: string }>()
    ).results

  it('is rewritten on every save, per locale, and cleared on delete', async () => {
    const a = await uploaded(await photo('webp', 800, 600), 'image/webp')
    const b = await uploaded(await photo('webp', 800, 600), 'image/webp')
    const created = await save('POST', '', { name: 'Krani', photo: { mediaId: a.id } })
    const { slug } = await created.json<{ slug: string }>()
    expect(await refs()).toEqual([{ media_id: a.id, doc_slug: slug, locale: 'is' }])

    await save('PUT', `/${slug}`, { name: 'Crane', photo: { mediaId: a.id } }, 'en')
    await save('PUT', `/${slug}`, { name: 'Krani', photo: { mediaId: b.id } })
    expect(await refs()).toEqual([
      { media_id: a.id, doc_slug: slug, locale: 'en' },
      { media_id: b.id, doc_slug: slug, locale: 'is' },
    ])

    await save('PUT', `/${slug}`, { name: 'Krani' })
    expect(await refs()).toEqual([{ media_id: a.id, doc_slug: slug, locale: 'en' }])

    await api.request(`/admin/content/equipment/${slug}`, { method: 'DELETE' }, env())
    expect(await refs()).toEqual([])
  })

  it('refuses a save that points at a photo that does not exist', async () => {
    const res = await save('POST', '', { name: 'Krani', photo: { mediaId: 'nope' } })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'unknownMedia' })
  })
})

describe('mediaByIds', () => {
  it('gives the site each photo’s size and blurred preview', async () => {
    const a = await uploaded(await photo('webp', 800, 600), 'image/webp')
    const found = await mediaByIds(db.d1, [a.id, 'missing'])
    expect(found.get(a.id)).toEqual({ ...a, alt: null })
    expect(found.has('missing')).toBe(false)
  })
})
