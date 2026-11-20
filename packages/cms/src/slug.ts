/** Icelandic letters that don't reduce to ASCII by dropping accents. */
const SPELLED: Record<string, string> = { þ: 'th', ð: 'd', æ: 'ae', ö: 'o', ø: 'o', ß: 'ss' }

/** "Þökulögn í Garðabæ" → "thokulogn-i-gardabae". Empty when nothing usable is left. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[þðæöøß]/g, (c) => SPELLED[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
}

/** `base`, or `base-2`, `base-3`, … whichever isn't in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${String(n)}`)) n++
  return `${base}-${String(n)}`
}
