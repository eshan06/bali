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
  race and its event-id integrity gap (**in review**), the portal's reconnect
  backoff and staleness banner (**landed**), and one shared SQLSTATE
  helper (**landed**).
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
  **The same missing field answers a second question**, which is why they
  should be decided together. The server cannot tell a retry from a deliberate
  reuse, so an app resending a spent id while the student physically taps
  ANOTHER teacher's block is answered `200 replay` naming the first teacher's
  still-running session: the phone shields to that window, that grid shows the
  student green, and the teacher whose room they are actually standing in sees
  them absent until the next check-in. No privilege comes with it and the code
  says so, but the visible symptom is the drift decision 1 exists to prevent —
  and a response that could say "recorded, no longer current" resolves both.
  (2) **Where that retrying used to end up, now fixed.** A retry that finds
  nothing of the teacher's running is ARMED — `armTap` de-dupes against
  `armed_taps.event_id` and never against `events`, so a spent id is
  accepted. That id then reached the next Start, and waiting taps are
  selected by **teacher**, not by class. It aborted the Start with
  `EVENT_ID_CONFLICT` (#26 before it landed: every class of that teacher the
  student is in, blocked until end of day), and then, converted under a fresh
  id, joined and SHIELDED the student in a class they never tapped into hours
  later (a 09:00 tap in period 5 at 13:00). Both reproduced.
  **Read the tense carefully, because an earlier draft of this bullet got it
  wrong and the mistake pointed the wrong way.** It said a spent armed tap "is
  consumed and skipped now", which would have meant the refusals in (1) cost a
  stuck outbox record and nothing else. On `main` today that is false: #26
  fixed only the first harm (the `EVENT_ID_CONFLICT` that wedged the next
  Start) and still converts a spent tap under a FRESH id, so the second — a
  student joined and SHIELDED in a class they never tapped into, hours later —
  is live behaviour. The skip is in #29, which is held for the owner too.
  So the honest statement of the tradeoff, which is the one to rule on: **this
  PR must not land before #29.** With the skip, the refusals in (1) cost a
  stuck outbox record and nothing else, and (1) is a contract question. Without
  it, this PR makes the period-5 shield MORE reachable, because a refusal that
  used to be a 200 now keeps the outbox record alive to be armed later. Caught
  by review; the claim was load-bearing for a decision the owner was being
  asked to make on it.
