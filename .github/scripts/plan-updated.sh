#!/bin/bash
# The plan backstop, for plan-check.yml's "Plan doc updated": a PR that changes source (apps/,
# packages/, ios/ or android/) from <base> to HEAD must change docs/PLAN.md too, or carry
# [no-plan] in a commit message for a truly trivial fix (CLAUDE.md, working rules). Dependabot's
# PRs are exempt while they change nothing but dependency manifests. Exits 1 with the reason when
# the plan is missing; a diff or log that fails fails the script too, never passes it.
#
#   .github/scripts/plan-updated.sh <base> <pr-author>
#
# A moved file counts where it left as well as where it went (--no-renames), and each path as it
# is (-z), as in touches.sh. docs/PLAN-ANDROID.md alone never stands in for docs/PLAN.md: that
# needs CLAUDE.md's rule changed first (docs/PLAN-ANDROID.md, AN2). plan-updated.test.sh pins each
# case.
set -euo pipefail

base=$1
author=$2
changed=$(git diff -z --no-renames --name-only "$base"...HEAD | tr '\0' '\n')
messages=$(git log --format=%B "$base"..HEAD)
echo "Changed files:"
echo "$changed"

if ! grep -qE '^(apps|packages|ios|android)/' <<<"$changed"; then
  echo "No source changes: plan update not required."
  exit 0
fi
# Both conditions on purpose: a human commit on a Dependabot branch makes the diff more than
# manifests, and a session adding a dependency (a plan-worthy decision) is not exempt merely
# because its diff is manifests alone (docs/PLAN.md, 2026-09-20).
if [ "$author" = 'dependabot[bot]' ] && ! grep -vqE '(^|/)package(-lock)?\.json$' <<<"$changed"; then
  echo "Dependabot manifest-only change: plan update not required."
  exit 0
fi
if grep -qxF docs/PLAN.md <<<"$changed"; then
  echo "docs/PLAN.md updated: ok."
  exit 0
fi
if grep -qF '[no-plan]' <<<"$messages"; then
  echo "[no-plan] escape used: ok."
  exit 0
fi
echo "::error::This PR changes source code but not docs/PLAN.md. Update the plan (status + what landed), or add [no-plan] to a commit message if the change is truly trivial."
exit 1
