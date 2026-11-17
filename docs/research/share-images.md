# Per-project share images within Workers limits

Research for issue #6. Checked 17 Nov 2026 against Cloudflare's docs (pages last updated Sep–Nov 2026), the satori README and a local benchmark.

## Question

Can Berghald make a 1200×630 Open Graph image for each project, built from the project's cover photo (in R2) and its title (in Outfit), on Workers Free? Free allows 10 ms of CPU per request. The fixed share images for other pages are already static files.

## Answer in short

- **Rendering on request with satori + resvg-wasm does not fit in 10 ms.** Measured on a laptop, it takes about 45 ms for text alone and about 150 ms with the cover photo, so it fails by 5–15×. Bundle size is no longer the blocker: the 3 MB compressed limit is gone.
- **Cloudflare Images can now draw text as well as image overlays** (`draw` with `text`, or `env.IMAGES.text()`), with a custom font loaded from a URL. A cover photo plus a title in Outfit can be made with no rendering code in the Worker. The catch is that text doesn't wrap, so we have to break lines ourselves.
- **Recommendation:** generate the image **once, when a project is published**, with the Images binding in the Hono admin API. Store it in R2 under a versioned key and serve it as a plain file. If a project has no generated image yet, fall back to the static default share image. If a spike shows that binding text isn't good enough, make the image in the browser in Vefstjórn with Canvas and upload it.

## Findings

### 1. Workers limits (the premise has changed)

