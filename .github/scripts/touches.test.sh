#!/bin/bash
# Self-test for touches.sh: a watched file changed, or moved in or out of the
# watched paths, touches them; a file elsewhere, one moved elsewhere, or no
# change at all does not; a base that isn't there and a pattern grep refuses
# fail instead of answering. ios.yml and load-gate.yml run it first, so a
# decision that stops working fails instead of skipping their job.
#
#   .github/scripts/touches.test.sh
set -euo pipefail

CHECK="$(cd "$(dirname "$0")" && pwd)/touches.sh"
REPO=$(mktemp -d)
trap 'rm -rf "$REPO"' EXIT
# No machine's git config reaches the repo (a signing key, rename settings).
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
cd "$REPO"
git init -q
mkdir apps ios
echo app >apps/app.ts
echo ios >ios/app.swift
echo job >job.yml
git add -A
git commit -qm base
BASE=$(git rev-parse HEAD)
# Shaped like the workflows' own patterns, which live in each workflow: a
# folder, or one file exactly.
WATCHED='^(ios/|job\.yml$)'
failures=0

# expect <true|false> <case> <change>: <change>, shell run on the base and
# committed, then the check asked about it.
expect() {
  local got
  git checkout -q --detach "$BASE"
  eval "$3"
  git add -A
  git commit -q --allow-empty -m "$2"
  got=$("$CHECK" "$BASE" "$WATCHED" 2>&1) || got="exit $?: $got"
  if [ "$got" != "$1" ]; then
    echo "FAIL: $2: expected $1, got $got"
    failures=$((failures + 1))
  fi
}

expect true 'a watched file changed' 'echo more >>ios/app.swift'
expect true 'the watched file changed' 'echo more >>job.yml'
expect true 'a file moved out of the watched folder' 'git mv ios/app.swift apps/app.swift'
expect true 'a file moved into it' 'git mv apps/app.ts ios/app.ts'
expect false 'a file elsewhere changed' 'echo more >>apps/app.ts'
expect false 'a file moved elsewhere' 'mkdir apps/sub; git mv apps/app.ts apps/sub/app.ts'
expect false 'no change at all' ':'

if got=$("$CHECK" no-such-base "$WATCHED" 2>/dev/null); then
  echo "FAIL: a base that isn't there answered $got instead of failing"
  failures=$((failures + 1))
fi
if got=$("$CHECK" "$BASE" '(' 2>/dev/null); then
  echo "FAIL: a pattern grep refuses answered $got instead of failing"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then exit 1; fi
echo "touches.sh: all cases pass"
