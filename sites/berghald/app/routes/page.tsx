import { pageAtPath, seoMeta } from '@norduo/cms'
import { getPage } from '@norduo/cms/server'
import { useTranslation } from 'react-i18next'

import { PageHeader } from '~/components/PageHeader'
import { cloudflare } from '~/context'
import { headTags } from '~/seo'

import cms from '../../cms.config'
import type { Route } from './+types/page'

type PageName = keyof typeof cms.pages

export function meta({ loaderData }: Route.MetaArgs) {
  return loaderData.head
}

/**
 * Any page from cms.config.ts that has no screen of its own yet: its header and SEO from
 * Vefstjórn, in the locale of the path. Each page gets its own route file as it is built.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare)
  const url = new URL(request.url)
  // routes.ts registers this file only at page paths, so the path always names a page.
  const at = pageAtPath(cms, url.pathname)
  if (!at) throw new Error(`No page at ${url.pathname}`)
  const name = at.page as PageName
  const page = await getPage(env.DB, cms, name, { locale: at.locale })
  const head = headTags(seoMeta(cms.pages[name].seo, page ?? {}, { siteName: cms.site.name }), url)
  // Only the header goes to the browser, not the whole page.
  const header = page && {
    title: page.title,
    eyebrow: page.eyebrow,
    heading: page.heading,
    lead: page.lead,
  }
  return { name, head, header }
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation('site')
  const { name, header } = loaderData
  return (
    <>
      <PageHeader
        eyebrow={header?.eyebrow}
        heading={header?.heading ?? header?.title ?? t(`pages.${name}`)}
        lead={header?.lead}
      />
      <main id="main" className="px-g" />
    </>
  )
}
