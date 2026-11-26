# Operating the live sites

Checked commands for looking at a deployed site. Run them from `sites/<name>` (wrangler reads its `wrangler.jsonc`). Names below are Berghald's; the PR preview uses `berghald-preview` and `berghald-preview-media`.

## Secrets

The PR preview Worker only ever gets version uploads, never a deploy, so its secrets go on a version; new versions inherit them. `secret put` there fails with "latest version isn't deployed".

| Worker     | Command                                                 |
| ---------- | ------------------------------------------------------- |
| production | `npx wrangler secret put <NAME>`                        |
| preview    | `npx wrangler versions secret put <NAME> --env preview` |

Without `--env preview`, wrangler warns about multiple environments and saves nothing. Check with `npx wrangler secret list` (production) or `npx wrangler versions view <id> --env preview`, with the id from `npx wrangler versions list --env preview`; `versions view` sometimes hangs, so run it in the background.

## PR preview

- **URL of a PR's preview**, from its branch (quote the URL: zsh treats `?` as a glob):
  `gh api "repos/norduo-com/norduo-sites/deployments?ref=<branch>" --jq '.[0].statuses_url' | xargs gh api --jq '.[0].environment_url'`

## Logs

- **Why a request failed, after the fact:** Cloudflare dashboard → Workers & Pages → `berghald` → Logs. Observability is on, so every `console.warn` is kept, e.g. `media upload refused { route, error, status }`.
- **Live, while someone reproduces it:** `npx wrangler tail berghald --format pretty`. The connection drops after a while ("Unable to reconnect"); restart it before each reproduction.

## R2

- **List objects:** wrangler has no list command. Dashboard → R2 → `berghald-media` → Objects (a folder like `tmp/` is gone when empty).
- **Fetch one object:** `npx wrangler r2 object get berghald-media/media/<id>.webp --remote --file out.webp`
- **Lifecycle rules:** `npx wrangler r2 bucket lifecycle list berghald-media`. `tmp-1d` deletes `tmp/` after 1 day on both buckets.

## Video upload setup

Videos are PUT from the browser straight to R2 with a presigned URL, so each bucket needs a CORS rule and each Worker an S3 token for its bucket. Done once per site.

1. **CORS rule** (an agent can do this): write `cors.json` in wrangler's format, then `npx wrangler r2 bucket cors set berghald-media --file cors.json` and check with `npx wrangler r2 bucket cors list berghald-media`.

   ```json
   {
     "rules": [
       {
         "allowed": {
           "origins": ["https://berghald.eythorkonrads.com", "https://berghald.is"],
           "methods": ["PUT"],
           "headers": ["content-type"]
         },
         "maxAgeSeconds": 3600
       }
     ]
   }
   ```

   On `berghald-preview-media`, use `"origins": ["*"]`: every PR has its own origin, and the presigned URL is what allows a PUT.

2. **S3 token** (the user, in the dashboard: wrangler can't make it, and the secret shows once): R2 → API → Manage API tokens → Create Account API token: _Object Read & Write_, applied to that one bucket only. Then set `R2_ACCOUNT_ID` (the account ID on the R2 page), `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` with the commands in [Secrets](#secrets). The preview Worker gets its own token for `berghald-preview-media`. The bucket name is `R2_BUCKET` in `wrangler.jsonc`.

Without these, adding a video fails with `501 noVideoUpload` (logged as `media upload refused`), and a PUT refused by CORS shows as `PUT network`.

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
- **DSNs:** `SENTRY_DSN` (Worker project) and `SENTRY_ADMIN_DSN` (Vefstjórn project), set with the commands in [Secrets](#secrets).
- **Read issues and events** (agents: the `sentry` CLI, signed in once by the user). `statsPeriod` takes only `24h` or `14d`:

  ```sh
  sentry api "projects/norduo-au/berghald-server/issues/?query=is:unresolved%20environment:production&statsPeriod=24h"
  sentry api "organizations/norduo-au/issues/<id>/events/?full=true"   # privacy check: user, request headers/data/query/cookies
  sentry api -X PUT "organizations/norduo-au/issues/<id>/" -F status=resolved
  ```

- **Live admin without the Access token:** the agent token opens only the PR preview. Drive the user's own browser session with Claude in Chrome, or ask the user.
