# Bali — rules for every Claude session

Bali: a teacher taps an NFC block, every student's iPhone locks into focus via
Screen Time shields until the bell. Teachers watch a live grid; Emergency Unlock
is always allowed and always recorded.

## Read first, in this order

1. `docs/ARCHITECTURE.md` — the design. It is law; changing a decision means
   discussing it with the owner first.
2. `docs/PLAN.md` — phases, go-live features, live status. Check it before
   building anything: is it already done, planned for a later phase, or
   deliberately cut?
3. `docs/GOTCHAS.md` — live traps of this environment and process (git
   plumbing, CI, cloud sessions, dev). Skim it so known traps aren't
   rediscovered the hard way.

Not on the list on purpose: `docs/DECISIONS.md`, the decision log — why
things are the way they are. Don't read it front to back. Search it for the
area you're touching before changing how something works, and add a dated
entry at the top when you make a real decision.

## Non-negotiable conventions

- **Only the transition engine (`packages/db/src/transitions.ts`) writes
  `participations` or `events`** — both tables in one transaction, always.
- **Every mutation carries a client-minted `event_id` (UUIDv7)** and is
  idempotent on it; a replay re-reads and returns the current truth.
- **Additive-only:** shipped `/v1` endpoints/fields and the vocab lists in
  `packages/shared` are never renamed or removed — old apps call forever.
- **The server owns the clock** — device timestamps are clamped into the
  session window (`clampToWindow`).
- **No silent failures** — every error path shows the user something honest,
  with a way to retry.
- **An emergency unlock record is never discarded** — the contract lives in
  `packages/shared/src/unlock-contract.ts`; no response may ever mean "delete".
- **No Claude attribution, ever, no matter what** — no `Co-Authored-By`, no
  session trailers, no Claude as git author. Owner's standing order. The
  how-to lives under Working rules.

## How to work — every task follows this loop

Applies to anything: a new phase, a new feature, a fix the owner asks for.

1. **Orient:** read `docs/ARCHITECTURE.md`, then `docs/PLAN.md`, and skim
   `docs/GOTCHAS.md` once per session (not per task). Locate the
   task: already done? planned for a later phase? deliberately cut? For a new
   phase, its step list lives in PLAN.md / the agreed phase plans.
