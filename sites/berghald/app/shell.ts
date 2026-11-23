import { localeOfPath, pagePath, switchLocalePath } from '@norduo/cms'
import { useTranslation } from 'react-i18next'
import { useLocation, useRouteLoaderData } from 'react-router'

import cms from '../cms.config'
import type { loader } from './routes/layout'

type PageName = keyof typeof cms.pages

/** Pages in the main menu and in the footer's legal line, in order. */
export const MENU: readonly PageName[] = ['services', 'projects', 'about']
export const LEGAL: readonly PageName[] = ['privacy', 'cookies']

/** Where the quote form sits on the home page. */
export const QUOTE_ANCHOR = 'tilbod'

/** The other language of each locale, for the language switch. */
const OTHER: Record<string, string> = { is: 'en', en: 'is' }

/**
 * What the header and footer need, from the layout route's loader: links to pages in the
 * current locale, labelled with each page's title from Vefstjórn (or a fixed label until the
 * page is saved), and the same address in the other language.
 */
export function useShell() {
  const data = useRouteLoaderData<typeof loader>('routes/layout')
  const { t } = useTranslation('site')
  const { pathname, search } = useLocation()
  const locale = localeOfPath(cms, pathname)
  const link = (name: PageName) => ({
    name,
    href: pagePath(cms, name, locale) ?? '/',
    label: data?.titles[name] ?? t(`pages.${name}`),
  })
  const home = pagePath(cms, 'home', locale) ?? '/'
  const other = OTHER[locale] ?? cms.site.defaultLocale
  return {
    locale,
    home,
    quote: `${home}#${QUOTE_ANCHOR}`,
    menu: MENU.map(link),
    legal: LEGAL.map(link),
    /** The current page in the other language, query string kept (the hash isn't sent to SSR). */
    switchTo: { locale: other, href: switchLocalePath(cms, pathname + search, other) },
    footer: data?.footer ?? null,
    settings: data?.settings ?? null,
    /** Which menu entry the current path sits under, if any. */
    current: (href: string) => pathname === href || pathname.startsWith(`${href}/`),
  }
}

/** "691 8944" → "tel:+3546918944"; a number with its own country code keeps it. */
export function telHref(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return phone.trim().startsWith('+') ? `tel:+${digits}` : `tel:+354${digits}`
}
