#!/bin/sh
# Fresh worktrees have no node_modules, so typecheck and tests fail until pnpm install runs.
cd "$CLAUDE_PROJECT_DIR" || exit 0
if [ ! -d node_modules ]; then
  if pnpm install --frozen-lockfile >/dev/null 2>&1; then
    echo "Ran pnpm install (this checkout had no node_modules)."
  else
    echo "pnpm install --frozen-lockfile failed; run it yourself to see why."
  fi
fi
# .dev.vars turns Access off and builds bundle it, so it is never created or edited
# automatically; this only says when it is missing or older than the example.
sh sites/berghald/scripts/check-dev-vars.sh || true
