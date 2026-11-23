import { imageUrl, type SeoMeta } from '@norduo/cms'
import type { MetaDescriptor } from 'react-router'

/**
 * `<head>` tags for a page from `seoMeta()` (called with the site name, so the title matches
 * Vefstjórn's Google preview). `origin` makes the share image absolute.
 */
export function headTags(meta: SeoMeta, origin: string): MetaDescriptor[] {
  const tags: MetaDescriptor[] = []
  if (meta.title) tags.push({ title: meta.title }, { property: 'og:title', content: meta.title })
  if (meta.description) {
    tags.push(
      { name: 'description', content: meta.description },
      { property: 'og:description', content: meta.description },
    )
  }
  if (meta.image) {
    const src = `${origin}${imageUrl(meta.image.mediaId, 1440)}`
    tags.push({ property: 'og:image', content: src })
  }
  return tags
}
