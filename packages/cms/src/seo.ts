import { group, image, type ImageValue, imageValue, type Infer, text } from './fields'
import type { RichTextValue } from './richtext'

/** Sub-fields of `seo()`. Their labels are Vefstjórn's own (`vefstjorn` namespace). */
/** Search engines cut longer titles and descriptions; fallbacks are cut to the same length. */
export const SEO_TITLE_MAX = 60
export const SEO_DESCRIPTION_MAX = 160

const seoFields = {
  keyword: text({ i18n: true }),
  title: text({ i18n: true, max: SEO_TITLE_MAX }),
  description: text({ i18n: true, max: SEO_DESCRIPTION_MAX, multiline: true }),
  image: image(),
}

/**
 * Search and sharing: a keyword (shown in the Google preview, never output as a meta tag),
 * a title (60), a description (160) and an optional share image. An empty title or
 * description falls back to the owner's `titleFrom` / `descriptionFrom` field.
 */
export function seo<const T extends string, const D extends string>(
  options: { titleFrom?: T; descriptionFrom?: D } = {},
) {
  return {
    ...group(seoFields),
    kind: 'seo' as const,
    i18n: true,
    titleFrom: options.titleFrom,
    descriptionFrom: options.descriptionFrom,
  }
}

export type SeoField = ReturnType<typeof seo>
/** A stored `seo()` value. */
export type SeoValue = Infer<typeof seoFields>

export interface SeoMeta {
  title: string | null
  description: string | null
  keyword: string | null
  image: ImageValue | null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A text or rich text value as one line of plain text. */
function plainText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (!Array.isArray(value)) return ''
  const inlines = (value as RichTextValue).flatMap((b) =>
    'items' in b ? b.items.flat() : b.children,
  )
  return plainText(inlines.map((i) => i.text).join(' '))
}

/** Cut at the last whole word that fits, with an ellipsis. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const filled = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** A fallback title with the site name after it, e.g. "Þjónusta – Berghald", within 60. */
function fallbackTitle(title: string | null, siteName: string | undefined): string | null {
  if (!siteName) return title && clip(title, SEO_TITLE_MAX)
  if (!title) return siteName
  const suffix = ` – ${siteName}`
  return `${clip(title, SEO_TITLE_MAX - suffix.length)}${suffix}`
}

/**
 * What goes in the page's `<head>` and Vefstjórn's Google preview: the `seo()` value with
 * its fallbacks applied. `data` is the whole document; the value is the top-level field
 * `name`. With `siteName`, a fallback title gets the site name after it (an editor's own
 * title is used as written), and a document with no title at all gets the site name.
 */
export function seoMeta(
  field: Pick<SeoField, 'titleFrom' | 'descriptionFrom'>,
  data: Record<string, unknown>,
  options: { name?: string; siteName?: string } = {},
): SeoMeta {
  const value = data[options.name ?? 'seo']
  const own = isRecord(value) ? value : {}
  const fallback = (from: string | undefined) => (from ? plainText(data[from]) || null : null)
  const description = filled(own.description) ?? fallback(field.descriptionFrom)
  const image = imageValue.safeParse(own.image)
  return {
    title: filled(own.title) ?? fallbackTitle(fallback(field.titleFrom), options.siteName),
    description: description && clip(description, SEO_DESCRIPTION_MAX),
    keyword: filled(own.keyword),
    image: image.success ? image.data : null,
  }
}
