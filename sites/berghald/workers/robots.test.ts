import { describe, expect, it } from 'vitest'

import { isIndexable, withRobots } from './robots'

const site = 'https://berghald.is'

describe('noindex by hostname', () => {
  it('lets only the live domain be indexed', () => {
    expect(isIndexable('https://berghald.is/verkefni', site)).toBe(true)
    expect(isIndexable('https://berghald.eythorkonrads.com/', site)).toBe(false)
    expect(isIndexable('https://pr-3-berghald-preview.norduo.workers.dev/', site)).toBe(false)
    expect(isIndexable('http://localhost:5173/en', site)).toBe(false)
  })

  it('sends noindex from the pre-launch host and nothing from the live one', () => {
    const live = withRobots(new Response('ok'), 'https://berghald.is/', site)
    expect(live.headers.get('x-robots-tag')).toBeNull()
    const pre = withRobots(new Response('ok'), 'https://berghald.eythorkonrads.com/en', site)
    expect(pre.headers.get('x-robots-tag')).toBe('noindex')
  })
})
