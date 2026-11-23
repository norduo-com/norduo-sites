import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { defineCms } from '../define'
import { gallery, image, text } from '../fields'
import type { MediaInfo } from '../media'
import { testDatabase } from '../test/d1'
import { type AdminMedia, contentVersion, createCmsApi, mediaByIds, type MediaUses } from './index'

/** Myndasafn: listing photos with where they're used, alt text and the delete rules. */

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
      titleField: 'name',
      fields: { name: text({ required: true, i18n: true }), photo: image() },
    },
    projects: {
      titleField: 'title',
      fields: { title: text({ required: true, i18n: true }), photos: gallery() },
    },
  },
})

let db: Awaited<ReturnType<typeof testDatabase>>
const api = createCmsApi(cms)

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

function call(method: string, path: string, body?: unknown) {
  return api.request(
    path,
    {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    },
    env(),
  )
}

async function uploaded(name = 'mynd.webp'): Promise<MediaInfo> {
  const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#4a7' } })
    .webp()
    .toBuffer()
  const form = new FormData()
  form.append('file', new File([new Uint8Array(bytes)], name, { type: 'image/webp' }))
  const res = await api.request('/admin/media', { method: 'POST', body: form }, env())
  expect(res.status).toBe(201)
  return res.json<MediaInfo>()
}

async function create(type: string, data: Record<string, unknown>) {
  const res = await call('POST', `/admin/content/${type}`, { status: 'published', data })
  expect(res.status).toBe(201)
  return (await res.json<{ slug: string }>()).slug
}

const list = async () => (await call('GET', '/admin/media')).json<AdminMedia[]>()

describe('GET /admin/media', () => {
  it('lists photos newest first, with the documents that use them', async () => {
    const a = await uploaded('a.webp')
    const b = await uploaded('b.webp')
    const slug = await create('equipment', { name: 'Kranabíll', photo: { mediaId: a.id } })
    // A second locale of the same document is one use, not two.
    await call('PUT', `/admin/content/equipment/${slug}`, {
      locale: 'en',
      status: 'published',
      data: { name: 'Crane', photo: { mediaId: a.id } },
    })

    const items = await list()
    expect(items.map((i) => i.filename).sort()).toEqual(['a.webp', 'b.webp'])
    expect(items.find((i) => i.id === a.id)?.uses).toEqual([{ type: 'equipment', slug }])
    expect(items.find((i) => i.id === b.id)?.uses).toEqual([])
  })
})

describe('PATCH /admin/media/:id', () => {
  it('sets the alt everywhere and bumps the content version', async () => {
    const a = await uploaded()
    const before = await contentVersion(db.d1)
    expect(
      (await call('PATCH', `/admin/media/${a.id}`, { alt: ' Kranabíll við vinnu ' })).status,
    ).toBe(200)
    expect((await mediaByIds(db.d1, [a.id])).get(a.id)?.alt).toBe('Kranabíll við vinnu')
    expect(await contentVersion(db.d1)).toBe(before + 1)

    await call('PATCH', `/admin/media/${a.id}`, { alt: '' })
    expect((await mediaByIds(db.d1, [a.id])).get(a.id)?.alt).toBeNull()
  })

  it('is a 404 for an unknown photo', async () => {
    expect((await call('PATCH', '/admin/media/nope', { alt: 'x' })).status).toBe(404)
  })
})

describe('DELETE /admin/media/:id', () => {
  it('deletes an unused photo, its row and its master', async () => {
    const a = await uploaded()
    expect((await call('DELETE', `/admin/media/${a.id}`)).status).toBe(200)
    expect(await list()).toEqual([])
    expect((await db.r2.list()).objects).toEqual([])
  })

  it('refuses while an image() field uses it, naming the document', async () => {
    const a = await uploaded()
    const slug = await create('equipment', { name: 'Kranabíll', photo: { mediaId: a.id } })
    await create('projects', { title: 'Garður', photos: [{ mediaId: a.id }] })

    const res = await call('DELETE', `/admin/media/${a.id}?galleries=remove`)
    expect(res.status).toBe(409)
    const body = await res.json<{ error: string; uses: MediaUses }>()
    expect(body.error).toBe('inUse')
    expect(body.uses.image).toEqual([{ type: 'equipment', slug, title: 'Kranabíll' }])
    expect(await list()).toHaveLength(1)
  })

  it('asks before removing it from galleries, then removes it from every locale', async () => {
    const a = await uploaded()
    const b = await uploaded()
    const slug = await create('projects', {
      title: 'Garður',
      photos: [{ mediaId: a.id }, { mediaId: b.id }],
    })
    await call('PUT', `/admin/content/projects/${slug}`, {
      locale: 'en',
      status: 'published',
      data: { title: 'Garden', photos: [{ mediaId: a.id }] },
    })

    const uses = await (await call('GET', `/admin/media/${a.id}/uses`)).json<MediaUses>()
    expect(uses).toEqual({ image: [], gallery: [{ type: 'projects', slug, title: 'Garður' }] })

    const unconfirmed = await call('DELETE', `/admin/media/${a.id}`)
    expect(unconfirmed.status).toBe(409)
    expect(await unconfirmed.json()).toMatchObject({ error: 'inGalleries' })

    const before = await contentVersion(db.d1)
    expect((await call('DELETE', `/admin/media/${a.id}?galleries=remove`)).status).toBe(200)
    expect(await contentVersion(db.d1)).toBe(before + 1)

    const photosOf = async (locale: string) =>
      (
        await (
          await call('GET', `/admin/content/projects/${slug}?locale=${locale}`)
        ).json<{
          data: { photos: { mediaId: string }[] }
        }>()
      ).data.photos
    expect(await photosOf('is')).toEqual([{ mediaId: b.id }])
    expect(await photosOf('en')).toEqual([])
    expect((await list()).map((i) => [i.id, i.uses.length])).toEqual([[b.id, 1]])
  })

  it('is a 404 for an unknown photo', async () => {
    expect((await call('DELETE', '/admin/media/nope')).status).toBe(404)
  })
})
