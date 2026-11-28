import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { defineCms } from '../define'
import { block, richText, slug, text } from '../fields'
import { seo } from '../seo'
import { testDatabase } from '../test/d1'
import {
  contentVersion,
  createCmsApi,
  getPage,
  getSingleton,
  listPublished,
  pageHeaders,
} from './index'

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
  blocks: { text: block({ heading: text({ i18n: true }), body: richText({ i18n: true }) }) },
  pages: {
    // Shares its name with the collection below: pages are stored apart.
    equipment: {
      route: '/thjonusta',
      localeRoutes: { en: '/services' },
      fields: {
        title: text({ required: true, i18n: true }),
        heading: text({ i18n: true }),
        lead: text({ i18n: true }),
      },
      seo: seo({ titleFrom: 'title', descriptionFrom: 'lead' }),
      blocks: ['text'],
    },
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
  const items = await listPublished(db.d1, cms, 'equipment', { fields: ['name'] })
  return items.map((d) => d.data.name)
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
    const saved = await call('GET', '/admin/content/settings/settings')
    expect(await saved.json()).toMatchObject({ status: 'published', data: { phone: '691 8944' } })
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

  it('in English, lists every item and fills untranslated fields from Icelandic', async () => {
    const crane = await create({ name: 'Kranabíll', description: 'Lyftir 10 t' }, 'published')
    await create({ name: 'Vörubíll', description: 'Flytur efni' }, 'published')
    await call('PUT', `/admin/content/equipment/${crane}`, {
      locale: 'en',
      status: 'published',
      data: { name: 'Crane truck', description: '' },
    })
    const items = await listPublished(db.d1, cms, 'equipment', {
      fields: ['name', 'description'],
      locale: 'en',
    })
    expect(items.map((i) => i.data)).toEqual([
      { name: 'Crane truck', description: 'Lyftir 10 t' },
      { name: 'Vörubíll', description: 'Flytur efni' },
    ])
  })
})

describe('getSingleton and pageHeaders (site loaders)', () => {
  it('read a singleton, with English falling back to Icelandic', async () => {
    expect(await getSingleton(db.d1, cms, 'settings')).toBeNull()
    await call('PUT', '/admin/content/settings/settings', { data: { phone: '691 8944' } })
    expect(await getSingleton(db.d1, cms, 'settings', { locale: 'en' })).toEqual({
      phone: '691 8944',
    })
  })

  it('give the asked-for header fields of every saved page', async () => {
    await call('PUT', '/admin/content/pages/equipment', {
      data: { title: 'Þjónusta', lead: 'Allt á einum stað.' },
    })
    expect(await pageHeaders(db.d1, cms, ['title'])).toEqual({ equipment: { title: 'Þjónusta' } })
    expect(await pageHeaders(db.d1, cms, ['title'], { locale: 'en' })).toEqual({
      equipment: { title: 'Þjónusta' },
    })
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

  it('refuses an item created in English: Icelandic comes first', async () => {
    const res = await call('POST', '/admin/content/projects', {
      status: 'draft',
      locale: 'en',
      data: { title: 'Paving' },
    })
    expect(res.status).toBe(409)
  })
})

describe('pages', () => {
  const header = { title: 'Þjónusta', heading: 'Við mótum lóðina þína', lead: 'Allt á einum stað.' }

  it('go live on save, header, seo and blocks included', async () => {
    const data = {
      ...header,
      seo: { keyword: 'garðaþjónusta', title: 'Garðaþjónusta – Berghald' },
      blocks: [{ type: 'text', data: { heading: 'Um okkur' } }],
    }
    const res = await call('PUT', '/admin/content/pages/equipment', { status: 'draft', data })
    expect(res.status).toBe(200)
    expect(await getPage(db.d1, cms, 'equipment')).toEqual(data)
    expect(await publicNames()).toEqual([])
  })

  it('are saved per locale; English texts not yet translated show the Icelandic', async () => {
    await call('PUT', '/admin/content/pages/equipment', { data: header })
    await call('PUT', '/admin/content/pages/equipment', {
      locale: 'en',
      data: { title: 'Services' },
    })
    expect(await getPage(db.d1, cms, 'equipment', { locale: 'en' })).toEqual({
      ...header,
      title: 'Services',
    })
    expect(await getPage(db.d1, cms, 'equipment')).toEqual(header)
  })

  it('refuse an English save before the Icelandic one', async () => {
    const res = await call('PUT', '/admin/content/pages/equipment', {
      locale: 'en',
      data: { title: 'Services' },
    })
    expect(res.status).toBe(409)
  })

  it('give nothing before their first save', async () => {
    expect(await getPage(db.d1, cms, 'equipment')).toBeNull()
  })

  it('reject an SEO description over 160 characters and a block they do not allow', async () => {
    const long = { ...header, seo: { description: 'a'.repeat(161) } }
    expect((await call('PUT', '/admin/content/pages/equipment', { data: long })).status).toBe(422)
    const hero = { ...header, blocks: [{ type: 'hero', data: {} }] }
    expect((await call('PUT', '/admin/content/pages/equipment', { data: hero })).status).toBe(422)
  })

  it('reject a share image that is not in the media library', async () => {
    const data = { ...header, seo: { image: { mediaId: 'nope' } } }
    expect((await call('PUT', '/admin/content/pages/equipment', { data })).status).toBe(422)
  })

  it('cannot be created under another name or deleted', async () => {
    expect((await call('PUT', '/admin/content/pages/other', { data: header })).status).toBe(404)
    expect((await call('POST', '/admin/content/pages', { data: header })).status).toBe(404)
    await call('PUT', '/admin/content/pages/equipment', { data: header })
    expect((await call('DELETE', '/admin/content/pages/equipment')).status).toBe(404)
    expect(await getPage(db.d1, cms, 'equipment')).toEqual(header)
  })
})

describe('order of new items', () => {
  it('puts each new item last, with the same place in every locale', async () => {
    const a = await create({ name: 'Kranabíll' }, 'published')
    const b = await create({ name: 'Smágrafa' }, 'published')
    const { results } = await db.d1
      .prepare("select slug, locale, sort from documents where type = 'equipment' order by sort")
      .all<{ slug: string; locale: string; sort: number }>()
    const sortOf = (slug: string, locale: string) =>
      results.find((r) => r.slug === slug && r.locale === locale)?.sort
    expect(sortOf(a, 'is')).toBe(0)
    expect(sortOf(a, 'en')).toBe(0)
    expect(sortOf(b, 'is')).toBe(1)
    expect(sortOf(b, 'en')).toBe(1)
  })
})
