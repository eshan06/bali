# Bali v3 — build plan & live status

The one file every session reads (after ARCHITECTURE.md) and updates when it
finishes work. ARCHITECTURE.md says *how*; this file says *what* and *where we
are*. Update rules are at the bottom.

_Last updated: 2026-09-22 — **Phase 2 is complete: the exit demo ran green against Railway dev.** Retroactive audit of the pre-gates Phase 1/2 code: nine findings confirmed, landing as gated PRs; offset timestamps and the SSE write-after-end crash are on `main`._

## Now

- **Phase 2 is merged to `main`** (steps 1–8) — the walking skeleton is complete: session lifecycle over HTTP, events feed + SSE live grid, teacher portal, phone simulator.
- **Dev runs Phase 2** (2026-09-20): Railway auto-deploy repaired (the Railway
  GitHub App was never installed — it is now), environment renamed `dev`, and
  the sweep cron created: it POSTs `/internal/sweep` every minute and returns
  healthy. (The earlier "repoint the cron" note is settled; the Phase 1 path is
  kept as an alias, nothing 404s.)
- **Owner actions from the Phase 2 merge: done** — "Integration + race tests
  (real Postgres)" is now a required check, and the Claude workflows bill the
  owner's subscription (see decision log).
- **Phase 2 exit demo: PASSED against dev** (2026-09-22) — every incident green
  against the deployed API with real Cognito: tap → session, unlock **delivered
  live on the SSE stream**, refocus, one real 90-second silence episode and one
  `came_back`, a removed student's unlock still **recorded**, and a session that
  **expired by itself at the bell**. The waits were real, not backdated. This run
  carried the sweep key, so its own `/internal/sweep` call opened the episode and
  expired the session; without the key the per-minute cron does the identical
  job, which is why the demo asserts on the event and not the caller. Re-run it
  via the README, "Running it against a deployed API".
