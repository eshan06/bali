#!/bin/bash
# Self-test for plan-updated.sh: a source change in apps/, packages/, ios/ or android/ fails
# without docs/PLAN.md, a moved-out file and a name git quotes included, and neither
# docs/PLAN-ANDROID.md nor a name that only ends in a line docs/PLAN.md stands in for it;
# docs/PLAN.md, a commit's [no-plan], Dependabot's manifests and a change to no source pass; a base
# that isn't there fails. plan-check.yml runs it first, so a check that stops counting fails
# instead of passing.
#
#   .github/scripts/plan-updated.test.sh
set -euo pipefail

CHECK="$(cd "$(dirname "$0")" && pwd)/plan-updated.sh"
REPO=$(mktemp -d)
OUT=$(mktemp)
trap 'rm -rf "$REPO" "$OUT"' EXIT
# No machine's git config reaches the repo (a signing key, rename settings).
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
cd "$REPO"
git init -q
mkdir -p android apps/web docs ios packages tools
echo app >apps/app.ts
echo web >apps/web/package.json
echo kt >android/App.kt
echo swift >ios/App.swift
echo pkg >packages/index.ts
echo plan >docs/PLAN.md
echo android >docs/PLAN-ANDROID.md
echo notes >docs/notes.md
git add -A
git commit -qm base
BASE=$(git rev-parse HEAD)
failures=0

# expect <pass|fail> <case> <author> <change>: <change>, shell run on the base and committed with
# the case as its message, then the check asked about it as <author>'s PR.
expect() {
  local got
  git checkout -q --detach "$BASE"
  eval "$4"
  git add -A
  git commit -q --allow-empty -m "$2"
  if "$CHECK" "$BASE" "$3" >"$OUT" 2>&1; then got=pass; else got=fail; fi
  if [ "$got" != "$1" ]; then
    echo "FAIL: $2: expected $1, got $got"
    sed 's/^/  /' "$OUT"
    failures=$((failures + 1))
  fi
}

expect fail 'android/ without the plan' someone 'echo more >>android/App.kt'
expect pass 'android/ with the plan' someone 'echo more >>android/App.kt; echo more >>docs/PLAN.md'
expect fail 'android/ with PLAN-ANDROID.md alone' someone 'echo more >>android/App.kt; echo more >>docs/PLAN-ANDROID.md'
expect fail 'apps/ without the plan' someone 'echo more >>apps/app.ts'
expect fail 'packages/ without the plan' someone 'echo more >>packages/index.ts'
expect fail 'ios/ without the plan' someone 'echo more >>ios/App.swift'
expect pass 'apps/ with the plan' someone 'echo more >>apps/app.ts; echo more >>docs/PLAN.md'
expect fail 'a source file moved out of android/' someone 'git mv android/App.kt tools/App.kt'
expect fail 'a file beside the plan, not the plan' someone 'echo more >>apps/app.ts; echo x >docs/PLAN.md.bak'
expect fail 'a source file whose name git quotes' someone "echo new >'apps/café.ts'"
expect pass 'a trivial fix [no-plan]' someone 'echo more >>android/App.kt'
expect pass 'no source changed' someone 'echo more >>docs/notes.md'
expect pass 'no change at all' someone ':'
expect pass "Dependabot's manifests alone" 'dependabot[bot]' 'echo more >>apps/web/package.json'
expect fail 'Dependabot beyond its manifests' 'dependabot[bot]' 'echo more >>apps/web/package.json; echo more >>apps/app.ts'
expect fail 'manifests alone, not Dependabot' someone 'echo more >>apps/web/package.json'

if "$CHECK" no-such-base someone >/dev/null 2>&1; then
  echo "FAIL: a base that isn't there passed instead of failing"
  failures=$((failures + 1))
fi

# A source change beside a path that only ends in a line reading docs/PLAN.md: never the plan. It
# goes straight into the index, since no Windows file name may hold a newline.
git checkout -q --detach "$BASE"
echo more >>apps/app.ts
git add -A
git -c core.protectNTFS=false update-index --add \
  --cacheinfo "100644,$(git hash-object -w docs/notes.md),$(printf 'x\ndocs/PLAN.md')"
git commit -qm 'a name ending in a line docs/PLAN.md'
if "$CHECK" "$BASE" someone >"$OUT" 2>&1; then
  echo "FAIL: a name ending in a line docs/PLAN.md passed as the plan"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then exit 1; fi
echo "plan-updated.sh: all cases pass"
