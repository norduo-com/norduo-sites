# Architecture & tech stack

Decided 17 Nov 2026 for the first site, Berghald.is. v1 = MVP: the public site is built as designed, and only the admin (Vefstjórn) is cut back.

## 1. Repo structure – one monorepo

The CMS (Vefstjórn) is a shared package so future client sites can reuse it. Each site lives in its own folder and deploys on its own, with its own data.

```
/
├─ packages/
│  ├─ cms/          # Vefstjórn: admin UI (React), Hono API routes, generic D1 schema (Drizzle)
│  ├─ ui/           # shared components, Tailwind preset, spacing tokens
│  └─ config/       # shared ESLint, TS configs
├─ sites/
│  └─ berghald/     # public site, cms.config.ts, block components, wrangler.jsonc
├─ .github/workflows/
├─ turbo.json
└─ pnpm-workspace.yaml
```

- To add a new site: create `sites/<name>`, reuse `packages/cms`, and give it its own Worker, D1 and R2.
- Sites never share data.

## 2. Multi-site CMS design

The CMS knows nothing about any site's pages or elements. Each site describes its content in a config, and Vefstjórn builds its screens from that config.

**Three layers**

1. **`packages/cms` (generic):**
   - admin shell, login, list and edit screens, Myndasafn (media library)
   - photo upload to R2, saving to D1, Hono routes
   - field types: text, rich text, toggle, image, gallery, select, multi-select, relation (one or many), slug, month range, year, URL, email, phone, group, repeater, blocks
   - rich text is stored as a small JSON tree (paragraphs, headings, lists; bold, italic, links and the site's own marks), not HTML, so the Worker never sanitizes markup; `richTextToHtml` escapes it on output
   - a `slug()` is made from its `from` field while a draft and locked on first publish; the server owns it and editors can't type it
2. **Site config (`sites/<name>/cms.config.ts`):** the site's
   - collections (e.g. Verkefni, Þjónusta)
   - singletons (e.g. settings)
   - page blocks (e.g. hero, services carousel, before/after, testimonials, quote form)
3. **Site components:** each site renders its own blocks. The CMS stores _what_ a block contains, and the site decides _how_ it looks.

**Pages = ordered lists of blocks.** A new site with different pages or elements defines its own blocks, and the CMS needs no changes.

**Storage:**

- A generic D1 schema shared by all sites: a `documents` table with `type`, `slug`, `locale`, `status` (draft/published), `data` (JSON) and timestamps, a `media` table and an `enquiries` table.
- Every site uses the same migrations.
- Zod schemas generated from the config validate data on save and give the frontend typed content.
- Trade-off: JSON is harder to query than real tables. That's fine at this scale (about 10 projects).

**Drafts:** every document has a draft/published status. Only published content is rendered publicly. A logged-in admin can preview drafts.

**Per-site admin branding:** the config also sets Vefstjórn's logo, colours, menu order and labels, so each client gets a branded admin from the same code.

## 3. Rendering & publishing

- The public site is **rendered by the Worker on request** (React Router framework mode, SSR) and **cached at the edge**.
- The cache key includes a content version in D1 (`site_meta.content_version`), which goes up on every save or delete in Vefstjórn, drafts included. Any change makes pages re-render on their next visit, in every data centre. No rebuild or purge list is needed.
- Watch out: the Workers free plan allows 10 ms CPU per request. Because of the cache, most visits never render, but if uncached renders go over that limit, the fix is Workers Paid at $5/month (30 s CPU).
- The Vefstjórn UI is served from the same Worker at `/vefstjorn`.

## 4. Hosting – Cloudflare, no paid server

| Part            | Where                                                                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public site     | Worker SSR + edge cache, refreshed on publish                                                                                                                                                                                                                                                          |
| Vefstjórn UI    | `berghald.is/vefstjorn`, same Worker                                                                                                                                                                                                                                                                   |
| API             | Same Worker, running **Hono** at `/api/cms`                                                                                                                                                                                                                                                            |
| Content         | **D1** (SQLite), accessed with **Drizzle ORM** + migrations                                                                                                                                                                                                                                            |
| Photos          | Master images (WebP, ≤ 2560 px, no metadata) in **R2**; originals are not kept (see `packages/cms/docs/adr/0001-master-image-only.md`). **Image Transformations** produce sizes and formats on request (WebP/AVIF), with a small fixed set of widths to stay under 5,000 unique transformations/month. |
| Translation     | **Workers AI** translation model, called from the Hono API                                                                                                                                                                                                                                             |
| Admin login     | **Cloudflare Access** in front of `/vefstjorn` and `/api/cms/admin`                                                                                                                                                                                                                                    |
| Quote form spam | **Cloudflare Turnstile**                                                                                                                                                                                                                                                                               |
| Quote form      | Saved to D1 (`enquiries`) **and** emailed to the client via Worker `send_email`. Resend free tier only if customer confirmation emails are needed.                                                                                                                                                     |
| Domain          | berghald.is via ISNIC, DNS on Cloudflare                                                                                                                                                                                                                                                               |

Expected cost: 0 kr on Cloudflare free tiers (100k Worker requests/day, D1 5 GB, R2 10 GB, 5,000 unique image transformations/month, a daily Workers AI allowance). The only fixed cost is the .is domain.

## 5. Images & uploads

- **Photo upload** (`packages/cms/src/admin/upload.ts`, `src/server/media.ts`), one file at a time, retried on a 503:
  - The browser decodes the photo, shrinks it to a master (≤ 2560 px) and re-encodes it as WebP q 0.9, or JPEG q 0.92 where it can't encode WebP; the Worker then converts that JPEG to WebP. The Worker refuses a master over 2560 px and strips any EXIF/XMP block (Safari writes one into canvas JPEGs) before storing it.
  - A HEIC the browser can't decode (≤ 20 MB) goes to `tmp/<id>` as it is; a second request makes its master (drawn onto a blank base, which drops EXIF) and deletes `tmp/<id>`. An R2 lifecycle rule deletes anything under `tmp/` after 1 day. Larger ones are refused.
  - The blurred preview (32 px WebP) and the master's width and height are stored in `media` at upload. `media_refs` (document, locale → photo) is rewritten on every save.
  - `/img/<480|960|1440|1920>/<id>` serves the widths from the master through the Images binding, AVIF ≤ 1200 px, else WebP or JPEG by `Accept`, cached with the Cache API. Other widths are 404.
- Larger files such as videos (up to 500 MB) are uploaded straight to R2 with a presigned URL.
- **Formats:** JPG, PNG, HEIC and WebP. Only the master image is kept (ADR 0001); web versions are generated from it.
- **Alt text:** optional, but can be added on any image. Editing it in Myndasafn updates it everywhere the image is used.
- **Myndasafn (media library):** all images in one place, with filters (by where they're used, unused, without alt text), search, upload, and "Velja úr myndasafni" (pick from library) in the project editor.
  - Images used by a service, team member or piece of equipment can't be deleted until they're replaced there.
  - Deleting an image used in projects removes it from those projects too, after a confirmation.

## 6. Languages

- **react-i18next**: Icelandic first, English via the translate button. Content translations are stored in D1, per locale.
- **Namespaces:**
  - `vefstjorn`: Vefstjórn's own generic strings, in `packages/cms/src/admin/locales/<lng>/vefstjorn.json`. Sites can't override them in v1.
  - `cms`: the site's content-model labels (collections, fields, blocks, choices, help), in `sites/<name>/locales/<lng>/cms.json`. `cms.config.ts` holds no labels; keys follow config paths (`collections.equipment.label`, `collections.equipment.fields.name.label` → site-wide `fields.name.label`).
  - `site`: the public site's fixed strings, in `sites/<name>/locales/<lng>/site.json`, `is` and `en`, written by hand.
  - The admin loads `vefstjorn` + `cms`, Icelandic only in v1.
- JSON is bundled statically and i18next starts synchronously, also on SSR. A missing key renders as the raw key and never crashes; a unit test fails `pnpm check` on a missing `is` label and on `site` key sets that differ between `is` and `en`.
- **Files vs D1:** text an editor would plausibly reword lives in D1 (page headers, block text, nav labels, settings). Microcopy tied to code lives in files (form labels and errors, buttons, aria labels, the language switch, the cookie banner, season and month names).
- **English content = machine draft, then edited:**
  - Each translatable field in Vefstjórn has a "Þýða á ensku" (translate to English) button. It calls Workers AI through the Hono API and fills in the English field.
  - A machine-translated field is flagged "Óyfirfarið" (not reviewed, `needs_review` in D1) until someone edits or approves it.
  - English fields that are still empty fall back to Icelandic on the public site.

## 7. Frontend stack

- **React + TypeScript**, built with **Vite**
- **React Router** (framework mode): routing and SSR on the Worker
- **Tailwind CSS**: spacing tokens from `docs/spacing-system.md`, in `packages/ui/src/tokens.css`
- **React Hook Form + Zod**: quote form and Vefstjórn forms. The Zod schemas are shared with the API.
- **TanStack Query**: Vefstjórn data fetching, using Hono's typed RPC client
- **3D hero: React Three Fiber (+ drei)**
  - The existing three.js animation is ported into R3F components.
  - Pipeline: Blender → glTF with Draco/Meshopt compression.
  - Lazy-loaded and client-only, so it's never rendered on the server.
  - A still image is shown on slow phones and with `prefers-reduced-motion`.
- **Motion**: scroll and UI animations
- **Lenis**: smooth scrolling, only if needed

## 8. Environments, secrets & backups

- **Environments:** local development (`wrangler`/Vite dev with local D1/R2), PR previews and production. No staging.
- **PR previews:** every PR from this repo uploads a version of a separate `berghald-preview` Worker (wrangler env `preview`) with its own D1 (`berghald-preview`) and R2 (`berghald-preview-media`), so a PR never touches live content. It is served only at `pr-<n>-berghald-preview.<subdomain>.workers.dev`, behind Cloudflare Access (the whole preview, not just the admin), and linked from the PR as the `preview` deployment. The preview D1 starts empty and is migrated on each upload. Fork PRs get no preview.
- **Secrets:** GitHub Actions secrets for CI/deploy (Cloudflare API token and account ID, in the `production` environment), and `wrangler secret` for runtime secrets (Sentry DSN, Turnstile secret, etc.). Nothing secret is committed; this is a public repo.
- **Backups:**
  - D1 Time Travel gives 30 days of point-in-time restore.
  - A nightly Cron Trigger also exports D1 to R2 (`backups/YYYY-MM-DD.json`).

## 9. Quality & tooling

- **pnpm workspaces + Turborepo**
- **Wrangler**: local dev and deploys
- **ESLint + Prettier**:
  - typescript-eslint strict type-checked
  - React Hooks rules
  - jsx-a11y
  - import sorting
  - prettier-plugin-tailwindcss
- **Husky + lint-staged**: lint and format on commit
- **Tests**:
  - **Playwright** for end-to-end tests
  - **Vitest** (+ Testing Library) for unit and component tests

## 10. CI – GitHub Actions

- Turborepo's `--affected` means only the changed parts get linted, tested and built.
- Changes to `*.md` files only run the Prettier check: lint, typecheck, test, build, e2e, preview and deploy are skipped.
- The pnpm store, the Turborepo cache and Playwright's Chromium and WebKit are cached between runs. `.dev.vars` is a build input, so the e2e build (which bundles it) never shares a cache entry with a deploy build.
- A change in `sites/berghald` runs only Berghald's tests.
- A change in `packages/cms` (or `ui`/`config`) runs the CMS tests and the tests of every site that depends on it.
- Deploys go per site via Wrangler on push to `main` (`turbo run deploy --affected`).

## 11. Monitoring & analytics

- **Sentry (free tier)**, with the focus on Vefstjórn:
  - React SDK in the admin UI
  - Cloudflare SDK in the Hono API, to catch failed saves and uploads
- **Uptime check** on berghald.is
- **Google Analytics**, since ads may run later:
  - Wired through the cookie bar with **Google Consent Mode v2**, which is required for ads in the EU/EEA
  - Nothing fires before consent
- **SEO**: sitemap.xml, meta/OG tags per page, Icelandic `lang` + hreflang for English

## 12. v1 admin scope (Berghald)

- **In:**
  - Yfirlit, Verkefni, Myndasafn, Þjónusta, Teymi, Tæki, Síður og textar, Stillingar
  - Drafts
  - "Þýða á ensku" machine-translation drafts
  - Enquiries saved to D1, with no inbox screen yet
- **Out:** GA on Yfirlit, SEO overview/score, tutorial videos, users screen/invites, Google/Apple login, admin language switch, reviews editing, enquiries inbox.

## 13. Known gaps in the scaffold

- Closed: the admin API verifies the Cloudflare Access JWT (`cf-access-jwt-assertion`): RS256 signature against the team's certs, AUD tag, issuer and expiry (`packages/cms/src/server/access.ts`). The team domain and AUD are `vars` in `wrangler.jsonc`. In production a missing setting fails closed (401).
- Closed: `wrangler.jsonc` has the real D1 id, `workers_dev` and preview URLs are off, and the Worker is served only on its custom domain, behind Access for `/vefstjorn` and `/api/cms/admin`.
- `ENVIRONMENT=development` in `.dev.vars` turns the Access check and the page cache off. `vite build` copies `.dev.vars` into the build, so never deploy from a working copy that has one; CI deploys from a clean checkout.
- The Vefstjórn UI has a generic split list/editor for collections and a form for singletons. Every field type has an input except gallery, repeater and blocks. The other screens and field editors from the prototype (Berghald.is — prufuvefur) still need porting.
