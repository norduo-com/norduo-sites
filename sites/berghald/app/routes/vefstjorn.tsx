import { Vefstjorn } from '@norduo/cms/admin'
import type * as SentryReact from '@sentry/react'
import { useEffect } from 'react'
import { useRouteLoaderData } from 'react-router'

import cms from '../../cms.config'
import { ErrorPage } from '../components/ErrorPage'
import { cloudflare } from '../context'
import { sentryOptions } from '../sentry'
import type { Route } from './+types/vefstjorn'

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Vefstjórn Berghalds' }, { name: 'robots', content: 'noindex' }]
}

/** The DSN is public by design (it only lets a client send events), so the browser gets it. */
export function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare)
  return {
    sentry: {
      dsn: env.SENTRY_ADMIN_DSN ?? '',
      environment: env.SENTRY_ENVIRONMENT,
      release: env.CF_VERSION_METADATA.id,
    },
  }
}

// Moving between Vefstjórn screens needn't refetch the Sentry settings.
export const shouldRevalidate = () => false

type SentrySettings = ReturnType<typeof loader>['sentry']

let sentry: Promise<typeof SentryReact | null> | undefined

/** Sentry for Vefstjórn only, loaded after hydration so the public site never ships it. */
function startSentry({ dsn, environment, release }: SentrySettings) {
  sentry ??= dsn
    ? import('@sentry/react').then((Sentry) => {
        Sentry.init(sentryOptions(dsn, environment, release))
        return Sentry
      })
    : Promise.resolve(null)
  return sentry
}

export default function Admin({ params, loaderData }: Route.ComponentProps) {
  const settings = loaderData.sentry
  useEffect(() => void startSentry(settings), [settings])
  return <Vefstjorn config={cms} path={params['*']} />
}

// A render error in Vefstjórn is caught here, so it never reaches window.onerror.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const settings = useRouteLoaderData<typeof loader>('routes/vefstjorn')?.sentry
  useEffect(() => {
    if (settings) void startSentry(settings).then((Sentry) => Sentry?.captureException(error))
  }, [settings, error])
  return <ErrorPage error={error} />
}
