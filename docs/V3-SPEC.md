# Bali v3 — rebuild spec

Status: **draft, pre-code.** Source-of-truth context doc for the v3 rebuild.

Branch layout: the full **v2** codebase lives on this branch, `v2-archive` (tag `v2-final`).
`main` is intentionally **empty** — v3 is being built there from scratch. This doc lives here
alongside the v2 audit it references so the context stays together without cluttering `main`.

---

## 1. What Bali is (as built in v2)

Bali is a classroom focus tool. A **teacher** starts a timed *focus session* for a class; each
**student** runs a native iOS app that uses Apple **Family Controls / Screen Time** to shield apps
on the phone for the session ("full focus" — everything shielded except a small, one-time student
allow-list). The teacher watches a **live grid** of per-student states and gets **reports** (focus
minutes, emergency unlocks). **Parents** can be given a read-only link to their child's status.

Surfaces:
- **Student iOS app** (Swift) — tap in, apply shields, heartbeat, emergency unlock, refocus.
- **Teacher app** — iOS (Swift) and a **web portal** (Next.js) — start/extend/end sessions, live grid, roster, reports, parent links.
- **iOS monitor extension** — enforces shields / reports device signals.
- **API** — Fastify + Postgres (Drizzle), SSE for the live grid.
- **Auth** — AWS Cognito via Amplify.

Distribution note: student app TestFlight is gated on the **Family Controls (Distribution)**
entitlement; the teacher app is not (`docs/TESTFLIGHT.md`).

## 2. Why we are rebuilding — the v2 lessons

v2 was vibe-coded and demos fine, but the 2026-09-09 audit (`docs/AUDIT-2026-09-09.md`, 19 confirmed
bugs incl. 1 critical) shows the failures cluster into a few **systemic** design faults. v3 fixes the
causes, not the instances:

1. **No single source of truth for "shields are actually on."** Local UI state was used as a proxy for
   enforcement, so the phone could show "focused" (teacher grid green) while nothing was shielded (the
   critical bug). → v3: enforcement state is *reconciled against the real device signal every
   heartbeat*, never inferred from UI state.

2. **Client-controlled data trusted by the server.** Client timestamps trusted into the past
   (backdated unlocks vanish from reports; backdated tap-ins inflate focus minutes); rate limit keyed
   by a caller-chosen header (trivially bypassable, a DoS vector). → v3: **server authoritative for
   time and identity**; client timestamps clamped to `[session.startedAt, now]`; rate limits keyed by
   verified identity then IP.

3. **Inconsistent lifecycle / state across surfaces.** Same student shown "focused" to themselves and
   "no device" to the teacher; removed-mid-session students stay shielded but can't record their exit
   (403); `no_device` never cleared on a real tap-in. → v3: **one state machine**, one derivation
   function shared by every surface; membership/participation/pass transitions atomic and total.

4. **Realtime that silently drops events.** SSE events held in a single slot — two simultaneous
   emergency unlocks collapsed to one, so the alerting surface missed an alert. → v3: realtime is a
   **durable ordered per-subscriber log**, at-least-once with client de-dupe by event id.

5. **Swallowed failures presented as success.** "Revoke link" that fails still closes as if it worked
   (live link the teacher thinks is dead); a transient `/me` blip signs the teacher out into a login
   that rejects their correct password. → v3: **failures surfaced, never swallowed**; distinguish "no
   session" from "couldn't reach server"; destructive actions confirm effect before claiming success.

6. **UI that promises what the code doesn't do.** Inert divs styled as dropdowns; allow-list category
   picks silently dropped so a category-only selection shields everything. → v3: **no dead
   affordances**; selection logic handles every token type (apps, categories, web domains).

## 3. v3 goals and non-goals

**Primary goal:** correct, honest behavior under real concurrency (many classes × many students live
at once), with an architecture that makes v2-class bugs structurally hard to reintroduce.

Goals:
- Correctness/honesty first — no surface claims a state it can't back up.
- Scale: many concurrent live sessions × students heartbeating, clear path to horizontal scaling
  (stateless API, realtime that survives multiple instances / restarts).
- Testability: state machine, time handling, lifecycle are pure/unit-testable; integration tests that
  actually run (v2's API suite self-skipped without a DB and proved nothing).
- One shared domain model reused across API, web, and (where practical) iOS.

Non-goals (for now): new product features; multi-region scale (design so it's possible, don't build it).

## 4. Target architecture (proposed — decisions in §6)

- **Monorepo:** `apps/api`, `apps/web`, `packages/shared` (domain + state machine + types, imported by
  API and web), `ios/` (native).
- **API:** stateless HTTP + realtime; all session/enforcement truth in Postgres; no in-process state
  that can't be rebuilt from the DB, so any instance serves any request.
- **Realtime:** off single-slot SSE. Per-subscriber ordered event log (DB-backed, or Redis stream)
  delivered at-least-once with a cursor; client de-dupes by event id. Correct across restarts and
  multiple API instances.
- **State machine:** one pure module in `packages/shared` — (participation row, device signals,
  timestamps) → derived state — used verbatim by every surface, exhaustive over all states (no
  `default: break` that swallows `revoked`).
- **Time:** server clock authoritative; client timestamps accepted only for offline replay, always
  clamped to the session window.
- **Idempotency:** every mutating student action carries a client event id; server dedupes so retries
  / offline replay can't double-count.
- **Auth:** keep Cognito (config already provisioned); rate limit by verified `sub`, fall back to IP.
- **iOS:** enforcement (Family Controls) is the source of truth for "shielded"; app reconciles to the
  server every heartbeat and renders only states it can prove; handles every server state explicitly.

## 5. Concurrency / scale plan (the explicit ask)

Load shape: N live sessions, ~30 students each, heartbeating ~every 30s plus tap-in / unlock bursts;
teachers each holding one live-grid stream.

- **Stateless API instances** behind a load balancer; all state in Postgres → scale out by adding
  instances.
- **Heartbeat write path** cheap and idempotent; batch/debounce non-critical writes (`lastSeenAt`).
- **Live grid** reads the persisted event log with a cursor, so a reconnecting teacher or a restarted
  API instance loses nothing and duplicates nothing.
- **DB** is the bottleneck to watch: index hot paths (participants by session, event log by session +
  cursor), pool sized to instance count, avoid v2's per-request fan-out (the public parent route ran
  ~10 queries unauthenticated).
- **Load test** the heartbeat + live-grid path as a first-class deliverable.

## 6. Open decisions to lock before scaffolding

1. **Realtime transport:** DB-backed event log + SSE cursor (fewer moving parts) vs. Redis Streams /
   pub-sub (scales cleaner across instances, adds infra). Recommend starting DB-backed with the
   interface abstracted so Redis can slot in later.
2. **Hosting / deploy target** for API + DB (affects pooling and scale approach).
3. **iOS scope:** rebuild both student and teacher iOS apps, or student first + web-only teacher for
   v3 and port teacher iOS later?
4. **Keep Fastify + Drizzle + Next.js** or reconsider any layer? (Recommend keeping — v2's problems
   were design, not framework.)

## 7. Build phasing (proposed)

1. `packages/shared`: domain types + the one state machine + time/clamp helpers, fully unit-tested.
2. `apps/api`: schema + migrations, auth, session lifecycle, heartbeat, event log, live stream — with
   integration tests that actually run against a real Postgres.
3. `apps/web`: teacher portal on the new API (live grid off the event log, honest error handling).
4. `ios/`: student app (enforcement-authoritative), then teacher app.
5. Load test + hardening.
