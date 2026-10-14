#!/bin/bash
# Self-test for docs-only.sh: a change to Markdown under docs/ alone is
# docs-only; one outside it, any other file under docs/, docs/APP-STORE.md, a
# file moved into docs/ or no change at all is not; a base that isn't there
# fails instead of answering. CI runs it first, so a decision that stops
# working fails instead of skipping the tests.
#
#   .github/scripts/docs-only.test.sh
set -euo pipefail

CHECK="$(cd "$(dirname "$0")" && pwd)/docs-only.sh"
REPO=$(mktemp -d)
trap 'rm -rf "$REPO"' EXIT
# No machine's git config reaches the repo (a signing key, rename settings).
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
cd "$REPO"
git init -q
mkdir apps docs
echo app >apps/app.ts
echo doc >docs/a.md
echo privacy >docs/APP-STORE.md
echo readme >README.md
git add -A
git commit -qm base
BASE=$(git rev-parse HEAD)
failures=0

# expect <true|false> <case> <change>: <change>, shell run on the base and
# committed, then the check asked about it.
expect() {
  local got
  git checkout -q --detach "$BASE"
  eval "$3"
  git add -A
  git commit -q --allow-empty -m "$2"
  got=$("$CHECK" "$BASE" 2>&1) || got="exit $?: $got"
  if [ "$got" != "$1" ]; then
    echo "FAIL: $2: expected $1, got $got"
    failures=$((failures + 1))
  fi
}

expect true 'a doc changed' 'echo more >>docs/a.md'
expect true 'a doc added in a folder and one deleted' 'mkdir docs/sub; echo b >docs/sub/b.md; rm docs/a.md'
expect true 'a doc moved within docs/' 'mkdir docs/sub; git mv docs/a.md docs/sub/a.md'
expect false 'a doc and a source file' 'echo more >>docs/a.md; echo more >>apps/app.ts'
expect false 'README.md, which a test reads' 'echo more >>README.md'
expect false 'a docs/ folder elsewhere' 'mkdir -p apps/docs; echo x >apps/docs/x.md'
expect false 'a folder whose name starts with docs' 'mkdir docsite; echo x >docsite/x.md'
expect false 'code under docs/, which ESLint lints' 'echo "export const x = 1;" >docs/x.ts'
expect false 'docs/APP-STORE.md, which the privacy-manifest check reads' 'echo more >>docs/APP-STORE.md'
expect false 'docs/APP-STORE.md beside another doc' 'echo more >>docs/APP-STORE.md; echo more >>docs/a.md'
expect false 'README.md moved into docs/' 'git mv README.md docs/README.md'
expect false 'no change at all' ':'

if got=$("$CHECK" no-such-base 2>/dev/null); then
  echo "FAIL: a base that isn't there answered $got instead of failing"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then exit 1; fi
echo "docs-only.sh: all cases pass"
