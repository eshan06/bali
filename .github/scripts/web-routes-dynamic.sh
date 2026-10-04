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
if ! grep -q '^Route (app)' "$log"; then
  echo "::error::no route table in $log: did the build run?"
  exit 1
fi
# No summary after the header (a Next that prints the table another way) fails,
# rather than reading every line to the end of the log as routes.
if ! table=$(awk '/^Route \(app\)/ { on = 1 } on { print } on && /^\+ First Load JS/ { end = 1; exit }
  END { exit !end }' "$log"); then
  echo "::error::the route table in $log has no '+ First Load JS' line after it: update this script to where Next's table ends"
  exit 1
fi
routes=$(grep -F ' /' <<<"$table" || true)
if [ -z "$routes" ]; then
  echo "::error::no routes in $log's route table: did the build run?"
  exit 1
fi
if not_dynamic=$(grep -vF ' ƒ /' <<<"$routes"); then
  echo "$not_dynamic"
  echo "::error::the routes above are not rendered per request, so they carry no CSP nonce; keep the root layout's dynamic = 'force-dynamic'"
  exit 1
fi
echo "every route is dynamic ($(wc -l <<<"$routes") routes)"
