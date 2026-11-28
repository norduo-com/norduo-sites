#!/usr/bin/env bash
# Usage: smoke.sh <base url>. Run after a deploy.
# Fails if the home page or any /assets file it links isn't 200 (a page cached from an older
# deploy links hashed files that no longer exist), or if an unknown URL isn't a 404.
set -euo pipefail
base=${1%/}
fail=0

check() { # <expected status> <path>
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' --retry 3 --retry-all-errors "$base$2")
  echo "$status $2"
  [ "$status" = "$1" ] || fail=1
}

html=$(curl -sf --retry 3 --retry-all-errors "$base/")
assets=$(grep -oE '/assets/[^"'"'"' )]+\.(css|js)' <<<"$html" | sort -u)
[ -n "$assets" ] || { echo "no /assets links on $base/"; exit 1; }

check 200 /
for a in $assets; do check 200 "$a"; done
check 404 /smoke-test-missing-page

exit $fail
