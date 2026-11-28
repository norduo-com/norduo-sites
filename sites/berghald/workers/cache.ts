import { contentVersion } from '@norduo/cms/server'

/**
 * Edge cache for rendered pages.
 * The cache key includes the content version, which goes up on every save or delete in
 * Vefstjórn, so any change makes every page re-render on its next visit, in every
 * data centre – no purge list to maintain.
 * It also includes the deployed Worker version: a deploy replaces the hashed /assets files,
 * so a page cached before it would point at CSS and JS that no longer exist.
 */

const BYPASS = ['/vefstjorn', '/api/']

/**
 * Query params a cached response may depend on: React Router's own (`_routes` and `index` on
 * `.data` requests, `paths` and `version` on `/__manifest`). The site reads none itself.
 */
const KEPT_PARAMS = ['_routes', 'index', 'paths', 'version']

/**
 * The URL a page is cached under and rendered from: other params (utm_*, fbclid, a random
 * `?x=`) are dropped and the rest sorted, so they can't force a fresh render each time.
 */
export function cacheUrl(url: URL): URL {
  const out = new URL(url.pathname, url.origin)
  for (const [k, v] of url.searchParams) if (KEPT_PARAMS.includes(k)) out.searchParams.append(k, v)
  out.searchParams.sort()
  return out
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
  const deploy = env.CF_VERSION_METADATA.id
  const page = cacheUrl(url)
  const key = new Request(`${page.href}#v=${version}&d=${deploy}`)
  const cache = await caches.open('pages')

  const hit = await cache.match(key)
  if (hit) return hit

  // Rendered from the same URL as the key, so a cached page never depends on a dropped param.
  const response = await render(page.href === url.href ? request : new Request(page, request))
  if (response.ok && !response.headers.has('set-cookie')) {
    const copy = new Response(response.clone().body, response)
    copy.headers.set('cache-control', 'public, max-age=86400')
    ctx.waitUntil(cache.put(key, copy))
  }
  return response
}
