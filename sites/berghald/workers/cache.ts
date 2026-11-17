/**
 * Edge cache for rendered pages.
 * The cache key includes a "content version" (last published change in D1),
 * so publishing in Vefstjórn makes every page re-render on its next visit –
 * no purge list to maintain.
 */

const BYPASS = ['/vefstjorn', '/api/']

async function contentVersion(db: D1Database): Promise<string> {
  const row = await db
    .prepare("select max(updated_at) as v from documents where status = 'published'")
    .first<{ v: number | null }>()
  return String(row?.v ?? 0)
}

export async function withPageCache(
  request: Request,
  env: Env,
  ctx: { waitUntil: (promise: Promise<unknown>) => void },
  render: (request: Request) => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url)
  const cacheable =
    request.method === 'GET' &&
    env.ENVIRONMENT === 'production' &&
    !BYPASS.some((p) => url.pathname.startsWith(p))
  if (!cacheable) return render(request)

  const version = await contentVersion(env.DB).catch(() => 'none')
  const key = new Request(`${url.origin}${url.pathname}${url.search}#v=${version}`)
  const cache = await caches.open('pages')

  const hit = await cache.match(key)
  if (hit) return hit

  const response = await render(request)
  if (response.ok && !response.headers.has('set-cookie')) {
    const copy = new Response(response.clone().body, response)
    copy.headers.set('cache-control', 'public, max-age=86400')
    ctx.waitUntil(cache.put(key, copy))
  }
  return response
}
