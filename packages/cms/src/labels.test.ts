import { describe, expect, it } from 'vitest'

import { defineCms } from './define'
import { block, blocks, repeater, richText, select, text } from './fields'
import { fieldLabelKeys, missingLabels } from './labels'
import { seo } from './seo'

const cms = defineCms({
  site: { id: 't', name: 'T', url: 'https://t.is', locales: ['is'], defaultLocale: 'is' },
  collections: {
    equipment: {
      fields: {
        name: text({ required: true }),
        kind: select(['crane', 'digger'] as const),
      },
    },
    posts: {
      fields: {
        sections: blocks({
          intro: block({ heading: text(), steps: repeater({ title: text() }) }),
        }),
      },
    },
  },
  singletons: { settings: { fields: { phone: text() } } },
})

const complete = {
  collections: {
    equipment: { label: 'Tæki', fields: { name: { label: 'Heiti' } } },
    posts: { label: 'Síður', fields: { sections: { label: 'Hlutar' } } },
  },
  singletons: { settings: { label: 'Stillingar', fields: { phone: { label: 'Sími' } } } },
  blocks: { intro: { label: 'Inngangur', fields: { steps: { label: 'Skref' } } } },
  fields: {
    kind: { label: 'Tegund', choices: { crane: 'Krani', digger: 'Grafa' } },
    heading: { label: 'Fyrirsögn' },
    title: { label: 'Titill' },
  },
}

/** A deep copy of `resources` with the given dotted paths removed. */
function without(resources: object, ...paths: string[]): object {
  const copy = structuredClone(resources) as Record<string, unknown>
  for (const path of paths) {
    const parts = path.split('.')
    const last = parts.pop() ?? ''
    let node = copy
    for (const part of parts) node = node[part] as Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete node[last]
  }
  return copy
}

describe('missingLabels', () => {
  it('finds nothing missing when every label exists, using site-wide field labels', () => {
    expect(missingLabels(cms, complete)).toEqual([])
  })

  it('names the most specific key of each missing label', () => {
    const resources = without(
      complete,
      'collections.equipment.label',
      'collections.equipment.fields.name',
      'fields.kind.choices.digger',
      'fields.title',
      'blocks.intro.label',
      'singletons.settings.fields.phone',
    )

    expect(missingLabels(cms, resources).sort()).toEqual(
      [
        'collections.equipment.label',
        'collections.equipment.fields.name.label',
        'collections.equipment.fields.kind.choices.digger',
        'blocks.intro.fields.steps.fields.title.label',
        'blocks.intro.label',
        'singletons.settings.fields.phone.label',
      ].sort(),
    )
  })
})

describe('fieldLabelKeys', () => {
  it('looks up the field under its owner first, then site-wide', () => {
    expect(fieldLabelKeys('blocks.intro', 'heading')).toEqual([
      'blocks.intro.fields.heading.label',
      'fields.heading.label',
    ])
  })
})

describe('rich text marks', () => {
  const withMarks = defineCms({
    site: { id: 't', name: 'T', url: 'https://t.is', locales: ['is'], defaultLocale: 'is' },
    collections: {
      projects: { fields: { body: richText({ marks: { muted: 'text-muted' } }) } },
    },
  })
  const base = {
    collections: { projects: { label: 'Verkefni' } },
    fields: { body: { label: 'Texti' } },
  }

  it('needs a label for each site mark, site-wide or under the field', () => {
    expect(missingLabels(withMarks, base)).toEqual(['collections.projects.fields.body.marks.muted'])
    expect(missingLabels(withMarks, { ...base, marks: { muted: 'Grátt' } })).toEqual([])
  })
})

describe('pages', () => {
  const withPages = defineCms({
    site: { id: 't', name: 'T', url: 'https://t.is', locales: ['is'], defaultLocale: 'is' },
    collections: { projects: { fields: { title: text(), seo: seo() } } },
    blocks: { intro: block({ heading: text() }) },
    pages: {
      home: {
        route: '/',
        fields: { heading: text(), lead: text() },
        seo: seo(),
        blocks: ['intro'],
      },
    },
  })
  const base = {
    collections: { projects: { label: 'Verkefni' } },
    blocks: { intro: { label: 'Inngangur' } },
    fields: { title: { label: 'Titill' }, heading: { label: 'Fyrirsögn' } },
  }

  it('need a label for the page and each header field; seo is labelled by Vefstjórn', () => {
    expect(missingLabels(withPages, base).sort()).toEqual(
      ['pages.home.label', 'pages.home.fields.lead.label'].sort(),
    )
    const pages = { home: { label: 'Forsíða', fields: { lead: { label: 'Inngangur' } } } }
    expect(missingLabels(withPages, { ...base, pages })).toEqual([])
  })
})

describe('notes and shortcuts', () => {
  const withNotes = defineCms({
    site: { id: 't', name: 'T', url: 'https://t.is', locales: ['is'], defaultLocale: 'is' },
    admin: { shortcuts: [{ name: 'newProject', to: 'projects/_new' }] },
    collections: { projects: { note: true, fields: {} } },
    singletons: { settings: { note: true, fields: {} } },
    pages: { cookies: { route: '/', note: true, fields: {}, seo: seo() } },
  })
  const base = {
    collections: { projects: { label: 'Verkefni' } },
    singletons: { settings: { label: 'Stillingar' } },
    pages: { cookies: { label: 'Vafrakökur' } },
  }

  it('need the text of each note and the label of each shortcut', () => {
    expect(missingLabels(withNotes, base).sort()).toEqual(
      [
        'admin.shortcuts.newProject',
        'collections.projects.note',
        'pages.cookies.note',
        'singletons.settings.note',
      ].sort(),
    )
  })
})
