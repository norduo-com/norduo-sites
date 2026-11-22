import { imageUrl, type SeoMeta } from '@norduo/cms'
import type { MetaDescriptor } from 'react-router'

/**
 * `<head>` tags for a page from its resolved `seo()` value. A title that fell back to the
 * page's own title gets the site name after it; `origin` makes the share image absolute.
 */
export function headTags(
  meta: SeoMeta,
  options: { siteName: string; origin: string; ownTitle: boolean },
): MetaDescriptor[] {
  const title = meta.title
    ? options.ownTitle
      ? meta.title
      : `${meta.title} – ${options.siteName}`
    : options.siteName
  const tags: MetaDescriptor[] = [{ title }, { property: 'og:title', content: title }]
  if (meta.description) {
    tags.push(
      { name: 'description', content: meta.description },
      { property: 'og:description', content: meta.description },
    )
  }
  if (meta.image) {
    tags.push({
      property: 'og:image',
      content: `${options.origin}${imageUrl(meta.image.mediaId, 1440)}`,
    })
  }
  return tags
}
