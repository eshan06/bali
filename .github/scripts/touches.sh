#!/bin/bash
# Whether a PR touches the paths a job watches, for ios.yml's "iOS changes" and
# load-gate.yml's "Load gate changes": any file it changes from <base> to HEAD
# matches <pattern>, an extended regex. Prints true or false. A diff that fails,
# or a pattern grep refuses, fails the script, never an answer, so no job is
# skipped on a guess.
#
#   .github/scripts/touches.sh <base> <pattern>
#
# A moved file counts where it left as well as where it went: --no-renames
# lists both paths, where git's rename detection lists only the new one, so a
# file moved out of ios/ read as no iOS change and skipped the build.
# touches.test.sh pins each case.
set -euo pipefail

changed=$(git diff --no-renames --name-only "$1"...HEAD)
found=0
grep -qE -- "$2" <<<"$changed" || found=$?
# grep's 1 is no match; anything else is an error, never a false.
case $found in
  0) echo true ;;
  1) echo false ;;
  *) exit "$found" ;;
esac
