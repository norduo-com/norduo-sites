import { describe, expect, it } from 'vitest'

import {
  email,
  type Fields,
  group,
  monthRange,
  multiSelect,
  relation,
  schemaOf,
  slug,
  tel,
  text,
  url,
  year,
} from './fields'

const valid = (fields: Fields, data: Record<string, unknown>) =>
  schemaOf(fields).safeParse(data).success

describe('email', () => {
  it('accepts an address and rejects anything else', () => {
    const fields = { email: email() }
    expect(valid(fields, { email: 'berghald@berghald.is' })).toBe(true)
    expect(valid(fields, { email: 'berghald.is' })).toBe(false)
  })
})

describe('url', () => {
  it('accepts http and https links only', () => {
    const fields = { facebook: url() }
    expect(valid(fields, { facebook: 'https://facebook.com/berghald' })).toBe(true)
    expect(valid(fields, { facebook: 'facebook.com/berghald' })).toBe(false)
    expect(valid(fields, { facebook: 'javascript:alert(1)' })).toBe(false)
    expect(valid(fields, { facebook: 'https://bergháld.is/um-okkur' })).toBe(true)
  })
})

describe('tel', () => {
  it('accepts Icelandic and international numbers with spaces or dashes', () => {
    const fields = { phone: tel() }
    expect(valid(fields, { phone: '691 8944' })).toBe(true)
    expect(valid(fields, { phone: '+354 691-8944' })).toBe(true)
    expect(valid(fields, { phone: 'hringdu' })).toBe(false)
    expect(valid(fields, { phone: '12' })).toBe(false)
  })
})

describe('year', () => {
  it('accepts a whole year and rejects text or fractions', () => {
    const fields = { year: year() }
    expect(valid(fields, { year: 2024 })).toBe(true)
    expect(valid(fields, { year: '2024' })).toBe(false)
    expect(valid(fields, { year: 2024.5 })).toBe(false)
    expect(valid(fields, { year: 24 })).toBe(false)
  })
})

describe('monthRange', () => {
  const fields = { workPeriod: monthRange() }

  it('accepts a range of months, also one that runs over new year', () => {
    expect(valid(fields, { workPeriod: { from: 5, to: 8 } })).toBe(true)
    expect(valid(fields, { workPeriod: { from: 11, to: 2 } })).toBe(true)
  })

  it('rejects a month outside 1 to 12 or a missing end', () => {
    expect(valid(fields, { workPeriod: { from: 0, to: 3 } })).toBe(false)
    expect(valid(fields, { workPeriod: { from: 5, to: 13 } })).toBe(false)
    expect(valid(fields, { workPeriod: { from: 5 } })).toBe(false)
  })
})

describe('multiSelect', () => {
  const fields = {
    seasons: multiSelect(['winter', 'spring', 'summer', 'autumn'] as const, { min: 1 }),
  }

  it('accepts several choices', () => {
    expect(valid(fields, { seasons: ['spring', 'summer'] })).toBe(true)
  })

  it('rejects an unknown choice or the same choice twice', () => {
    expect(valid(fields, { seasons: ['monsoon'] })).toBe(false)
    expect(valid(fields, { seasons: ['summer', 'summer'] })).toBe(false)
  })

  it('needs at least `min` choices, so a min makes the field required', () => {
    expect(valid(fields, { seasons: [] })).toBe(false)
    expect(valid(fields, {})).toBe(false)
  })

  it('is optional without a min', () => {
    expect(valid({ tags: multiSelect(['a', 'b'] as const) }, {})).toBe(true)
  })
})

describe('relation', () => {
  it('holds one linked item by default', () => {
    const fields = { service: relation('services') }
    expect(valid(fields, { service: 'abc' })).toBe(true)
    expect(valid(fields, { service: ['abc'] })).toBe(false)
  })

  it('holds a list of distinct linked items with many: true', () => {
    const fields = { services: relation('services', { many: true, required: true }) }
    expect(valid(fields, { services: ['abc', 'def'] })).toBe(true)
    expect(valid(fields, { services: ['abc', 'abc'] })).toBe(false)
    expect(valid(fields, { services: [''] })).toBe(false)
  })
})

describe('group', () => {
  const fields = {
    cta: group({ heading: text({ required: true, i18n: true }), phone: tel() }),
  }

  it('validates its fields as one value', () => {
    expect(valid(fields, { cta: { heading: 'Fáðu tilboð', phone: '691 8944' } })).toBe(true)
    expect(valid(fields, { cta: { phone: '691 8944' } })).toBe(false)
  })

  it('is optional as a whole unless required', () => {
    expect(valid(fields, {})).toBe(true)
  })
})

describe('slug', () => {
  it('accepts lowercase words joined by dashes only', () => {
    const fields = { title: text(), slug: slug({ from: 'title' }) }
    expect(valid(fields, { slug: 'hellulogn-i-gardabae-2' })).toBe(true)
    expect(valid(fields, { slug: 'Hellulögn í Garðabæ' })).toBe(false)
    expect(valid(fields, { slug: '-hellulogn' })).toBe(false)
  })
})