2. **Plan, then go — no approval gate:** for anything non-trivial, run
   `/plan` (ecc's planner, ported at `.claude/commands/plan.md`) to produce
   the plan — requirements restated, PR-sized steps, patterns to mirror,
   risks, a validation command per step. A PR-sized step is **one change,
   under ~400 changed lines not counting tests**. Its wait-for-confirmation
   gate is disabled in this repo: post the plan in chat for the record, then
   **start executing immediately**. Never block waiting for the owner to
   approve a plan. **One step, one fresh worker, one PR:** the planning
   session hands each step to a new worker sub-agent, one at a time, and never
   writes code itself (the procedure is the last section of
   `.claude/commands/plan.md`). Steps 3–6 are the worker's job; a trivial
   task with no plan is done by the session itself. Message the
   owner only for: parked steps, device checkpoints (anything needing a
   physical iPhone), genuine scope or architecture decisions the docs don't
   answer, and destructive/irreversible actions.
3. **Execute** on a branch cut from the latest `origin/main`: code + tests
   together, fast checks locally as you go.
4. **Verify:** first the deterministic checks (`npm run typecheck && npm run
lint && npm test`, plus `npm run demo` when API behavior changed), then run
   `/santa-loop` — two independent reviewers. Docs-only changes skip it,
   except changes to the rules themselves; code gets up to 2 rounds, and
   round 2 checks only the fixes and any dismissals. Only proven
   problems block (the BLOCKER rules in `.github/workflows/claude-review.yml`);
   easy style notes get fixed in the same PR without another round. A step it
   can't settle is parked as a draft PR, and the planning session moves on.
5. **Ship:** push, open the PR, enable auto-merge (squash). Drive every check
   green — fix Claude Review BLOCKERs and CI failures, never weaken a check. A
   PASS with WARNs merges as is: pushing to fix a WARN restarts the review.
   Green = it merges itself; report back when merged.
6. Confirm `docs/PLAN.md` reflects the new state (it should have ridden the PR).

## Working rules (CI enforces most of these)

- Code changes ship **with their tests in the same PR**. New endpoint →
  integration tests (happy path, authz, validation, idempotent replay). Bug
  fix → the failing regression test comes first. Engine change → PGlite tests
  plus real-Postgres race coverage where concurrency is involved.
- **Ponytail (the account-wide minimalism/YAGNI plugin) governs
  implementation, never the gates.** Its minimalism shapes the code you
  write; the testing rules above, every CI check, validation at trust
  boundaries, error handling, and security are explicit requirements —
  YAGNI never trims them. No Ponytail on your account? The boundary still
  reads the same: minimize implementation, never the gates.
- **New feature?** Check `docs/PLAN.md` first. Design against ARCHITECTURE.md.
  When done, add the feature to PLAN.md with a one-line architecture note; if
  it changed a real design decision, update ARCHITECTURE.md itself.
- **Found a critical or recurring issue?** First make it impossible to hit
  again: a regression test, a CI check, or a rule in this file — in that
  order. Only a trap that fits none of those (environment quirks, process
  mechanics) goes into `docs/GOTCHAS.md`, one short entry, and the PR that
  fixes a trap deletes its entry. GOTCHAS holds live traps only.
- **Before ending any session that changed source code, update `docs/PLAN.md`**
  (what landed, current status, what's next). The "Plan doc updated" CI check
  blocks source PRs that skip this; a genuinely trivial fix may carry
  `[no-plan]` in a commit message instead.
- Never commit secrets. `.env` stays local; real values live in Railway and
  GitHub Actions secrets.
- Work on a branch, open a PR to `main`, keep it green. `main` is protected —
  nobody pushes to it directly.
- **Enable auto-merge (squash) on every PR you open** — except a parked
  step's draft PR. Green checks = merged; a PR never waits for a human unless
  the owner asked to review it, a check is red, or the step was parked.
  Drive red checks to green — never by weakening a check.
- verify against dev when applicable / the environment has the AWS + Railway access / prod is off-limits
- Commit style: `feat(api): …`, `fix(db): …`, `test(web): …`, `docs: …`.
- **No Claude attribution in commits or on GitHub** — no `Co-Authored-By`, no
  session trailers. Cloud sessions: before committing, set the repo-local git
  author to the owner's GitHub identity
  (`git config user.name "eshans" && git config user.email
"40549302+eshan06@users.noreply.github.com"`), or squash merges will
  re-add a Claude co-author line automatically. The GitHub MCP
  `create_pull_request` appends a "Generated by Claude Code" footer to the PR
  description: strip it right after creating the PR (`update_pull_request`
  with the body minus the footer), and never add one to a comment or review
  either. The "No Claude attribution" check fails the PR until it is gone.

## Commands

`npm ci` · `npm run typecheck` · `npm run lint` · `npm test` (PGlite — no
database server needed) · `npm run demo` (end-to-end in memory) ·
`npm run dev:api`

## graphify (optional local tooling)

graphify builds a local knowledge graph of this repo at `graphify-out/`
(gitignored — regenerable, never committed). The CLI arrives via the owner's
account plugin, not this repo; every rule below applies **only when the
`graphify` CLI is installed and `graphify-out/graph.json` exists** — with
neither, skip this section entirely and work normally.

- `docs/ARCHITECTURE.md` and `docs/PLAN.md` are law and always read from
  source — a derived graph, which is only as fresh as the last
  `graphify update .`, never answers for them.
- For codebase questions, first run `graphify query "<question>"`. Use
  `graphify path "<A>" "<B>"` for relationships and `graphify explain
"<concept>"` for focused concepts — a scoped subgraph beats raw grep output.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead
  of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or
  when query/path/explain do not surface enough.
- After modifying code, run `graphify update .` to keep the graph current
  (AST-only, no API cost).
- Enforcement hooks (`graphify hook-guard`) are personal opt-in config for
  `.claude/settings.local.json` (untracked) — never the shared
  `.claude/settings.json`, which must work in every environment and must not
  route tool inputs through third-party binaries.
