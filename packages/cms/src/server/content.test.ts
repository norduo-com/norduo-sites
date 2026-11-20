import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { defineCms } from '../define'
import { slug, text } from '../fields'
import { testDatabase } from '../test/d1'
import { contentVersion, createCmsApi, listPublished } from './index'

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
      titleField: 'name',
      fields: {
        name: text({ required: true, i18n: true }),
        description: text({ i18n: true, max: 120, multiline: true }),
      },
    },
    projects: {
      drafts: true,
      fields: {
        title: text({ required: true, i18n: true }),
        slug: slug({ from: 'title' }),
      },
    },
  },
  singletons: {
    settings: { fields: { phone: text({ required: true }) } },
  },
})

let db: Awaited<ReturnType<typeof testDatabase>>
const app = createCmsApi(cms)

beforeAll(async () => {
  db = await testDatabase()
})
afterAll(async () => {
  await db.dispose()
})
beforeEach(async () => {
  await db.reset()
})

const env = () => ({ DB: db.d1, ENVIRONMENT: 'development' })

function call(method: string, path: string, body?: unknown) {
  return app.request(
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

async function create(data: Record<string, unknown>, status: 'draft' | 'published') {
  const res = await call('POST', '/admin/content/equipment', { status, data })
  expect(res.status).toBe(201)
  return (await res.json<{ slug: string }>()).slug
}

async function publicNames() {
  const res = await call('GET', '/content/equipment')
  return (await res.json<{ data: { name: string } }[]>()).map((d) => d.data.name)
}

describe('collection with drafts', () => {
  it('shows a Birt item publicly and keeps a Drög item hidden', async () => {
    await create({ name: 'Kranabíll' }, 'published')
    await create({ name: 'Smágrafa' }, 'draft')
    expect(await publicNames()).toEqual(['Kranabíll'])
  })

  it('lists every item, drafts included, in the admin in creation order', async () => {
    await create({ name: 'Kranabíll' }, 'published')
    await create({ name: 'Smágrafa' }, 'draft')
    const res = await call('GET', '/admin/content/equipment')
    const items = await res.json<{ status: string; data: { name: string } }[]>()
    expect(items.map((i) => [i.data.name, i.status])).toEqual([
      ['Kranabíll', 'published'],
      ['Smágrafa', 'draft'],
    ])
  })

  it('publishes a draft when it is saved as Birt', async () => {
    const slug = await create({ name: 'Smágrafa' }, 'draft')
    const res = await call('PUT', `/admin/content/equipment/${slug}`, {
      status: 'published',
      data: { name: 'Smágrafa 2t' },
    })
    expect(res.status).toBe(200)
    expect(await publicNames()).toEqual(['Smágrafa 2t'])
  })

  it('hides a published item again when it is saved as Drög', async () => {
    const slug = await create({ name: 'Kranabíll' }, 'published')
    await call('PUT', `/admin/content/equipment/${slug}`, {
      status: 'draft',
      data: { name: 'Kranabíll' },
    })
    expect(await publicNames()).toEqual([])
  })

  it('deletes an item', async () => {
    const slug = await create({ name: 'Kranabíll' }, 'published')
    expect((await call('DELETE', `/admin/content/equipment/${slug}`)).status).toBe(200)
    expect(await publicNames()).toEqual([])
    expect((await call('GET', `/admin/content/equipment/${slug}`)).status).toBe(404)
  })

  it('returns one item for the editor', async () => {
    const slug = await create({ name: 'Kranabíll', description: 'Lyftir 10 t' }, 'draft')
    const res = await call('GET', `/admin/content/equipment/${slug}`)
    expect(await res.json()).toMatchObject({
      slug,
      status: 'draft',
      data: { name: 'Kranabíll', description: 'Lyftir 10 t' },
    })
  })

  it('rejects data that breaks the config with 422 and saves nothing', async () => {
    const res = await call('POST', '/admin/content/equipment', {
      status: 'published',
      data: { name: '', description: 'x'.repeat(121) },
    })
    expect(res.status).toBe(422)
    expect(await publicNames()).toEqual([])
  })

  it('returns 404 when updating an item that does not exist', async () => {
    const res = await call('PUT', '/admin/content/equipment/nope', {
      status: 'draft',
      data: { name: 'x' },
    })
    expect(res.status).toBe(404)
  })
})

describe('singletons', () => {
  it('go live on save, without drafts', async () => {
    const res = await call('PUT', '/admin/content/settings/settings', {
      status: 'draft',
      data: { phone: '691 8944' },
    })
    expect(res.status).toBe(200)
    const pub = await call('GET', '/content/settings')
    expect(await pub.json()).toMatchObject([{ data: { phone: '691 8944' } }])
  })
})

describe('content version (edge cache key)', () => {
  it('changes on every save and delete, drafts included', async () => {
    const seen = new Set([await contentVersion(db.d1)])
    const slug = await create({ name: 'Kranabíll' }, 'published')
    seen.add(await contentVersion(db.d1))
    await call('PUT', `/admin/content/equipment/${slug}`, {
      status: 'draft',
      data: { name: 'Kranabíll' },
    })
    seen.add(await contentVersion(db.d1))
    await call('DELETE', `/admin/content/equipment/${slug}`)
    seen.add(await contentVersion(db.d1))
    expect(seen.size).toBe(4)
  })
})

describe('listPublished (site loaders)', () => {
  it('returns only the asked-for fields of published items, in order', async () => {
    await create({ name: 'Kranabíll', description: 'Lyftir 10 t' }, 'published')
    await create({ name: 'Smágrafa' }, 'draft')
    await create({ name: 'Vörubíll', description: 'Flytur efni' }, 'published')
    const items = await listPublished(db.d1, cms, 'equipment', { fields: ['name'] })
    expect(items.map((i) => i.data)).toEqual([{ name: 'Kranabíll' }, { name: 'Vörubíll' }])
    expect(items.every((i) => i.slug.length > 0)).toBe(true)
  })
})

describe('slug fields', () => {
  async function createProject(title: string, status: 'draft' | 'published') {
    const res = await call('POST', '/admin/content/projects', { status, data: { title } })
    expect(res.status).toBe(201)
    return (await res.json<{ slug: string }>()).slug
  }
  const save = (id: string, data: Record<string, unknown>, status = 'draft', locale = 'is') =>
    call('PUT', `/admin/content/projects/${id}`, { status, locale, data })
  async function slugOf(id: string, locale = 'is') {
    const res = await call('GET', `/admin/content/projects/${id}?locale=${locale}`)
    return (await res.json<{ data: { slug?: string } }>()).data.slug
  }

  it('makes the slug from the title, spelling Icelandic letters in plain ASCII', async () => {
    const id = await createProject('Þökulögn og hellur í Garðabæ!', 'draft')
    expect(await slugOf(id)).toBe('thokulogn-og-hellur-i-gardabae')
  })

  it('follows the title while the project is a draft, ignoring a slug sent by the client', async () => {
    const id = await createProject('Hellulögn', 'draft')
    await save(id, { title: 'Hellulögn í Kópavogi', slug: 'eitthvad-annad' })
    expect(await slugOf(id)).toBe('hellulogn-i-kopavogi')
  })

  it('locks on first publish: later title changes and drafts keep it', async () => {
    const id = await createProject('Hellulögn', 'draft')
    await save(id, { title: 'Hellulögn' }, 'published')
    await save(id, { title: 'Ný hellulögn', slug: 'ny-hellulogn' }, 'published')
    await save(id, { title: 'Ný hellulögn' }, 'draft')
    expect(await slugOf(id)).toBe('hellulogn')
  })

  it('locks when the project is created as Birt', async () => {
    const id = await createProject('Grjóthleðsla', 'published')
    await save(id, { title: 'Grjótveggur' }, 'published')
    expect(await slugOf(id)).toBe('grjothledsla')
  })

  it('adds a number when another project already has the slug', async () => {
    await createProject('Hellulögn', 'published')
    const second = await createProject('Hellulögn', 'draft')
    const third = await createProject('Hellulögn', 'draft')
    expect(await slugOf(second)).toBe('hellulogn-2')
    expect(await slugOf(third)).toBe('hellulogn-3')
  })

  it('shares one slug across locales, made from the Icelandic title', async () => {
    const id = await createProject('Hellulögn', 'draft')
    await save(id, { title: 'Paving' }, 'draft', 'en')
    expect(await slugOf(id, 'en')).toBe('hellulogn')
  })

  it('updates the English row when the Icelandic title changes a draft slug', async () => {
    const id = await createProject('Hellulögn', 'draft')
    await save(id, { title: 'Paving' }, 'draft', 'en')
    await save(id, { title: 'Grjótveggur' })
    expect(await slugOf(id, 'en')).toBe('grjotveggur')
  })

  it('waits for the Icelandic title before making a slug for an item created in English', async () => {
    const res = await call('POST', '/admin/content/projects', {
      status: 'draft',
      locale: 'en',
      data: { title: 'Paving' },
    })
    const id = (await res.json<{ slug: string }>()).slug
    expect(await slugOf(id, 'en')).toBeUndefined()
    await save(id, { title: 'Hellulögn' })
    expect(await slugOf(id, 'en')).toBe('hellulogn')
  })
})
