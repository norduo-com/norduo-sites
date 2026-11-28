import type { Badge } from '@norduo/cms'

/** Parts of the year when a service is in demand (GLOSSARY: Season). */
export const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const
export type Season = (typeof SEASONS)[number]

/** Vetur is November to February, Vor March to May, Sumar June to August, Haust the rest. */
export function seasonOf(date: Date): Season {
  const month = date.getMonth() + 1
  if (month >= 11 || month <= 2) return 'winter'
  if (month <= 5) return 'spring'
  if (month <= 8) return 'summer'
  return 'autumn'
}

const runsAllYear = (seasons: readonly Season[]) => SEASONS.every((s) => seasons.includes(s))

/** The banner on Þjónusta in Vefstjórn: which season it is, so editors know the site's order. */
export const seasonNotice = (now: Date) => `collections.services.notice.${seasonOf(now)}`

/** A service's seasons as tags in Vefstjórn's list; one "Allt árið" tag when it runs all year. */
export function seasonBadges(doc: { data: { seasons?: readonly Season[] } }): Badge[] {
  const seasons = doc.data.seasons ?? []
  if (runsAllYear(seasons)) return [{ label: 'collections.services.badges.allYear' }]
  return seasons.map((s) => ({ label: `fields.seasons.choices.${s}` }))
}
