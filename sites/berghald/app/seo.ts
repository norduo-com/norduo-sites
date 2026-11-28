import { imageUrl, localeAlternates, localeOfPath, type SeoMeta } from '@norduo/cms'
import type { MetaDescriptor } from 'react-router'

import cms from '../cms.config'

const OG_LOCALE: Record<string, string> = { is: 'is_IS', en: 'en_GB' }

/**
 * `<head>` tags for a page from `seoMeta()` (called with the site name, so the title matches
 * Vefstjórn's Google preview) and the page's URL: a self canonical, and `hreflang` links to
 * the page in every locale plus `x-default` pointing at Icelandic. The query is left out.
 */
export function headTags(meta: SeoMeta, url: URL): MetaDescriptor[] {
  const tags: MetaDescriptor[] = []
  if (meta.title) tags.push({ title: meta.title }, { property: 'og:title', content: meta.title })
  if (meta.description) {
    tags.push(
      { name: 'description', content: meta.description },
      { property: 'og:description', content: meta.description },
    )
  }
  if (meta.image) {
    const src = `${url.origin}${imageUrl(meta.image.mediaId, 1440)}`
    tags.push({ property: 'og:image', content: src })
  }

  const locale = localeOfPath(cms, url.pathname)
  const alternates = localeAlternates(cms, url.pathname)
  const self = alternates.find((a) => a.locale === locale)?.path ?? url.pathname
  const fallback = alternates.find((a) => a.locale === cms.site.defaultLocale)?.path ?? self
  tags.push(
    { tagName: 'link', rel: 'canonical', href: url.origin + self },
    { property: 'og:url', content: url.origin + self },
    { property: 'og:locale', content: OG_LOCALE[locale] ?? locale },
    ...alternates.map((a) => ({
      tagName: 'link' as const,
      rel: 'alternate',
      hrefLang: a.locale,
      href: url.origin + a.path,
    })),
    { tagName: 'link', rel: 'alternate', hrefLang: 'x-default', href: url.origin + fallback },
  )
  return tags
}
