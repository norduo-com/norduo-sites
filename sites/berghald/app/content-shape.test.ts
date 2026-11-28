// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs'

import { type ContentShape, contentShape, shapeChanges } from '@norduo/cms'
import { describe, expect, it } from 'vitest'

import cms from '../cms.config'

/*
 * Content in D1 is trusted by the site's loaders, so cms.config.ts only ever adds fields
 * (docs/architecture.md §2). `content-shape.json` records what stored content can hold.
 *
 * After adding a field:  UPDATE_CONTENT_SHAPE=1 pnpm --filter berghald test
 * After a content script has rewritten D1 for a removal or retype, add
 * CONTENT_SHAPE_BREAKING=1 to that command.
 */
const file = new URL('../content-shape.json', import.meta.url)
const saved = JSON.parse(readFileSync(file, 'utf8')) as ContentShape
const current = contentShape(cms)

describe('content shape', () => {
  it('only adds to what stored content can hold', () => {
    const breaking = shapeChanges(saved, current)
    if (process.env.CONTENT_SHAPE_BREAKING !== '1') expect(breaking).toEqual([])
    if (process.env.UPDATE_CONTENT_SHAPE === '1') {
      writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`)
    }
  })

  it('is recorded in content-shape.json (UPDATE_CONTENT_SHAPE=1 to record additions)', () => {
    if (process.env.UPDATE_CONTENT_SHAPE === '1') return
    expect(current).toEqual(saved)
  })
})
