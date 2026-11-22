import { group, image, type ImageValue, imageValue, text } from './fields'
import type { RichTextValue } from './richtext'

/** Sub-fields of `seo()`. Their labels are Vefstjórn's own (`vefstjorn` namespace). */
const seoFields = {
  keyword: text({ i18n: true }),
  title: text({ i18n: true, max: 60 }),
  description: text({ i18n: true, max: 160, multiline: true }),
  image: image(),
}

/** Search engines cut longer descriptions, and fallbacks are cut to the same length. */
export const SEO_DESCRIPTION_MAX = 160

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

/**
 * What goes in the page's `<head>`: the `seo()` value with its fallbacks applied.
 * `data` is the whole document the field belongs to, with the value under `name`.
 */
export function seoMeta(
  field: Pick<SeoField, 'titleFrom' | 'descriptionFrom'>,
  data: Record<string, unknown>,
  name = 'seo',
): SeoMeta {
  const own = isRecord(data[name]) ? data[name] : {}
  const fallback = (from: string | undefined) => (from ? plainText(data[from]) || null : null)
  const description = filled(own.description) ?? fallback(field.descriptionFrom)
  const image = imageValue.safeParse(own.image)
  return {
    title: filled(own.title) ?? fallback(field.titleFrom),
    description: description && clip(description, SEO_DESCRIPTION_MAX),
    keyword: filled(own.keyword),
    image: image.success ? image.data : null,
  }
}
