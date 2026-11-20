import type { AdminDocument } from '../server'

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
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}/admin${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) throw new ApiError(res.status, json)
    return json as T
  }

  const path = (type: string, slug?: string) =>
    `/content/${encodeURIComponent(type)}${slug ? `/${encodeURIComponent(slug)}` : ''}`

  return {
    list: (type: string) => request<AdminDocument[]>('GET', path(type)),
    get: (type: string, slug: string) => request<AdminDocument>('GET', path(type, slug)),
    create: (type: string, input: { status: Status; data: Record<string, unknown> }) =>
      request<{ slug: string }>('POST', path(type), input),
    update: (
      type: string,
      slug: string,
      input: { status: Status; data: Record<string, unknown> },
    ) => request<{ ok: true }>('PUT', path(type, slug), input),
    remove: (type: string, slug: string) => request<{ ok: true }>('DELETE', path(type, slug)),
  }
}

export type AdminApi = ReturnType<typeof adminApi>
