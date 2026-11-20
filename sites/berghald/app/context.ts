import type { ExecutionContext } from 'hono'
import { createContext } from 'react-router'

/** The Worker's bindings, set per request in `workers/app.ts` for loaders to read. */
export const cloudflare = createContext<{ env: Env; ctx: ExecutionContext }>()
