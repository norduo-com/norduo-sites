import { masterSize, MAX_BINDING_BYTES, type MediaInfo } from '../media'
import { type AdminApi, ApiError } from './api'

/*
 * Photo upload (ADR 0001). The browser makes the master: it decodes the photo (which applies
 * its orientation), shrinks it to ≤ 2560 px and re-encodes it, so EXIF and GPS never leave
 * the editor's device. Only a HEIC the browser can't decode goes up as it is, and the Worker
 * makes its master.
 */

export type UploadErrorCode = 'tooBig' | 'unsupported' | 'failed'

export class UploadError extends Error {
  constructor(readonly code: UploadErrorCode) {
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
    throw new UploadError(codeOf(err))
  }
}
