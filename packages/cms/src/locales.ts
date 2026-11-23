import type { CmsConfig } from './define'

/*
 * Locale URLs. The default locale sits at the root ("/verkefni") and every other locale under
 * its own prefix ("/en/projects"). Each page declares its path per locale in the config;
 * document slugs are shared by every locale, so a path changes language by swapping the
 * prefix and the page's segment and keeping the rest.
 */

type SiteLocales = Pick<CmsConfig, 'site' | 'pages'>

/** "" for the default locale, else "/<locale>". */
export function localePrefix(config: SiteLocales, locale: string): string {
  return locale === config.site.defaultLocale ? '' : `/${locale}`
}

/** The locale a path is in, from its first segment. */
export function localeOfPath(config: SiteLocales, pathname: string): string {
  const first = pathname.split('/')[1] ?? ''
  return first !== config.site.defaultLocale && config.site.locales.includes(first)
    ? first
    : config.site.defaultLocale
}

/** A page's path in one locale, without the prefix; undefined for a page with no route. */
function routeOf(config: SiteLocales, name: string, locale: string): string | undefined {
  const page = config.pages && Object.hasOwn(config.pages, name) ? config.pages[name] : undefined
  if (page?.route === undefined) return undefined
  return locale === config.site.defaultLocale ? page.route : page.localeRoutes?.[locale]
}

/** Prefix and route joined: the home page of "/en" is "/en", not "/en/". */
const join = (prefix: string, rest: string) => (rest === '/' ? prefix || '/' : `${prefix}${rest}`)

/** The full path of a page in a locale, e.g. "/en/services"; undefined if it has no route. */
export function pagePath(config: SiteLocales, name: string, locale: string): string | undefined {
  const route = routeOf(config, name, locale)
  return route === undefined ? undefined : join(localePrefix(config, locale), route)
}

/** Every page with a route, with its full path in each locale. */
export function pagePaths(config: SiteLocales): { name: string; paths: Record<string, string> }[] {
  return Object.keys(config.pages ?? {}).flatMap((name) => {
    const paths: Record<string, string> = {}
    for (const locale of config.site.locales) {
      const path = pagePath(config, name, locale)
      if (path === undefined) return []
      paths[locale] = path
    }
    return [{ name, paths }]
  })
}

/** The page a path (without prefix) belongs to: the longest route it equals or sits under. */
function matchPage(config: SiteLocales, rest: string, locale: string) {
  let best: { name: string; route: string } | undefined
  for (const name of Object.keys(config.pages ?? {})) {
    const route = routeOf(config, name, locale)
    if (route === undefined) continue
    const hit = route === '/' ? rest === '/' : rest === route || rest.startsWith(`${route}/`)
    if (hit && (!best || route.length > best.route.length)) best = { name, route }
  }
  return best
}

/**
 * The page and locale of a path, e.g. "/en/projects/x" → `{ page: 'projects', locale: 'en',
 * rest: '/x' }`; undefined when no page owns it.
 */
export function pageAtPath(
  config: SiteLocales,
  pathname: string,
): { page: string; locale: string; rest: string } | undefined {
  const locale = localeOfPath(config, pathname)
  const path = pathname.slice(localePrefix(config, locale).length) || '/'
  const page = matchPage(config, path, locale)
  if (!page) return undefined
  return { page: page.name, locale, rest: page.route === '/' ? '' : path.slice(page.route.length) }
}

/**
 * The same address in another locale: "/verkefni/hellulogn?forskodun=x" →
 * "/en/projects/hellulogn?forskodun=x". The query and hash are kept. A path no page owns
 * keeps everything after the prefix.
 */
export function switchLocalePath(config: SiteLocales, href: string, target: string): string {
  const cut = href.search(/[?#]/)
  const pathname = cut === -1 ? href : href.slice(0, cut)
  const tail = cut === -1 ? '' : href.slice(cut)
  const from = localeOfPath(config, pathname)
  const rest = pathname.slice(localePrefix(config, from).length) || '/'
  const page = matchPage(config, rest, from)
  const targetRoute = page && routeOf(config, page.name, target)
  let moved = rest
  if (page && targetRoute !== undefined) {
    const after = page.route === '/' ? '' : rest.slice(page.route.length)
    moved = (targetRoute === '/' ? '' : targetRoute) + after || '/'
  }
  return join(localePrefix(config, target), moved) + tail
}

/** The path in every locale, for `hreflang` links and sitemap alternates. */
export function localeAlternates(
  config: SiteLocales,
  pathname: string,
): { locale: string; path: string }[] {
  return config.site.locales.map((locale) => ({
    locale,
    path: switchLocalePath(config, pathname, locale),
  }))
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Rich text (blocks with `children` or list `items`) with no text in it. */
function isBlankRichText(value: unknown[]): boolean {
  const isBlock = (b: unknown) =>
    isRecord(b) && (Array.isArray(b.children) || Array.isArray(b.items))
  return value.every(isBlock) && !/"text":"\s*[^"\s]/.test(JSON.stringify(value))
}

/** Nothing written yet: missing, an empty string, an empty list or rich text with no text. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0 || isBlankRichText(value)
  return false
}

/**
 * A document in another locale with the default locale filled in field by field: a field
 * that has no translation yet shows the default-locale text. Objects (groups, `seo`) are
 * merged the same way, one field at a time; lists (repeaters, blocks, galleries) are taken
 * whole from whichever locale has them.
 */
export function withFallback<T extends Record<string, unknown>>(
  fallback: T,
  own: Record<string, unknown> | null | undefined,
): T {
  if (!own) return fallback
  const out: Record<string, unknown> = { ...fallback }
  for (const [key, value] of Object.entries(own)) {
    if (isBlank(value)) continue
    const base = out[key]
    out[key] = isRecord(value) && isRecord(base) ? withFallback(base, value) : value
  }
  return out as T
}
