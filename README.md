# norduo-sites

Monorepo for Norduo client sites and **Vefstjórn**, the shared CMS.

```
packages/
  cms/      Vefstjórn: field types, defineCms, Hono API, D1 schema + migrations, admin UI
  ui/       Shared Tailwind tokens (spacing, radius)
  config/   Shared ESLint + TypeScript config
sites/
  berghald/ berghald.is – React Router on a Cloudflare Worker
```

Each site has its own `cms.config.ts` (collections, singletons and page blocks). Vefstjórn builds its screens from that config, so a new site with different pages needs no CMS changes. Each site deploys separately with its own Worker, D1 database and R2 bucket.

Full architecture: [`docs/architecture.md`](docs/architecture.md). Agent instructions: [`CLAUDE.md`](CLAUDE.md).

## Getting started

```sh
corepack enable          # gives you the pnpm version pinned in package.json
pnpm install
git init && git add -A && git commit -m "Initial scaffold"   # enables the pre-commit hook

cp sites/berghald/.dev.vars.example sites/berghald/.dev.vars
pnpm --filter berghald db:migrate:local
pnpm --filter berghald dev
```

- Site: http://localhost:5173
- Vefstjórn: http://localhost:5173/vefstjorn
- API: http://localhost:5173/api/cms/health

## Scripts (root)

| Command         | What it does                              |
| --------------- | ----------------------------------------- |
| `pnpm dev`      | Dev servers for all sites                 |
| `pnpm check`    | Lint, typecheck and unit tests everywhere |
| `pnpm test:e2e` | Playwright end-to-end tests               |
| `pnpm format`   | Prettier (with Tailwind class sorting)    |

Add `--filter berghald` (or `--filter @norduo/cms`) to run something for one package only.

## Changing the database schema

Edit `packages/cms/src/db/schema.ts`, then:

```sh
pnpm --filter @norduo/cms db:generate
pnpm --filter berghald db:migrate:local
```

Migrations are shared by every site and applied automatically on deploy.

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) uses Turborepo's `--affected`. It lints, typechecks, tests and builds only what changed, plus everything that depends on it. A change in `packages/cms`, for example, also tests and deploys `sites/berghald`. Pushes to `main` deploy the affected sites.

Repository secrets (in a `production` environment):

- `CLOUDFLARE_API_TOKEN`: needs Workers, D1 and R2 edit permissions
- `CLOUDFLARE_ACCOUNT_ID`

## First deploy of Berghald

```sh
cd sites/berghald
npx wrangler login
npx wrangler d1 create berghald        # paste the database_id into wrangler.jsonc
npx wrangler r2 bucket create berghald-media
```

Then put Cloudflare Access in front of `berghald.is/vefstjorn*` and `berghald.is/api/cms/admin*`.

Sentry: create a Worker project and a Vefstjórn (React) project, then `npx wrangler secret put SENTRY_DSN` with the Worker DSN and `SENTRY_ADMIN_DSN` with the Vefstjórn DSN (and both again with `--env preview`). In the project's settings, turn on "Prevent Storing of IP Addresses". Without the secret, Sentry stays off.

## Adding a new site

1. Copy `sites/berghald` to `sites/<name>` and change `name` in `package.json` and `wrangler.jsonc`.
2. Write the site's `cms.config.ts` and its block components.
3. Create its D1 database and R2 bucket, as described above.

## Not set up yet

These are in the architecture doc and get added with the features that use them: TanStack Query, React Hook Form, react-i18next, React Three Fiber, Motion, Lenis, Turnstile, Google Analytics, image transformations and the "Þýða á ensku" translation.
