import { describe, expect, it } from 'vitest'

import { block, blocks, defineCms, gallery, schemaOf, select, slug, text } from './index'
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
    pages: {
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
    const pages = schemaOf(cms.collections.pages.fields)
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

  it('returns 404 for an unknown content type', async () => {
    const res = await app.request('/content/nope')
    expect(res.status).toBe(404)
  })

  it('rejects an invalid enquiry before touching the database', async () => {
    const res = await app.request('/enquiries', {
      method: 'POST',
      body: JSON.stringify({ name: '', email: 'not-an-email' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })
})
