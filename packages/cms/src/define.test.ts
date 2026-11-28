import { describe, expect, it } from 'vitest'

import {
  block,
  blocks,
  defineCms,
  gallery,
  pageFields,
  schemaOf,
  select,
  seo,
  slug,
  text,
} from './index'
import { createCmsApi } from './server'

const cms = defineCms({
  site: {
    id: 'test',
    name: 'Test',
    url: 'https://example.com',
    locales: ['is', 'en'],
    defaultLocale: 'is',
  },
  collections: {
    projects: {
      fields: {
        title: text({ required: true, i18n: true }),
        status: select(['draft', 'done'] as const),
        photos: gallery(),
      },
    },
    posts: {
      fields: {
        title: text({ required: true }),
        body: blocks({
          hero: block({ heading: text({ required: true }) }),
          quote: block({ intro: text() }),
        }),
      },
    },
  },
})

describe('schemaOf', () => {
  const schema = schemaOf(cms.collections.projects.fields)

  it('accepts valid data and treats unmarked fields as optional', () => {
    expect(schema.safeParse({ title: 'Hellulögn' }).success).toBe(true)
  })

  it('rejects a missing required field', () => {
    expect(schema.safeParse({ photos: [] }).success).toBe(false)
  })

  it('rejects a value outside a select', () => {
    expect(schema.safeParse({ title: 'x', status: 'nope' }).success).toBe(false)
  })

  it('validates page blocks by type', () => {
    const pages = schemaOf(cms.collections.posts.fields)
    expect(
      pages.safeParse({ title: 'Forsíða', body: [{ type: 'hero', data: { heading: 'Hæ' } }] })
        .success,
    ).toBe(true)
    expect(pages.safeParse({ title: 'Forsíða', body: [{ type: 'hero', data: {} }] }).success).toBe(
      false,
    )
  })
})

describe('defineCms', () => {
  it('rejects a slug made from a field the collection does not have', () => {
    expect(() =>
      defineCms({
        site: { id: 'x', name: 'X', url: 'https://x.is', locales: ['is'], defaultLocale: 'is' },
        collections: { projects: { fields: { title: text(), slug: slug({ from: 'titel' }) } } },
      }),
    ).toThrow(/titel/)
  })

  it('rejects an seo fallback the collection or singleton does not have', () => {
    const site = {
      id: 'x',
      name: 'X',
      url: 'https://x.is',
      locales: ['is'],
      defaultLocale: 'is',
    } as const
    expect(() =>
      defineCms({
        site,
        collections: { projects: { fields: { title: text(), seo: seo({ titleFrom: 'titel' }) } } },
      }),
    ).toThrow(/titel/)
    expect(() =>
      defineCms({
        site,
        collections: {},
        singletons: { settings: { fields: { seo: seo({ descriptionFrom: 'lead' }) } } },
      }),
    ).toThrow(/lead/)
  })

  it('rejects a default locale that is not listed', () => {
    expect(() =>
      defineCms({
        site: { id: 'x', name: 'X', url: 'https://x.is', locales: ['is'], defaultLocale: 'en' },
        collections: {},
      }),
    ).toThrow()
  })
})

describe('createCmsApi', () => {
  const app = createCmsApi(cms)

  it('answers health checks', async () => {
    const res = await app.request('/health')
    expect(await res.json()).toEqual({ ok: true, site: 'test' })
  })

  it('has no public content or enquiry routes', async () => {
    expect((await app.request('/content/equipment')).status).toBe(404)
    expect((await app.request('/enquiries', { method: 'POST' })).status).toBe(404)
  })

  it('keeps the admin closed when ENVIRONMENT is missing', async () => {
    expect((await app.request('/admin/config', {}, {})).status).toBe(401)
    expect((await app.request('/admin/config', {}, { ENVIRONMENT: 'prod' })).status).toBe(401)
  })
})

describe('pages', () => {
  const site = {
    id: 'x',
    name: 'X',
    url: 'https://x.is',
    locales: ['is'],
    defaultLocale: 'is',
  } as const
  const library = {
    intro: block({ heading: text() }),
    serviceList: block({ heading: text() }),
  }
  const withPages = defineCms({
    site,
    collections: {},
    blocks: library,
    pages: {
      home: {
        route: '/',
        fields: { title: text({ required: true }), lead: text() },
        seo: seo({ titleFrom: 'title', descriptionFrom: 'lead' }),
        blocks: ['intro'],
      },
    },
  })

  it('have their header fields, seo and the blocks they allow', () => {
    const schema = schemaOf(pageFields(withPages, 'home'))
    const intro = { type: 'intro', data: { heading: 'Hæ' } }
    expect(
      schema.safeParse({ title: 'Forsíða', seo: { title: 'Berghald' }, blocks: [intro] }).success,
    ).toBe(true)
    expect(schema.safeParse({ title: '' }).success).toBe(false)
    const notAllowed = { type: 'serviceList', data: {} }
    expect(schema.safeParse({ title: 'Forsíða', blocks: [notAllowed] }).success).toBe(false)
  })

  const page = (extra: Record<string, unknown>) => ({
    route: '/',
    fields: { title: text() },
    seo: seo(),
    ...extra,
  })
  const define =
    (pages: Record<string, unknown>, more: Record<string, unknown> = {}) =>
    () =>
      defineCms({ site, collections: {}, blocks: library, pages, ...more } as never)

  it('reject a block that is not in the library', () => {
    expect(define({ home: page({ blocks: ['hero'] }) })).toThrow(/hero/)
  })

  it('may share a name with a collection, since pages are stored apart', () => {
    expect(
      define({ projects: page({}) }, { collections: { projects: { fields: {} } } }),
    ).not.toThrow()
  })

  it('reject a route that is not a path, or one used twice', () => {
    expect(define({ home: page({ route: 'thjonusta' }) })).toThrow(/route/)
    expect(define({ a: page({ route: '/x' }), b: page({ route: '/x' }) })).toThrow(/\/x/)
  })

  it('reject header fields named seo or blocks', () => {
    expect(define({ home: page({ fields: { seo: text() } }) })).toThrow(/seo/)
  })

  it('reject an seo fallback that is not a header field', () => {
    expect(define({ home: page({ seo: seo({ titleFrom: 'titel' }) }) })).toThrow(/titel/)
  })
})
