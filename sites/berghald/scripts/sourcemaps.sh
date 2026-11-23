#!/usr/bin/env bash
# Runs before every deploy. Uploads the build's source maps to Sentry so stack traces are
# readable, then deletes the client ones so they're never deployed.
# Debug IDs tie each file to its map, so no release name has to match.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${SENTRY_AUTH_TOKEN:-}" ]]; then
  sentry-cli sourcemaps inject build/client build/server
  sentry-cli sourcemaps upload --org norduo-au --project berghald-vefstjorn build/client
  sentry-cli sourcemaps upload --org norduo-au --project berghald-server build/server
else
  echo "SENTRY_AUTH_TOKEN is not set: source maps are not uploaded."
fi

# Client maps would be served as public assets. The Worker's stay: wrangler reads them while
# bundling and doesn't upload them (no `upload_source_maps`), so they're never public.
find build/client -name '*.map' -delete
