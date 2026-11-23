// Runtime secrets aren't in wrangler.jsonc, so `wrangler types` doesn't list them.
interface Env {
  /** Sentry DSN, set with `wrangler secret put SENTRY_DSN`. Unset turns Sentry off. */
  SENTRY_DSN?: string
}
