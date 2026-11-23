# Operating the live sites

Checked commands for looking at a deployed site. Run them from `sites/<name>` (wrangler reads its `wrangler.jsonc`). Names below are Berghald's; the PR preview uses `berghald-preview` and `berghald-preview-media`.

## Logs

- **Why a request failed, after the fact:** Cloudflare dashboard → Workers & Pages → `berghald` → Logs. Observability is on, so every `console.warn` is kept, e.g. `media upload refused { route, error, status }`.
- **Live, while someone reproduces it:** `npx wrangler tail berghald --format pretty`. The connection drops after a while ("Unable to reconnect"); restart it before each reproduction.

## R2

- **List objects:** wrangler has no list command. Dashboard → R2 → `berghald-media` → Objects (a folder like `tmp/` is gone when empty).
- **Fetch one object:** `npx wrangler r2 object get berghald-media/media/<id>.webp --remote --file out.webp`
- **Lifecycle rules:** `npx wrangler r2 bucket lifecycle list berghald-media`. `tmp-1d` deletes `tmp/` after 1 day on both buckets.

## D1

- **Query:** `npx wrangler d1 execute berghald --remote --command "select id, width, height from media order by created_at desc limit 5"`
- **Migrations:** `pnpm --filter berghald db:migrate:remote`. Deploys run it too.

## Photos

- **Check a photo's EXIF:** download `/img/1920/<id>` and run `exiftool <file>`; it lists no GPS, Make or Model.
- **Widths:** `/img/<480|960|1440|1920>/<id>`; any other width is 404.

## Behind Access

The PR previews (the whole Worker) and the live site's `/vefstjorn` and `/api/cms/admin` are behind Cloudflare Access. An agent gets through with a service token kept in `.env.access` at the repo root (git-ignored by `.env.*`). Without the file, ask the user to check the page.

```sh
set -a; . ./.env.access; set +a
access() { curl -s -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" "$@"; }
access https://pr-<n>-berghald-preview.kh-krimper.workers.dev/ | grep -oE '<title>[^<]*</title>'
access "https://pr-<n>-berghald-preview.kh-krimper.workers.dev/api/cms/admin/content/pages/home?locale=en"
```

A 302 to `cloudflareaccess.com` means the token isn't allowed on that Access app. The token can save content, like an editor: save only on a preview.

**Setup (once, by the user):** Zero Trust → Access → Service credentials → Service Tokens → create `agent-preview`. Then, on each Access app it should open (the preview app, and the live admin app only if wanted), add a policy with action **Service Auth** and the rule **Service Token = agent-preview**. Put the Client ID and Secret in `.env.access` as `CF_ACCESS_CLIENT_ID=` and `CF_ACCESS_CLIENT_SECRET=`. The Worker accepts the token's JWT as it is (`packages/cms/src/server/access.ts` needs no email).

## Sentry

- **Check the Worker reports errors:** open `/api/cms/admin/debug/error` while logged in through Access. It throws on purpose; the event shows up in Sentry tagged with the environment (`production` or `preview`).
- **Check Vefstjórn reports errors:** on any `/vefstjorn` screen, run `setTimeout(() => { throw new Error('Vefstjórn test') })` in the browser console. (An error thrown straight in the console isn't reported.)
- **Projects:** `berghald-server` (Worker) and `berghald-vefstjorn` (browser) in the `norduo-au` org, EU region, IP storage off.
- **DSNs:** `npx wrangler secret put SENTRY_DSN` (Worker project) and `SENTRY_ADMIN_DSN` (Vefstjórn project); add `--env preview` for the PR previews.
