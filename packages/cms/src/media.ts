import type { BlockConfig, Field, Fields } from './fields'

/**
 * Photos: only the master image is stored (ADR 0001), and the site shows it through
 * `/img/<width>/<id>` at a fixed set of widths, to stay inside the free plan's
 * 5,000 unique transformations a month.
 */

/** The only widths `/img` serves. */
export const IMAGE_WIDTHS = [480, 960, 1440, 1920] as const
export type ImageWidth = (typeof IMAGE_WIDTHS)[number]

/** Long edge of a master image. */
export const MASTER_MAX_EDGE = 2560

/** The Images binding fails on anything larger, so the Worker never takes more. */
export const MAX_BINDING_BYTES = 20 * 1024 * 1024

/** What the site needs to show a photo before and while it loads. */
export interface MediaInfo {
  id: string
  width: number
  height: number
  /** Blurred preview as a data URI (a few hundred bytes). */
  lqip: string | null
  alt: string | null
}

/** Size of the master for a photo of `width` × `height`: long edge ≤ 2560, never upscaled. */
export function masterSize(width: number, height: number) {
  const scale = Math.min(1, MASTER_MAX_EDGE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export const imageUrl = (id: string, width: ImageWidth) => `/img/${String(width)}/${id}`

export const imageSrcSet = (id: string) =>
  IMAGE_WIDTHS.map((w) => `${imageUrl(id, w)} ${String(w)}w`).join(', ')

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function idOf(value: unknown): string[] {
  return isRecord(value) && typeof value.mediaId === 'string' ? [value.mediaId] : []
}

/** How a document uses a photo: an `image()` field, or an item in a `gallery()`. */
export type MediaUse = 'image' | 'gallery'

type Nested = Field & { fields?: Fields; blocks?: Record<string, BlockConfig> }

const blockDef = (field: Nested, item: Record<string, unknown>) =>
  typeof item.type === 'string' && field.blocks && Object.hasOwn(field.blocks, item.type)
    ? field.blocks[item.type]
    : undefined

function collect(field: Field, value: unknown, visit: (id: string, use: MediaUse) => void) {
  const nested = field as Nested
  const list = Array.isArray(value) ? (value as unknown[]) : []
  switch (field.kind) {
    case 'image':
      for (const id of idOf(value)) visit(id, 'image')
      break
    case 'gallery':
      for (const item of list) for (const id of idOf(item)) visit(id, 'gallery')
      break
    case 'group':
    case 'seo':
      if (nested.fields && isRecord(value)) walk(nested.fields, value, visit)
      break
    case 'repeater':
      for (const item of list) if (nested.fields && isRecord(item)) walk(nested.fields, item, visit)
      break
    case 'blocks':
      for (const item of list) {
        if (!isRecord(item) || !isRecord(item.data)) continue
        const def = blockDef(nested, item)
        if (def) walk(def.fields, item.data, visit)
      }
      break
  }
}

function walk(
  fields: Fields,
  data: Record<string, unknown>,
  visit: (id: string, use: MediaUse) => void,
) {
  for (const [name, field] of Object.entries(fields)) collect(field, data[name], visit)
}

/** Ids of every photo a document uses, found through its fields, each once. */
export function mediaIdsOf(fields: Fields, data: Record<string, unknown>): string[] {
  return [...mediaUsesOf(fields, data).keys()]
}

/**
 * Every photo a document uses and how. A photo in an `image()` field anywhere counts as
 * `image` even if a gallery has it too, since that use blocks deleting it.
 */
export function mediaUsesOf(fields: Fields, data: Record<string, unknown>): Map<string, MediaUse> {
  const out = new Map<string, MediaUse>()
  walk(fields, data, (id, use) => {
    if (out.get(id) !== 'image') out.set(id, use)
  })
  return out
}

function strip(field: Field, value: unknown, id: string): unknown {
  const nested = field as Nested
  if (!Array.isArray(value) && !isRecord(value)) return value
  switch (field.kind) {
    case 'gallery':
      return Array.isArray(value) ? value.filter((item) => !idOf(item).includes(id)) : value
    case 'group':
    case 'seo':
      return nested.fields && isRecord(value) ? stripAll(nested.fields, value, id) : value
    case 'repeater':
      return Array.isArray(value)
        ? value.map((item: unknown) =>
            nested.fields && isRecord(item) ? stripAll(nested.fields, item, id) : item,
          )
        : value
    case 'blocks':
      return Array.isArray(value)
        ? value.map((item: unknown) => {
            if (!isRecord(item) || !isRecord(item.data)) return item
            const def = blockDef(nested, item)
            return def ? { ...item, data: stripAll(def.fields, item.data, id) } : item
          })
        : value
    default:
      return value
  }
}

function stripAll(fields: Fields, data: Record<string, unknown>, id: string) {
  const out = { ...data }
  for (const [name, field] of Object.entries(fields))
    if (Object.hasOwn(out, name)) out[name] = strip(field, out[name], id)
  return out
}

/** The document with photo `id` taken out of every gallery; `image()` fields are left as they are. */
export function removeFromGalleries(
  fields: Fields,
  data: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  return stripAll(fields, data, id)
}
