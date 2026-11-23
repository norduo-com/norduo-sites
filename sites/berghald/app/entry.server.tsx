// React Router's default web entry, plus `handleError` so loader and render errors reach
// Sentry. React Router catches them to show the ErrorBoundary, so the Worker never sees a throw.
import * as Sentry from '@sentry/cloudflare'
import { isbot } from 'isbot'
import { renderToReadableStream } from 'react-dom/server'
import type { EntryContext, HandleErrorFunction, RouterContextProvider } from 'react-router'
import { ServerRouter } from 'react-router'

export const streamTimeout = 5_000

export const handleError: HandleErrorFunction = (error, { request }) => {
  // An aborted request (the visitor left) isn't a bug.
  if (request.signal.aborted) return
  Sentry.captureException(error)
  console.error(error)
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === 'HEAD') {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders })
  }

  let shellRendered = false
  const userAgent = request.headers.get('user-agent')

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: AbortSignal.timeout(streamTimeout + 1000),
      onError(error: unknown) {
        responseStatusCode = 500
        // Errors in the shell reject and go through handleError; later ones only come here.
        if (shellRendered) {
          Sentry.captureException(error)
          console.error(error)
        }
      },
    },
  )
  shellRendered = true

  // Bots wait for all content, so they get the full page.
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady
  }

  responseHeaders.set('Content-Type', 'text/html')
  return new Response(body, { headers: responseHeaders, status: responseStatusCode })
}
