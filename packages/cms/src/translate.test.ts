import { describe, expect, it } from 'vitest'

import { block, blocks, group, image, repeater, richText, text } from './fields'
import type { RichTextValue } from './richtext'
import { seo } from './seo'
import {
  decodeInlines,
  editLocale,
  encodeInlines,
  fromSegments,
  hashValue,
  planLocale,
  segmentsOf,
  translatableLeaves,
} from './translate'

const fields = {
  name: text({ required: true, i18n: true }),
  phone: text(),
  body: richText({ i18n: true }),
  photo: image(),
  cta: group({ heading: text({ i18n: true }), url: text() }),
  items: repeater({ item: text({ i18n: true }) }),
  seo: seo(),
  blocks: blocks({ text: block({ heading: text({ i18n: true }) }) }),
}

const body: RichTextValue = [
  {
    type: 'p',
    children: [
      { text: 'Við ' },
      { text: 'svörum', marks: ['bold'] },
      { text: ' innan dags. ' },
      { text: 'Hafðu samband', href: 'mailto:a@b.is' },
    ],
  },
  { type: 'ul', items: [[{ text: 'Hellulögn' }], [{ text: ' ' }]] },
]

const source = {
  name: 'Kranabíll',
  phone: '555 1234',
  body,
  photo: { mediaId: 'm1' },
  cta: { heading: 'Fáðu tilboð', url: 'https://a.is' },
  items: [{ item: 'Grjót' }, { item: 'Möl' }],
  seo: { title: 'Kranabíll – Berghald', image: { mediaId: 'm2' } },
  blocks: [{ type: 'text', data: { heading: 'Um okkur' } }],
}

describe('translatableLeaves', () => {
  it('finds every i18n text, nested in groups, repeaters, seo and blocks', () => {
    expect(translatableLeaves(fields, source).map((l) => l.key)).toEqual([
      'name',
      'body',
      'cta.heading',
      'items.0.item',
      'items.1.item',
      'seo.title',
      'blocks.0.data.heading',
    ])
  })
})

describe('rich text segments', () => {
  it('turn formatting into numbered placeholders and never send links', () => {
    const [para] = segmentsOf({ path: ['body'], key: 'body', kind: 'richText', value: body })
    expect(para).toBe('Við [1]svörum[/1] innan dags. [2]Hafðu samband[/2]')
  })

  it('read the translation back onto the original marks and links, in the new order', () => {
    const inlines = body[0] && 'children' in body[0] ? body[0].children : []
    expect(decodeInlines('[2]Contact us[/2]: we [1]reply[/1] within a day.', inlines)).toEqual([
      { text: 'Contact us', href: 'mailto:a@b.is' },
      { text: ': we ' },
      { text: 'reply', marks: ['bold'] },
      { text: ' within a day.' },
    ])
  })

  it('reject a reply with a missing, repeated or unknown placeholder', () => {
    const inlines = body[0] && 'children' in body[0] ? body[0].children : []
    expect(decodeInlines('We reply. [2]Contact us[/2]', inlines)).toBeNull()
    expect(decodeInlines('[1]a[/1] [1]b[/1] [2]c[/2]', inlines)).toBeNull()
    expect(decodeInlines('[1]a[/1] [2]c[/2] [3]d[/3]', inlines)).toBeNull()
    expect(decodeInlines('[1]a [2]c[/2]', inlines)).toBeNull()
  })

  it('skip blocks without words and rebuild the whole value', () => {
    const leaf = { path: ['body'], key: 'body', kind: 'richText' as const, value: body }
    expect(segmentsOf(leaf)).toHaveLength(2)
    const value = fromSegments(leaf, ['We [1]reply[/1]. [2]Contact[/2]', 'Paving'])
    expect(value).toEqual([
      {
        type: 'p',
        children: [
          { text: 'We ' },
          { text: 'reply', marks: ['bold'] },
          { text: '. ' },
          { text: 'Contact', href: 'mailto:a@b.is' },
        ],
      },
      { type: 'ul', items: [[{ text: 'Paving' }], [{ text: ' ' }]] },
    ])
    expect(fromSegments(leaf, ['We reply.', 'Paving'])).toBeNull()
    expect(fromSegments(leaf, ['We [1]reply[/1]. [2]Contact[/2]'])).toBeNull()
  })

  it('round-trip plain inlines', () => {
    const list = [{ text: 'Hæ ' }, { text: 'þú', marks: ['italic'] }]
    expect(decodeInlines(encodeInlines(list), list)).toEqual(list)
  })
})

