# Media pipeline limits on the free plan

Research for issue #4. Sources are Cloudflare's own docs, read on 2026-11-17. Each claim links to the page it comes from. Anything marked **(inference)** or **(unverified)** is not stated in the docs and should be checked in a prototype.

Context: photo originals live in R2 and are served through Image Transformations. Videos up to 500 MB go straight to R2 through a presigned URL (see `docs/architecture.md` §4–5). The site has three breakpoints (1440 / 768 / 390 px). It launches with about 30 photos and may grow to 10–20 projects with galleries.

## TL;DR

| Question | Answer |
|---|---|
| HEIC input? | **Yes.** HEIC is a supported input format for remote images, including images in R2. It can be output as AVIF, WebP, JPEG or PNG. There is no need to convert it on upload. |
| What counts as a "unique transformation"? | One source image plus one set of parameters, counted once per **calendar month**. **`format` and `quality` are not counted**, so AVIF and WebP output of the same width is one transformation. Width, height, fit, blur and so on are counted. |
| Width set | `480, 960, 1440, 1920`, always with the same `fit`/`metadata` parameters and `format` negotiated from `Accept`. That is at most 4 per photo per month. |
| Monthly count | About 120 at launch (30 photos). About 1,300 at 330 photos. That stays well under 5,000. |
| Large video uploads | Use a presigned `PUT` to `<ACCOUNT_ID>.r2.cloudflarestorage.com`, signed with `aws4fetch` in the Worker. Sign `Content-Type`. Set a bucket CORS rule for `PUT`. Check size and type again after the upload with `head()`. A single PUT allows up to 5 GiB. |
| LQIP | At upload, use the **Images binding**: `width: 24–32`, `blur`, WebP at low quality. Store it as a base64 data URI in D1, which is a few hundred bytes. It costs one transformation per photo, once. Cloudflare's image service does the work, so it adds almost no Worker CPU. |
| Watch out for | R2's free tier is **10 GB**, so 500 MB videos fill it quickly. AVIF output is limited to 1,200 px. Originals keep EXIF and GPS data. A public `/cdn-cgi/image/` URL lets anyone use up the quota by requesting arbitrary widths. |

## 1. HEIC

