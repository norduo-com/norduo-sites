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
  const key = new Request(`${url.origin}${url.pathname}${url.search}#v=${version}&d=${deploy}`)
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
