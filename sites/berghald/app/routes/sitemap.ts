import { sitemapXml } from '@norduo/cms'

import cms from '../../cms.config'
import type { Route } from './+types/sitemap'

/** Every page in Icelandic and English, with `xhtml:link` alternates. */
export function loader({ request }: Route.LoaderArgs) {
  const xml = sitemapXml(cms, new URL(request.url).origin, { exclude: ['thankYou'] })
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8' } })
}
