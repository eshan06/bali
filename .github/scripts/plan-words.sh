#!/bin/bash
# Fails when docs/PLAN.md, which every session reads first, passes its word cap.
# PLAN.md holds the current state only: a finished step's full notes go word for
# word to docs/PLAN-ARCHIVE.md, the why to docs/DECISIONS.md (DECISIONS, 2026-10-13).
#
#   .github/scripts/plan-words.sh [file] [cap]
set -euo pipefail

file=${1:-docs/PLAN.md}
cap=${2:-8000}
words=$(wc -w <"$file" | tr -d ' ')
echo "$file: $words words (the cap is $cap)"
if [ "$words" -gt "$cap" ]; then
  echo "::error file=$file::$file is $words words, over its $cap-word cap. It holds the current state only: move finished detail (a done step's full notes, past status lines) word for word to docs/PLAN-ARCHIVE.md, and the why to docs/DECISIONS.md."
  exit 1
fi