describe('planLocale', () => {
  it('copies untranslated fields and marks every translatable text pending', () => {
    const plan = planLocale(fields, source, null)
    expect(plan.data).toEqual(source)
    expect(plan.todo).toHaveLength(7)
    expect(plan.translations.name).toEqual({ src: hashValue('Kranabíll'), state: 'pending' })
  })

  it('keeps translations whose source has not changed, and takes the rest from the source', () => {
    const prev = {
      data: { ...source, name: 'Crane truck', phone: '000', cta: { heading: 'Get a quote' } },
      translations: {
        name: { src: hashValue('Kranabíll'), state: 'machine' as const },
        'cta.heading': { src: hashValue('Eitthvað annað'), state: 'reviewed' as const },
      },
    }
    const plan = planLocale(fields, source, prev)
    expect(plan.data.name).toBe('Crane truck')
    expect(plan.data.phone).toBe('555 1234')
    expect(plan.data.cta).toEqual({ heading: 'Fáðu tilboð', url: 'https://a.is' })
    expect(plan.todo).not.toContain('name')
    expect(plan.todo).toContain('cta.heading')
  })

  it('keeps a translation when its text moves, e.g. reordered items', () => {
    const prev = planLocale(fields, source, null)
    prev.data.items = [{ item: 'Stone' }, { item: 'Gravel' }]
    prev.translations['items.0.item'] = { src: hashValue('Grjót'), state: 'machine' }
    prev.translations['items.1.item'] = { src: hashValue('Möl'), state: 'machine' }
    const swapped = { ...source, items: [{ item: 'Möl' }, { item: 'Grjót' }] }
    const plan = planLocale(fields, swapped, prev)
    expect(plan.data.items).toEqual([{ item: 'Gravel' }, { item: 'Stone' }])
    expect(plan.todo).not.toContain('items.0.item')
  })

  it('skips blank texts', () => {
    expect(planLocale(fields, { name: ' ' }, null).todo).toEqual([])
  })
})

describe('editLocale', () => {
  const prev = () => {
    const p = planLocale(fields, source, null)
    p.data.name = 'Crane truck'
    p.translations.name = { src: hashValue('Kranabíll'), state: 'machine' }
    return p
  }

  it('marks an edited text reviewed and ignores untranslatable values sent', () => {
    const edit = editLocale(fields, source, prev(), {
      ...prev().data,
      name: 'Our crane truck',
      phone: '999',
    })
    expect(edit.data.name).toBe('Our crane truck')
    expect(edit.data.phone).toBe('555 1234')
    expect(edit.translations.name?.state).toBe('reviewed')
  })

  it('leaves an untouched machine translation Óyfirfarið, unless approved', () => {
    expect(editLocale(fields, source, prev(), prev().data).translations.name?.state).toBe('machine')
    const approved = editLocale(fields, source, prev(), prev().data, ['name'])
    expect(approved.translations.name?.state).toBe('reviewed')
  })

  it('translates a cleared text again, showing the source meanwhile', () => {
    const edit = editLocale(fields, source, prev(), { ...prev().data, name: '' })
    expect(edit.data.name).toBe('Kranabíll')
    expect(edit.translations.name?.state).toBe('pending')
    expect(edit.todo).toContain('name')
  })
})
