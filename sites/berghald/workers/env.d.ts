// Runtime secrets aren't in wrangler.jsonc, so `wrangler types` doesn't list them.
interface Env {
  /** DSN of the site's Worker project in Sentry (`wrangler secret put SENTRY_DSN`). Unset: off. */
  SENTRY_DSN?: string
  /** DSN of the site's Vefstjórn project in Sentry (`wrangler secret put SENTRY_ADMIN_DSN`). */
  SENTRY_ADMIN_DSN?: string
}
