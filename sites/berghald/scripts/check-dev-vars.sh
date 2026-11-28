#!/bin/sh
# Checks that .dev.vars sets every key .dev.vars.example sets. A copy made before a new key
# landed breaks dev and e2e far from the cause (no TRANSLATOR=fake: every save logs
# "translation failed"). Exits 1 and says what to add. Run from anywhere.
dir=$(dirname "$0")/..
example="$dir/.dev.vars.example"
vars="$dir/.dev.vars"

if [ ! -f "$vars" ]; then
  echo "sites/berghald/.dev.vars is missing: cp sites/berghald/.dev.vars.example sites/berghald/.dev.vars (never deploy from a checkout that has it)."
  exit 1
fi

missing=""
for key in $(sed -n 's/^\([A-Z_][A-Z0-9_]*\)=.*/\1/p' "$example"); do
  grep -q "^$key=" "$vars" || missing="$missing $key"
done

if [ -n "$missing" ]; then
  echo "sites/berghald/.dev.vars lacks:$missing. Copy them from .dev.vars.example."
  exit 1
fi
