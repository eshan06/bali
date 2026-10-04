#!/bin/bash
# Self-test for web-routes-dynamic.sh: a table of ƒ routes passes; one route
# built ahead under any marker, or no table at all, fails. CI runs it before
# the real check, so a pattern that stops matching fails instead of passing.
#
#   .github/scripts/web-routes-dynamic.test.sh
set -euo pipefail

CHECK="$(cd "$(dirname "$0")" && pwd)/web-routes-dynamic.sh"
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
failures=0

# table <marker of /login>: a route table as `next build` prints it.
table() {
  cat <<EOF
   Generating static pages (2/2)
Route (app)                                 Size  First Load JS
┌ ƒ /                                    3.79 kB         148 kB
├ ƒ /classes/[id]                        5.92 kB         150 kB
└ $1 /login                               1.88 kB         140 kB
+ First Load JS shared by all             138 kB
  ├ chunks/87c73c54-24122e7b92478d00.js  54.2 kB
  └ other shared chunks (total)          3.41 kB

ƒ Middleware                             32.9 kB
EOF
}

# expect <pass|fail> <case> <log text>
expect() {
  printf '%s\n' "$3" >"$DIR/build.log"
  if "$CHECK" "$DIR/build.log" >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" != "$1" ]; then
    echo "FAIL: $2: expected $1, got $got"
    failures=$((failures + 1))
  fi
}

expect pass 'every route dynamic' "$(table ƒ)"
expect fail 'a static route' "$(table ○)"
expect fail 'an SSG route' "$(table ●)"
expect fail 'a partially prerendered route' "$(table ◐)"
expect fail 'no route table (the build failed)' 'Failed to compile.'

if [ "$failures" -gt 0 ]; then exit 1; fi
echo "web-routes-dynamic.sh: all cases pass"
