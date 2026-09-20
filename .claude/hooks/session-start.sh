#!/bin/bash
# SessionStart hook: make a fresh Claude Code on the web container able to
# run typecheck/lint/tests immediately. Replaces the cloud environment's UI
# "setup script" (leave that field empty — it ran outside the repo root and
# failed npm ci with "no package-lock.json").
set -euo pipefail

# Local checkouts manage their own node_modules; only web containers need this.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# The hook lives at .claude/hooks/, so ../.. is the repo root — the fallback
# covers runtimes that invoke the hook without exporting CLAUDE_PROJECT_DIR.
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# npm install, not npm ci: the container state is cached after the hook runs,
# and install reuses node_modules on later sessions instead of wiping it.
npm install --no-audit --no-fund
