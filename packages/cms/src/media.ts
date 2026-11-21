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

function collect(field: Field, value: unknown, out: Set<string>) {
  const nested = field as Field & { fields?: Fields; blocks?: Record<string, BlockConfig> }
  const list = Array.isArray(value) ? (value as unknown[]) : []
  switch (field.kind) {
    case 'image':
      for (const id of idOf(value)) out.add(id)
      break
    case 'gallery':
      for (const item of list) for (const id of idOf(item)) out.add(id)
      break
    case 'group':
      if (nested.fields && isRecord(value)) walk(nested.fields, value, out)
      break
    case 'repeater':
      for (const item of list) if (nested.fields && isRecord(item)) walk(nested.fields, item, out)
      break
    case 'blocks':
      for (const item of list) {
        if (!isRecord(item) || typeof item.type !== 'string' || !isRecord(item.data)) continue
        const def =
          nested.blocks && Object.hasOwn(nested.blocks, item.type)
            ? nested.blocks[item.type]
            : undefined
        if (def) walk(def.fields, item.data, out)
      }
      break
  }
}

function walk(fields: Fields, data: Record<string, unknown>, out: Set<string>) {
  for (const [name, field] of Object.entries(fields)) collect(field, data[name], out)
}

/** Ids of every photo a document uses, found through its fields, each once. */
export function mediaIdsOf(fields: Fields, data: Record<string, unknown>): string[] {
  const out = new Set<string>()
  walk(fields, data, out)
  return [...out]
}
