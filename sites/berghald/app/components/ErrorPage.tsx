import { pagePath } from '@norduo/cms'
import { useTranslation } from 'react-i18next'
import { isRouteErrorResponse } from 'react-router'

import { useLocale } from '~/locale'

import cms from '../../cms.config'

/** What a route's ErrorBoundary shows: "not found" or a generic error, in the path's locale. */
export function ErrorPage({ error }: { error: unknown }) {
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
