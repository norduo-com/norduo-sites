/**
 * Only the live domain may be indexed. Every other host that serves the Worker – the
 * pre-launch berghald.eythorkonrads.com, PR previews, localhost – sends `noindex`, so
 * search engines never list a copy of the site.
 */
export function isIndexable(url: string, siteUrl: string): boolean {
  return new URL(url).hostname === new URL(siteUrl).hostname
}

/** Adds `X-Robots-Tag: noindex` to a response from a host that may not be indexed. */
export function withRobots(response: Response, url: string, siteUrl: string): Response {
  if (isIndexable(url, siteUrl)) return response
  // Responses from fetch or the cache have immutable headers.
  const copy = new Response(response.body, response)
  copy.headers.set('x-robots-tag', 'noindex')
  return copy
}
