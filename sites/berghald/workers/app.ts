import { createCmsApi } from '@norduo/cms/server'
import { Hono } from 'hono'
import { createRequestHandler } from 'react-router'

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

// Public pages: rendered on request, cached at the edge until content changes.
app.all('*', (c) => withPageCache(c.req.raw, c.env, c.executionCtx, (req) => requestHandler(req)))

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(backupToR2(env))
  },
} satisfies ExportedHandler<Env>
