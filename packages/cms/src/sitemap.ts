import type { CmsConfig } from './define'
import { localeAlternates, pagePaths } from './locales'

const ENTITIES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
}
const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ENTITIES[c] ?? c)

/**
 * `sitemap.xml` for every page with a route except those in `exclude` (e.g. a thank-you
 * page), plus `extraPaths` (default-locale paths such as "/verkefni/hellulogn"). Each
 * address is listed once per locale, with `xhtml:link` alternates for every locale and
 * `x-default` pointing at the default locale.
 */
export function sitemapXml(
  config: Pick<CmsConfig, 'site' | 'pages'>,
  origin: string,
  options: { extraPaths?: readonly string[]; exclude?: readonly string[] } = {},
): string {
  const { defaultLocale } = config.site
  const paths = [
    ...pagePaths(config)
      .filter((p) => !options.exclude?.includes(p.name))
      .map((p) => p.paths[defaultLocale] ?? '/'),
    ...(options.extraPaths ?? []),
  ]
  const link = (hreflang: string, path: string) =>
    `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(origin + path)}"/>`
  const urls = paths.flatMap((path) => {
    const alternates = localeAlternates(config, path)
    const links =
      alternates.map((a) => link(a.locale, a.path)).join('') +
      link('x-default', alternates.find((a) => a.locale === defaultLocale)?.path ?? path)
    return alternates.map((a) => `<url><loc>${escapeXml(origin + a.path)}</loc>${links}</url>`)
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}
