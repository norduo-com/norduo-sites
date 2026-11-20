import { describe, expect, it } from 'vitest'

import { defineCms } from './define'
import { block, blocks, repeater, select, text } from './fields'
import { fieldLabelKeys, missingLabels } from './labels'

const cms = defineCms({
  site: { id: 't', name: 'T', url: 'https://t.is', locales: ['is'], defaultLocale: 'is' },
  collections: {
    equipment: {
      fields: {
        name: text({ required: true }),
        kind: select(['crane', 'digger'] as const),
      },
    },
    pages: {
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
    pages: { label: 'Síður', fields: { sections: { label: 'Hlutar' } } },
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
