import './app.css'

import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'

import type { Route } from './+types/root'
import { ErrorPage } from './components/ErrorPage'
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
  return <ErrorPage error={error} />
}
