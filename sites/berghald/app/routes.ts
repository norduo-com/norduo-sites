import { pagePaths } from '@norduo/cms'
import { index, layout, route, type RouteConfig } from '@react-router/dev/routes'

import cms from '../cms.config'

/** Pages with their own screen; the rest show their header until theirs is built. */
const FILES: Partial<Record<string, string>> = { home: 'routes/home.tsx' }

/**
 * Every page in every locale, from the paths in cms.config.ts: Icelandic at the root,
 * English under /en. Route ids are "<page>.<locale>".
 */
const pages = pagePaths(cms).flatMap(({ name, paths }) =>
  Object.entries(paths).map(([locale, path]) => {
    const file = FILES[name] ?? 'routes/page.tsx'
    const id = `${name}.${locale}`
    return path === '/' ? index(file, { id }) : route(path.slice(1), file, { id })
  }),
)

export default [
  layout('routes/layout.tsx', pages),
  route('sitemap.xml', 'routes/sitemap.ts'),
  route('vefstjorn/*', 'routes/vefstjorn.tsx'),
] satisfies RouteConfig
