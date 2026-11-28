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
# Git doesn't copy ignored files into a worktree: link the Access service token
# (docs/ops.md, "Behind Access") from the main checkout so previews can be checked.
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)")
if [ ! -e .env.access ] && [ -f "$main/.env.access" ]; then
  ln -s "$main/.env.access" .env.access && echo "Linked .env.access from the main checkout."
fi
# .dev.vars turns Access off and builds bundle it, so it is never created or edited
# automatically; this only says when it is missing or older than the example.
sh sites/berghald/scripts/check-dev-vars.sh || true
