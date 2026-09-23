# Gotchas — live traps of this repo's environment and process

Known traps that sessions kept rediscovering the hard way. Skim this before
touching infra, CI, git plumbing, or the dev environment.

**Rules for this file (they are what keep it useful):**

- **Live traps only, current truth only.** The PR that fixes a trap deletes
  its entry. History belongs in git, not here.
- **One entry per trap, a few lines each.** What bites, and what to do.
- **A note is the last resort.** A critical or recurring finding first becomes
  something that can't be skimmed past — a regression test, a CI check, or a
  CLAUDE.md rule. Only a trap that fits none of those (environment quirks,
  process mechanics) belongs here.

## Git / GitHub

- **Remote session branches auto-delete when their PR merges.** A later push
  to the same branch name then fails with `stale info` (force-with-lease) or
  surprises with `[new branch]`. Run `git fetch --prune origin` before
  re-pushing a session branch; `stale info` means your tracking ref is stale,
  not that someone else pushed.
- **Auto-merge can race your push.** If auto-merge fires while you're
  amending, your push lands on a deleted branch and recreates it with
  already-merged history. Rebuild: reset the branch onto the new `main`,
  cherry-pick only your new commit, `push --force-with-lease`, open a fresh
  PR.
- **Editing `.github/workflows/claude-review.yml` or `claude.yml` trips the
  action's tamper protection**: that PR's own Claude Review check is red by
  design and cannot be fixed by pushing. Merging it takes the owner's
  one-time ruleset toggle (remove the check from `protect-main`, merge,
  re-add it).
- **GitHub silently disables a PR's auto-merge when a required check fails.**
  After driving the check green, re-enable auto-merge — a green PR otherwise
  just sits there.
- **Dependabot-triggered workflow runs read the _Dependabot_ secrets store,
  not Actions secrets.** A secret needed in those runs must exist in both
  stores (`CLAUDE_CODE_OAUTH_TOKEN` does).

## Cloud sessions / dev environment

- **The cloud environment's network policy allowlists egress.** `*.railway.app`
  had to be added before any session could reach dev; a proxy 403 is an org
  policy denial to report to the owner, never to route around.
- **The environment's UI "setup script" field must stay empty.** It runs
  outside the repo root and kills every session at startup. Dependency
  install belongs to the repo's SessionStart hook
  (`.claude/hooks/session-start.sh`), which handles it.
- **Sessions on dev really expire.** The Railway cron POSTs `/internal/sweep`
  every minute (session expiry + silence detection). Timing-sensitive steps
  against dev must account for it. `/internal/sessions/expire` is a live
  alias of the same handler — nothing 404s.
