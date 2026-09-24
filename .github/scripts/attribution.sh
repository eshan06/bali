#!/bin/bash
# The "No Claude attribution" check (.github/workflows/attribution.yml).
# CLAUDE.md bans Claude attribution outright; this fails a PR whose
# description, or any commit in BASE..HEAD, still carries it, and says what
# to remove and how.
#
#   PR_BODY="<description>" .github/scripts/attribution.sh <base> <head>
#
# Exit 0: clean. Exit 1: attribution found. Anything else: the check itself
# broke, which must never read as clean.
set -euo pipefail

BASE="$1"
HEAD="$2"

# Attribution forms, not the word: PR bodies here rightly say "Claude Review"
# and "Claude Opus", and prose may describe the footer, so the footer is
# matched in its markdown link form. Case-insensitive, one line at a time.
# attribution.test.sh pins what each one must and must not catch.
PATTERNS=(
  -e 'generated (by|with) \[claude code\]\(' # the footer the tools append
  -e 'claude\.ai/code/session_'              # a link to the Claude session
  -e 'claude\.com/claude-code'               # Claude Code's own link
  -e '^[[:space:]]*co-authored-by:.*\b(claude|anthropic)\b'
  -e '^[[:space:]]*claude-session:'
)
CLAUDE_IDENTITY='^(author|committer) (claude(\[bot\])? <|.*<noreply@anthropic\.com>$)'

# grep, except that only trouble (status 2) is an error; "no match" is not.
matches() {
  local rc=0
  grep "$@" || rc=$?
  [ "$rc" -le 1 ] || exit "$rc"
}

found=0

hits=$(printf '%s\n' "${PR_BODY:-}" | matches -niE "${PATTERNS[@]}")
if [ -n "$hits" ]; then
  found=1
  while IFS= read -r hit; do
    echo "::error::PR description, line ${hit%%:*}: ${hit#*:}"
  done <<<"$hits"
  echo "::error::Remove the line(s) above from the PR description (for the footer, the --- rule above it too): mcp__github__update_pull_request with the body minus them, or edit the description on GitHub. Saving it re-runs this check; no push needed."
fi

# The PR's own commits: a squash merge carries their trailers onto main and
# turns every commit author but the merger into a Co-authored-by line.
commits=$(git rev-list "$BASE..$HEAD")
bad=0
for sha in $commits; do
  short=$(git rev-parse --short "$sha")
  msg=$(git log -1 --format=%B "$sha" | matches -niE "${PATTERNS[@]}")
  who=$(git log -1 --format='author %an <%ae>%ncommitter %cn <%ce>' "$sha" |
    matches -iE -e "$CLAUDE_IDENTITY")
  if [ -n "$msg$who" ]; then
    bad=$((bad + 1))
    if [ -n "$msg" ]; then
      while IFS= read -r hit; do
        echo "::error::Commit $short, message line ${hit%%:*}: ${hit#*:}"
      done <<<"$msg"
    fi
    if [ -n "$who" ]; then
      while IFS= read -r hit; do
        echo "::error::Commit $short: $hit"
      done <<<"$who"
    fi
  fi
done
if [ "$bad" -gt 0 ]; then
  found=1
  echo "::error::Rewrite the branch without them: set the owner's git identity (CLAUDE.md, Working rules), then git reset --soft \"\$(git merge-base $BASE HEAD)\" && git commit -m \"<message without those lines>\" && git push --force-with-lease. The PR is squash-merged, so one clean commit loses nothing."
fi

if [ "$found" -eq 0 ]; then
  echo "No Claude attribution in the PR description or its $(wc -w <<<"$commits") commit(s)."
fi
exit "$found"
