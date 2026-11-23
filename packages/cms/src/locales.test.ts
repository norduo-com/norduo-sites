import { describe, expect, it } from 'vitest'

import { defineCms } from './define'
import { text } from './fields'
import {
  isBlank,
  localeAlternates,
  localeOfPath,
  pageAtPath,
  pagePath,
  pagePaths,
  switchLocalePath,
  withFallback,
} from './locales'
import { seo } from './seo'
import { sitemapXml } from './sitemap'

const page = (route: string | undefined, en?: string) => ({
  ...(route === undefined ? {} : { route }),
  ...(en === undefined ? {} : { localeRoutes: { en } }),
  fields: { title: text({ i18n: true }) },
  seo: seo({ titleFrom: 'title' }),
})

const site = {
  id: 'test',
  name: 'Test',
  url: 'https://example.com',
  locales: ['is', 'en'],
  defaultLocale: 'is',
} as const

const cms = defineCms({
  site,
  collections: {},
  pages: {
    home: page('/', '/'),
    projects: page('/verkefni', '/projects'),
    services: page('/thjonusta', '/services'),
    notFound: page(undefined),
  },
})

describe('page paths', () => {
  it('puts the default locale at the root and others under their prefix', () => {
    expect(pagePath(cms, 'projects', 'is')).toBe('/verkefni')
    expect(pagePath(cms, 'projects', 'en')).toBe('/en/projects')
    expect(pagePath(cms, 'home', 'is')).toBe('/')
    expect(pagePath(cms, 'home', 'en')).toBe('/en')
    expect(pagePath(cms, 'notFound', 'en')).toBeUndefined()
  })

  it('lists every routed page in every locale', () => {
    expect(pagePaths(cms).map((p) => p.name)).toEqual(['home', 'projects', 'services'])
  })

  it('finds the page and locale a path belongs to', () => {
    expect(pageAtPath(cms, '/en/projects/x')).toEqual({
      page: 'projects',
      locale: 'en',
      rest: '/x',
    })
    expect(pageAtPath(cms, '/thjonusta')).toEqual({ page: 'services', locale: 'is', rest: '' })
    expect(pageAtPath(cms, '/en')).toEqual({ page: 'home', locale: 'en', rest: '' })
    expect(pageAtPath(cms, '/nope')).toBeUndefined()
  })

  it('reads the locale from the first segment only', () => {
    expect(localeOfPath(cms, '/en/projects')).toBe('en')
    expect(localeOfPath(cms, '/en')).toBe('en')
    expect(localeOfPath(cms, '/english')).toBe('is')
    expect(localeOfPath(cms, '/is/verkefni')).toBe('is')
    expect(localeOfPath(cms, '/')).toBe('is')
  })
})

describe('switchLocalePath', () => {
  it('swaps the prefix and the page segment and keeps the slug', () => {
    expect(switchLocalePath(cms, '/verkefni/hellulogn', 'en')).toBe('/en/projects/hellulogn')
    expect(switchLocalePath(cms, '/en/projects/hellulogn', 'is')).toBe('/verkefni/hellulogn')
  })

  it('keeps the query string and hash', () => {
    expect(switchLocalePath(cms, '/verkefni/x?forskodun=abc#myndir', 'en')).toBe(
      '/en/projects/x?forskodun=abc#myndir',
    )
    expect(switchLocalePath(cms, '/?s=tilbod', 'en')).toBe('/en?s=tilbod')
  })

  it('maps the home page both ways', () => {
    expect(switchLocalePath(cms, '/', 'en')).toBe('/en')
    expect(switchLocalePath(cms, '/en', 'is')).toBe('/')
    expect(switchLocalePath(cms, '/en/', 'is')).toBe('/')
  })

  it('returns the same path for its own locale', () => {
    expect(switchLocalePath(cms, '/thjonusta', 'is')).toBe('/thjonusta')
    expect(switchLocalePath(cms, '/en/services', 'en')).toBe('/en/services')
  })

  it('only matches whole segments, and keeps a path no page owns', () => {
    expect(switchLocalePath(cms, '/verkefnin', 'en')).toBe('/en/verkefnin')
    expect(switchLocalePath(cms, '/en/nope', 'is')).toBe('/nope')
  })

  it('gives the alternates in every locale', () => {
    expect(localeAlternates(cms, '/en/services')).toEqual([
      { locale: 'is', path: '/thjonusta' },
      { locale: 'en', path: '/en/services' },
    ])
  })
})

describe('locale routes in the config', () => {
  const pagesWith = (pages: Record<string, ReturnType<typeof page>>) => () =>
    defineCms({ site, collections: {}, pages })

  it('are required for every other locale', () => {
    expect(pagesWith({ a: page('/a') })).toThrow('no route for "en"')
  })

  it('must be unique within a locale', () => {
    expect(pagesWith({ a: page('/a', '/x'), b: page('/b', '/x') })).toThrow('used by two pages')
  })

  it('reject a locale the site does not have, or the default one', () => {
    const de = { ...page('/a', '/a'), localeRoutes: { en: '/a', de: '/a' } }
    expect(pagesWith({ a: de })).toThrow('"de"')
    const is = { ...page('/a', '/a'), localeRoutes: { en: '/a', is: '/a' } }
    expect(pagesWith({ a: is })).toThrow('"is"')
  })

  it('keep default-locale routes out of a locale prefix', () => {
    expect(pagesWith({ a: page('/en/x', '/x') })).toThrow('locale prefix')
  })
})

describe('withFallback', () => {
  it('fills each untranslated field from the default locale', () => {
    expect(
      withFallback(
        { title: 'Hellulögn', lead: 'Inngangur', phone: '691 8944' },
        { title: 'Paving', lead: '' },
      ),
    ).toEqual({ title: 'Paving', lead: 'Inngangur', phone: '691 8944' })
  })

  it('uses the default locale when there is no translation at all', () => {
    const is = { title: 'Hellulögn' }
    expect(withFallback(is, null)).toBe(is)
  })

  it('merges groups field by field and takes lists whole', () => {
    expect(
      withFallback(
        { cta: { heading: 'Hafðu samband', button: 'Senda' }, items: ['a', 'b'] },
        { cta: { heading: 'Get in touch', button: ' ' }, items: ['x'] },
      ),
    ).toEqual({ cta: { heading: 'Get in touch', button: 'Senda' }, items: ['x'] })
  })

  it('treats rich text with no text as untranslated', () => {
    const empty = [{ type: 'paragraph', children: [{ text: '' }] }]
    expect(isBlank(empty)).toBe(true)
    expect(isBlank([{ type: 'paragraph', children: [{ text: 'Hi' }] }])).toBe(false)
    expect(isBlank([{ mediaId: 'a' }])).toBe(false)
  })
})

describe('sitemapXml', () => {
  const xml = sitemapXml(cms, 'https://example.com', {
    extraPaths: ['/verkefni/hellulogn'],
    exclude: ['services'],
  })

  it('lists every page in each locale, with alternates', () => {
    expect(xml).toContain('<loc>https://example.com/</loc>')
    expect(xml).toContain('<loc>https://example.com/en</loc>')
    expect(xml).toContain('<loc>https://example.com/en/projects/hellulogn</loc>')
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/projects"/>',
    )
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/verkefni"/>',
    )
    expect(xml.match(/<url>/g)).toHaveLength(6)
  })

  it('leaves out excluded pages', () => {
    expect(xml).not.toContain('thjonusta')
  })
})
