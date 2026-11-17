import './app.css'

import type { ReactNode } from 'react'
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'

import type { Route } from './+types/root'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="is">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
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
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return (
    <main className="p-g">
      <h1 className="text-3xl">{notFound ? 'Síða fannst ekki' : 'Eitthvað fór úrskeiðis'}</h1>
      <p>
        <a href="/">Fara á forsíðu</a>
      </p>
    </main>
  )
}
