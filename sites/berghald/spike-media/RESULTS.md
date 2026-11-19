# Media upload path: spike results

Measured 2026-11-19 on a throwaway Worker `berghald-spike-media` (workers.dev) with a throwaway R2 bucket, both deleted afterwards. Workers Free. CPU from `wrangler tail`.

Test photos are synthetic, made with `gen-heic.swift` (CoreGraphics → HEIC, Display P3, iPhone-style EXIF with make/model and GPS, orientation 6):
- `photo.heic`: 4032×3024, 5.5 MB (iPhone-sized)
- `big.heic`: 6048×4536, 31 MB (over the binding's 20 MB input limit)

## What works

- **HEIC end to end:** upload via the Worker to R2, then `IMAGES.info()` → `{format: image/heic, width: 3024, height: 4032}`. EXIF orientation is applied (the portrait shot comes out portrait). Display P3 is converted to sRGB.
- **`/img/<w>/<key>`** (binding + Cache API, widths 480/960/1440/1920 whitelisted, other widths 400): correct sizes; AVIF for ≤ 1200 px when `Accept` allows it, else WebP, else JPEG. `Cache-Control: public, max-age=31536000, immutable`, `Vary: Accept`. Cache API worked on workers.dev: second request `cf-cache-status: HIT`, ~70 ms, 0 ms CPU.
- **LQIP:** `width 32, blur 2, WebP q40` = 326 bytes, ~450 chars as a data URI.

Output sizes (synthetic noisy image, so larger than a real photo would be):

| Width | AVIF | WebP | JPEG |
|---|---|---|---|
| 480 | 4.7 KB | 4.0 KB | 7.9 KB |
| 960 | 20 KB | 13 KB | 59 KB |
| 1440 | (WebP) | 88 KB | 200 KB |
| 1920 | (WebP) | 416 KB | 470 KB |

## Problem 1: binding CPU scales with input size

The Images binding streams its input through the Worker, and Worker CPU grows with the input bytes.

| Call (n) | Input | CPU p50 | p90 | max |
|---|---|---|---|---|
| Drain R2 object to ArrayBuffer only (8) | 5.5 MB HEIC | 4 ms | 6 | 6 |
| `info()` only (8) | 5.5 MB HEIC | 40 ms | 95 | 99 |
| LQIP transform only (8) | 5.5 MB HEIC | 36 ms | 53 | 109 |
| Upload: R2 put + `info()` + LQIP (23) | 5.5 MB HEIC | 96 ms | 137 | 144 |
| `/img/<w>` cache miss (12) | 5.5 MB HEIC | ~58 ms | 70 | 104 |
| `info()` (9) | 416 KB WebP master | 6 ms | 9 | 9 |
| LQIP (11) | 416 KB WebP master | 8 ms | 10 | 11 |
| `/img/<w>` cache miss (5) | 416 KB WebP master | 8 ms | 19 | 19 |
| LQIP (24) | 4 KB WebP | 2 ms | 3 | 5 |
| Upload + binding (1) | 31 MB HEIC | 264 ms | | |

Single requests over 10 ms passed, but after ~40 heavy requests in a row the runtime started killing them: **5 of the last 7 LQIP calls on the 5.5 MB original returned 503 `exceededCpu`** at 19–24 ms. This matches the SSR spike: occasional overruns are tolerated, sustained ones are not. An editor uploading 20 photos in a row would hit this.

## Problem 2: the binding keeps EXIF, including GPS

Every binding output (AVIF, WebP, JPEG, all widths) still contained the original's EXIF: make/model **and the GPS IFD** (`0x8825`, latitude ref `N`). The binding has no `metadata` option. An untyped `metadata: "none"` in `transform()` or `output()` is silently ignored.

Workaround that works: draw the photo onto a fresh 1×1 PNG stretched to the target size (`input(png).transform({width, height, fit: "squeeze"}).draw(input(photo).transform({width}))`). The output has no EXIF and looks identical. Caveat: with a PNG base, the 1440 WebP came out 186 KB vs 81 KB, so use an opaque base (JPEG) or strip once when making the master, not per variant.

## Problem 3: originals over 20 MB

Both `info()` and `transform()` fail with `IMAGES_INFO_ERROR 9502` / `IMAGES_TRANSFORM_ERROR 9502: Images binding connection error`. It is not a clear "too large" error, and the attempt still costs ~260–390 ms CPU. Check the size before calling the binding and reject or route elsewhere.

## Not tested

- **Zone `cf.image` transforms** (bytes bypass the Worker, `metadata: "none"` documented): needs the Worker on a custom domain on the zone with transformations enabled. Adding a throwaway custom domain on eythorkonrads.com was not permitted in this session.
- **Presigned PUT of a large video and signed `Content-Length`:** needs an R2 S3 API token. Wrangler's OAuth token can't create one. Checklist below.

## Verdict

**Make derivatives once at upload, from a small, clean master. Never run the binding on the original per request.**

1. **Browser first (Vefstjórn):** resize to a ≤ 2560 px master and re-encode it (WebP/JPEG, q≈0.85) in the browser before upload. `createImageBitmap` applies orientation and the canvas drops EXIF/GPS. This works for JPEG/PNG/WebP everywhere and for HEIC in Safari. iOS Safari's file picker already hands HEIC over as JPEG when `accept` doesn't list HEIC.
2. **Fallback for a HEIC that the browser can't decode** (Chrome/Firefox on desktop) and is ≤ 20 MB: upload the original. The Worker makes the master once with the draw-onto-blank trick (strips EXIF), stores it, then makes the LQIP from the master. That is one ~40–100 ms request per photo. The admin uploads one file at a time and retries on 503. Over 20 MB with no browser decode: reject with an Icelandic message.
3. **`/img/<w>/<key>` reads the master, never the original:** cache miss ≈ 8–19 ms, cached afterwards. Keep the width whitelist and the Cache API.
4. **Originals:** don't serve them. Whether to keep them in R2 at all (10 GB limit, GPS) is an open decision; this spike suggests keeping only the master.
5. `cf.image` on the zone stays a possible later optimisation, not the plan.

## Presigned PUT: human checklist

1. Cloudflare dashboard → R2 → Manage R2 API tokens → Create **Account API token**: "spike media presign", permission **Object Read & Write**, scope **only bucket `berghald-spike-media`**, TTL 1 day.
2. Recreate the bucket: `npx wrangler r2 bucket create berghald-spike-media` (run in `sites/berghald/spike-media`).
3. `npx wrangler secret put R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `ACCOUNT_ID`, then `npx wrangler deploy`.
4. Test: `POST /sign?key=v.mp4&type=video/mp4&size=<n>` → `curl -X PUT -H 'content-type: video/mp4' --data-binary @v.mp4 '<url>'` with a 150 MB `mkfile`, then with a body larger and smaller than the signed size. Check `GET /head/v.mp4`.
5. Delete the token, Worker and bucket.
