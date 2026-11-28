/*
 * Fixed sets Berghald's content model picks from. The site's own code gives them meaning:
 * what each question set asks, how each icon is drawn. Labels are in `locales/is/cms.json`.
 */

/** The extra questions on the quote form for a service's kind of job (GLOSSARY: Question set). */
export const QUESTION_SETS = ['garden', 'trees', 'snow', 'crane', 'general'] as const

/** Icons the Skref and Gildi blocks can show. */
export const BLOCK_ICONS = [
  'chat',
  'ruler',
  'pencil',
  'shovel',
  'check',
  'leaf',
  'shield',
  'clock',
  'handshake',
] as const

/** Nýleg verkefni on the home page shows at most this many projects (GLOSSARY: Home-page project). */
export const HOME_PROJECTS = 4

/** Vefstjórn warns on Verkefni when more published projects are on the home page than it shows. */
export function homeProjectWarnings(
  docs: readonly { status: string; data: { showOnHome?: boolean } }[],
): string[] {
  const onHome = docs.filter((d) => d.status === 'published' && d.data.showOnHome === true)
  return onHome.length > HOME_PROJECTS ? ['collections.projects.warnings.tooManyOnHome'] : []
}
