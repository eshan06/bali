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

1. **Orient:** read `docs/ARCHITECTURE.md`, then `docs/PLAN.md`. Locate the
   task: already done? planned for a later phase? deliberately cut? For a new
   phase, its step list lives in PLAN.md / the agreed phase plans.
2. **Plan, then go — no approval gate:** for anything non-trivial, run
   `/plan` (ecc's planner, ported at `.claude/commands/plan.md`) to produce
   the plan — requirements restated, PR-sized steps, patterns to mirror,
   risks, a validation command per step. Its wait-for-confirmation gate is
   disabled in this repo: post the plan in chat for the record, then **start
   executing immediately**. Never block waiting for the owner to approve a
   plan. **Repeat steps 3–5 below for EACH PR-sized step — one step, one
   `/santa-loop` pass, one PR.** Message the owner only for: `/santa-loop`
   escalations, device checkpoints (anything needing a physical iPhone),
   genuine scope or architecture decisions the docs don't answer, and
   destructive/irreversible actions.
3. **Execute** step by step on a branch: code + tests together, fast checks
   locally as you go.
4. **Verify:** first the deterministic checks (`npm run typecheck && npm run
lint && npm test`, plus `npm run demo` when API behavior changed), then run
   `/santa-loop` (ecc's adversarial dual-review convergence loop — two
   independent reviewers, both must return NICE) until it converges. It pushes
   on NICE; if it escalates after 3 rounds, stop and show the owner.
5. **Ship:** push, open the PR, enable auto-merge (squash). Drive every check
   green — fix Claude Review findings and CI failures, never weaken a check.
   Green = it merges itself; report back when merged.
6. Confirm `docs/PLAN.md` reflects the new state (it should have ridden the PR).

## Working rules (CI enforces most of these)

- Code changes ship **with their tests in the same PR**. New endpoint →
  integration tests (happy path, authz, validation, idempotent replay). Bug
  fix → the failing regression test comes first. Engine change → PGlite tests
  plus real-Postgres race coverage where concurrency is involved.
- **New feature?** Check `docs/PLAN.md` first. Design against ARCHITECTURE.md.
  When done, add the feature to PLAN.md with a one-line architecture note; if
  it changed a real design decision, update ARCHITECTURE.md itself.
- **Before ending any session that changed source code, update `docs/PLAN.md`**
  (what landed, current status, what's next). The "Plan doc updated" CI check
  blocks source PRs that skip this; a genuinely trivial fix may carry
  `[no-plan]` in a commit message instead.
- Never commit secrets. `.env` stays local; real values live in Railway and
  GitHub Actions secrets.
- Work on a branch, open a PR to `main`, keep it green. `main` is protected —
  nobody pushes to it directly.
- **Enable auto-merge (squash) on every PR you open.** Green checks = merged;
  a PR never waits for a human unless the owner asked to review it or a check
  is red. Drive red checks to green — never by weakening a check.
- Commit style: `feat(api): …`, `fix(db): …`, `test(web): …`, `docs: …`.
- **No Claude attribution in commits** — no `Co-Authored-By`, no session
  trailers. Cloud sessions: before committing, set the repo-local git author
  to the owner's GitHub identity
  (`git config user.name "eshans" && git config user.email
"40549302+eshan06@users.noreply.github.com"`), or squash merges will
  re-add a Claude co-author line automatically.

## Commands

`npm ci` · `npm run typecheck` · `npm run lint` · `npm test` (PGlite — no
database server needed) · `npm run demo` (end-to-end in memory) ·
`npm run dev:api`
