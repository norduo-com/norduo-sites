import type { MediaInfo } from '../media'
import type { AdminDocument, AdminMedia, MediaUses, VideoTicket } from '../server'

export type Status = AdminDocument['status']

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`)
  }
}

/** Thin client for the admin API, e.g. `adminApi('/api/cms')`. */
export function adminApi(base: string) {
  async function send<T>(method: string, path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${base}/admin${path}`, { method, credentials: 'same-origin', ...init })
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) throw new ApiError(res.status, json)
    return json as T
  }
  const request = <T>(method: string, path: string, body?: unknown) =>
    send<T>(
      method,
      path,
      body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    )

  const path = (type: string, slug?: string) =>
    `/content/${encodeURIComponent(type)}${slug ? `/${encodeURIComponent(slug)}` : ''}`

  return {
    list: (type: string) => request<AdminDocument[]>('GET', path(type)),
    get: (type: string, slug: string, locale?: string) =>
      request<AdminDocument>(
        'GET',
        `${path(type, slug)}${locale ? `?locale=${encodeURIComponent(locale)}` : ''}`,
      ),
    create: (type: string, input: { status: Status; data: Record<string, unknown> }) =>
      request<{ slug: string }>('POST', path(type), input),
    update: (
      type: string,
      slug: string,
      input: {
        status: Status
        data: Record<string, unknown>
        /** A translated locale; its status follows the default locale's. */
        locale?: string
        /** Keys of machine translations to mark as reviewed. */
        approve?: string[]
      },
    ) => request<{ ok: true }>('PUT', path(type, slug), input),
    remove: (type: string, slug: string) => request<{ ok: true }>('DELETE', path(type, slug)),
    /** A master the browser made (WebP, or JPEG when it can't encode WebP). */
    uploadMaster: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return send<MediaInfo>('POST', '/media', { body: form })
    },
    /** A HEIC the browser can't decode, as it is; `makeMaster` then turns it into a master. */
    uploadRaw: (file: File) =>
      send<{ id: string }>('POST', `/media/raw?filename=${encodeURIComponent(file.name)}`, {
        headers: { 'content-type': file.type || 'image/heic' },
        body: file,
      }),
    makeMaster: (id: string) => send<MediaInfo>('POST', `/media/raw/${encodeURIComponent(id)}`),
    /** A presigned URL for one MP4 of exactly `size` bytes; `uploadVideo` PUTs it there. */
    videoTicket: (input: { size: number; type: string }) =>
      request<VideoTicket>('POST', '/media/video', input),
    /** Adds the video's media row once its PUT is done. */
    completeVideo: (id: string, input: { filename: string; width?: number; height?: number }) =>
      request<MediaInfo>('POST', `/media/video/${encodeURIComponent(id)}`, input),
    /** Myndasafn: every photo with the documents that use it. */
    listMedia: () => request<AdminMedia[]>('GET', '/media'),
    setAlt: (id: string, alt: string) =>
      request<{ ok: true }>('PATCH', `/media/${encodeURIComponent(id)}`, { alt }),
    mediaUses: (id: string) => request<MediaUses>('GET', `/media/${encodeURIComponent(id)}/uses`),
    /** `removeFromGalleries` once the editor has confirmed it; refused while an image() uses it. */
    removeMedia: (id: string, removeFromGalleries: boolean) =>
      request<{ ok: true }>(
        'DELETE',
        `/media/${encodeURIComponent(id)}${removeFromGalleries ? '?galleries=remove' : ''}`,
      ),
  }
}

export type AdminApi = ReturnType<typeof adminApi>
