import { getSingleton, pageHeaders } from '@norduo/cms/server'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router'

import { Footer } from '~/components/Footer'
import { cloudflare } from '~/context'
import { localeOf } from '~/locale'

import cms from '../../cms.config'
import type { Route } from './+types/layout'

/**
 * The public site's shell around every page: the menu labels (each page's `title`), the
 * footer and the contact details. Each page draws its own header box with the menu in it.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare)
  const locale = localeOf(request)
  const [headers, footer, settings] = await Promise.all([
    pageHeaders(env.DB, cms, ['title'], { locale }),
    getSingleton(env.DB, cms, 'footer', { locale }),
    getSingleton(env.DB, cms, 'settings', {
      locale,
      fields: ['company', 'kennitala', 'phone', 'email'],
    }),
  ])
  const titles: Partial<Record<string, string>> = {}
  for (const [name, header] of Object.entries(headers)) {
    if (typeof header?.title === 'string') titles[name] = header.title
  }
  return { titles, footer, settings }
}

export default function SiteLayout() {
  const { t } = useTranslation('site')
  return (
    <>
      <a
        href="#main"
        className="focus:top-4 focus:left-4 focus:bg-white focus:px-5 focus:py-3 sr-only focus:not-sr-only focus:fixed focus:z-50 focus:rounded-full"
      >
        {t('nav.skip')}
      </a>
      <Outlet />
      <Footer />
    </>
  )
}
