#!/bin/bash
# Fails unless every route in a `next build` log's route table is dynamic (ƒ).
# A page built ahead (○ static, ● SSG, ◐ partial prerender, or any marker a
# later Next adds) carries no CSP nonce, so its scripts are refused and the
# page is blank (Phase 6, S4; apps/web/src/app/rendering.test.ts).
#
#   .github/scripts/web-routes-dynamic.sh <next build log>
set -euo pipefail

log=$1
# The route table: from its header to the shared-chunks summary. A route line
# names its path after its marker (`├ ƒ /login`); the header and the summary don't.
routes=$(sed -n '/^Route (app)/,/^+ First Load JS/p' "$log" | grep -F ' /' || true)
if [ -z "$routes" ]; then
  echo "::error::no route table in $log: did the build run?"
  exit 1
fi
if not_dynamic=$(grep -vF ' ƒ /' <<<"$routes"); then
  echo "$not_dynamic"
  echo "::error::the routes above are not rendered per request, so they carry no CSP nonce; keep the root layout's dynamic = 'force-dynamic'"
  exit 1
fi
echo "every route is dynamic ($(wc -l <<<"$routes") routes)"
