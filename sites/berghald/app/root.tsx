import './app.css'

import { pagePath } from '@norduo/cms'
import type { ReactNode } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'

import cms from '../cms.config'
import type { Route } from './+types/root'
import { i18nFor } from './i18n'
import { useLocale } from './locale'

export function Layout({ children }: { children: ReactNode }) {
  const locale = useLocale()
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <I18nextProvider i18n={i18nFor(locale)}>{children}</I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useTranslation('site')
  const locale = useLocale()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return (
    <main className="p-g">
      <h1 className="text-3xl">{notFound ? t('errors.notFound') : t('errors.generic')}</h1>
      <p>
        <a href={pagePath(cms, 'home', locale)}>{t('errors.home')}</a>
      </p>
    </main>
  )
}