- **Found while fixing the audit, on `main` rather than in the audit's list:**
  the SSE hub's `close()` did not wait for a LISTEN it had started, so a
  shutdown during setup left a query on a pool being torn down — an unhandled
  `write CONNECTION_ENDED` that failed the real-Postgres lane with every test
  green (**landed**; see the decision log).
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
  id names this very tap; what stopped being true is the participation.
  The lookup itself sits **ahead** of the ended-session guard, the placement
  `extendSession` uses: `resolveTapTarget` filters on `ended_at IS NULL`
  outside the transaction, so the session it picks can end before the engine's
  locked read, and a tap that did land must still replay against the running
  session that recorded it rather than 409.
  The branch's read of the OTHER session stays unlocked, and that is measured
  rather than assumed: with `for update` on it, two taps crossing in opposite
  directions order locks B-then-A against A-then-B and deadlock for real
  (40P01 at Postgres's one-second `deadlock_timeout`), which
  `withDeadlockRetry` would paper over rather than fix. The residual window —
  the recorded session, or the student's row in it, ending just after both
  reads — is narrow and heals on the next check-in.
  `extendSession` now takes minutes instead of an absolute end. The route read
  the session, did the arithmetic and handed over a fixed time, so two
  simultaneous "add time" presses computed the same target from the same
  starting point: the loser's value was no longer later than the winner's, the
  engine refused it as `INVALID_EXTENSION`, and the teacher's second press
  bought no time — a 400 saying the new end was not later than the current one,
  true of the value the route computed and useless to a teacher who had just
  pressed "add 10 minutes".
  The arithmetic moved inside the locked read, so each press adds to whatever
  it finds. Nothing calls the endpoint yet (no
  extend control in the portal), so this was caught before it could bite. `INVALID_EXTENSION` is kept and still
  refuses a non-positive, non-finite, or out-of-Date-range duration — the
  engine does not trust its caller. 1e15 minutes used to overflow into an
  Invalid Date and a bare `RangeError`; the route's zod cap
  (`int().positive().max(480)`) means no `/v1` caller could reach it, so this
  is defence-in-depth for a direct engine caller rather than a live 500. Its
  client-facing message no longer claims the end time was not moved forward,
  which the duration rewrite made false. The real-Postgres lane now covers two
  concurrent extends both landing.
  **Review round, and the sharpest finding was a guard that guarded nothing
  useful.** Refusing only what overflows the `Date` range is a bound at the
  year 275760: `1e6` minutes is finite, positive, and ends the lesson in 2028,
  and only the route's zod cap kept `/v1` honest. If the engine is going to
  distrust its caller — and it should, since `/v1` is not the only possible
  one — the bound has to mean something. `MAX_SESSION_MINUTES` is in
  `packages/shared` now and both the route's cap and the engine's refusal are
  that same number. The range check stays: `base` comes from the stored
  session, so a row already near the `Date` boundary can still overflow on an
  ordinary extension.
  **And the half this PR CHANGES for `/v1` had no wire test** — only an engine
  assertion that `NOT_PARTICIPATING` is thrown. What a phone branches on is
  the status and body `routes/errors.ts` maps that to, and the response the
  whole hold turns on was unpinned; the same shape of gap that let `armTap`'s
  refusals ship as 500s in #29. There is a 409 case next to the 200 one now,
  asserting the body as well as the status.
  Both blockers are the ones already with the owner: landing order behind #29
  (which this PR's own bullet now states), and ARCHITECTURE rule 4 / tap step
  10 promising the unconditional 200 that this changes.
  **Next round found a race test that went red for the wrong reason**, which
  is the third time this audit has turned one of those up. "Two taps crossing
  in opposite directions never deadlock" asserts on a rejected promise's
  `cause.code` — but `tapIn` wraps its whole transaction in
  `withDeadlockRetry`, so a reintroduced deadlock is caught, retried, and
  usually wins the retry; no rejection ever reaches that check. Measured with
  `for update` added back to the cross-session read: **7 deadlocks in 8
  rounds, every one swallowed**, and the test died on the vitest budget with
  "Test timed out", naming nothing. It asserts on Postgres's own
  `pg_stat_database.deadlocks` now — which counts a deadlock whether or not the
  error escaped — and `makeTestDb` gives each suite a freshly created
  throwaway database, so the counter starts at 0 and nothing else can
  contribute. Red 3 of 3, naming the cause. The per-result check stays as the
  faster signal for a deadlock that does escape.
  **And adding that bound made another guard unreachable by its own test** —
  caught by the next round, and it is the same shape as everything else this
  audit has turned up. `1e15` minutes used to reach the `Date`-range check;
  the new `MAX_SESSION_MINUTES` rejects it two lines earlier, so the check had
  no coverage while its comment read as though it did. It still has a
  reachable case, which is the one it was always for: `base` is
  `max(at, endsAt)` and `endsAt` comes from the STORED session, so a row near
  the JS `Date` boundary overflows on a legal ten-minute press. Pinned on both
  lanes now; deleting the guard produces exactly the bare `RangeError` the
  comment warns about.
  Worth recording because it cost a probe to find: that stored end has to be
  written through raw SQL. A JS `Date` past year 9999 serialises as
  `+275760-09-12T23:59:00.000Z` and Postgres rejects the `+`-prefixed extended
  year (22009, DateTimeParseError) — so the driver can READ such an instant
  back as a valid `Date` but cannot write one.
  **A later round asked for a number instead of an adjective, and was right
  to.** The file header budgeted `tapIn`'s `events`-by-event_id read as "a few
  hundred extra indexed reads spread over a minute" — a total, when the read
  sits inside the session's `FOR UPDATE` window and taps into one session
  serialise behind it. What matters is what it adds to the HELD LOCK per tap,
  because that is what a queue at a bell waits on. Measured on the real lane,
  29 sequential taps into one session: ~5.0 ms per tap with the read, ~4.8 ms
  without — about 0.2 ms, roughly 4% of the window. Fine at a school's scale,
  and now a measurement rather than a guess.
  The `NOT_PARTICIPATING` message also claimed more than its branch knows: it
  read "the participation has ended", which is also the message when
  `loadParticipation` finds no row at all. Nothing deletes a participation
  (decision 3) so that is unreachable today, but it would have misdirected
  whoever first hit it. It says "you are no longer in this session" now, which
  is true of both.
  **And the bound is only half-enforced, which the comment did not say.**
  `extendSession` refuses a duration above `MAX_SESSION_MINUTES` in the
  engine; `startSession` takes absolute `startedAt`/`endsAt` and applies no
  bound at all, so the route's zod cap is the only thing holding for starts. A
  non-`/v1` caller could open a session ending in 2028 while the same caller's
  481-minute extend is refused — which is exactly the reasoning the extend
  bound was added on ("`/v1` is not the only possible caller"), applied
  inconsistently. Nothing unbounded reaches `startSession` today (the route is
  its only caller), and closing it needs a refusal code that function does not
  have, so **the comment is corrected now and the symmetry is a follow-up**
  rather than another widening of a PR already held. Worth doing with the
  ruling, since it is the same "the engine distrusts its caller" question.
  Also from that round: `MAX_SESSION_MINUTES` said "the longest a session may
  run or be extended by" when it bounds ONE operation — N presses still move a
  session arbitrarily far, which is the intended design, and that comment is
  what an iOS client mirrors. And the silent suppression of a genuine second
  tap is recorded next to the `TapResponse` question above, because the same
  missing field answers both.

- **2026-09-22** — #31's review landed after it merged, and the best finding
  in it was that the staleness banner **could not fire in production**, for
  the exact scenario it was built for.
  One clock was the bug. `lastActivity` was stamped by events, by heartbeats,
  AND by the 15 s snapshot refresh — against a 60 s threshold. So a wedged
  proxy or a hub that died without closing the socket, stream still `open` and
  the API answering fine, reset that counter four times per threshold and the
  teacher saw nothing at all. There are two clocks now: the stream's own (it
  decides WHETHER to warn) and the grid's (it decides what "last updated"
  says, and on a dead stream with a live poll it is the smaller, truer
  number). Pinned by a test asserting both halves at once — warns, and reports
  5s rather than 180s — plus its mirror, so the two cannot be quietly swapped.
  Four more from the same review, all fair:
  **The backoff-reset test pinned nothing.** It exercised only the first
  connection, where `attempt` is already 0, so the reset was a no-op for it —
  deleting the line outright left the whole file green, which I checked before
  believing it. The replacement drives `attempt` to 4 with instant drops first
  and then asserts the gap after one healthy stream: ~20-40 ms if the reset
  fired, ~320-640 ms if it did not, a separation no jitter can close. Red 3 of
  3 against the mutation.
  **`STREAM_HEARTBEAT_MS` was hand-copied into the portal** with a comment
  claiming the two sides could not drift. It is in `packages/shared` now, like
  `EVENT_RESUME_OVERLAP`, and both sides import it — move the server to 30 s
  with a copy on the client and the banner flaps on healthy classes, move it
  to 60 s and it never fires, with nothing going red either way.
  **An off-by-one between a constant and its own name:**
  `STALE_AFTER_MISSED_HEARTBEATS = 2` multiplied by `n + 1`, i.e. three missed
  heartbeats. Behaviour was the conservative one and is unchanged at 60 s; the
  constant says 3 and is multiplied by exactly itself now.
  **A reconnect that succeeded reported the old silence.** `onStatus('open')`
  stamped nothing, so after a three-minute outage the banner read "gone quiet,
  last updated 180s ago" over a connection working perfectly, until the
  server's first heartbeat up to 20 s later. The client reports the open
  through `onActivity` now — an open connection is a sign of life — which put
  the fact where the connection is known and made it testable, instead of in
  the component where it would not have been.

