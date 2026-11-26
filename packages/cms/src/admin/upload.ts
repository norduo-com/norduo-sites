import { MAX_VIDEO_BYTES, VIDEO_TYPE } from '../gallery'
import { masterSize, MAX_BINDING_BYTES, type MediaInfo } from '../media'
import { type AdminApi, ApiError } from './api'

/*
 * Photo upload (ADR 0001). The browser makes the master: it decodes the photo (which applies
 * its orientation), shrinks it to ≤ 2560 px and re-encodes it, so EXIF and GPS never leave
 * the editor's device. Only a HEIC the browser can't decode goes up as it is, and the Worker
 * makes its master. Videos (MP4) go straight to R2 instead; see `uploadVideo`.
 */

export type UploadErrorCode =
  'tooBig' | 'unsupported' | 'failed' | 'videoTooBig' | 'videoType' | 'videoFailed'

export class UploadError extends Error {
  constructor(
    readonly code: UploadErrorCode,
    /** What went wrong, for a bug report, e.g. "422 tooLarge". */
    readonly detail?: string,
  ) {
    super(code)
  }
}

/** What the file picker offers. iOS hands HEIC over as is; Safari can decode it. */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'

const isHeic = (file: File) => /^image\/hei[cf]$/.test(file.type) || /\.hei[cf]$/i.test(file.name)

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality)
  })

/** WebP at q 0.9, or JPEG at q 0.92 where the browser can't encode WebP (Safari). */
async function encodeMaster(bitmap: ImageBitmap): Promise<Blob> {
  const { width, height } = masterSize(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new UploadError('failed')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  const webp = await toBlob(canvas, 'image/webp', 0.9)
  if (webp?.type === 'image/webp') return webp
  // JPEG has no transparency: put white behind the photo instead of black.
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.92)
  if (!jpeg) throw new UploadError('failed')
  return jpeg
}

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/** The Images binding can run the Worker out of CPU (503); a short wait usually fixes it. */
async function withRetry<T>(call: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call()
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 503 || attempt >= tries) throw err
      await wait(1000 * attempt)
    }
  }
}

function codeOf(err: unknown): UploadErrorCode {
  if (err instanceof UploadError) return err.code
  if (err instanceof ApiError && err.status === 413) return 'tooBig'
  if (err instanceof ApiError && err.status === 415) return 'unsupported'
  return 'failed'
}

function detailOf(err: unknown): string | undefined {
  if (err instanceof UploadError) return err.detail
  if (err instanceof ApiError) {
    const body = err.body as { error?: unknown } | null
    return [err.status, typeof body?.error === 'string' ? body.error : ''].join(' ').trim()
  }
  return err instanceof Error ? err.name : undefined
}

/** Uploads one photo and returns it once its master is stored. Throws `UploadError`. */
export async function uploadImage(api: AdminApi, file: File): Promise<MediaInfo> {
  try {
    const bitmap = await createImageBitmap(file).catch(() => null)
    if (bitmap) {
      const master = await encodeMaster(bitmap).finally(() => {
        bitmap.close()
      })
      return await withRetry(() =>
        api.uploadMaster(new File([master], file.name, { type: master.type })),
      )
    }
    if (!isHeic(file)) throw new UploadError('unsupported')
    if (file.size > MAX_BINDING_BYTES) throw new UploadError('tooBig')
    const { id } = await withRetry(() => api.uploadRaw(file))
    return await withRetry(() => api.makeMaster(id))
  } catch (err) {
    throw new UploadError(codeOf(err), detailOf(err))
  }
}

/** What the video picker offers: MP4 only, the one format every browser plays. */
export const VIDEO_ACCEPT = 'video/mp4,.mp4'

const isMp4 = (file: File) => file.type === VIDEO_TYPE || (!file.type && /\.mp4$/i.test(file.name))

interface VideoProbe {
  /** Frame size, for the site to reserve space. */
  size: { width: number; height: number } | null
  /** A still from about 1 s in (many clips open black or fade in), to use as the poster. */
  frame: File | null
}

const FRAME_AT_SECONDS = 1

