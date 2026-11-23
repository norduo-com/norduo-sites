import { createCmsApi, createImageRoute, createVideoRoute } from '@norduo/cms/server'
import { Hono } from 'hono'
import { createRequestHandler, RouterContextProvider } from 'react-router'

import { cloudflare } from '../app/context'
import cms from '../cms.config'
import { backupToR2 } from './backup'
import { withPageCache } from './cache'

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

const app = new Hono<{ Bindings: Env }>()

app.route(
  '/api/cms',
  createCmsApi(cms, {
    // TODO: email Hjalti via the send_email binding once the address is verified.
    onEnquiry: () => undefined,
  }),
)

// Photos at the fixed widths, made from the master and cached at the edge.
app.route('/img', createImageRoute())

// Gallery videos as uploaded, with byte ranges for seeking.
app.route('/video', createVideoRoute())

// Public pages: rendered on request, cached at the edge until content changes.
app.all('*', (c) =>
  withPageCache(c.req.raw, c.env, c.executionCtx, (req) => {
    const context = new RouterContextProvider()
    context.set(cloudflare, { env: c.env, ctx: c.executionCtx })
    return requestHandler(req, context)
  }),
)

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(backupToR2(env))
  },
} satisfies ExportedHandler<Env>
