# Coding standards

Read during review. These are judgement calls; anything mechanical is a lint rule or a test instead. The rules in `CLAUDE.md` (generic CMS, labels, Icelandic wording, free tier) apply too.

## Browsers

- **Every browser path has a test in an engine that takes it.** Code that branches on what the browser can do (canvas encoders, image decoders, file pickers) is covered in Chromium _and_ WebKit (`desktop`/`mobile` and `webkit`/`iphone` in `sites/*/playwright.config.ts`). Safari can't encode WebP, so photo upload takes the JPEG path only there.
- **Server checks accept what real browsers send.** A check on client-made data (size, format, metadata) is tested with data a real browser produced, not only with fixtures from Sharp or Node. Safari writes EXIF into every canvas JPEG.

## End-to-end tests

- **Find form fields by role and exact name.** Use `getByRole('textbox', { name: 'Heiti', exact: true })`. A required field's label renders as "Heiti \*", so `getByLabel('Heiti', { exact: true })` never matches and times out.

## Local vs production

- **Local bindings are not production.** The local Images binding is Sharp: it can't read HEIC, ignores `draw`, `blur` and `quality`, and strips EXIF by itself (see `docs/architecture.md` §5). A test that passes only because local mode drops something says so, and the real check is listed for the PR preview.
- **CPU per request is counted.** Images binding calls cost about 7 ms CPU per MB of input on Workers Free. A request that makes several heavy calls is split, or retried on 503 from the client.

## Failures

- **A failure the editor sees carries a code the server logs.** Vefstjórn shows a short Icelandic message plus the server's code; the Worker logs the same reason (`console.warn`), so Workers Logs explain a bug report without a live `wrangler tail`.

## Spacing

- `pnpm lint` rejects arbitrary spacing values and non-token radii in sites. Numeric spacing (`mt-2`) is for small gaps inside one component where no token in `docs/spacing-system.md` fits; gaps between cards, boxes and sections use the tokens.
