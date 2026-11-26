import { AwsV4Signer } from 'aws4fetch'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'

import { media } from '../db/schema'
import { MAX_VIDEO_BYTES, VIDEO_TYPE } from '../gallery'
import type { MediaInfo } from '../media'
import { ID, mediaByIds, type MediaFailure } from './media'

/*
 * Video upload (issues #19, #34). An MP4 is too big for a Worker request, so the browser PUTs
 * it straight to R2 with a presigned URL. The URL signs the declared size and type, so R2
 * refuses any other body (403) and the 200 MB cap needs no check afterwards. The Worker then
 * HEADs the object before it adds the media row.
 */

export interface VideoBindings {
  DB: D1Database
  MEDIA: R2Bucket
  ENVIRONMENT?: string
  /** Name of the bucket behind `MEDIA`, for the S3 URL. */
  R2_BUCKET?: string
  /** Secrets: the account and a bucket-scoped R2 token (Object Read & Write). */
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
}

export const videoKey = (id: string) => `media/${id}.mp4`

/** How long a presigned URL works; one 200 MB PUT takes well under a minute on a good line. */
export const PRESIGN_SECONDS = 15 * 60

export interface VideoTicket {
  id: string
  /** Where to PUT the file, with exactly `headers` and the declared size. */
  url: string
  headers: Record<string, string>
}

function s3(env: VideoBindings) {
  const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env
  return R2_ACCOUNT_ID && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
    ? {
        accountId: R2_ACCOUNT_ID,
        bucket: R2_BUCKET,
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      }
    : null
}

/**
 * Without the S3 token, local dev and tests PUT to the Worker instead (`putLocalVideo`), with
 * the same checks R2 makes. Production never does: there it is an error.
 */
const usesLocalPut = (env: VideoBindings) => !s3(env) && env.ENVIRONMENT !== 'production'

/**
 * A presigned PUT for one MP4 of `size` bytes. `localUrl` is where the Worker takes the PUT
 * itself when there is no S3 token (local dev and tests).
 */
export async function presignVideo(
  env: VideoBindings,
  input: { size: unknown; type: unknown },
  localUrl: (id: string, size: number) => string,
): Promise<VideoTicket | MediaFailure> {
  if (input.type !== VIDEO_TYPE) return { error: 'type', status: 415 }
  const size = input.size
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0)
    return { error: 'empty', status: 422 }
  if (size > MAX_VIDEO_BYTES) return { error: 'tooBig', status: 413 }

  const id = crypto.randomUUID()
  const headers = { 'content-type': VIDEO_TYPE }
  const creds = s3(env)
  if (!creds) {
    return usesLocalPut(env)
      ? { id, url: localUrl(id, size), headers }
      : { error: 'noVideoUpload', status: 501 }
  }
  const url = new URL(
    `https://${creds.accountId}.r2.cloudflarestorage.com/${creds.bucket}/${videoKey(id)}`,
  )
  url.searchParams.set('X-Amz-Expires', String(PRESIGN_SECONDS))
  const signed = await new AwsV4Signer({
    method: 'PUT',
    url: url.toString(),
    headers: { ...headers, 'content-length': String(size) },
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    service: 's3',
    region: 'auto',
    signQuery: true,
    // content-length is "unsignable" by default; signing it is what enforces the size.
    allHeaders: true,
  }).sign()
  return { id, url: signed.url.toString(), headers }
}

/**
 * The PUT that stands in for R2 without an S3 token. Like a presigned URL, it takes only a
 * body of exactly the declared size and type, and refuses anything else with 403.
 */
export async function putLocalVideo(
  env: VideoBindings,
  request: Request,
  id: string,
  size: number,
): Promise<{ ok: true } | MediaFailure> {
  if (!usesLocalPut(env) || !ID.test(id)) return { error: 'notFound', status: 404 }
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_VIDEO_BYTES)
    return { error: 'signature', status: 403 }
  if (request.headers.get('content-type') !== VIDEO_TYPE) return { error: 'signature', status: 403 }
  const length = request.headers.get('content-length')
  if (length !== null && Number(length) !== size) return { error: 'signature', status: 403 }
  const bytes = await request.arrayBuffer()
  if (bytes.byteLength !== size) return { error: 'signature', status: 403 }
  await env.MEDIA.put(videoKey(id), bytes, { httpMetadata: { contentType: VIDEO_TYPE } })
  return { ok: true }
}

