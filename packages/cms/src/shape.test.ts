import { describe, expect, it } from 'vitest'

import { defineCms } from './define'
import { block, group, relation, repeater, select, text } from './fields'
import { seo } from './seo'
import { contentShape, shapeChanges } from './shape'

const site = {
  id: 'x',
  name: 'X',
  url: 'https://x.is',
  locales: ['is'],
  defaultLocale: 'is',
} as const

const cms = defineCms({
  site,
  collections: {
    projects: {
      fields: {
        title: text({ required: true }),
        kind: select(['garden', 'wall']),
        services: relation('services', { many: true }),
        steps: repeater({ name: text() }),
      },
    },
    services: { fields: { name: text() } },
  },
  singletons: { footer: { fields: { cta: group({ heading: text() }) } } },
  blocks: { intro: block({ heading: text() }) },
  pages: { home: { fields: { title: text() }, seo: seo(), blocks: ['intro'] } },
})

describe('contentShape', () => {
  it('lists every stored path with its kind', () => {
    expect(contentShape(cms)).toMatchObject({
      'collections.projects.title': 'text',
      'collections.projects.kind': 'select?',
      'collections.projects.kind.choices.garden': 'choice',
      'collections.projects.services': 'relation:services[]?',
      'collections.projects.steps[].name': 'text?',
      'singletons.footer.cta.heading': 'text?',
      'blocks.intro.heading': 'text?',
      'pages.home.title': 'text?',
      'pages.home.seo.title': 'text?',
      'pages.home.blocks.intro': 'block',
    })
  })
})

describe('shapeChanges', () => {
  const prev = { 'a.title': 'text', 'a.lead': 'text?', 'a.kind.choices.x': 'choice' }

  it('allows adding paths and making a field optional', () => {
    expect(shapeChanges(prev, { ...prev, 'a.title': 'text?', 'a.new': 'year?' })).toEqual([])
  })

  it('flags a removed path, a changed kind and a field made required', () => {
    expect(shapeChanges(prev, { 'a.title': 'richText', 'a.lead': 'text' })).toEqual([
      'a.title: text → richText',
      'a.lead: text? → text',
      'a.kind.choices.x: removed (was choice)',
    ])
  })
})
