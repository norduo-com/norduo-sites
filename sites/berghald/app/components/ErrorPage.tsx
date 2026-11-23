import { useTranslation } from 'react-i18next'
import { isRouteErrorResponse } from 'react-router'

/** What a route's ErrorBoundary shows: "not found" or a generic error. */
export function ErrorPage({ error }: { error: unknown }) {
  const { t } = useTranslation('site')
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return (
    <main className="p-g">
      <h1 className="text-3xl">{notFound ? t('errors.notFound') : t('errors.generic')}</h1>
      <p>
        <a href="/">{t('errors.home')}</a>
      </p>
    </main>
  )
}
