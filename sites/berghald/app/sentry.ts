/**
 * Sentry settings shared by the Worker and Vefstjórn's browser bundle.
 * No personal data goes to Sentry: no IPs, cookies or user, no request bodies (form data),
 * no query strings and only a few harmless request headers (decided in issue #14).
 */

/** Headers kept on an event; everything else (cookies, the Access JWT, client IPs) is dropped. */
const KEPT_HEADERS = new Set(['accept', 'content-type', 'user-agent'])

interface ScrubbableEvent {
  request?: {
    data?: unknown
    cookies?: unknown
    headers?: Record<string, string>
    query_string?: unknown
    env?: unknown
  }
  user?: unknown
}

/** Strips personal data from an event before it is sent. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  delete event.user
  const request = event.request
  if (request) {
    delete request.data
    delete request.cookies
    delete request.query_string
    delete request.env
    if (request.headers)
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => KEPT_HEADERS.has(name.toLowerCase())),
      )
  }
  return event
}

/**
 * Options shared by both SDKs. No DSN turns Sentry off (local dev, e2e).
 * Sentry 11 replaced `sendDefaultPii` with `dataCollection`, whose defaults collect everything,
 * so each category is turned off here; `scrubEvent` is the backstop.
 */
export function sentryOptions(
  dsn: string | undefined,
  environment: string | undefined,
  /** The Worker version id, so an issue points at the deploy that caused it. */
  release: string | undefined,
) {
  return {
    dsn: dsn === '' ? undefined : dsn,
    enabled: Boolean(dsn),
    environment: environment ?? 'development',
    release,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { allow: [...KEPT_HEADERS] },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeSend: scrubEvent,
  }
}
