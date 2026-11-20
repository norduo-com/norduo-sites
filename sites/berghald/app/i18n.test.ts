import { missingLabels } from '@norduo/cms'
import { describe, expect, it } from 'vitest'

import cms from '../cms.config'
import { i18n, resources } from './i18n'

/** Every dotted key path of a translation file. */
function keysOf(node: object, prefix = ''): string[] {
  return Object.entries(node).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keysOf(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

describe('translations', () => {
  it('have an Icelandic label for everything in cms.config.ts', () => {
    expect(missingLabels(cms, resources.is.cms)).toEqual([])
  })

  it('have the same public-site keys in Icelandic and English', () => {
    expect(keysOf(resources.en.site).sort()).toEqual(keysOf(resources.is.site).sort())
  })

  it('show the raw key for a missing string instead of failing', () => {
    expect(i18n.t('site:nope.missing')).toBe('nope.missing')
  })

  it('look a field label up under its collection, then site-wide', () => {
    expect(
      i18n.t(['collections.equipment.fields.name.label', 'fields.name.label'], { ns: 'cms' }),
    ).toBe('Heiti')
  })
})
