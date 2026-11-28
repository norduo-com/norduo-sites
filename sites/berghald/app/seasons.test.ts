import { badgesOf } from '@norduo/cms'
import { describe, expect, it } from 'vitest'

import cms from '../cms.config'
import { resources } from './i18n'
import { seasonOf } from './seasons'

const day = (month: number, date = 15) => new Date(2026, month - 1, date)

/** Whether `key` has a non-empty Icelandic `cms` string. */
function hasLabel(key: string) {
  let node: unknown = resources.is.cms
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  return typeof node === 'string' && node.length > 0
}

describe('seasonOf', () => {
  it('is winter from November to February, then spring, summer and autumn', () => {
    expect([11, 12, 1, 2].map((m) => seasonOf(day(m)))).toEqual(Array(4).fill('winter'))
    expect([3, 4, 5].map((m) => seasonOf(day(m)))).toEqual(Array(3).fill('spring'))
    expect([6, 7, 8].map((m) => seasonOf(day(m)))).toEqual(Array(3).fill('summer'))
    expect([9, 10].map((m) => seasonOf(day(m)))).toEqual(Array(2).fill('autumn'))
  })

  it('turns at the start of a month', () => {
    expect(seasonOf(day(2, 28))).toBe('winter')
    expect(seasonOf(day(3, 1))).toBe('spring')
    expect(seasonOf(day(10, 31))).toBe('autumn')
    expect(seasonOf(day(11, 1))).toBe('winter')
  })
})

describe('Þjónusta in Vefstjórn', () => {
  const services = cms.collections.services

  it('says which season it is, in Icelandic', () => {
    const notice = services.list.notice(day(7))
    expect(notice).toContain('summer')
    expect(notice && hasLabel(notice)).toBe(true)
  })

  it('tags each service with its seasons, labelled in Icelandic', () => {
    const doc = { slug: 'snjor', status: 'published', data: { seasons: ['winter'] } } as const
    const badges = badgesOf(services, doc)
    expect(badges).toHaveLength(1)
    expect(badges.every((b) => hasLabel(b.label))).toBe(true)
    expect(badgesOf(services, { ...doc, data: {} })).toEqual([])
  })

  it('tags a service that runs all year once, not four times', () => {
    const data = { seasons: ['winter', 'spring', 'summer', 'autumn'] as const }
    const badges = badgesOf(services, { slug: 'a', status: 'published', data: { ...data } })
    expect(badges).toHaveLength(1)
    expect(badges.every((b) => hasLabel(b.label))).toBe(true)
  })
})

describe('Verkefni in Vefstjórn', () => {
  const projects = cms.collections.projects
  const project = (n: number, status: 'draft' | 'published', showOnHome = true) => ({
    slug: `p${String(n)}`,
    status,
    data: { showOnHome },
  })

  it('warns when more than 4 published projects are on the home page', () => {
    const four = [1, 2, 3, 4].map((n) => project(n, 'published'))
    expect(projects.warnings(four)).toEqual([])
    expect(
      projects.warnings([...four, project(5, 'draft'), project(6, 'published', false)]),
    ).toEqual([])
    const warnings = projects.warnings([...four, project(5, 'published')])
    expect(warnings).toHaveLength(1)
    expect(warnings.every(hasLabel)).toBe(true)
  })
})
