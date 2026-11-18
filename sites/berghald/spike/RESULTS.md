# SSR CPU spike: results (2026-11-18)

Throwaway branch for the "SSR CPU time on Workers Free" ticket. Never merged.

Setup: `sites/berghald` from `main`, deployed as Worker `berghald-ssr-spike` (workers.dev) with its own
D1 `berghald-ssr-spike`, seeded by `spike/seed.mjs` with Forsíða-shaped CMS documents (1 page with 6
blocks, 6 services, 12 projects with 10-image galleries each, settings). Route `app/routes/spike.tsx`:
4 D1 queries in one `batch`, JSON.parse of every row, React Router 8 SSR with the default streaming
`entry.server`. No edge cache (`ENVIRONMENT=spike`). CPU per request from `wrangler tail --format json`.

| Variant         | What                                         | HTML    | n   | CPU p50 | p90 | max | >10 ms |
| --------------- | -------------------------------------------- | ------- | --- | ------- | --- | --- | ------ |
| `/`             | scaffold home, no D1                         | 4 KB    | 36  | 2       | 3   | 4   | 0      |
| `/spike`        | Forsíða, 16 images, galleries loaded         | 80 KB   | 36  | 7       | 9   | 19  | 2      |
| `/spike?lean=1` | same, `json_remove(data,'$.gallery')` in SQL | 68 KB   | 39  | 5       | 7   | 12  | 2      |
| `/spike?x=3`    | body rendered 3×                             | 149 KB  | 38  | 8       | 12  | 21  | 9      |
| `/spike?x=6`    | body rendered 6×                             | ~280 KB | 34  | 11      | 20  | 30  | 20     |

Enforcement on Workers Free:

- A runaway loop is killed at ~10 ms CPU (`exceededCpu`, HTTP 503), so the account is on Free (Paid allows 30 s).
- Single requests with a fixed extra burn reached 98 ms CPU and still returned 200 (`ok`). Occasional overruns
  are tolerated; the limit is not a hard per-request cut-off at 10 ms. Do not design around that grace.
