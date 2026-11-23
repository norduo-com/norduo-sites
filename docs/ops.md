# Operating the live sites

Checked commands for looking at a deployed site. Run them from `sites/<name>` (wrangler reads its `wrangler.jsonc`). Names below are Berghald's; the PR preview uses `berghald-preview` and `berghald-preview-media`.

## Logs

- **Why a request failed, after the fact:** Cloudflare dashboard → Workers & Pages → `berghald` → Logs. Observability is on, so every `console.warn` is kept, e.g. `media upload refused { route, error, status }`.
- **Live, while someone reproduces it:** `npx wrangler tail berghald --format pretty`. The connection drops after a while ("Unable to reconnect"); restart it before each reproduction.

## R2

- **List objects:** wrangler has no list command. Dashboard → R2 → `berghald-media` → Objects (a folder like `tmp/` is gone when empty).
- **Fetch one object:** `npx wrangler r2 object get berghald-media/media/<id>.webp --remote --file out.webp`
- **Lifecycle rules:** `npx wrangler r2 bucket lifecycle list berghald-media`. `tmp-1d` deletes `tmp/` after 1 day on both buckets.

## Video upload setup

Videos are PUT from the browser straight to R2 with a presigned URL, so each bucket needs a CORS rule and each Worker an S3 token. Done once per bucket, in the dashboard (wrangler can't make the token).

1. **CORS rule:** Dashboard → R2 → `berghald-media` → Settings → CORS policy → add:

   ```json
   [
     {
       "AllowedOrigins": ["https://berghald.eythorkonrads.com", "https://berghald.is"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   On `berghald-preview-media`, use `"AllowedOrigins": ["*"]`: every PR has its own origin, and the presigned URL is what allows a PUT. Check with `npx wrangler r2 bucket cors list <bucket>`.

2. **S3 token:** Dashboard → R2 → Manage API tokens → Create API token: _Object Read & Write_, applied to that one bucket only. Then, from `sites/berghald`:

   ```sh
   npx wrangler secret put R2_ACCOUNT_ID          # the account ID shown on the R2 page
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   ```

   For the preview Worker, make a token for `berghald-preview-media` and add `--env preview` to each. The bucket name is `R2_BUCKET` in `wrangler.jsonc`.

Without these, adding a video fails with `501 noVideoUpload` (logged as `media upload refused`), and a PUT refused by CORS shows as `PUT network`.

## D1

- **Query:** `npx wrangler d1 execute berghald --remote --command "select id, width, height from media order by created_at desc limit 5"`
- **Migrations:** `pnpm --filter berghald db:migrate:remote`. Deploys run it too.

## Photos

- **Check a photo's EXIF:** download `/img/1920/<id>` and run `exiftool <file>`; it lists no GPS, Make or Model.
- **Widths:** `/img/<480|960|1440|1920>/<id>`; any other width is 404.
