#!/bin/bash
# Self-test for plan-words.sh: a file at its cap passes, one word over fails and
# says where the detail goes, and a missing file fails. CI runs it before the
# real check, so a check that stops counting fails instead of passing.
#
#   .github/scripts/plan-words.test.sh
set -euo pipefail

CHECK="$(cd "$(dirname "$0")" && pwd)/plan-words.sh"
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
failures=0

# words <n>: n words over several lines, as a Markdown file has them.
words() {
  for ((i = 1; i <= $1; i++)); do
    printf 'word '
    if ((i % 12 == 0)); then printf '\n'; fi
  done
  printf '\n'
}

# expect <pass|fail> <case> <file> [cap]
expect() {
  if "$CHECK" "${@:3}" >"$DIR/out" 2>&1; then got=pass; else got=fail; fi
  if [ "$got" != "$1" ]; then
    echo "FAIL: $2: expected $1, got $got"
    failures=$((failures + 1))
  fi
}

words 8000 >"$DIR/at-cap.md"
words 8001 >"$DIR/over-cap.md"
: >"$DIR/empty.md"

expect pass 'at the default cap' "$DIR/at-cap.md"
expect fail 'one word over the default cap' "$DIR/over-cap.md"
expect pass 'an empty file' "$DIR/empty.md"
expect pass 'under a cap given' "$DIR/at-cap.md" 8001
expect fail 'over a cap given' "$DIR/at-cap.md" 7999
expect fail 'no file' "$DIR/missing.md"

"$CHECK" "$DIR/over-cap.md" >"$DIR/out" 2>&1 || true
for where in docs/PLAN-ARCHIVE.md docs/DECISIONS.md; do
  if ! grep -q "^::error .*$where" "$DIR/out"; then
    echo "FAIL: the error over the cap doesn't name $where"
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then exit 1; fi
echo "plan-words.sh: all cases pass"
