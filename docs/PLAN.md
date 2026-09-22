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
  the armTap insert race and its event-id integrity gap (**in review**), a
  replayed tap re-resolved to another session, extend's arithmetic outside the
  engine transaction, the portal's reconnect backoff and staleness banner
  (**landed**), and one shared SQLSTATE helper (**landed**). Block
  re-registration by the tag's own teacher is fixed but **held for the
  owner** — the fix answers 200 where `/v1` answers 409 today, and decision 2
  sends behaviour changes to `/v2`.
  The tenth, `POST /v1/classes`'s missing idempotency key, was re-examined and
  the deferral stands.
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
| Minimal student personal history + edit own name | 3 | backs the privacy contract; **it needs an explicit tiebreak — `seq` inverts the converted-tap pair and `occurred_at` ties it** — see the note on `events_user_seq_idx` |
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

- **2026-09-22** — Review follow-ups on the armed-tap work, from #23's and
  #26's own reviews. #23's found both halves of its fix incomplete,
  and one of them was a test that could pass with the bug present.
  The `ON CONFLICT` that #23 added names the waiting partial index, but
  `armed_taps` has a SECOND unique index — `event_id` — and it is reachable:
  the `exact` select at the top of `armTap` can miss a concurrent delivery of
  the same tap that has not committed yet, and by the time the insert runs
  that row can be committed AND consumed by a Start, so it sits outside the
  waiting index, the arbiter does not match, and the insert lands on
  `armed_taps_event_id_unique`. Measured: a raw 23505 from a statement built
  exactly like `armTap`'s — the same 500 on a pre-bell tap that #23 existed to
  remove, reached by the other index. The insert now runs in a SAVEPOINT
  (verified on both lanes: a caught 23505 inside `tx.transaction` leaves the
  outer transaction usable) and a 23505 is answered as what it is — another
  delivery of this tap won the id, so `replay`. Reasoned, not pinned: the
  recovery is only reachable through an interleaving nothing here stages.
  A shared `hasSqlState` walks the cause chain for both codes now, because
  drizzle wraps the driver error and a plain `err.code` check silently never
  matches — measured while getting this wrong once. That recovery is no longer
  unpinned either: a held transaction inserts the rival row and sits on it, so
  `armTap`'s `exact` select misses it and the insert parks on the event-id
  index; releasing the holder lets it resume into the conflict. Rethrowing
  instead of recovering, or dropping the savepoint, each turns it red.
  Both of `armTap`'s event-id lookups are scoped to the CALLER now, not just
  the id: the `armed_taps` one to the student and the teacher, the `events`
  one to the student and the event type — not the teacher, which is the
  asymmetry recorded below, left as it is pending the ruling rather than
  chosen. Answering `replay` for a stranger's id
  handed back their row and told this phone's outbox the tap was durably
  recorded, so it dropped a tap that was never armed and never converts —
  silently absent from the grid at Start. `insertEvent` refuses the same
  class of reuse for the same reason;
  arming holds the same line and raises `EVENT_ID_CONFLICT`. **Behaviour
  change on a path that previously answered `replay`**, but only for an id
  that is not the caller's, which no honest client sends. Open for Phase 3:
  unlike the unlock path there is no typed disposition telling a TAP outbox
  what a permanent 409 means, so a client that hits one retries forever
  without surfacing — the same contract gap already recorded above.
  Known and accepted: a skipped spent tap is consumed with no event and no
  contribution to `armedConverted`, so nothing in the feed records that a
  waiting tap was dropped. With the takeover above, the only rows that reach
  it are stale retries for a student who never came back, and naming that in
  the permanent log would mean new event vocabulary — worth doing with the
  contract decision, not ahead of it.
  The conversion-gap race test staged with a bare 12 ms sleep and asserted
  only the invariant — nothing checked that the interleaving happened. Worth
  being exact about what that is: on an idle box it does still catch the
  mutation (`FOR UPDATE` removed, test red in 425 ms, measured), so it was not
  unconditionally vacuous. What it lacked was anything KEEPING the window hit,
  so under load the refresh lands after the conversion has committed, the
  plain-insert path is taken, every consumed row still names its original id,
  and it degrades to a pass with nothing going red. It now fails loudly when
  nothing contended at all, which is how it degraded. Its reach is narrower
  than "by construction", and the test says so: the gate observes that a
  backend parked on a lock, not WHICH lock, and with `FOR UPDATE` removed the
  refresh can still block on the row lock the conversion takes writing
  `consumed_at`. Better, not proof. The order-dependent assertion is
  conditional now — whether the conversion or the refresh reaches the row
  first is itself a race and both orders are correct, so asserting one
  unconditionally would redden a sound engine on a slow runner.
  **Review round: one blocker, and it was an engine fix that never reached the
  client.** `armTap` throws `EVENT_ID_CONFLICT` as of this PR, but the
  `armTap` call in `POST /v1/taps` was not wrapped in `mapTransitionError` —
  unlike the `tapIn` call fifteen lines above it. A `TransitionError` carries
  no numeric `statusCode`, so it fell through every branch of the error
  handler to the catch-all and shipped as `500 internal` where `routes/errors`
  already defines a 409 for that code. That is rule 5 inverted: a 500 reads to
  any outbox as a transient server fault, so the phone retries the poisoned id
  forever and nothing ever surfaces, while the permanent 409 retries AND
  shows. Harmless on `main` (nothing in `armTap` threw a `TransitionError`
  before), which is why it slipped. An engine test cannot catch this — the
  throw is right and only the status is wrong — so the pin is an API test that
  asserts the 409 a phone actually sees.
  The race test's 12 ms sleep is gone too, for the reason the review gave: it
  is a guess about how long `startSession`'s preamble takes on the runner of
  the day, and guessing long means the conversion has already committed, so
  the gate fails a sound engine — a red real-Postgres lane with no bug under
  it. The refresh is aimed by watching `pg_stat_activity` for the conversion
  actually reaching `armed_taps` instead. Measured after the change: green 3
  runs out of 3 on sound code, red 2 out of 3 with `FOR UPDATE` removed. That
  second number is written down on purpose — the aim makes it tempting to call
  the gate a mutation kill, and it is not one; the third run parked on the row
  lock the conversion takes writing `consumed_at`, exactly the reach the test
  already admits to. The gate's job is that a run with no contention cannot
  read as a pass, and that it now reports under its own name rather than as a
  vitest timeout.
  Last, `armTap`'s exhausted-attempts throw keeps the driver's error as
  `cause`. A 23505 in that loop is read as `event_id` because it is the only
  unique index the arbiter does not cover; if a third is ever added, the owner
  lookup finds nothing, the attempts burn, and the constraint name that says
  what really happened would otherwise be discarded at the throw.
  **Second review round, and the useful find was the door this PR had just
  closed on one write while widening the other.** `armTap` puts
  `input.eventId` into `armed_taps` two ways — the insert, and the refresh
  that recycles a stale standing row — and both write a column carrying its
  own unique index after the same non-locking `exact` read. Only the insert
  got the savepoint. Meanwhile the stale check above widened the refresh from
  "expired rows only" to every standing row whose id is spent, so it is taken
  far more often than before: an uncommitted rival holding that id turns the
  refresh's 23505 into an aborted transaction and a 500 on a pre-bell tap,
  which is precisely what the insert's savepoint exists to prevent. Both
  writes are savepointed now and answer through one `ownerOfEventId` — replay
  when the id is the caller's, `EVENT_ID_CONFLICT` when it is a stranger's —
  so the two paths cannot drift again. Pinned on the real lane by a sibling of
  the insert test: without the savepoint it fails with `25P02 current
  transaction is aborted`; recovering replaced by a rethrow, with the raw
  23505.
  Also corrected: the comment above that recovery still said "Reasoned, not
  pinned … nothing goes red if it is removed", in the very commit that added
  the test which does. Left standing it is an invitation to delete the
  savepoint as dead weight.
  **Two of that round's findings are the owner's, not mine, and both are
  recorded rather than acted on.** (a) Skipping a spent waiting tap narrows
  ARCHITECTURE decision 5's unqualified "every waiting tap becomes a
  participation", and ARCHITECTURE.md is law — narrowing a decision is a
  conversation, not a doc edit I make on my own. (b) `POST /v1/taps` now
  answers 409 where it answered 200 for an id that is not the caller's, and
  the sibling `/v1` change (block re-registration) is already held for exactly
  that reason. My reading is that these are not the same case — the 200 being
  removed handed back a stranger's row and told this phone's outbox a tap was
  durably recorded when it was not, so no honest client loses anything — but
  that reading is the owner's to confirm, and it is a revert of one call site
  if they rule the other way. (c) **A recommendation, not a blocker**, added
  after the fact: `armTap`'s `events` lookup is not scoped to the teacher, so
  an id spent under one teacher answers `replay` on another's block and arms
  nothing — a rule 5 silent drop. Scoping it is one `leftJoin` and rides the
  same 200 → 409 decision as (b); it narrows the gap without closing it, and
  the residual is written up below. (a) and (b) are now **BLOCKERs on the
  PR**, so it waits on the ruling rather than merging ahead of it; (c) needs
  no separate ruling if (b) goes against the 409.
  **Third round found the half of the skip that needed no race at all.** The
  spent-id check went on the STANDING row but not on the incoming id, so the
  plain retry of a lost 200 — tap at 09:01, bell, outbox retries at 09:30 with
  nothing running — still armed a row the 10:00 Start was guaranteed to throw
  away, after telling the phone `armed`. `armTap` now reads `events` for the
  incoming id first and answers `replay` with no waiting row, because the tap
  genuinely landed; an id on record for a DIFFERENT student is the same
  `EVENT_ID_CONFLICT` the armed-tap lookup already raises. `armedTapId` is
  optional for that one answer — it is the only `replay` with no row behind
  it. The ARMED-TAP lookup is scoped to the teacher as well as the student
  now: a row of this student's for teacher X was being handed back as the
  answer to a tap on teacher Y's block, arming nothing for Y while telling the
  outbox it was recorded — the same failure the student scoping closed, one
  axis over. **The `events` lookup is not, and an earlier version of this
  entry claimed both were** — found by review: another claim that was true of
  the writing and not of the code. An id already
  recorded as this student's `tap_in` under teacher X answers `replay` on
  teacher Y's block too, so Y arms nothing and Y's Start converts nobody: the
  same shape, one table over. Pinned by a test now rather than only described.
  That lookup is LOOSER than `insertEvent`'s own replay key (type + session +
  user), so the same reuse is already answered two ways on nothing the client
  controls — 409 when Y has a session running and the tap routes to `tapIn`,
  a silent 200 `replay` when Y has nothing running and it routes to `armTap`.
  The quiet answer is a rule 5 silent drop, so scoping this lookup to the
  teacher is the better behaviour — **recommended, and added to the owner's
  ask** rather than done here, since it is another shipped `/v1` 200 → 409,
  the category already with them, and a held PR is not the place to widen it.
  Mechanically one `leftJoin`: `events` has no teacher column, but every
  `tap_in` carries `classId`, so `classes.teacherId` is one hop — left, not
  inner, because `class_id` is nullable and an inner join would drop those
  rows into "id unused".
  **Recorded follow-up, tied to an endpoint that does not exist yet:** the
  teacher scope on the `armed_taps` lookup also refuses a legitimate retry
  across a block REASSIGNMENT — same student, same id, same physical tap, but
  `resolveTapTarget` now resolves the tag to a different teacher, so the retry
  gets a permanent 409 nothing surfaces. Unreachable today (nothing outside
  tests writes `blocks.removed_at`), and deliberately not patched here: taking
  the row over for the new teacher collides with the
  `(student, teacher) WHERE consumed_at IS NULL` index as soon as the student
  has tapped the moved block for real, and `ownerOfEventId` reads that as a
  conflict — the same 409, in a case that IS reachable. The fix consumes the
  stale row and answers about the new one; it must land WITH the block-removal
  or reassignment endpoint, not before it.
  **It closes the cross-teacher split and no more.** The SAME teacher, an id
  spent in an earlier session of theirs, still answers 200 through `armTap`
  and 409 through `tapIn`, because the teacher matches. That residual is not
  a tidiness point but the same rule 5 silent drop: a real second physical
  tap at that teacher's own block, with nothing running, dropped without a
  trace, and their next Start converting nobody. So the join narrows the gap;
  it does not close rule 5 on this path. Closing that needs a session scope,
  and `armTap` has none to scope to. Named here because the ruling should not be made on half
  the shape. Two earlier drafts of this entry got it wrong in the other
  direction: the first argued tightening would SPLIT `armTap` from `tapIn`,
  which had it backwards, and the second claimed it would unify them
  outright, which is true only of the axis the join covers.
  That obsoleted the staging of "a spent event id never wedges the next
  Start": it armed the spent id through `armTap`, which now refuses. The row
  is written directly instead, which is the honest framing anyway — the
  conversion's skip is defence in depth for rows that ALREADY exist, armed
  before this refusal shipped or by an older deploy against the same database.
  **And it obsoleted a second staging I did not think to check** — found by
  the PR's own review, after two independent reviewers had passed over it. "A
  fresh tap takes over a standing row whose id is already spent" staged that
  standing row the same way, so the guard answered `replay`, wrote no row, and
  the retap took the ordinary empty-slot path: every assertion passed with
  `rowIsStale`'s spent branch DELETED. Measured — under that mutation the whole
  PGlite suite stayed green, so the rule this branch exists for had no cover on
  the lane that always runs; only a REAL_PG-only race caught it, and that one
  exercises the other branch. Re-staged with a direct insert like its sibling,
  and it kills the mutation now. Third time in this audit a test would have
  passed with its own bug present, and the first that two reviewers and I all
  missed together.
  Also recorded rather than changed: the `tap_in` moved ahead of
  `endParticipationsElsewhere` (a skipped tap must leave nothing behind), so
  within one Start a converted tap's `tap_in` now carries a lower `seq` than
  the `left_for_other_session` it causes. Same `occurred_at`, different
  sessions' feeds, no consumer today reads them in one stream — noted in the
  code so the next report that orders cross-session history by `seq` knows.
  And the review's warning about the conversion-gap gate came true in the same
  round, which is the cleanest lesson here. Adding that `events` lookup to the
  front of `armTap` gave the refresh one more round-trip to make before its
  UPDATE, the conversion committed first, nothing blocked, and the gate failed
  a sound engine — the exact false red the reviewer named. A missed window is
  not a bug, so the round is RETRIED now (up to three, fresh cohort each
  time) and the gate reports rather than asserts; the invariant is asserted on
  every round regardless, so a real regression is caught by a round that ran.
  One more thing had to go with it, and only a full-suite loop found it: the
  aim helper THREW when it never saw the conversion, and it runs inside the
  racing call — so a missed aim rejected the refresh and the test went red
  with `expected 'rejected' to be 'fulfilled'`, naming nothing. About 1 run in
  8 under the full real-PG suite, invisible when the test ran alone. It
  returns now, and a missed aim is simply a round to retry.
  Measured after both: **green 10 runs out of 10** on the full real-Postgres
  suite, and with `FOR UPDATE` removed **red 6 out of 6** — every time through
  the invariant itself ("names event … which no tap_in recorded") rather than
  through a gate timing out, which is a far better failure to read. Three
  versions of one staging check: a bare sleep that passed for the wrong
  reason, a gate that failed for the wrong reason, and a retry that does
  neither.
  **Fourth round, PASS, and one finding worth having.** The new `events` guard
  matched on the caller but not the TYPE, which is half of `insertEvent`'s
  standard — the standard its own comment invokes. On the student alone, a
  phone reusing one of its OWN ids across actions (an `unlock` id sent again
  as a tap) reads as this tap's replay: no armed row, no `tap_in`, and an
  outbox told the tap is durably recorded, so it deletes it. The same silent
  lost tap the guard exists to stop, through the other door. Matched on type
  and caller now, pinned by "will not launder an unlock id into an arming
  replay".
  A later round found one more, and it is the subtle kind: the conversion-gap
  test's invariant asserted that every consumed armed tap names an event
  recorded as a `tap_in`, which this branch quietly stopped guaranteeing — a
  SKIPPED tap is consumed and mints nothing, so the event under its id is
  whatever recorded it first. No tap in that cohort carries a spent id today,
  so it still passed; it would simply have reddened one day for a reason that
  is not a bug, with a message naming the wrong one. It asserts that the event
  EXISTS now, which is the invariant the engine actually keeps, and the orphan
  it exists for is untouched — a refresh that slipped inside the conversion
  leaves an id in no event at all.
  **And the fallback door into the same failure**, found a round later: the
  insert loop's `standing` re-read answered `already_armed` about whatever
  waiting row it found, without the staleness test the standing-row branch had
  just been given. Reachable only against a row this build would not write — a
  rival delivery from an older deploy holding an uncommitted waiting row under
  a spent id, which `armTap`'s own read misses and the ON CONFLICT then loses
  the slot to — but the outcome is identical: the fresh physical tap dropped,
  the row skipped at Start, joined never. Both doors apply one `rowIsStale`
  and one `takeOverStaleRow` now, which also removes the duplication that let
  them drift; staged on the real lane with the held-transaction technique the
  sibling races use, red 3 of 3 against the old behaviour.
  Two more recorded rather than argued with: `armTap`'s JSDoc had been
  orphaned by a helper inserted between it and the function (moved back), and
  the `seq` note now names the read that will actually see the reordering —
  `events_user_seq_idx` on `(user_id, seq)` exists for the student's own
  timeline, which is cross-session and seq-ordered by construction, so it
  would show them joining period 2 before leaving period 1. **Corrected later:**
  this said to order that one by `occurred_at`, which does not order it — the
  engine stamps one value on the pair, so they tie, and the obvious tiebreak
  for a tie is `seq`, which is the inversion again. Neither column works
  alone; the read needs an explicit deterministic tiebreak (leaves before
  joins at equal `occurred_at`), decided when it is built. **And the shape is
  pinned now rather than only written down** — review's point was that four
  notes described an ordering no test held, so it could drift back before the
  read exists and leave every note describing the wrong shape. A test asserts
  both halves: the converted `tap_in` carries a lower `seq` than the leave it
  causes, and the pair shares one `occurred_at`. Restoring the old order
  reddens the first (`expected 5 to be less than 4`), stamping the leave
  separately reddens the second. Carried into the
  go-live row for student history as well, so the warning reaches the phase
  that builds it and not only the reader of the schema.
  `TapResponse.session`'s doc said it is null only for an armed tap, which
  this branch makes false on the common path: every lost-200 retry after a
  session ends now answers `replay` with no session. Corrected, and pointed at
  the contract question, since "recorded, but no longer current" is what would
  actually give that phone something to reconcile against.
  Caught on the way: CI's `format:check` failed a push that `typecheck` and
  `lint` both passed — a double-quoted test name. `format:check` belongs in
  the pre-push routine next to the other two.
  **Fifth round.** The `events_user_seq_idx` warning now sits on the index
  whose own comment promised "in stream order", not only at the call site that
  broke that promise — the trap was set where the next reader would look.
  `conversionGapRound` settled both sides of its race and rethrew only the
  refresh's rejection, so a Start that threw surfaced as
  `expected 0 to be greater than 0`, which names nothing; both are named now.
  And the refresh's give-up throw is labelled a DISCLOSED SURVIVOR, the
  convention #28 established: nothing goes red if it is deleted, staging it
  needs a rival to commit and then be deleted before the owner lookup reads it
  three times running, and a test that pretended to cover that would be worse
  than the sentence saying it does not. The 500 it produces is also the right
  answer, and the comment now says why: what was lost is a race against a
  rival that keeps appearing and vanishing, which is transient by
  construction, so "retry" is exactly what the outbox should do.

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
  The waiting tap is consumed and SKIPPED instead — and the skip needs its
  other half, which the first version of this fix did not have. `armTap`'s
  standing-row branch answered `already_armed` for any unexpired row without
  touching its id, so a student whose spent id was armed between periods, and
  who then physically tapped again, had that fresh tap dropped on the floor
  and was skipped at Start: told "armed" twice, joined never, absent from the
  grid with nothing in `events` to say why. Reproduced. A standing row whose
  id is already on record is stale for the same reason an expired one is —
  the conversion will not honour it — so the fresh tap takes the slot. The phone mints one id per
  physical tap, so a spent id can only be a retry of one that already landed:
  the tap was honoured, in the session that recorded it, and the waiting row
  is a stale retry rather than a tap owed anything. Decision 5's "a tap is a
  tap" is about a tap not yet honoured.
  (#26 shipped this differently, twice over, and both were wrong. First as a
  pre-read of `events` — but a read is not a lock, so an id can become spent
  between the read and the insert and roll the Start back anyway, through a
  narrower door; the refusal has no such window, so it is caught instead.
  Then as a conversion under a FRESH id, which survives the Start but joins
  and SHIELDS the student in a class they never tapped into, possibly hours
  later: reproduced, a 09:00 tap whose response was lost puts them in period 5
  at 13:00, because waiting taps are selected by teacher. Skipping is the only
  shape that is wrong in neither direction.) Nothing is weakened: the armed tap's id exists to de-dupe
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
