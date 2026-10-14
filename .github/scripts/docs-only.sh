#!/bin/bash
# Whether a PR is docs-only, for ci.yml's "CI changes": every file it changes
# from <base> to HEAD is Markdown under docs/, which no test job reads and no
# tool picks up by pattern (Prettier ignores docs/, ESLint lints only code).
# Prints true or false. A diff that fails fails the script, never an answer,
# so the tests run.
#
#   .github/scripts/docs-only.sh <base>
#
# Not docs-only: any other file under docs/ (`eslint .` lints a docs/x.ts);
# docs/APP-STORE.md, whose privacy table "Typecheck · lint · build" checks the
# app's privacy manifests against (privacy-manifests.py); a file moved into
# docs/, which --no-renames lists where it left too; and a change to no file at
# all. docs-only.test.sh pins each one.
set -euo pipefail

changed=$(git diff --no-renames --name-only "$1"...HEAD)
# No change at all is one empty line here, which isn't Markdown under docs/.
if ! grep -qvE '^docs/.*\.md$' <<<"$changed" && ! grep -qxF docs/APP-STORE.md <<<"$changed"; then
  echo true
else
  echo false
fi
