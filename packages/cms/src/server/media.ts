import { inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'

import { media } from '../db/schema'
import {
  IMAGE_WIDTHS,
  type ImageWidth,
  MASTER_MAX_EDGE,
  masterSize,
  MAX_BINDING_BYTES,
  type MediaInfo,
} from '../media'

/*
 * Photo pipeline (ADR 0001, issues #4, #16, #20). Vefstjórn shrinks each photo in the browser
 * to a clean master and the Worker stores only that. The Worker does the expensive work only
 * when the browser can't: JPEG → WebP once, and HEIC the browser can't decode → master once.
 * Every Images binding call costs ~7 ms CPU per MB of input, so it only ever gets masters,
 * except for that one HEIC call.
 */

export interface MediaBindings {
  DB: D1Database
  MEDIA: R2Bucket
  IMAGES?: ImagesBinding
}

export const masterKey = (id: string) => `media/${id}.webp`
export const tmpKey = (id: string) => `tmp/${id}`

const MASTER_QUALITY = 90
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const streamOf = (bytes: Bytes) => new Response(bytes).body as ReadableStream<Uint8Array>
type Bytes = Uint8Array<ArrayBuffer>
const bytesOf = async (stream: ReadableStream<Uint8Array>): Promise<Bytes> =>
  new Uint8Array(await new Response(stream).arrayBuffer())

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length))

const u32le = (bytes: Uint8Array, at: number) =>
  ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16)) +
  (bytes[at + 3] ?? 0) * 0x1000000

const isWebp = (bytes: Uint8Array) => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'

/** Byte ranges of the EXIF and XMP blocks in a JPEG or WebP, where phones keep GPS. */
function metadataRanges(bytes: Uint8Array): [number, number][] {
  const out: [number, number][] = []
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG: walk the segments up to the image data.
    let at = 2
    while (at + 4 <= bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1] ?? 0
      if (marker === 0xda || marker === 0xd9) break
      const end = at + 2 + (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0))
      if (marker === 0xe1) {
        const head = ascii(bytes, at + 4, 29)
        if (head.startsWith('Exif\0') || head.startsWith('http://ns.adobe.com/xap/1.0/'))
          out.push([at, end])
      }
      at = end
    }
  } else if (isWebp(bytes)) {
    let at = 12
    while (at + 8 <= bytes.length) {
      const size = u32le(bytes, at + 4)
      const end = at + 8 + size + (size % 2)
      const fourcc = ascii(bytes, at, 4)
      if (fourcc === 'EXIF' || fourcc === 'XMP ') out.push([at, end])
      at = end
    }
  }
  return out
}

/**
 * Whether a JPEG or WebP carries EXIF or XMP. The Images binding copies it into every
 * output, so it is stripped before anything is stored.
 */
export const hasMetadata = (bytes: Uint8Array) => metadataRanges(bytes).length > 0

/**
 * The same JPEG or WebP without its EXIF and XMP blocks. The image data isn't touched, so
 * this costs only a copy. Safari writes a small EXIF block into every canvas JPEG.
 */
export function stripMetadata(bytes: Bytes): Bytes {
  const ranges = metadataRanges(bytes)
  if (ranges.length === 0) return bytes
  const parts: Uint8Array[] = []
  let at = 0
  for (const [from, to] of ranges) {
    parts.push(bytes.subarray(at, from))
    at = to
  }
  parts.push(bytes.subarray(at))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  if (isWebp(out)) {
    new DataView(out.buffer).setUint32(4, out.length - 8, true)
    // VP8X flags: clear "has EXIF" (0x08) and "has XMP" (0x04).
    if (ascii(out, 12, 4) === 'VP8X') out[20] = (out[20] ?? 0) & ~0x0c
  }
  return out
}

/** Most widths go out as AVIF or WebP; AVIF output stops at 1,200 px. */
export function negotiateFormat(accept: string | null | undefined, width: number) {
  if (accept?.includes('image/avif') && width <= 1200) return 'image/avif'
  if (accept?.includes('image/webp')) return 'image/webp'
  return 'image/jpeg'
}

