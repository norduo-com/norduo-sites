# Store only the master image, never the uploaded original

Vefstjórn shrinks every uploaded photo in the browser to a WebP master image (long edge ≤ 2560 px, never upscaled, q ≈ 0.9, sRGB, orientation applied, no metadata). That master is the only copy stored in R2. Originals straight from the phone are not kept.

Why: originals carry EXIF/GPS (the Images binding copies it into every output), cost ~5 MB each against R2's 10 GB free tier, and anything over 20 MB can't pass through the binding. The site never serves wider than 2560 px, so the master is enough for re-cropping, and the client still has the originals on their own devices. This can't be undone for photos that are already uploaded: a higher-resolution version means uploading the photo again.

## Consequences

- Every upload is re-encoded, even a small WebP, so no metadata ever reaches R2.
- If the browser can't encode WebP (`blob.type` isn't `image/webp`), it uploads a JPEG at q 0.92 and the Worker converts it to WebP once with the Images binding.
- If the browser can't decode a HEIC, the raw file goes to `tmp/<id>`. The Worker makes the master from it and deletes it straight away. An R2 lifecycle rule deletes anything under `tmp/` after 1 day.
- Supersedes "the original is kept" in `docs/architecture.md`.