- **Dev provisioning it needed** (one-time, owner-run): a `schools` row plus
  `school_id` on the test teacher — see the teacher-gating row under Go-live.
  Two things to know next time: a session cannot run this itself (dev Postgres
  exposes only `postgres.railway.internal`, and reaching it means publishing the
  database through Railway's TCP proxy), and `schools.id` has no DB default, so
  raw SQL must supply a UUIDv7 (ids are minted in TypeScript, decision 2). The
  demo now prints that statement with a freshly minted id, ready to paste — and
  the tests now **execute** the printed recipe against a migrated database
  instead of string-matching it, since the missing-`id` bug read perfectly and
  only failed at the database. The `UPDATE` half also refuses to run when there
  is no live school (`AND EXISTS`), so pasting only the second statement reports
  `UPDATE 0` rather than setting `school_id` NULL and looking like success.
- **Exit-demo follow-ups from #15's review (done):** the sign-in's redaction now
  scrubs enumerable own properties, not just messages (inspecting an error
  prints them, so a client hanging the request body off it leaked through a path
  no message-only scrub reached), and both the redaction and the detail walk
  follow `AggregateError.errors` as well as `cause` — a host whose addresses all
  refuse arrives as an AggregateError with an empty message, so the operator was
  getting "fetch failed" and nothing else.
- **Exit-demo follow-ups from #14's review (done):** Ben's own check-in closes
  his silence episode with no pump running, so the incident proves his return
  did it rather than "some check-in did"; a fetch failure reports its cause
  chain, because Node reports every network error as a bare `fetch failed` and
  puts ENOTFOUND on `cause`; that detail is redacted so a client echoing the
  request body could not leak `DEMO_PASSWORD`; and a non-JSON body names the
  status that actually came back.
- **Exit-demo follow-ups from #13's review (done):** the second heartbeat stretch
  now includes Ben, so a slow remote run cannot fabricate a second silence
  episode and blame the engine for a simulation artefact; a Cognito failure that
  is not a timeout no longer reports one (a mistyped region fails DNS instantly);
  and a 200 that is not JSON names the request that produced it.
- **Also needed per environment (AWS, one-time):** test users with **permanent**
  passwords (a temporary one parks the account in `NEW_PASSWORD_REQUIRED`) and
  `ALLOW_USER_PASSWORD_AUTH` on the app client. The demo names whichever is
  missing; the README lists them with the school step.
- **Retroactive audit of the pre-gates code: run** (2026-09-20). Ten leads
  reviewed against `apps/` + `packages/`; nine reproduced and are landing as
  small gated PRs, one PR per finding or related pair: offset timestamps
  (**landed**), an SSE write-after-end that kills the API process (**landed**),
  a replayed tap re-resolved to another session (**landed**), extend's
  arithmetic outside the engine transaction (**landed**), the armTap insert
  race and its event-id integrity gap (**landed**), the portal's reconnect
  backoff, the portal's staleness banner, and one shared SQLSTATE helper.
  Block re-registration by the tag's own teacher is fixed but **held for the
  owner** — the fix answers 200 where `/v1` answers 409 today, and decision 2
  sends behaviour changes to `/v2`. The tenth, `POST /v1/classes`'s missing
  idempotency key, was re-examined and the deferral stands.
- **Found while fixing the audit, for the owner to rule on — one decision, and
  the bug that makes it urgent.**
  (1) **A tap that landed but is no longer current has no honest `200`.**
  `TapResponse` carries `{id, classId, endsAt}` with no way to say "over" or
  "you have left it", and a session the teacher ended early keeps its original
  `endsAt` — so replaying one would point a phone at a window that has not
  closed. A foregrounded app heals inside one ~30s check-in (it answers
  `gone`), but enforcement deliberately does not need the network, so a
  backgrounded phone stays shielded to the stale window. The engine therefore
  refuses, in **three** different vocabularies depending on shape, all of them
  409 and all "keep the record, retry, and surface": `EVENT_ID_CONFLICT` when
  the retry re-resolved to another session, `NOT_PARTICIPATING` when it
  resolved back to the session that recorded it but the student has left or
  been removed, and `SESSION_NOT_RUNNING` when that session has itself ended.
  Honest, but none of them is final: that outbox record retries forever.
  Candidates: an `ended` flag on `SessionView` (additive), or one code the
  outbox may clear on.
  (2) **What makes (1) urgent, and it is pre-existing on `main`.**
  `convertArmedTaps` inserts the armed tap's `event_id` as a `tap_in`, but
  `armTap` de-dupes only against `armed_taps.event_id`, never against
  `events`. So a retry that finds nothing running arms an already-spent id,
  and the teacher's next Start aborts with `EVENT_ID_CONFLICT` inside
  `startSession`'s transaction — creating no session. `convertArmedTaps`
  selects waiting taps by **teacher**, not by class, so this blocks every
  class of that teacher the student is enrolled in, until the armed tap
  expires at end of day. Reproduced end to end on `main` and on the audit
  branches. Every refusal in (1) is a feeder into it, which is why the
  contract decision is not cosmetic.
- **Next up:** finish the audit series → **start Phase 3 (iOS student app)** —
  10 steps, plan already agreed with the owner. Phase 0's open question gates
  step 5: confirm the DeviceActivity extension fires at interval END with the
  app force-quit.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 | iOS enforcement spike | ✅ NFC → shields <1s proven on device. ⚠️ Still to confirm before Phase 3 step 5: DeviceActivity extension fires at interval END with the app force-quit. |
| 1 | The spine: monorepo, CI, schema + constraints, transition engine, Cognito auth, `/v1/me`, `/v1/taps`, session start, armed taps, Railway dev deploy | ✅ on `main` |
| 2 | Walking skeleton: real-Postgres CI lane + race tests, unlock recorded-with-a-note contract, enrollments, classes/blocks, session lifecycle + silence events, events feed + SSE (LISTEN/NOTIFY), teacher portal + live grid, phone simulator | ✅ **complete** — merged to `main` and the exit demo passed against dev (2026-09-22) |
| 3 | iOS student app: BaliCore (contract fixtures TS↔Swift), GRDB outbox + sync engine, enforcement (shields + DeviceActivity extension), Cognito PKCE auth, screens, device test gate (ISSUES #2 on hardware) | ⬜ next — 10 steps, plan agreed with owner |
| 4 | Reports + recap, rate limiting (ISSUES #1 per-account budgets), school-behind-one-IP load gate (k6), OpenAPI snapshot check | ⬜ |
| 5 | Pilot readiness: prod environment, monitoring/Sentry, backup restore drill, Vercel flip (portal + marketing), TestFlight, App Store submission, teacher invite gating docs | ⬜ |

## Go-live features

### In scope for launch (phase noted)

| Feature | Phase | Notes |
|---|---|---|
| Core loop: tap→shield offline, armed taps, live grid, unlock always-recorded, refocus, join codes, roster, removal, self-expiry | 1–2 | ✅ built |
| 30s check-in that verifies shields before claiming them | 3 | rule 3 |
| Shields survive force-quit; bell frees phone via extension | 3 | pending spike confirmation |
| Onboarding: privacy contract → sign-in → Screen Time grant → allow-list | 3 | |
| Consent preview before joining a class | 3 | small |
| Unlock with optional, skippable reason (bathroom/nurse/other) | 3 | replaces full "passes" at launch |
| Custom shield screen ("Focused with Bali until 9:42") | 3 | bundle ID in entitlement request |
| Minimal student personal history + edit own name | 3 | backs the privacy contract |
| Sign in with Apple (App Review guideline 4.8) | 5 | Cognito IdP |
| End-of-session recap card (portal) | 4 | |
| Reports: class focus minutes + unlock list; aggregates only, never rankings | 4 | |
| Teacher signup gating (invite code) | 4 | today: manual role flip **and school assignment** — nothing assigns `users.school_id`, and `classes.school_id` is NOT NULL |
| Block provisioning: pre-written tags + portal register-by-ID fallback | 5 | no teacher iOS app at launch |
| Privacy policy, terms, pilot agreement, support/FAQ page | 5 | policy work, launch-blocking |

### Out at launch (fast-follow order)

Passes as a real state → QR join → teacher push notification on unlock →
lock-screen Live Activity → teacher iOS app → auto-start at bell / bell
schedules → weekly summary email → admin portal / multi-school self-serve →
substitute-day link → parent links (cut in v3) → solo focus → VPN enforcement
layer → roster import (CSV / Google Classroom).

### Open product decisions (owner to confirm; lean in parentheses)

1. Bathroom breaks: unlock-with-reason at launch vs real passes (lean: reasons).
2. Custom shield screen in launch scope (lean: in).
3. Minimal student history in launch scope (lean: in).
4. Under-13: pilot with 13+ classes only at launch (lean: yes).
5. Recap card in Phase 4 (lean: yes).

Parked by design, blocking before real students: data-deletion policy,
under-13 parental-consent machinery.

## External / waiting

- **Family Controls distribution entitlement** (Apple) — applied for; blocks
  TestFlight/App Store, not development builds. Bundle IDs incl. monitor
  extension (and shield-UI extension) should be in the request.
- Apple checklist: bundle IDs registered, App Store Connect record created.

## Decision log

- **2026-09-22** — Two engine idempotency holes, both from the same habit of
  deciding something outside the transaction that only holds inside it.
  A retried tap was answered with `EVENT_ID_CONFLICT` whenever the server
  re-resolved it elsewhere. The phone mints one id per physical tap and retries
  until answered, but `resolveTapTarget` picks the newest running session **of
  the tapped block's teacher** that the student is enrolled in — so a retry
  after that teacher started a second session the student is also in resolved
  somewhere new, `insertEvent` saw the id against a different session, and
  refused. Backwards: the tap landed, so rule 4 says re-read and return what
  was recorded. `tapIn` now does. The conflict check is untouched for an id
  reused for a genuinely different event, which is what the unlock path
  depends on (ISSUES #2) and which keeps its own test — but on the tap path
  something IS given up, because the server cannot tell a retry from a
  deliberate reuse: an app resending a spent id for a second physical tap into
  another session is now answered as a replay and that join is suppressed. No
  privilege comes with it (the same student can simply not tap, and the grid
  shows them absent either way).
  The replay is **bounded to what is still true** — the recorded participation
  is still live, in a session still running — and that bound is the whole
  safety of it, because `TapResponse` cannot say "that one is over" or "you
  have left it", so a stale answer here is a shield rather than a small
  inaccuracy. Replaying an **ended** session points the phone at a window that
  has not closed (a teacher who ends early leaves the original `endsAt`
  behind): a foregrounded app heals inside one ~30s check-in, but enforcement
  deliberately does not need the network, so a backgrounded phone stays locked
  to a bell that already rang, in a grid no teacher is watching and no unlock
  can reach.
  Replaying a participation the student **left** — they tapped into the
  teacher's other session for real — would point the phone at the session it
  left while the grid shows them in the one they are in; its next check-in
  there answers `gone` and unshields. Both are worse than the 409 they
  replaced, and both now decline. A retry that resolves back to the session
  that recorded it, with the student's row since ended, declines through the
  `!isNew` path below the branch as `NOT_PARTICIPATING` — not a conflict, the
  id names this very tap; what stopped being true is the participation. The lookup itself sits **ahead** of the
  ended-session guard, the placement `extendSession` uses: `resolveTapTarget`
  filters on `ended_at IS NULL` outside the transaction, so the session it
  picks can end before the engine's locked read, and a tap that did land must
  still replay against the running session that recorded it rather than 409.
  `extendSession` now takes minutes instead of an absolute end. The route read
  the session, did the arithmetic and handed over a fixed time, so two
  simultaneous "add time" presses computed the same target from the same
  starting point: the loser's value was no longer later than the winner's, the
  engine refused it as `INVALID_EXTENSION`, and the teacher's second press
  bought no time — a 400 saying the new end was not later than the current one,
  true of the value the route computed and useless to a teacher who had just
  pressed "add 10 minutes". The arithmetic moved inside the locked read, so
  each press adds to whatever it finds. Nothing calls the endpoint yet (no
  extend control in the portal), so this was caught before it could bite. `INVALID_EXTENSION` is kept and still
  refuses a non-positive, non-finite, or out-of-Date-range duration — the
  engine does not trust its caller. 1e15 minutes used to overflow into an
  Invalid Date and a bare `RangeError`; the route's zod cap
  (`int().positive().max(480)`) means no `/v1` caller could reach it, so this
  is defence-in-depth for a direct engine caller rather than a live 500. Its client-facing message no longer
  claims the end time was not moved forward, which the duration rewrite made
  false. The real-Postgres lane now covers two concurrent extends both landing.
- **2026-09-22** — Three defects in `armTap`, two of them the same shape: a
  read-then-write where the database could have arbitrated.
  (1) `armTap`'s insert had no `ON CONFLICT`, so two pre-bell taps from one
  phone both passed the selects and the loser surfaced a raw 23505 as a 500 to
  a student walking to their seat. It now lets the waiting-tap index arbitrate
  and reads the winner's tap back, the way `insertEvent` does. The insert and
  its re-read are bounded-retried rather than throwing: `ON CONFLICT DO
  NOTHING` takes no lock on the row it conflicted with, so a Start can consume
  that row in between and leave neither a row nor a standing tap — throwing
  there would have been the same 500 on the same path.
  (2) A consumed armed tap could end up naming an event no `tap_in` ever
  recorded — the transient table and the permanent history disagreeing about
  which tap was converted. Two interleavings, both closed: the refresh guarded
  on `consumed_at IS NULL` (for a conversion that commits before the update),
  and `convertArmedTaps` taking `FOR UPDATE` on the taps it reads (for a
  refresh landing inside its read→consume gap, where the guard sees NULL and
  passes). The second was reproducing 6/6 with only the guard in place.
  Accepted residual, unchanged by either: a student whose tap is consumed
  under them keeps a fresh waiting tap, so the teacher's next session that day
  converts them without another tap. Decision 5 says a tap is a tap, and
  end-of-day expiry bounds it.
  The third finding in this pair, `createBlock` answering `tag_taken` to the
  teacher who already owns the tag, is **split out and waiting on the owner**:
  fixing it means `POST /v1/blocks` answering 200 where it answers 409 today,
  and ARCHITECTURE.md decision 2 sends behaviour changes on a shipped endpoint
  to `/v2`. Nothing would be renamed or removed and `BlockDetail` is
  unchanged, and no client can break today (the portal never calls it, the
  only caller in the tree is the demo script, and there is no iOS app yet) —
  but that is the owner's call, not a code-review one, so the rest ships
  without it rather than waiting.
  Race coverage runs on the real-Postgres lane only — PGlite is
  single-connection and cannot contend, so the fast lane would pass either
  way. The warm-up in the race suite is load-bearing for round 0: with a fix
  reverted and a cold pool, the first round passes vacuously.
- **2026-09-22** — Follow-ups from #18's review, and a claim of mine that a
  reviewer disproved. The stream route's `'error'` listener logged at `debug`
  while production runs at `info`, so the fix that stopped the crash would also
  have hidden anything unexpected that reached it; it now logs the one code
  that actually arrives (`ERR_STREAM_WRITE_AFTER_END`) at `debug` and anything
  else at `warn`. Measured while correcting a wrong rationale: a peer reset
  reaches the socket and the server's `'clientError'`, never a hijacked
  response, and a write after destroy is routed to the write callback rather
  than emitted — so `warn` here means "we have never seen this", not "a proxy
  is resetting connections". The `streamFailed` disjunct after `subscribe` is
  removed: nothing between the hijack and that check is asynchronous, so it had
  never fired (a reviewer instrumented it across the whole suite on both lanes
  to confirm).
  I had also recorded that two of the route's guards could not be pinned by a
  test, having written three that all passed against the broken version. That
  was wrong, and the counterexample was one entry above it in this same file:
  under backpressure `'finish'` never fires, so the request's `'close'` never
  arrives, the subscription stays live, and the hub's next read hands a frame
  to a write on an ended response. The technique is to **stall the flush** —
  a client that never reads holds the window open — and with it the guard is
  observably load-bearing: softened to a silent `return`, the per-teacher slot
  leaks and the teacher sits permanently at their cap. That test now ships.
  Its reach is exact and worth knowing: softening the guard turns it red, but
  deleting the guard outright leaves the suite green, because the route's own
  'error' listener then releases the slot a tick later. The guard is the
  synchronous path; the listener is the net. That is written above the guard
  so a green run is not read as permission to remove it.
  The reusable lesson is not "this cannot be tested" but "the obvious
  end-to-end reproduction is rescued by another guard; hold the window open
  yourself".

- **2026-09-22** — The live grid's crash-safety was borrowed; the stream route
  now owns it. A write after `end()` on the hijacked SSE response does not
  throw — it returns false and emits `'error'` a tick later, so the hub's
  try/catch never sees it, and an `'error'` with no listener is an
  uncaughtException. Fastify does attach one, but only under
  `hasLogger || onResponse hook || handlerTimeout` (`lib/route.js`), and it
  removes itself from both `'finish'` and `'error'` the first time either fires
  (`lib/reply.js`). Measured on the running route with the app exactly as it
  ships: a late write in the same tick, on a microtask, or **resuming from an
  awaited `getEventsSince`** all die with an uncaught
  `ERR_STREAM_WRITE_AFTER_END`; only a backpressured write survives, because
  `'finish'` cannot fire while data is queued so the borrowed listener is still
  there. The `getEventsSince` case is the hub's own path — a teacher closing a
  tab while a read is in flight killed the API process and every other class's
  grid with it. Two changes: the route installs an `'error'` listener it never
  removes (verified: borrowed → crash, own → survives), and the hub stops
  handing over the rest of a page to a subscriber it has already torn down.
  The audit reported this as a crash and it was twice written off as
  theoretical here; it was real, and the lesson is that a probe which attaches
  its own listener can only ever observe the emission, never the crash.
- **2026-09-20** — Retroactive audit of the pre-gates Phase 1/2 code: ten leads
  checked against the code, nine reproduced and are being fixed as a series of
  gated PRs (status in **Now**; this entry records what the audit decided, not
  work already on `main`). Four of the nine are idempotency or race holes on
  paths whose *happy* case was already tested — the shape of what the gates
  miss, and the argument for keeping the real-Postgres lane required.
  `POST /v1/classes`'s missing idempotency key (below) was the one lead
  rejected: re-examined and deliberately left as it stands.
- **2026-09-20** — The offset-timestamp fix closes a spelling, not a class. Any
  4xx on an unlock body still means the outbox keeps the record and retries
  forever — a malformed `eventId` would do it too. That is the contract working
  as written (`retry_and_surface` also requires the client to *surface* it, so
  it is never silent), and the exposure it leaves is a server that refuses a
  well-formed client. Removing that for timestamps is the fix; the general
  guard — never let validation be the reason an unlock is unrecordable — is a
  standing constraint on anything added to the unlock body.
- **2026-09-20** — The exit demo runs in two worlds behind one seam
  (`apps/api/scripts/demo/world.ts`): in-process (default — server, Postgres and
  issuer all local, time compressed by backdating rows) and remote
  (`DEMO_API_URL` — a deployed API with real Cognito sign-ins). Remote mode does
  **not** get a database handle, and deliberately: with no way to backdate, the
  silence and expiry incidents wait out the real threshold and the deployment's
  own cron, which is what makes a dev run evidence about the deployment rather
  than about the script. The other phones keep heartbeating through those waits,
  so "Ben went quiet" stays about Ben. Cost: a remote run takes minutes where a
  local one takes seconds; `npm run demo` is unchanged and still needs nothing.
- **2026-09-20** — The demo now asserts two guarantees it previously only
  implied: that events reach the teacher's grid **live over SSE** (the stream is
  opened before the incidents, and every event written afterwards must arrive on
  it), and that a session **expires by itself** — the sweep ends it, the grid
  learns live, participations close, and the phone reconciles on its next
  check-in. Both were named Phase 2 exit criteria with no assertion behind them.
- **2026-09-20** — Web sessions install dependencies via a repo-tracked
  SessionStart hook (`.claude/hooks/session-start.sh`), not the cloud
  environment's setup-script field (it ran outside the repo root and broke
  every web session at startup; the field stays empty). Tracked hook means
  checking out a branch runs that branch's hook — accepted for a
  single-owner repo; revisit before adding outside contributors. The hook's
  drift guard deliberately tolerates a session's own uncommitted dependency
  work: it hashes the lockfile immediately before and after its own install and
  compares those two, rather than comparing against the git index, so only what
  that install changed counts as drift. Both the hash and an install run on
  every web SessionStart (`npm ci` on a fresh container, `npm install` on a cached
  one); CI's `npm ci` remains the backstop that catches a lockfile genuinely
  out of step with the manifests.
- **2026-09-20** — CI reviewer billing: Claude Review and `@claude` authenticate
  with the owner's Max subscription (`CLAUDE_CODE_OAUTH_TOKEN`), replacing
  prepaid API credits; reviewer model unchanged. The token also lives in the
  Dependabot secrets store, since GitHub withholds Actions secrets from
  Dependabot-triggered workflows.
- **2026-09-20** — Dependabot policy: alerts and security PRs stay on. The plan
  backstop exempts Dependabot's manifest-only PRs (author and content both
  checked); patch/minor bumps get auto-merge armed
  automatically (merge still requires every required check green); majors are
  handled deliberately by a session. First case: postcss's high-severity alert
  is fixed by a root npm override to `^8.5.23` instead of riding Dependabot's
  Next 15→16 major (#8); the override retires when Next 16 lands as its own
  task.
- **2026-09-20** — `last_seen_at` is stamped with the server's clock, not the
  device's clamped timestamp. The clamp orders events; liveness is an
  observation the server makes. Keying silence off the device's claim let a
  phone with a fast clock pin `last_seen_at` to `ends_at` and stay green for the
  rest of the lesson (rule 3's v2 bug), and a slow one flap the episode open and
  shut against decision 7's "exactly once".
- **2026-09-20** — An `event_id` identifies one event, checked at `insertEvent`.
  Reusing an id for a *different* event is a client bug, not a replay: treating
  it as one silently dropped the write, and on the unlock path 'replay' is a
  recorded outcome, so the phone would delete a record the server never stored —
  v2's lost-unlock bug through a different door. It is now `EVENT_ID_CONFLICT` →
  409, which the unlock contract reads as "keep the record, retry, surface".
- **2026-09-20** — Emergency unlock gets the one authorization check the rule
  allows. `POST /v1/sessions/:id/unlock` previously accepted any valid token for
  any session id, so a stranger could write permanent rows into another
  teacher's history and live grid. A refusal is still forbidden (the phone would
  read it as "discard"), so a caller with no participation row in the session
  *and* no active enrollment in its class now records as an orphan
  (`recorded_as: 'not_enrolled'`, no session/class attached, the claimed id in
  the payload) — durable, but unattached. A student removed mid-session keeps
  their ended participation row, so ISSUES #2's actual case is unchanged.
- **2026-09-20** — `extendSession`'s idempotency key is checked ahead of the
  ended-session guard and scoped to this session's own `session_extended` rows.
  An id already spent on a different event is now a 409 rather than a reported
  "extended" for a write that never happened: `insertEvent` de-dupes on
  `event_id`, so carrying on would have moved the end time with no matching
  event row — the session and its history disagreeing.
- **2026-09-20** — `POST /v1/classes` ships without an idempotency key: a lost
  response that the client retries leaves two identically named classes with
  different join codes. Accepted for now because it is visible and correctable
  by the teacher, and because classes do not pass through the event log, so the
  fix needs its own mechanism rather than an `event_id`. Tracked here; it lands
  with the portal work that actually calls it.
- **2026-09-20** — Portal auth ships access-token-only for the Phase 2 skeleton:
  no refresh token is requested or stored, so a teacher is signed out when the
  ~1h Cognito access token expires. Deliberate for the walking skeleton and
  written down rather than silently omitted; token renewal lands with the real
  portal UI (ARCHITECTURE.md auth decision 2 assumes it).
- **2026-09-20** — Bali Design System created at [Bali Design System](https://claude.ai/artifact/UPEBLz6nAmGXrzYnQ75qVz)
  (tokens, brand book, reference screens); UI work designs against it.
- **2026-09-19** — Plan-then-go (no plan-approval gate) and no-Claude-attribution
  adopted as standing rules; ecc `/plan` and `/santa-loop` ported as the loop's
  planner and verifier.
- **2026-09-19** — Quality gates: `main` protected (PRs only, no human-approval
  requirement while the team is 1), Claude Review is a required blocking check
  (Opus), "Plan doc updated" backstop with `[no-plan]` escape, tests required
  with every code change. CodeRabbit et al. skipped (free tier doesn't review
  private repos).
- **2026-09-19** — Merge policy: auto-merge on green. Every PR gets auto-merge
  (squash) enabled at open; GitHub merges the moment all required checks pass.
- **2026-09-19** — OpenAPI snapshot check deferred to Phase 4 (needs
  `@fastify/swagger` wiring; avoid conflicting with the unmerged Phase 2 branch).
- Earlier design decisions live in `docs/ARCHITECTURE.md` (dated inline).

## How to update this file (every session that changes code)

- Flip statuses, refresh **Now**, and re-date the header line.
- Built a new feature? Add a row under Go-live features with a one-line
  architecture note; if a design decision changed, ARCHITECTURE.md is updated
  too.
- Keep it scannable — statuses and one-liners, not essays. History belongs in
  git; this file is the current truth.
