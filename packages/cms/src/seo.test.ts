import { describe, expect, it } from 'vitest'

import { schemaOf, text } from './fields'
import { seo, seoMeta } from './seo'

describe('seo()', () => {
  const field = seo({ titleFrom: 'title', descriptionFrom: 'lead' })
  const schema = schemaOf({ title: text(), lead: text(), seo: field })

  it('caps the title at 60 and the description at 160 characters', () => {
    expect(schema.safeParse({ seo: { title: 'a'.repeat(60) } }).success).toBe(true)
    expect(schema.safeParse({ seo: { title: 'a'.repeat(61) } }).success).toBe(false)
    expect(schema.safeParse({ seo: { description: 'a'.repeat(161) } }).success).toBe(false)
  })

  it('takes a keyword and a share image', () => {
    const value = { keyword: 'hellulögn', image: { mediaId: 'm1' } }
    expect(schema.safeParse({ seo: value }).success).toBe(true)
  })

  it('uses its own title and description when they are filled in', () => {
    const data = {
      title: 'Þjónusta',
      lead: 'Við sjáum um garðinn.',
      seo: { title: 'Garðaþjónusta á höfuðborgarsvæðinu', description: 'Hellulögn og hleðslur.' },
    }
    expect(seoMeta(field, data)).toMatchObject({
      title: 'Garðaþjónusta á höfuðborgarsvæðinu',
      description: 'Hellulögn og hleðslur.',
    })
  })

  it('falls back to the title and short text when its own are empty', () => {
    const data = { title: 'Þjónusta', lead: 'Við sjáum um garðinn.', seo: { title: '  ' } }
    expect(seoMeta(field, data)).toEqual({
      title: 'Þjónusta',
      description: 'Við sjáum um garðinn.',
      keyword: null,
      image: null,
    })
  })

  it('adds the site name to a fallback title, never to its own, within 60 characters', () => {
    const site = { siteName: 'Berghald' }
    expect(seoMeta(field, { title: 'Þjónusta' }, site).title).toBe('Þjónusta – Berghald')
    expect(seoMeta(field, { seo: { title: 'Garðar' } }, site).title).toBe('Garðar')
    const long = seoMeta(field, { title: 'Hellulögn '.repeat(10) }, site).title
    expect(long?.length).toBeLessThanOrEqual(60)
    expect(long?.endsWith('Hellulögn… – Berghald')).toBe(true)
    expect(seoMeta(field, {}, site).title).toBe('Berghald')
  })

  it('cuts a fallback title to 60 characters without a site name', () => {
    const title = seoMeta(field, { title: 'Hellulögn '.repeat(10) }).title
    expect(title?.length).toBeLessThanOrEqual(60)
  })

  it('falls back to rich text as plain text, cut at a word to 160 characters', () => {
    const long = `${'Hellulögn '.repeat(20)}endir`
    const data = {
      lead: [
        { type: 'p', children: [{ text: 'Við ' }, { text: 'mótum', marks: ['bold'] }] },
        { type: 'ul', items: [[{ text: 'lóðina' }]] },
        { type: 'p', children: [{ text: long }] },
      ],
    }
    const { description } = seoMeta(field, data)
    expect(description?.startsWith('Við mótum lóðina Hellulögn')).toBe(true)
    expect(description?.length).toBeLessThanOrEqual(160)
    expect(description?.endsWith('Hellulögn…')).toBe(true)
  })

  it('gives nothing when neither its own text nor the fallback is there', () => {
    expect(seoMeta(seo(), {})).toEqual({
      title: null,
      description: null,
      keyword: null,
      image: null,
    })
  })
})