/** Whether `event` fires on the video before an error or `ms` passes. */
function fired(video: HTMLVideoElement, event: string, ms: number) {
  return new Promise<boolean>((resolve) => {
    const finish = (ok: boolean) => () => {
      clearTimeout(timer)
      video.removeEventListener(event, yes)
      video.removeEventListener('error', no)
      resolve(ok)
    }
    const yes = finish(true)
    const no = finish(false)
    const timer = setTimeout(no, ms)
    video.addEventListener(event, yes)
    video.addEventListener('error', no)
  })
}

/** A still of the video at about 1 s, as a JPEG for `uploadImage`, or null. */
async function stillOf(video: HTMLVideoElement, filename: string): Promise<File | null> {
  // iOS Safari loads no frames for a video that hasn't played, so seeking never finishes.
  // A muted, inline video may play without a tap; it's paused again straight away.
  await Promise.race([video.play().catch(() => undefined), wait(3000)])
  video.pause()
  const length = Number.isFinite(video.duration) ? video.duration : 0
  const seeked = fired(video, 'seeked', 8000)
  video.currentTime = Math.min(FRAME_AT_SECONDS, length / 2)
  if (!(await seeked)) return null
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA &&
    !(await fired(video, 'loadeddata', 4000))
  )
    return null
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0)
  const blob = await toBlob(canvas, 'image/jpeg', 0.92)
  return blob
    ? new File([blob], `${filename.replace(/\.[^.]*$/, '')}.jpg`, { type: 'image/jpeg' })
    : null
}

/**
 * What this browser can read from the video: its size and a still. Both are null where it
 * can't decode the codec (e.g. HEVC in Chrome on some systems); the upload goes on anyway.
 */
async function probeVideo(file: File): Promise<VideoProbe> {
  const video = document.createElement('video')
  const src = URL.createObjectURL(file)
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  // In the page but out of sight: iOS Safari won't play a video that isn't.
  video.setAttribute('aria-hidden', 'true')
  video.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(video)
  try {
    const loaded = fired(video, 'loadedmetadata', 8000)
    video.src = src
    if (!(await loaded) || !video.videoWidth) return { size: null, frame: null }
    const size = { width: video.videoWidth, height: video.videoHeight }
    const frame = await stillOf(video, file.name).catch(() => null)
    return { size, frame }
  } finally {
    video.pause()
    video.remove()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(src)
  }
}

/** One PUT of the whole file. XHR rather than fetch, for upload progress. */
function put(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (share: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new UploadError('failed', `PUT ${String(xhr.status)}`))
    }
    // R2's 403 has no CORS headers, so a refused PUT from the browser also lands here.
    xhr.onerror = () => {
      reject(new UploadError('failed', 'PUT network'))
    }
    xhr.send(file)
  })
}

/**
 * Uploads one MP4 straight to R2 through a presigned URL that signs its size, then adds its
 * media row. A failed PUT gets one more try with a new URL. Throws `UploadError`.
 * Also returns a still from the video, if the browser could make one, for `uploadImage`.
 */
export async function uploadVideo(
  api: AdminApi,
  file: File,
  onProgress?: (share: number) => void,
): Promise<{ media: MediaInfo; frame: File | null }> {
  try {
    if (!isMp4(file)) throw new UploadError('videoType')
    if (file.size > MAX_VIDEO_BYTES) throw new UploadError('videoTooBig')
    const { size, frame } = await probeVideo(file)
    for (let attempt = 1; ; attempt++) {
      const ticket = await api.videoTicket({ size: file.size, type: VIDEO_TYPE })
      try {
        await put(ticket.url, file, ticket.headers, onProgress)
      } catch (err) {
        if (attempt >= 2) throw err
        continue
      }
      const media = await api.completeVideo(ticket.id, { filename: file.name, ...size })
      return { media, frame }
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 413) throw new UploadError('videoTooBig')
    if (err instanceof ApiError && err.status === 415) throw new UploadError('videoType')
    if (err instanceof UploadError && err.code !== 'failed') throw err
    throw new UploadError('videoFailed', detailOf(err))
  }
}
