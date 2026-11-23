# norduo-sites

Monorepo for Norduo client websites and **Vefstjórn**, the shared CMS. The first site is **Berghald** (berghald.is), an Icelandic landscaping company: gardens, paving, stone walls and a crane truck. The site is in Icelandic first, with English second.

Read `docs/architecture.md` before making structural decisions. It records what has already been decided and why.

## Layout

- `packages/cms`: Vefstjórn
  - field types and `defineCms` (`src/fields.ts`, `src/define.ts`)
  - Hono API (`src/server`)
  - Drizzle D1 schema and shared migrations (`src/db`, `migrations/`)
  - admin UI (`src/admin`)
- `packages/ui`: shared Tailwind tokens (`src/tokens.css`)
- `packages/config`: shared ESLint and TypeScript config
- `sites/berghald`: React Router (framework mode, SSR) on a Cloudflare Worker
  - `cms.config.ts`: the site's content model
  - `workers/`: the Worker entry, edge page cache and nightly backup
  - `app/`: routes and components

## Rules

- **The CMS is generic.** `packages/cms` must never know about a specific site's pages, fields or wording. Site-specific things go in `sites/<name>/cms.config.ts` or the site's own components.
- **Sites never share data.** Each site has its own Worker, D1 database and R2 bucket.
- **Everything runs on Cloudflare's free tier, with no paid server.** Mind the 10 ms CPU limit per request on Workers Free.
- **Wording is Icelandic.** Use Icelandic for all user-facing text in the site and the admin. Code, comments and commit messages are in English.
- **This is a public repo.** Never commit secrets, `.dev.vars`, client photos or personal data. Content lives in D1 and R2.
- Spacing and radius come from the tokens in `docs/spacing-system.md`; `pnpm lint` flags arbitrary values in sites.

## Commands

```sh
pnpm check                              # lint + typecheck + unit tests, all packages
pnpm --filter berghald dev              # site at :5173, admin at /vefstjorn
pnpm test:e2e --filter berghald         # Playwright (turbo builds first)
pnpm --filter berghald db:migrate:local
pnpm --filter berghald db:migrate:preview # the PR-preview D1 (CI also runs it)
pnpm --filter @norduo/cms db:generate   # after editing src/db/schema.ts
```

Run `pnpm check` before calling work done. Logs, R2 and D1 on the live site: `docs/ops.md`. CI runs lint, typecheck, test and build only for affected packages (Turborepo `--affected`).

## Stack

TypeScript 6 (pinned: typescript-eslint doesn't support 7 yet), React 19, React Router 8, Vite 8, Tailwind 4, Hono, Zod 4, Drizzle (D1), react-i18next, Vitest (with Miniflare for D1 tests), Playwright, Sentry 11 (`@sentry/cloudflare` on the Worker, `@sentry/react` in Vefstjórn only; settings in `sites/<name>/app/sentry.ts`), ESLint 9 (strict type-checked) and Prettier.

These are planned but not installed yet; add each with the feature that needs it: TanStack Query, React Hook Form, React Three Fiber, Motion, Lenis, Turnstile.

## Labels

- Don't add user-facing text inline in components or `cms.config.ts` (older inline strings move to files as their screens are rebuilt). Strings come from react-i18next namespaces: `vefstjorn` (`packages/cms/src/admin/locales`), `cms` and `site` (`sites/<name>/locales`).
- `cms` keys follow config paths, e.g. `collections.equipment.label`, then site-wide `fields.<f>.label`. `pnpm check` fails on a missing `is` label or on `site` keys that differ between `is` and `en`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `norduo-com/norduo-sites`, via the `gh` CLI. The repo is public: tickets hold build decisions only, never client data. See `docs/agents/issue-tracker.md`, also before opening a PR.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: `GLOSSARY-MAP.md` points to `packages/cms/GLOSSARY.md` and `sites/berghald/GLOSSARY.md`. Written in English, with Icelandic UI labels noted per term. See `docs/agents/domain.md`.