/** 32 px wide, blurred WebP as a data URI: a few hundred bytes, stored in D1. */
async function blurredPreview(images: ImagesBinding, master: Bytes) {
  const out = await images
    .input(streamOf(master))
    .transform({ width: 32, blur: 2 })
    .output({ format: 'image/webp', quality: 40 })
  const bytes = await bytesOf(out.image())
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:image/webp;base64,${btoa(bin)}`
}

/** Stores a finished master and its row. */
async function store(
  env: MediaBindings & { IMAGES: ImagesBinding },
  input: { id: string; filename: string; master: Bytes; width: number; height: number },
): Promise<MediaInfo> {
  const { id, master, width, height } = input
  const lqip = await blurredPreview(env.IMAGES, master)
  await env.MEDIA.put(masterKey(id), master, { httpMetadata: { contentType: 'image/webp' } })
  await drizzle(env.DB)
    .insert(media)
    .values({
      id,
      key: masterKey(id),
      filename: input.filename.slice(0, 200),
      mime: 'image/webp',
      size: master.byteLength,
      width,
      height,
      lqip,
    })
  return { id, width, height, lqip, alt: null }
}

export interface MediaFailure {
  error: string
  status: 404 | 413 | 415 | 422 | 501
}

/**
 * A master made by the browser: WebP, or JPEG when the browser can't encode WebP.
 * It must already be shrunk and clean; a JPEG is converted to WebP here.
 */
export async function storeBrowserMaster(
  env: MediaBindings,
  file: File,
): Promise<MediaInfo | MediaFailure> {
  const { IMAGES } = env
  if (!IMAGES) return { error: 'noImages', status: 501 }
  if (file.type !== 'image/webp' && file.type !== 'image/jpeg')
    return { error: 'type', status: 415 }
  if (file.size > MAX_BINDING_BYTES) return { error: 'tooBig', status: 413 }
  const bytes = stripMetadata(new Uint8Array(await file.arrayBuffer()))

  const info = await IMAGES.info(streamOf(bytes)).catch(() => null)
  if (!info || !('width' in info)) return { error: 'undecodable', status: 415 }
  if (Math.max(info.width, info.height) > MASTER_MAX_EDGE) return { error: 'tooLarge', status: 422 }

  const master =
    file.type === 'image/webp'
      ? bytes
      : await bytesOf(
          (
            await IMAGES.input(streamOf(bytes)).output({
              format: 'image/webp',
              quality: MASTER_QUALITY,
            })
          ).image(),
        )
  return store(
    { ...env, IMAGES },
    {
      id: crypto.randomUUID(),
      filename: file.name,
      master,
      width: info.width,
      height: info.height,
    },
  )
}

/** A 1×1 opaque PNG. Drawing the photo onto it gives an output without the photo's EXIF. */
const BLANK_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  ),
  (c) => c.charCodeAt(0),
)

/**
 * Makes the master from a raw HEIC in `tmp/<id>` (one the browser couldn't decode), then
 * deletes it. Safe to retry: once the master exists, it returns it.
 */
export async function masterFromRaw(
  env: MediaBindings,
  id: string,
): Promise<{ media: MediaInfo; created: boolean } | MediaFailure> {
  const { IMAGES } = env
  if (!IMAGES) return { error: 'noImages', status: 501 }
  if (!ID.test(id)) return { error: 'notFound', status: 404 }
  const raw = await env.MEDIA.get(tmpKey(id))
  if (!raw) {
    const existing = (await mediaByIds(env.DB, [id])).get(id)
    return existing ? { media: existing, created: false } : { error: 'notFound', status: 404 }
  }
  const discard = () => env.MEDIA.delete(tmpKey(id))
  if (raw.size > MAX_BINDING_BYTES) {
    await discard()
    return { error: 'tooBig', status: 413 }
  }
  // If the binding fails from here on (e.g. 503 out of CPU), tmp/<id> stays for the retry;
  // the lifecycle rule removes it if nobody retries.
  const bytes = await bytesOf(raw.body as ReadableStream<Uint8Array>)
  const info = await IMAGES.info(streamOf(bytes)).catch(() => null)
  if (!info || !('width' in info)) {
    await discard()
    return { error: 'undecodable', status: 415 }
  }
  // `info` gives the size with the photo's orientation applied.
  const { width, height } = masterSize(info.width, info.height)
  const out = await IMAGES.input(streamOf(BLANK_PNG))
    .transform({ width, height, fit: 'squeeze' })
    .draw(IMAGES.input(streamOf(bytes)).transform({ width, height, fit: 'squeeze' }), {
      top: 0,
      left: 0,
    })
    .output({ format: 'image/webp', quality: MASTER_QUALITY })
  const master = await bytesOf(out.image())
  const filename = (raw.customMetadata?.filename ?? 'photo.heic').slice(0, 200)
  const stored = await store({ ...env, IMAGES }, { id, filename, master, width, height })
  await discard()
  return { media: stored, created: true }
}

/** Stores a raw HEIC under `tmp/` for `masterFromRaw`. R2 deletes `tmp/` after a day anyway. */
export async function putRaw(
  env: MediaBindings,
  request: Request,
  filename: string,
): Promise<{ id: string } | MediaFailure> {
  const type = request.headers.get('content-type') ?? ''
  if (!/^image\/hei[cf]$/.test(type)) return { error: 'type', status: 415 }
  const length = Number(request.headers.get('content-length'))
  if (length > MAX_BINDING_BYTES) return { error: 'tooBig', status: 413 }
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > MAX_BINDING_BYTES) return { error: 'tooBig', status: 413 }
  if (bytes.byteLength === 0) return { error: 'empty', status: 422 }
  const id = crypto.randomUUID()
  await env.MEDIA.put(tmpKey(id), bytes, {
    httpMetadata: { contentType: type },
    customMetadata: { filename: filename.slice(0, 200) },
  })
  return { id }
}

/** Size, blurred preview and alt of photos, by id, for the site to render. */
export async function mediaByIds(db: D1Database, ids: readonly string[]) {
  const unique = [...new Set(ids)]
  const rows = unique.length
    ? await drizzle(db)
        .select({
          id: media.id,
          width: media.width,
          height: media.height,
          lqip: media.lqip,
          alt: media.alt,
        })
        .from(media)
        .where(inArray(media.id, unique))
    : []
  return new Map(
    rows.map((r): [string, MediaInfo] => [
      r.id,
      { id: r.id, width: r.width ?? 0, height: r.height ?? 0, lqip: r.lqip, alt: r.alt },
    ]),
  )
}

const isWidth = (w: number): w is ImageWidth => (IMAGE_WIDTHS as readonly number[]).includes(w)

/**
 * `/img/<width>/<id>`: a photo at one of the fixed widths, made from its master and cached
 * at the edge. A site mounts it, e.g. `app.route('/img', createImageRoute())`.
 */
export function createImageRoute() {
  const app = new Hono<{ Bindings: MediaBindings }>()

  app.get('/:width/:id', async (c) => {
    const width = Number(c.req.param('width'))
    const id = c.req.param('id')
    if (!isWidth(width) || !ID.test(id)) return c.notFound()
    const format = negotiateFormat(c.req.header('accept'), width)

    const cache = typeof caches === 'undefined' ? undefined : await caches.open('img')
    const url = new URL(c.req.url)
    const cacheKey = new Request(`${url.origin}/img/${String(width)}/${id}?f=${format}`)
    const hit = await cache?.match(cacheKey)
    if (hit) return hit

    const master = await c.env.MEDIA.get(masterKey(id))
    if (!master) return c.notFound()
    const headers = {
      'cache-control': 'public, max-age=31536000, immutable',
      vary: 'Accept',
    }
    let response: Response
    try {
      if (!c.env.IMAGES) throw new Error('No Images binding')
      const out = await c.env.IMAGES.input(master.body as ReadableStream<Uint8Array>)
        .transform({ width, fit: 'scale-down' })
        .output({ format, quality: 80 })
      response = new Response(out.image(), {
        headers: { ...headers, 'content-type': out.contentType() },
      })
    } catch {
      // E.g. the month's transformations are used up (9422). The master is clean WebP, so a
      // browser that takes WebP gets it as it is, briefly cached; others get a retryable error.
      if (!c.req.header('accept')?.includes('image/webp'))
        return c.body(null, 503, { 'retry-after': '300' })
      const fallback = await c.env.MEDIA.get(masterKey(id))
      if (!fallback) return c.notFound()
      return new Response(fallback.body, {
        headers: {
          'content-type': 'image/webp',
          'cache-control': 'public, max-age=300',
          vary: 'Accept',
        },
      })
    }
    if (cache) c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  })

  return app
}
