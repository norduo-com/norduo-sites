import { afterEach, describe, expect, it, vi } from 'vitest'

import { cacheUrl, withPageCache } from './cache'

vi.mock('@norduo/cms/server', () => ({ contentVersion: () => Promise.resolve(7) }))

const key = (href: string) => cacheUrl(new URL(href)).href

describe('cacheUrl', () => {
  it('drops params the site does not read', () => {
    expect(key('https://berghald.is/verkefni?utm_source=fb&fbclid=1&x=42')).toBe(
      'https://berghald.is/verkefni',
    )
  })

  it("keeps React Router's own params, sorted", () => {
    expect(key('https://berghald.is/verkefni.data?x=1&_routes=routes%2Fpage')).toBe(
      'https://berghald.is/verkefni.data?_routes=routes%2Fpage',
    )
    expect(key('https://berghald.is/__manifest?version=abc&paths=%2F%2C%2Fen')).toBe(
      key('https://berghald.is/__manifest?paths=%2F%2C%2Fen&version=abc'),
    )
  })
})

describe('withPageCache', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders a random query from the clean URL and caches it once', async () => {
    const store = new Map<string, Response>()
    vi.stubGlobal('caches', {
      open: () =>
        Promise.resolve({
          match: (req: Request) => Promise.resolve(store.get(req.url)?.clone()),
          put: (req: Request, res: Response) => Promise.resolve(void store.set(req.url, res)),
        }),
    })
    const env = { ENVIRONMENT: 'production', CF_VERSION_METADATA: { id: 'd1' } } as unknown as Env
    const waits: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) }
    const rendered: string[] = []
    const render = (req: Request) => {
      rendered.push(req.url)
      return Promise.resolve(new Response('page'))
    }

    await withPageCache(new Request('https://berghald.is/?x=1'), env, ctx, render)
    await Promise.all(waits)
    await withPageCache(new Request('https://berghald.is/?x=2'), env, ctx, render)

    expect(rendered).toEqual(['https://berghald.is/'])
    expect(store.size).toBe(1)
  })
})
