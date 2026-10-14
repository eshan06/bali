#!/bin/bash
# Whether a PR is docs-only, for ci.yml's "CI changes": every file it changes
# from <base> to HEAD is under docs/, where no test job can fail on a Markdown
# change. Prints true or false. A diff that fails fails the script, never an
# answer, so the tests run.
#
#   .github/scripts/docs-only.sh <base>
#
# Not docs-only: a change to no file at all; docs/APP-STORE.md, whose privacy
# table "Typecheck · lint · build" checks the app's privacy manifests against
# (privacy-manifests.py); and a file moved into docs/, which --no-renames lists
# where it left too. docs-only.test.sh pins each one.
set -euo pipefail

changed=$(git diff --no-renames --name-only "$1"...HEAD)
# No change at all is one empty line here, which isn't under docs/.
if ! grep -qvE '^docs/' <<<"$changed" && ! grep -qxF docs/APP-STORE.md <<<"$changed"; then
  echo true
else
  echo false
fi
