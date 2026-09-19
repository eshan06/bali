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
- Commit style: `feat(api): …`, `fix(db): …`, `test(web): …`, `docs: …`.

## Commands

`npm ci` · `npm run typecheck` · `npm run lint` · `npm test` (PGlite — no
database server needed) · `npm run demo` (end-to-end in memory) ·
`npm run dev:api`