From [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (updated 13 Nov 2026):

- **CPU time:** 10 ms per HTTP request on Free, and the same 10 ms for Cron Triggers. "Waiting on network requests (such as `fetch()` calls, KV reads, or database queries) does **not** count toward CPU time."
- **Worker size:** 64 MiB uncompressed on both Free and Paid. "There is no compressed size limit. Only the uncompressed bundle size counts." The 3 MB compressed limit in the ticket no longer applies.
- **Startup:** the global scope must run within 1 second, on both plans.
- **Memory:** 128 MB per isolate, WebAssembly included.
- **Workflows:** each step is held to the configured CPU limit, so 10 ms on Free. Moving the work to Cron Triggers or Workflows gives no extra CPU on Free.
- **Paid:** 30 s by default, up to 5 min. That would make on-request rendering possible ([architecture §3](../architecture.md) already names this as the escape hatch), but it isn't needed here.

### 2. satori + resvg-wasm (and workers-og / @vercel/og-style libraries)

**Bundle size** (from npm, Nov 2026):

| Package | Version | Size |
|---|---|---|
| `@resvg/resvg-wasm` | 2.6.2 | `index_bg.wasm` is 2.4 MB (950 KB gzipped) |
| `satori` | 0.63.2 | `index.js` is 1.6 MB with the Yoga Wasm inlined as base64; `standalone.js` is 916 KB plus a separate `layout.wasm` |
| `workers-og` | 0.0.27 | 396 KB JS plus `resvg` (1.3 MB) and `yoga` (88 KB) `.wasm` files |

That adds roughly 3–4 MB uncompressed. This is well under 64 MiB, but it does add Wasm compile work to cold starts.

**Workers caveat:** Workers only accept precompiled Wasm modules ([WebAssembly docs](https://developers.cloudflare.com/workers/runtime-apis/webassembly/): "`WebAssembly.instantiate()` only supports pre-compiled modules"). The satori README says to use its standalone build where loading Wasm at runtime is restricted, "e.g. Cloudflare Workers", and to supply `layout.wasm` yourself. It supports TTF, OTF, WOFF and WOFF2.

**CPU cost (measured):** the benchmark ran on Node 26 on an Apple M1 Pro. It rendered a 1200×630 layout: a JPEG cover (about 69 KB, synthetic noise, no client photo), a gradient, and a two-line Icelandic title in Outfit 700 (`latin` and `latin-ext` WOFF). The script and output are not committed.

| Case | satori (warm) | resvg render + PNG encode (warm) | First run |
|---|---|---|---|
| Title + cover photo | 1.7–2.9 ms | **150–153 ms** | 46 ms + 340 ms |
| Title only, no photo | 1.3–1.9 ms | **44–45 ms** | — |

Initialising the resvg Wasm took about 17 ms on top of that. The Icelandic glyphs (ð, æ, ö, í) rendered correctly.

- Satori's layout step alone would fit in 10 ms, but rasterising does not.
- The M1 is no slower than a Workers isolate, so on-request rendering on Free would hit Error 1102 ("Worker exceeded resource limits"). `workers-og` and `@vercel/og` wrap the same satori + resvg pipeline, so the same cost applies to them.

### 3. Cloudflare Images: draw overlays and text

From [Draw overlays](https://developers.cloudflare.com/images/optimization/draw-overlays/) and [Optimize with Workers (binding)](https://developers.cloudflare.com/images/optimization/binding/) (updated 2 Sep 2026):

**Drawing**

- Text and image overlays can be drawn in a Worker in two ways:
  - a `draw` array in `cf.image` on a `fetch()`, which needs URLs
  - the **Images binding** (`env.IMAGES.input(bytes).draw(...)`), which accepts R2 bytes directly
- Layers stack in order. Each layer can set `top`, `left`, `bottom` and `right`, `opacity`, `composite`, and `width`/`height`/`fit` for images.
- The output size is the size of the base image. So you first `.transform({ width: 1200, height: 630, fit: "cover" })` the cover, then draw onto it.

**Text** (`.text(content, { font: { url }, color, size })`)

- Fonts can be TTF, OTF, WOFF or WOFF2, up to 20 MB, fetched from a URL. Outfit can be served from the site's own static assets.
- Limits: 1,000 characters and 4096×4096 px.
- The docs list **no options for maximum width, wrapping, line height, weight or shadow**. A long title therefore has to be split into lines in our code, with each line drawn as its own `.text()` layer.
- A small table of Outfit's glyph advance widths, a few KB, makes that split cheap and deterministic.
- A darkening gradient for legibility can be a static PNG overlay, drawn under the text.

**Inputs and formats**

- The binding's `.input()` accepts up to 20 MB ([Limits](https://developers.cloudflare.com/images/get-started/limits/)). Our uploads can be up to 100 MB, so very large originals need a resized copy first.
- HEIC input is supported, and output can be JPEG, PNG, WebP or AVIF.

**Billing** ([pricing](https://developers.cloudflare.com/images/pricing/))

- Binding calls are billed as unique transformations: one per unique source and parameter set per calendar month. Free includes 5,000 a month, and R2 sources count.
- Over the limit, Free returns error `9422` for new transformations. The 5,000 is shared with the site's responsive photo widths ([architecture §4](../architecture.md)).
- For about 10 projects × 2 locales, share images cost a few dozen transformations a month at most.

**CPU** (inference, not stated for the binding specifically)

- The transform runs in Cloudflare's Images service, and the Worker only awaits it. Under the "waiting on network requests does not count" rule, the Worker's CPU cost should be small: reading D1 and R2, and building the request.
- **Verify this in a spike** by checking CPU time in Workers Logs.

**Caching** (the binding doc)

- "Responses from the Images binding are not automatically cached. Every uncached call performs a full decode and re-encode."
- The doc recommends Workers Cache plus `Cache-Control`. Generating at publish time avoids this entirely.

**Not confirmed in the docs:** whether `wrangler dev` emulates `.draw()` with `.text()` locally. Check this in the spike, because it affects local development and Playwright.

### 4. Generating once at publish time

| Where | Fits within limits? | Notes |
|---|---|---|
| **Hono admin API, Images binding, on publish** (`ctx.waitUntil`) | Yes. The work runs in Images, not as Worker CPU (to verify). `waitUntil` allows up to 30 s after the response. | Server-side and deterministic, and it also covers publishing from other paths. Uses a few transformations per publish. |
| **Browser in Vefstjórn** (Canvas / `OffscreenCanvas`, `FontFace` for Outfit, `canvas.toBlob('image/jpeg')`), then upload to R2 | Yes. No Worker CPU and no Images quota used. | Full control over layout (`measureText` handles wrapping, plus gradients and shadows). Load the cover through Image Transformations as JPEG or WebP, same origin, so the canvas isn't tainted and HEIC works. Drawbacks: it only runs when an admin saves from the UI, and output can differ slightly between browsers. |
| satori + resvg in the browser | Yes | Satori runs in browsers ("uses `OffscreenCanvas`"), but this adds about 3 MB of Wasm to the admin for no gain over plain Canvas. |
| Cron or Workflows on Free | No | Still 10 ms CPU, so it doesn't help satori/resvg. |
| Workers Paid ($5/mo) | Yes | 30 s CPU makes satori/resvg on request viable. Only worth it if Paid is adopted for other reasons. |

**Where the code lives:** the CMS must stay generic ([CLAUDE.md](../../CLAUDE.md)).

- Vefstjórn should only offer a hook, e.g. `shareImage?: (doc) => ShareImageSpec` or an `onPublish` callback in `cms.config.ts`.
- The Berghald layout (gradient, title placement, Outfit) lives in `sites/berghald`.

### 5. Storage, URLs and caching

- **R2 key:** `share/<collection>/<slug>.<locale>.<hash>.jpg`, where `hash` is a short hash of cover media id + title + layout version.
  - The page's `og:image` points at that versioned URL.
  - A new title or cover gives a new URL, which helps because social platforms cache share images by URL.
- **Serving:** serve it from the same Worker with `Cache-Control: public, max-age=31536000, immutable`. JPEG at quality 80–85 keeps it well under the size limits common platforms apply.
- **Clean-up:** delete the previous key on republish, or leave old keys for the nightly backup job to prune.
- **Fallback:** if a project has no generated image (e.g. generation failed), `og:image` uses the existing static default. A share must never return an error.
- Because the image is a stored file, the edge page cache key ([architecture §3](../architecture.md)) needs no change. The HTML already re-renders on publish and picks up the new URL.

## Recommendation

1. Generate the share image **at publish time with the Images binding**: cover transformed to 1200×630 `fit: cover`, then a static gradient PNG, then one Outfit `.text()` layer per line.
   - Break lines with a precomputed Outfit width table.
   - Write the result to R2 under a versioned key and serve it as an immutable file.
   - Fall back to the static default image.
2. Run a short spike before building it. Confirm:
   - text quality and kerning in Outfit, including Icelandic glyphs
   - that the binding call's Worker CPU is negligible
   - that `wrangler dev` supports `.text()` locally
3. If the spike fails, use the **Vefstjórn Canvas** route instead: render in the browser at publish and upload to the same R2 key scheme. Its storage, URLs and caching are identical.
4. **Do not** render with satori + resvg on request on Workers Free. Its rasterising step alone is 5–15× over the CPU limit.

## Sources

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers WebAssembly: https://developers.cloudflare.com/workers/runtime-apis/webassembly/
- Cloudflare Images, draw overlays: https://developers.cloudflare.com/images/optimization/draw-overlays/
- Cloudflare Images binding (`.text()`, caching, billing): https://developers.cloudflare.com/images/optimization/binding/
- Cloudflare Images limits and formats: https://developers.cloudflare.com/images/get-started/limits/
- Cloudflare Images pricing: https://developers.cloudflare.com/images/pricing/
- satori README (fonts, standalone build for Workers, browser support): https://github.com/vercel/satori
- npm packages measured: `satori@0.63.2`, `@resvg/resvg-wasm@2.6.2`, `workers-og@0.0.27`, `@fontsource/outfit@5.3.0`