const dimension = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 16384 ? v : null

/**
 * Adds the media row once the PUT is done, after checking the object is there. Safe to
 * retry. `width` and `height` are what the browser read from the file, if it could.
 */
export async function completeVideo(
  env: VideoBindings,
  id: string,
  input: { filename?: unknown; width?: unknown; height?: unknown },
): Promise<{ media: MediaInfo; created: boolean } | MediaFailure> {
  if (!ID.test(id)) return { error: 'notFound', status: 404 }
  const existing = (await mediaByIds(env.DB, [id])).get(id)
  if (existing) return { media: existing, created: false }
  const head = await env.MEDIA.head(videoKey(id))
  if (!head) return { error: 'notFound', status: 404 }
  // Only a presigned PUT can write here, so this is a second line of defence.
  if (head.httpMetadata?.contentType !== VIDEO_TYPE || head.size > MAX_VIDEO_BYTES) {
    await env.MEDIA.delete(videoKey(id))
    return { error: 'type', status: 415 }
  }
  const width = dimension(input.width)
  const height = width === null ? null : dimension(input.height)
  const filename =
    typeof input.filename === 'string' && input.filename ? input.filename : 'video.mp4'
  await drizzle(env.DB)
    .insert(media)
    .values({
      id,
      key: videoKey(id),
      filename: filename.slice(0, 200),
      mime: VIDEO_TYPE,
      size: head.size,
      width: height === null ? null : width,
      height,
    })
  return {
    media: {
      id,
      width: height === null ? 0 : (width ?? 0),
      height: height ?? 0,
      lqip: null,
      alt: null,
    },
    created: true,
  }
}

const FILE = /^([0-9a-f-]{36})\.mp4$/

/** A `Range: bytes=…` header as R2 takes it; anything else gets the whole file. */
export function parseRange(header: string | undefined): R2Range | undefined {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
  if (!m) return undefined
  const [, from = '', to = ''] = m
  if (from === '' && to === '') return undefined
  if (from === '') return { suffix: Number(to) }
  const offset = Number(from)
  return to === ''
    ? { offset }
    : Number(to) < offset
      ? undefined
      : { offset, length: Number(to) - offset + 1 }
}

/**
 * `/video/<id>.mp4`: a gallery's MP4 as it was uploaded, with byte ranges so browsers can seek.
 * It streams from R2 without touching the bytes, so it costs next to no CPU.
 * A site mounts it, e.g. `app.route('/video', createVideoRoute())`.
 */
export function createVideoRoute() {
  const app = new Hono<{ Bindings: { MEDIA: R2Bucket } }>()

  app.get('/:file', async (c) => {
    const id = FILE.exec(c.req.param('file'))?.[1]
    if (!id || !ID.test(id)) return c.notFound()
    const requested = parseRange(c.req.header('range'))
    // R2 throws on a range past the end of the file.
    const object = await c.env.MEDIA.get(videoKey(id), requested ? { range: requested } : {}).catch(
      () => 'unsatisfiable' as const,
    )
    if (object === 'unsatisfiable') {
      const head = await c.env.MEDIA.head(videoKey(id))
      if (!head) return c.notFound()
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${String(head.size)}` },
      })
    }
    if (!object) return c.notFound()
    const headers = new Headers({
      'content-type': VIDEO_TYPE,
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=31536000, immutable',
      etag: object.httpEtag,
    })
    if (!requested) {
      headers.set('content-length', String(object.size))
      return new Response(object.body, { headers })
    }
    // From the request rather than `object.range`, whose shape differs between runtimes.
    const offset =
      'suffix' in requested ? Math.max(0, object.size - requested.suffix) : (requested.offset ?? 0)
    const length =
      'suffix' in requested ? object.size - offset : (requested.length ?? object.size - offset)
    if (offset >= object.size || length <= 0) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${String(object.size)}` },
      })
    }
    const end = Math.min(object.size, offset + length) - 1
    headers.set('content-range', `bytes ${String(offset)}-${String(end)}/${String(object.size)}`)
    headers.set('content-length', String(end - offset + 1))
    return new Response(object.body, { status: 206, headers })
  })

  return app
}
