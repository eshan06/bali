#!/bin/bash
# SessionStart hook: make a fresh Claude Code on the web container able to
# run typecheck/lint/tests immediately. Replaces the cloud environment's UI
# "setup script" (leave that field empty — it ran outside the repo root and
# failed npm ci with "no package-lock.json").
set -euo pipefail

# Local checkouts manage their own node_modules; only web containers need this.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  echo "session-start: not a web session — skipping dependency install."
  exit 0
fi

# The hook lives at .claude/hooks/, so ../.. is the repo root — the fallback
# covers runtimes that invoke the hook without exporting CLAUDE_PROJECT_DIR.
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

if [ -d node_modules ]; then
  # Cached container state: npm install is a fast no-op against the tree.
  npm install --no-audit --no-fund
else
  # Fresh container: npm ci reproduces exactly the lockfile's tree.
  npm ci --no-audit --no-fund
fi

# A session must see the same tree CI's npm ci will see. If the install
# silently repaired a package.json/lockfile disagreement, surface it.
if ! git diff --quiet -- package-lock.json; then
  echo "session-start: dependency install changed package-lock.json —" >&2
  echo "package.json and the lockfile disagree; commit a fix via a PR." >&2
  exit 1
fi
