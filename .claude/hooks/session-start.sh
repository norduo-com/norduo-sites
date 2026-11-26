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
# .dev.vars turns Access off and builds bundle it, so it is never created automatically.
if [ ! -f sites/berghald/.dev.vars ]; then
  echo "e2e needs sites/berghald/.dev.vars: cp sites/berghald/.dev.vars.example sites/berghald/.dev.vars (never deploy from a checkout that has it)."
fi
