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

## Sentry

- **Check the Worker reports errors:** open `/api/cms/admin/debug/error` while logged in through Access. It throws on purpose; the event shows up in Sentry tagged with the environment (`production` or `preview`).
- **Check Vefstjórn reports errors:** on any `/vefstjorn` screen, run `setTimeout(() => { throw new Error('Vefstjórn test') })` in the browser console. (An error thrown straight in the console isn't reported.)
- **DSN:** `npx wrangler secret put SENTRY_DSN` (add `--env preview` for the PR previews).