- **2026-09-22** — Last of the audit's ten, and the smallest one only because
  the thing it removes is invisible. Two files had independently grown the
  same cause-chain walk — the engine's 40P01 deadlock retry and management's
  23505 join-code retry — and both had to learn the same non-obvious thing to
  get there: drizzle wraps the driver error, so the SQLSTATE sits on a nested
  `cause` and a plain `err.code` check silently never matches. Silently is
  what makes it worth a module rather than a tidy-up. Nothing throws and
  nothing logs; the retry just stops retrying, and the failure it existed to
  absorb surfaces as a 500 at a bell.
  `packages/db/src/sql-errors.ts` owns `hasSqlState` plus `isDeadlock` and
  `isUniqueViolation` now. `isJoinCodeCollision` stays as a named wrapper at
  its call site: the reasoning that a 23505 out of THAT update is always a
  code collision is about the unique indexes on `classes`, not about 23505,
  and it belongs where the loop that depends on it is.
  Pinned directly rather than left to the integration tests, and checked both
  ways: replacing the walk with a plain `err.code` check turns the new unit
  tests AND "regenerate retries past a taken join code" red on both lanes, and
  `isDeadlock` answering true for a 23505 turns one red — the inverted half,
  which matters because a deadlock retry that loops on a unique violation can
  never resolve it.