- The list of input formats for both remote and hosted images is "PNG, JPEG, GIF, WebP, SVG, AVIF\*, HEIC". The asterisk on AVIF means AVIF *input* is Enterprise-only. HEIC has no asterisk. ([Limits and formats](https://developers.cloudflare.com/images/get-started/limits/#input-formats))
- A "remote image" is "an image that is stored outside of Images storage, including images in R2". ([Key concepts](https://developers.cloudflare.com/images/get-started/key-concepts/))
- The changelog from 2025-07-08 says: "You can use Images to ingest HEIC images and serve them in supported output formats like AVIF, WebP, JPEG, and PNG." It adds that the usual size and dimension limits still apply. ([Changelog: HEIC support](https://developers.cloudflare.com/changelog/post/heic-support/))
- Limits for remote images: 100 MB file size, 100 MP area, and 12,000 px on any side. ([Limits](https://developers.cloudflare.com/images/get-started/limits/#remote-images)) An iPhone HEIC photo (12–48 MP, usually under 10 MB) is well within these limits.

**Recommendation:** keep the HEIC original as decided. Image Transformations serve WebP/AVIF/JPEG from it. No conversion on upload, no WASM decoder and no browser-side conversion are needed.

Two side effects:

- **Admin previews must also go through a transformation.** Most browsers other than Safari can't display HEIC, so the original can't be used as the preview. Use the same `480` width the public site uses, so it adds nothing to the count.
- **Never fall back to the original.** `onerror=redirect` and fallbacks in the style of `Response.redirect(original)` ([Transform via fetch: error handling](https://developers.cloudflare.com/images/optimization/transformations/transform-via-workers/#error-handling)) would send a HEIC file, or a 20 MB JPEG, to the browser. If a transformation fails, show the LQIP or a placeholder instead.

If a pre-converted file is ever needed, for example a downloadable JPEG, the Images binding can convert it in the Worker with `env.IMAGES.input(stream).output({ format: "image/jpeg" })`. Input is limited to 20 MB. This costs one transformation, and the image service does the decoding, not the isolate. ([Images binding](https://developers.cloudflare.com/images/optimization/binding/))

## 2. How Image Transformations are counted on Free

All quotes are from [Images pricing](https://developers.cloudflare.com/images/pricing/):

- "On the Free plan, you can request up to 5,000 unique transformations each month for free." Transforming images stored outside of Images, such as R2, is available on the Free plan.
- "Each combination of a source image and optimization parameters counts as a unique transformation." For example, `thumbnail.jpg` at 100×100 and at 200×200 counts as 2.
- "Cloudflare counts the number of unique transformations requested in each calendar month." Repeat requests in the same month count once, "regardless of how many times the transformed image is served."
- "**Cloudflare excludes `format` and `quality`** when determining whether a transformation is unique." For example, `width=100,format=auto` is one transformation, whether it is served as AVIF or WebP.
- The first request in each month is billed "regardless of cache status" ([Transformations overview](https://developers.cloudflare.com/images/optimization/transformations/overview/)). The count **resets every month**, so the steady state is *(photos actually viewed) × (widths actually requested)* each month. It is not a one-time cost.
- Calls to the Images binding are billed the same way. `.info()` calls are free. ([Images binding: billing](https://developers.cloudflare.com/images/optimization/binding/))
- Over the limit: "Existing transformations in cache will continue to be served", new ones return error **9422**, and "You will not be charged" on Free.

### What adds to the count (inference from the rules above)

- Every distinct value of `width`, `height`, `fit`, `gravity`, `blur`, `dpr` and so on. Do crops such as square cards and 4:3 tiles with CSS `object-fit` over the same URL. Don't make a second `height`/`fit` variant.
- `width=auto` picks a width per device from client hints or the user agent ([Make responsive images](https://developers.cloudflare.com/images/optimization/make-responsive-images/#use-widthauto)), so the number of widths isn't bounded. **Don't use it.**
- **Unstable source URLs.** Assume each distinct source URL is a separate "source image", including cache-busting query strings. Use immutable, content-addressed R2 keys.
- **Abuse.** If the zone's URL interface (`/cdn-cgi/image/<params>/<src>`) is enabled, anyone can request `width=1,2,3,…` and use up the month's quota. Serve images through a Worker route that only accepts the whitelisted widths (§2.3).

### 2.1 Width set for the three breakpoints

Cloudflare recommends a maximum of 1,920 px for desktop, and `dpr` tops out at 2 ([Features](https://developers.cloudflare.com/images/optimization/features/)). AVIF output is limited to **1,200 px** ([Limits](https://developers.cloudflare.com/images/get-started/limits/#remote-images)), and AVIF falls back to WebP or JPEG when it would be too slow to encode. Wider images will therefore come out as WebP. That is fine, and it costs nothing extra because format isn't counted.

| Slot | 390 mobile (DPR 2–3) | 768 tablet (DPR 1–2) | 1440 desktop (DPR 1–2) |
|---|---|---|---|
| Full-bleed hero or gallery | 780–1170 → **960 / 1440** | 768–1536 → **960 / 1920** | 1440–2880 → **1440 / 1920** (cap) |
| Half-width or two-column | 780 → **960** | 384–768 → **480 / 960** | 720–1440 → **960 / 1440** |
| Card or thumbnail (≈⅓) | 780 → **960** | 256–512 → **480** | 460–920 → **480 / 960** |

**Suggested set: `480, 960, 1440, 1920`.** Use `srcset` with `w` descriptors and a `sizes` value for each component ([Make responsive images](https://developers.cloudflare.com/images/optimization/make-responsive-images/)). Use fixed parameters `fit=scale-down, metadata=none`. Negotiate format from `Accept`, because a Worker using `cf.image` has to do format negotiation itself ([Transform via fetch](https://developers.cloudflare.com/images/optimization/transformations/transform-via-workers/)). Set quality as needed, since it isn't counted either.

### 2.2 Monthly estimate (worst case: every photo requested at every width every month)

| Scenario | Photos | × widths | + LQIP (one-off, upload month) | Total / month | Share of 5,000 |
|---|---|---|---|---|---|
| Launch | 30 | 120 | 30 | **~150** | 3 % |
| 10 projects × 15 photos + site photos | ~180 | 720 | new uploads only | **~750** | 15 % |
| 20 projects × 15 photos + site photos | ~330 | 1,320 | new uploads only | **~1,350** | 27 % |

There is room for about 1,200 photos at 4 widths before the limit, so a fifth width or a second crop would still fit if needed.

### 2.3 Serving route (recommendation)

Add a Worker route such as `GET /img/<w>/<key>` that:

1. Rejects any `w` not in `{480, 960, 1440, 1920}`. This keeps the count bounded.
2. Calls `fetch(originUrl, { cf: { image: { width: w, fit: "scale-down", metadata: "none", format } } })`. `format` comes from `Accept` (avif → webp → default). `cf.image` works on any zone that hosts a Worker, and "each transformation is billed to the account that owns the Worker". ([Transform via fetch](https://developers.cloudflare.com/images/optimization/transformations/transform-via-workers/))
3. On error, returns the placeholder or LQIP. It never redirects to the original.

`originUrl` has to be fetchable over HTTP. The simplest way is a Worker path that streams the object from the `MEDIA` binding. If that path is handled by the same Worker, guard it against request loops with the `Via: image-resizing` check from the docs. Originals keep EXIF data, including GPS ([Features: metadata](https://developers.cloudflare.com/images/optimization/features/#metadata)). Keep the original path unlisted (random keys, never put in HTML), and strip metadata on every transformed output with `metadata: "none"`.

*Alternative:* `env.IMAGES.input(r2Object.body)` reads the original without any public URL. However, binding responses are **not cached automatically**: you have to enable Workers Cache and set `Cache-Control` yourself. Input is also limited to 20 MB. ([Images binding](https://developers.cloudflare.com/images/optimization/binding/)) Since photos can be up to 100 MB, the `cf.image` route is the better default.

## 3. Presigned R2 uploads for videos up to 500 MB

Facts ([Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)):

- A presigned URL allows one operation (`GET`/`PUT`/`HEAD`/`DELETE`) on one object, and expires after 1 s to 7 days. **`POST` form uploads are not supported**, so S3's `content-length-range` POST policy isn't available.
- "The R2 Workers API binding cannot generate presigned URLs." Sign them in the Worker with **`aws4fetch`**, which is built on `fetch` and `SubtleCrypto`. Use an R2 API token (Access Key ID and Secret) stored as Worker secrets.
- Presigned URLs only work on `<ACCOUNT_ID>.r2.cloudflarestorage.com`, **not on custom domains**.
- Restrict the content type by signing `Content-Type`: with aws4fetch, set `allHeaders: true`. A different `Content-Type` then fails with `403 SignatureDoesNotMatch`. ([aws4fetch example](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/))
- One `PUT` can be up to 5 GiB, and multipart uploads up to about 5 TiB ([R2 limits](https://developers.cloudflare.com/r2/platform/limits/)). A 500 MB file fits in one request, so multipart is optional. It is only worth adding for resumable uploads on bad connections. Incomplete multipart uploads expire after 7 days by default ([Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)).

CORS ([Configure CORS](https://developers.cloudflare.com/r2/buckets/cors/#use-cors-with-a-presigned-url)): browsers enforce CORS on presigned URLs, so an upload fails without a bucket policy. A suitable policy:

```json
[
  {
    "AllowedOrigins": ["https://berghald.is", "http://localhost:5173"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Apply it with `wrangler r2 bucket cors set berghald-media --file cors.json`. Origins have no path, ports can't be wildcarded (list each localhost port), and changes can take up to 30 s to apply. An **expired** presigned URL returns 403 *without* CORS headers, so the browser can't read the error. Issue the URL just before the upload, and have the client ask for a new one if the upload fails.

### Enforcing size and type

Signing alone can't enforce size, because there is no POST policy. Recommended flow:

1. **Request:** the admin calls `POST /api/cms/admin/uploads` with `{ name, size, type }`. This route is behind Cloudflare Access. The Worker rejects the request if `size > 500 MB` or `type` is not on the allow-list (`video/mp4`, `video/quicktime`, `video/webm`). It then signs a `PUT` for a fresh random key with `Content-Type` signed and a short expiry, such as 15 minutes.
   - *Optionally* also sign `Content-Length` with the exact size. The browser sets `Content-Length` itself, so a different file would fail the signature. **(unverified on R2; the R2 docs only document `Content-Type`. Test it before relying on it.)**
2. **Upload:** the browser `PUT`s the file directly to R2. Use `XMLHttpRequest` if a progress bar is wanted, because `fetch` has no upload progress.
3. **Confirm:** the admin calls `POST …/uploads/<key>/complete`. The Worker calls `env.MEDIA.head(key)` and checks `size` and `httpMetadata.contentType`. It can also read the first bytes with a range `get` to check the MP4/MOV `ftyp` signature. If the checks fail, the Worker deletes the object. If they pass, it writes the D1 row.
4. **Clean up:** the existing nightly cron (`workers/backup.ts`) deletes objects that are older than 24 h and have no D1 row. These steps are all I/O and barely use CPU (Workers CPU time excludes waiting on network/R2: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)). `DeleteObject` is a free R2 operation ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)).

A presigned URL is a bearer token until it expires, so keep expiries short.

### Storage budget

The R2 free tier is **10 GB-month of storage**, 1 M Class A and 10 M Class B operations per month, and free egress ([R2 pricing](https://developers.cloudflare.com/r2/pricing/#free-tier)). Operations won't come close to these limits, but **storage will**:

- 330 photo originals at about 5 MB each is about 1.7 GB.
- Each 500 MB video is 5 % of the free tier, so about 16 full-size videos fill what is left.
- Nightly backups (`workers/backup.ts`), if they are stored in R2 on the same account, also count against this.

The admin should show the bucket usage. Consider a lower per-video cap, such as 200 MB, or ask for compressed exports. This is not a hard block, but going over 10 GB is the first thing that would make this site cost money.

## 4. ~1 KB blurred previews (LQIP) at upload time

There is no build step, so the preview has to be created when the image is uploaded. That happens in the Worker, which receives images of up to 100 MB (the Free request body limit, [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).

**Recommended: the Images binding.**

```ts
// wrangler.jsonc: "images": { "binding": "IMAGES" }
const [a, b] = file.stream().tee();          // one copy to R2, one to the Images service
const put = env.MEDIA.put(key, a, { httpMetadata: { contentType: file.type } });
const info = await env.IMAGES.info(await file.slice(0, 64 * 1024).stream()); // free; header bytes may suffice (unverified)
const lqip = await (
  await env.IMAGES.input(b)
    .transform({ width: 32, fit: "scale-down", blur: 10 })
    .output({ format: "image/webp", quality: 40 })
).response().arrayBuffer();                                     // typically a few hundred bytes
await put;
// store `data:image/webp;base64,…`, width, height in the D1 media row
```

- `.input()` accepts a stream up to **20 MB** from any source, `.transform()` takes `width`/`blur`, `.output()` takes a format and quality, and `.info()` returns `format`, `fileSize`, `width` and `height` for free. ([Images binding](https://developers.cloudflare.com/images/optimization/binding/)) Use `.info()` to store the intrinsic size so `<img width height>` prevents layout shift.
- Cost: **1 unique transformation per photo**, once, in the month it is uploaded.
- CPU: the decode and encode run in Cloudflare's image service. The Worker only waits on I/O, which doesn't count toward the 10 ms limit (see the CPU time link in §3). Base64-encoding about 1 KB is trivial. **(inference: the docs don't say directly where binding work runs. Measure it with Workers Logs CPU time in the prototype.)**
- Local dev: `wrangler dev` uses a low-fidelity local Images mock, and `--remote` uses the real service. Local use isn't billed. ([Images binding: local](https://developers.cloudflare.com/images/optimization/binding/#interact-with-your-images-binding-locally))
- Using the same width for every LQIP keeps the parameters identical. Render it as a CSS `background-image` or as a blurred `<img>` under the real image, with `filter: blur()` and `transform: scale(1.1)` to hide the edges.

**Originals over 20 MB** (large DSLR JPEGs, for example) can't go through `.input()`. Two options:

- After the `put`, call `fetch(originUrl, { cf: { image: { width: 32, blur: 10, format: "webp" } } })`. Remote images allow up to 100 MB. ([Limits](https://developers.cloudflare.com/images/get-started/limits/#remote-images))
- Generate the preview in the browser with `createImageBitmap` and `OffscreenCanvas.convertToBlob({ type: "image/webp" })` and send it along with the upload. This costs no transformations, but it **doesn't work for HEIC in Chromium or Firefox**. Only use it as a fallback for JPEG, PNG and WebP.

Alternatives considered: BlurHash or ThumbHash strings (about 30 bytes) would need a decoder on the client and a JS image decoder in the Worker, which is too much CPU for HEIC or large JPEGs on Free. A dominant-colour placeholder is cheaper still, but looks worse. The binding approach is simpler and fits the "~1 KB" goal.

## Open items to verify in a prototype

1. HEIC from a current iPhone through `cf.image` on R2: check that it renders, check the orientation, and check whether it outputs WebP or AVIF.
2. Whether R2 enforces a signed `Content-Length` on presigned `PUT`.
3. Worker CPU time for an upload request that calls `IMAGES.input()` on a 15 MB file.
4. Whether `metadata: "none"` removes GPS data from WebP/AVIF output. The docs say all metadata is always dropped for non-JPEG output.