- **2026-09-22** — CI was failing the real-Postgres lane with every test green,
  and the cause was the stream hub's own shutdown. `ensureListening()` fires
  `client.listen('bali_events', …)` without awaiting it, and `unlisten` is only
  assigned once that RESOLVES — so `hub.close()` on a hub whose LISTEN was
  still being established awaited nothing and returned, and whatever tore the
  pool down next (a test's `closeDb`, the server exiting after `app.close()`)
  did so with the query in flight. postgres.js reported `write
  CONNECTION_ENDED` as an unhandled rejection: 5 runs out of 5 on `main`, in
  isolation, so not a flake. It was not #29's failure — that diff is db-only —
  and it had been read as one twice.
  `close()` now awaits the setup promise, and the `.then` that unlistens a
  LISTEN landing after close awaits its `stop()` instead of voiding it.
  Isolating the two halves says plainly which does what, because the first
  regression test I wrote for this passed with the bug present and I nearly
  shipped it: the awaited `stop()` is what stops the rejection going unhandled
  (voided, it has no handler; awaited, it lands in the `.catch` already there),
  and the awaited setup is what makes `close()` mean "the LISTEN is settled and
  unlistened" — the promise the `onClose` shutdown hook is built on. The
  end-to-end symptom reproduced 1 run in 3 against the first half alone, so it
  is not what the test asserts: `hub-close.test.ts` drives `listen` by hand and
  pins the contract, red with a different message for each half removed, on
  both lanes — where the real-pool version could not run on PGlite at all.

- **2026-09-22** — The portal's two audit findings, and both were subtler than
  "missing": the reconnect backoff and the staleness banner already existed,
  and both were wrong in the case that matters.
  **The backoff reset on the 200, not on the connection lasting.** A server
  that accepts and immediately drops — a session that has ended, a hub
  draining on deploy — answers 200 every time, so every retry went back to the
  base delay. Measured: 16 attempts in 600 ms with a 50 ms base and no growth
  at all, which at the shipped 500 ms default is a browser knocking twice a
  second, per open tab, indefinitely. It resets only once a connection has
  lasted `stableAfterMs` (5 s) now; the same measurement gives 5 attempts,
  doubling. A genuine blip after a healthy stream still reconnects at the base
  delay, which has its own test.
  **The banner only appeared when the client already knew it was
  disconnected** — the one case it can see. The dangerous shape showed
  nothing: a stream that stays open and stops delivering (a wedged proxy, a
  hub that died without closing the socket) left a fully green grid ageing
  silently, every chip claiming a freshness nothing had checked, which is rule
  3 exactly. The decision is a pure `staleness()` in `grid-state.ts` — the
  shape `gridDisplay` already uses, so it is unit-testable without pulling a
  DOM harness into `apps/web` — and it now also fires on an open-but-silent
  stream, worded differently so the two are not confused.
  Liveness had to come from the SERVER's heartbeat, not from events: a quiet
  class emits none for minutes (decision 7), so event traffic would have
  marked a healthy stream stale. The SSE client reports every frame through
  `onActivity`, comments included, and a heartbeat counts as freshness rather
  than mere liveness — nothing arriving means nothing changed. The 15 s
  snapshot refresh feeds it too, so a reload that worked stops the counter.
  Caught in my own mutation pass before pushing: `onActivity` was load-bearing
  and unpinned — deleting it left the suite green while a quiet class would
  have shown the stale banner after a minute. It has its own test now.

- **2026-09-22** — Fourth pass on the same decision, and the third time I
  closed half a hole. #27 added a test that the stream route's log dispatch
  really writes `debug` for the teardown race — and asserted only that
  direction. Measured: hardcode `request.log[level]` to `.debug` and all six
  tests stay green, while every code the listener has never seen is logged at
  `debug` and swallowed by `LOG_LEVEL`'s `info` default. That is the MORE
  dangerous half — the `warn` branch exists precisely so an unheard-of code is
  not discarded — and it was the one left unpinned. Both directions are
  asserted now: hardcoding either way turns one case red, and inverting the
  helper turns five.
  The rest of #27's review, all of it fair: the new test performs a deliberate
  write-after-end without the `uncaughtException` net its sibling documents, so
  a regression in the route's own listener would have taken the worker down
  instead of reporting a failure; `logStream` was spread on top of `transport`,
  which pino refuses outright, so the injected stream wins explicitly now
  rather than leaving a trap for the next caller; and the `'request'` listener
  that #27 moved into `afterEach` outlived the request it captured, so
  anything else reaching the app could reassign it — first match only now, in
  both files, with the `cleanups` convention #27 established applied to the
  new file too.
  That precedence fix then shipped with nothing pinning it, which is the PR's
  own thesis one more time: every test builds with `NODE_ENV: 'test'`, so the
  transport branch was never taken and flipping the ternary back left the
  suite green. There is a test now that builds in development WITH an injected
  stream and reads the raw JSON line off it — both wrong shapes turn it red.
  And the first version of that test failed on the real-Postgres lane with
  every assertion green: it waited on `headersSent`, which fires at
  `writeHead` and therefore BEFORE `hub.subscribe()`, so it ended the response
  while the subscription's first `getEventsSince` was still in flight and the
  pool closed under it — `write CONNECTION_ENDED`, an unhandled rejection that
  fails the run without failing a test. It waits for the opening frame to
  reach the client now, which is the proof that read finished. Causation
  measured, not guessed: the old shape reproduces it 2/2 locally, the new one
  is clean.

- **2026-09-22** — The stream route's log decision took three passes to
  actually pin, and the last hole was one level below the last fix. #24 folded
  the level and the line into one tested helper so the listener had no branch
  left — but the line that CONSUMES it, `request.log[level]({ err }, msg)`, is
  ordinary code: hardcode it to `.warn` and every tab-close goes to `warn` in
  production while all five helper cases stay green. `buildApp` now takes an
  optional `logStream` (tests only; production keeps pino's own destination)
  and an integration test reads the level the route actually wrote. Hardcoding
  the dispatch turns it red; the helper's table test does not notice.
  Also measured, from the same review: the rewritten stall loop treated ONE
  quiet round as proof the socket was full. Draining happens on the event
  loop, so a round where the loop is busy for the whole sleep — this suite
  runs with `repollMs: 5` — looks identical to a full socket. On this box the
  kernel accepts about 3 MiB before it stops, so a false stall on round one
  leaves ~1 MiB queued, `end()` flushes it, `'finish'` fires, and the test
  goes red for a busy machine rather than a regression. It now takes two
  consecutive quiet rounds; a genuinely full socket never drains again.
  And the `'request'` listeners come off in `afterEach` rather than after the
  `waitFor` that may throw first.

- **2026-09-22** — The worst thing the audit turned up was not on its list: a
  lost tap response could stop a teacher starting any lesson for the rest of
  the day, and it needed no race to reach. A tap lands in a session, its
  response is lost, the bell ends the session, and the phone's outbox retries.
  Nothing of that teacher's is running, so the route arms the retry —
  `armTap` de-dupes against `armed_taps.event_id` and never against `events`,
  so a SPENT id is accepted. The next Start converts it, `insertEvent` sees
  the id against a different session and refuses, and because conversion runs
  inside `startSession`'s transaction the whole Start rolls back with the tap
  still unconsumed. Waiting taps are selected by TEACHER, not by class, so
  every class that student is in is blocked, every period, until the tap
  expires at end of day.
  A tap is still a tap (decision 5) and the student is still standing there,
  so the conversion now goes ahead under a fresh event id, with the spent one
  kept in `payload.armed_tap_event_id` so the history still shows which tap it
  came from. Nothing is weakened: the armed tap's id exists to de-dupe
  ARMING, and the conversion was already exactly-once, consumed in the same
  transaction. Both reviewers on the tap-replay step reproduced this
  independently and flagged it as worse than anything that step fixed; it is
  pre-existing on `main`, reproduced there before the fix.
  This also removes the sharp edge under the tap path's refusals: each of them
  is a 409 the outbox keeps retrying, and this was where that retrying ended
  up. The contract question — a tap that landed but is no longer current has
  no honest `200` — is still open for the owner, but it can no longer cost a
  teacher their day.
- **2026-09-22** — #22's own review found the same class of hole one level up
  from the one #22 fixed. That PR extracted `streamErrorLevel` so the stream
  route's log decision could be asserted, but the listener then RE-BRANCHED on
  what it returned, and that branch was hand-written and unseen: swapping its
  two bodies left the whole api suite green (verified — 244 passed) while
  every ordinary tab-close would log at `warn` in production, which is the
  exact noise the split existed to avoid. A pinned function with an unpinned
  call site pins nothing. The helper now returns the level AND the line
  together (`streamErrorLog`) and the listener dispatches on what comes back,
  so there is no branch left outside the tested function. Inverting the helper
  turns all five of its cases red.
  The same lesson twice, because the review also measured the stalled-reader
  test's own loop. It claimed to queue "until the socket genuinely stops
  draining, rather than trusting a byte count measured on one machine" — but
  `write()` returns false on the very first 1 MiB chunk (the stream high-water
  mark is 64 KiB and says nothing about the socket), so the loop exited after
  one iteration, the pad was a fixed 5 MiB, and the assertion guarding it was
  true before the socket had done anything. It watches `writableLength` now —
  what has been handed over and not yet accepted — so a round where it grows
  by the whole chunk is a round where nothing drained. The magic number is
  gone and both mutations still kill the test.
  Also from that review: the crash-regression test's socket is registered with
  the same `extraSockets` net its neighbour already had, and its `'request'`
  listener is removed once it has what it needs — a `waitFor` timing out
  before the `try` used to leave a live streaming connection attached to an
  app the suite was about to close.
  Worth knowing for anyone re-running CI locally: `npm test --
  --hookTimeout=60000` at the repo root silently DROPS the flag (the root
  script is `npm test -ws --if-present`, so npm takes the extra argument as
  its own), and on a loaded box PGlite's `beforeEach` then reports phantom
  "Hook timed out in 10000ms" failures. Run `npx vitest run --root <workspace>
  --hookTimeout=120000` per workspace instead.

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
