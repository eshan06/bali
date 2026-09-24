# Bali v3 — build plan & live status

The one file every session reads (after ARCHITECTURE.md) and updates when it
finishes work. ARCHITECTURE.md says *how*; this file says *what* and *where we
are*. Update rules are at the bottom.

_Last updated: 2026-09-24 — **Phase 3 (iOS student app) has started**, API and contract work first: the step list is under Phases, A1 (the unlock's optional reason), A2 (protection off, end to end on the server), A2b (no deadlock reaches a phone as a 500), A2c (a protection-off reaching the server after the bell is recorded with a note), A3 (the tap and state-change outbox tables, in `@bali/shared`), A4 (a retried tap or refocus recorded but no longer current is answered `200 replay` naming no session), A5 (contract fixtures of every student endpoint in `contracts/fixtures/`, and a machine-readable `reason` on errors), A6 (the join-code preview, `GET /v1/join-codes/{code}`), A7 (the student's own history, `GET /v1/me/history`), A8 (a student edits their own display name, `PATCH /v1/me`, unique within each class) and A9 (the portal's live grid shows an unlock's reason, an unlock under protection off, and late records that survive the refresh) have landed — the API and contract steps are done. **The iOS steps have begun: B1a (the `BaliCore` Swift package — every student wire type, decoded against every contract fixture on a Linux Swift CI job) and B1b (the outbox tables ported to Swift, proven equal to the TypeScript's on every fixture and on generated cases in `contracts/outbox/`) have landed; B1c is next.** **The owner ruled on open decisions 7–10 (2026-09-24).** **The owner ruled out a student allow-list — the shield blocks every app a third party can block — and approved D1, so A6–A8 no longer wait on it (2026-09-24).** **Phase 2 is complete: the exit demo ran green against Railway dev.** Retroactive audit of the pre-gates Phase 1/2 code: nine findings confirmed, landing as gated PRs; offset timestamps and the SSE write-after-end crash are on `main`. **The owner ruled on the audit's held `/v1` questions (yes to all five): #29, then #28, then the block fix.** `/v1/me` now stores a display name the token actually carries, so the live grid shows a readable name wherever the token has one, instead of a UUID prefix._

## Now

- **Phase 2 is merged to `main`** (steps 1–8) — the walking skeleton is complete: session lifecycle over HTTP, events feed + SSE live grid, teacher portal, phone simulator.
- **Dev runs Phase 2** (2026-09-20): Railway auto-deploy repaired (the Railway
  GitHub App was never installed — it is now), environment renamed `dev`, and
  the sweep cron created: it POSTs `/internal/sweep` every minute and returns
  healthy. (The earlier "repoint the cron" note is settled; the Phase 1 path is
  kept as an alias, nothing 404s.)
- **Owner actions from the Phase 2 merge: done** — "Integration + race tests
  (real Postgres)" is now a required check, and the Claude workflows bill the
  owner's subscription (see `docs/DECISIONS.md`).
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
- **The live grid shows a readable name wherever the token carries one**
  (2026-09-22). `/v1/me` read
  `claims.name`, but Cognito puts profile attributes in the ID token and every
  client here sends an **access** token — the portal stores `access_token`
  and nothing else, the exit demo signs in for `AuthenticationResult.AccessToken`
  — so that read found nothing on every real request, `display_name` stayed NULL,
  and the grid fell back to eight characters of a UUID. Setting a `name`
  attribute on the pool would not have fixed it — only a pre-token-generation
  Lambda adds claims to an access token, and nothing here has one. `/v1/me` now walks
  `name → preferred_username → cognito:username → username`, so a real name still
  wins wherever one exists, and `findOrCreateStudent` **fills** a NULL
  `display_name` on a later sign-in instead of only setting it at creation —
  otherwise every existing account would have kept its UUID prefix forever. A
  fill, never an overwrite: "edit own name" (`PATCH /v1/me`, A8 ✅) makes that
  field the student's own once they set it. Where the pool's usernames are readable, a
  remote exit-demo run labels its actors with them, because `me.user.displayName`
  finally answers. **Not checked yet:** whether the dev pool's usernames are
  readable. A pool that signs users in by email (`UsernameAttributes: ['email']`)
  gives every user a UUID username, which is not stored, and its access tokens
  carry no `name`; there the grid keeps its UUID prefix until the student sets
  a name (A8's API is in; its screen is C6) or a pre-token-generation Lambda
  supplies one.
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
  the armTap insert race and its event-id integrity gap (**landed**; its
  review follow-ups are #29), a replayed tap re-resolved to another session
  and extend's arithmetic outside the engine transaction (**#28, which lands
  after #29 — ruled in, and landing now**), the portal's reconnect backoff and staleness banner
  (**landed**), and one shared SQLSTATE helper (**landed**). Block
  re-registration by the tag's own teacher answers 200 with their own block,
  where `/v1` answered 409 before; **the owner ruled that correction in
  (2026-09-22)**, and it landed as its own PR after #29, which carries the
  ARCHITECTURE note allowing it (**landed**).
  The tenth, `POST /v1/classes`'s missing idempotency key, was re-examined and
  the deferral stands.
- **The owner ruled on #28's held question (2026-09-22): the `409`s stand** —
  until A4 (2026-09-24) replaced them with the "recorded, no longer current"
  answer they were waiting for. A retried tap that landed names its session
  only while what it recorded is still true (the participation live, its
  session running); otherwise it is answered `200 replay` with no session, so
  the outbox deletes it and re-reads the truth (tap step 10). The
  spent-armed-tap skip it depended on landed first, in #29.
- **Found while fixing the audit, on `main` rather than in the audit's list:**
  the SSE hub's `close()` did not wait for a LISTEN it had started, so a
  shutdown during setup left a query on a pool being torn down — an unhandled
  `write CONNECTION_ENDED` that failed the real-Postgres lane with every test
  green (**landed**; see `docs/DECISIONS.md`).
- **Phase 3 is under way** (2026-09-23): the step list under Phases replaces
  the earlier unwritten 10-step outline. The API and shared-contract steps land
  first, so the iOS client implements against finished, tested contracts —
  the `unlockDisposition` pattern. **A1 (unlock reason), A2 (protection off),
  A2b (deadlock retry), A2c (protection off after the bell, recorded), A3
  (the outbox tables), A4 (recorded, no longer current), A5 (the contract
  fixtures), A6 (the join-code preview), A7 (the student's history), A8
  (edit own name, unique within each class) and A9 (the live grid's unlocks
  and late records) landed, and so have B1a (BaliCore's wire types and the
  fixture contract tests) and B1b (the outbox tables in Swift); B1c is
  next.** Of the
  owner decisions Phase 3
  needs (items 6–10 under Open product decisions), 7–10 are decided
  (2026-09-24) and 6 is still open;
  steps that need the owner's iPhone are marked 📱. Phase 0's open question
  gates B5: confirm the DeviceActivity extension fires at interval END with
  the app force-quit.
- **BaliCore has landed** (B1a, 2026-09-24): `ios/BaliCore`, the iOS apps'
  Swift package, decodes every contract fixture in the "BaliCore Swift tests
  (Linux)" CI job — and since B1b its outbox tables must give every fixture's
  disposition and every generated case in `contracts/outbox/` the
  TypeScript's answer there too, so a change to a table in `@bali/shared`
  fails that job until the port follows. **Owner's call:** whether to make
  that job a required check in `protect-main` — it runs on every PR, not
  path-filtered, so requiring it never leaves a PR waiting on a check that
  did not run.
- **No student allow-list, and D1 approved** (owner, 2026-09-24). The shield
  blocks every app a third party can block (`.all()`, no app picker anywhere);
  iOS itself keeps calls, FaceTime, Messages and Emergency SOS working. Known
  gap: an app a student medically needs is blocked too — Emergency Unlock is
  the exit at launch, and any carve-out is the owner's later call
  (ARCHITECTURE, iOS "Decided later"). D1's screens are approved, so A6–A8 no
  longer wait on the owner. Why: `docs/DECISIONS.md`.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 | iOS enforcement spike | ✅ NFC → shields <1s proven on device. ⚠️ Still to confirm before Phase 3 step B5: DeviceActivity extension fires at interval END with the app force-quit. |
| 1 | The spine: monorepo, CI, schema + constraints, transition engine, Cognito auth, `/v1/me`, `/v1/taps`, session start, armed taps, Railway dev deploy | ✅ on `main` |
| 2 | Walking skeleton: real-Postgres CI lane + race tests, unlock recorded-with-a-note contract, enrollments, classes/blocks, session lifecycle + silence events, events feed + SSE (LISTEN/NOTIFY), teacher portal + live grid, phone simulator | ✅ **complete** — merged to `main` and the exit demo passed against dev (2026-09-22) |
| 3 | iOS student app: BaliCore (contract fixtures TS↔Swift), GRDB outbox + sync engine, enforcement (shields + DeviceActivity extension), Cognito PKCE auth, screens, device test gate (ISSUES #2 on hardware) | 🔨 in progress — steps below |
| 4 | Reports + recap, rate limiting (ISSUES #1 per-account budgets), school-behind-one-IP load gate (k6), OpenAPI snapshot check. The load gate sizes the sweep too: its per-row deadlock retry runs in a serial loop, so its worst case is candidates × 4 backoff sleeps — if the sweep grows, bound it (a shared retry budget per run, or batching) (#56's review) | ⬜ |
| 5 | Pilot readiness: prod environment, monitoring/Sentry, backup restore drill, Vercel flip (portal + marketing), TestFlight, App Store submission, teacher invite gating docs | ⬜ |

### Phase 3 steps (one PR each; 📱 = needs the owner's iPhone)

API and shared contracts come first; Swift lives in a root `ios/` folder (the
plan backstop already treats it as source).

- **A1** Unlock takes an optional reason (bathroom / nurse / other) — ✅
- **A2** `POST /v1/sessions/{id}/protection-off`; refocus refused while protection is off (a re-tap returns) — ✅
- **A2b** Deadlock retry: unlock, refocus and protection-off take the session lock before the participation row, while the silence sweep, a switching tap, an armed tap converting at Start and a check-in closing a silence episode take the row first — Postgres aborted one side (40P01) and a phone request that lost got a 500. Both sides retry now; the exit demo drives protection off end to end (live on the stream, refocus refused, a re-tap returns — not yet re-run against dev) — ✅
- **A2c** A protection-off that first reaches the server after the session ended is recorded with a note instead of refused (owner decision 10): `200 recorded`, noted `after_session_end` like a late unlock, marking nothing, and answered with no session and no state, so it never hands a phone a window to shield to. Only for a student who was in the session at its end; every other report after the end keeps its `409`, including the retry of one that landed while the session ran — ✅
- **A3** Outbox dispositions in `@bali/shared`: `tapDisposition` (the tap-side twin of `unlockDisposition`) and one for refocus / protection-off — a refused change is dropped and the truth re-read, never resent. Protection-off's `recorded` (A2c) is final like `applied` and `replay`, and it and its replay carry a null `session` and `state` — pin that shape in the fixtures (A5). Also: a check-in racing a state change can answer the state from before it (checkIn reads `state` before it writes — pre-existing, raised in A2b's review), so the reconcile must never let a check-in answer override a newer state-change response — ✅ `tapDisposition`, `stateChangeDisposition` and `readMayReconcile` (`outbox-contract.ts`), bound to the server's real answers by an API test. The session an answer names, not its outcome, decides the window, so A4's `200 replay` with no session already reads as "delete, re-read the truth"; a refused tap is kept, retried and shown (tap steps 9–10, rule 5)
- **A4** A retried tap that is recorded but no longer current answers `200 replay` with no session instead of `409` — ✅ a retry whose participation ended (switched away, left or removed from the class) or whose session is over names no session, whichever running session it reaches: `tapDisposition` reads it as `reread`. Only under the teacher it was recorded with — under another it stays `409 EVENT_ID_CONFLICT`, as on the arm path — and an id held by a different event, or a fresh tap that raced its session's end, still 409s. A refocus replayed after its participation ended in a running session answers `replay` with no session and no state (it named the session, with the ended row's last state), which `stateChangeDisposition` reads as `reread`; protection-off keeps refusing that replay (A2). The retry of a still-armed tap answers `already_armed`, so the phone keeps showing "waiting for your teacher"
- **A5** Contract fixtures: real response JSON per student endpoint, checked in, CI fails on drift — including A4's no-session replays, whose `session` and `state` are null (a tap's, and a refocus's: `RefocusResponse.state`/`session` are nullable now, so BaliCore must decode them as optional). First decide whether errors get a machine-readable `details` code: `PROTECTION_OFF` and `NOT_PARTICIPATING` both reach the phone as `conflict`, told apart only by message — ✅ 42 fixtures in `contracts/fixtures/`, the API's real answers to every student endpoint and outcome (A2c's and A4's null-session answers, every unlock `recordedAs`, each 409 kind), captured in memory by a golden-file test (`apps/api/test/contract-fixtures.test.ts`), each checked against its `@bali/shared` type and carrying the disposition the TS outbox table gives it; `npm test` fails on drift, `npm run fixtures` rewrites them, and CI regenerates and diffs. Errors carry an optional `reason` (`API_ERROR_REASONS`, one per engine refusal) — the phone keys on it, never the message. Rode along: `unlockDisposition` reads a 408 as transport (`retry`), like the other tables; an engine answer naming no session names no participation either
- **A6** Join-code preview — ✅ `GET /v1/join-codes/{code}` answers the consent screen (C2): the class, its teacher's display name (null when their account has none) and whether the caller is in it already; the "sees / never sees" list is fixed copy, not served. A read that writes nothing. The join and the preview share one code schema, to which case and surrounding whitespace are noise (a lower-case code now joins), so they never name different classes; an unknown, archived or regenerated code is the join's `404 class_not_found`, a teacher the join's `403`. Guessing codes is bounded per account only by ISSUES #1 (Phase 4). Rode along (#64's review): `npm run fixtures` clears only the `*.json` the drift check reconciles, and leaving a class's two 403s carry `unknown_user` / `enrollment_not_yours`
- **A7** `GET /v1/me/history` — ✅ the history screen (C6): the caller's own moments a teacher sees, newest first, in every class they have been in — tapped in, back to focus, unlocked with its reason, protection off, a switch, leaving or being removed, the class ending while they were in it (read through the participation the end closed), and `armed_tap_skipped` as a declined tap naming the class it counted in, never a join; a late record carries its `recordedAs`. Silence, joining and orphan unlocks are not shown (`HISTORY_EVENT_TYPES`). The tiebreak is explicit: `occurred_at`, then a leave before anything else at one instant, then `seq`. Pages of at most 50 with an event-id cursor (`before`) that names a row, so new moments never shift a page; a read that creates nothing, `403` for a teacher. `events_user_seq_idx` became `events_user_occurred_idx` (user_id, occurred_at), and `participations_student_ended_idx` is new, so a page costs its own size (a test EXPLAINs both reads). Rode along (#65's review): a join code longer than `JOIN_CODE_LENGTH` once trimmed is a `400` before any lookup, for the join and the preview, and a test pins the generator's alphabet as upper-case — the invariant that keeps every stored code findable
- **A8** edit own name — ✅ `PATCH /v1/me` `{ displayName, eventId }` (D1's Me screen; the screen is C6): stored trimmed, each run of spaces made one, answered with `/v1/me`'s `user`. Decision 8: a name another student in any live class the caller is in already uses — ignoring case, spacing, Unicode compatibility forms and characters that draw nothing — is `409 display_name_taken`, never a silent rename; `renameStudent` locks the caller's row, then their classes in id order, `FOR NO KEY UPDATE` (real-Postgres races: two classmates at once, the lock order, a ring of shared classes, a retry racing its original, a fill racing a rename). Recorded as a `display_name_changed` event with the name it replaced (the idempotency key's home and the name history); a replay answers the name now; a grid shows the new name at its next 15 s snapshot. Not covered, on purpose: a join is never refused over a name, a name filled from sign-in claims is not policed, a collision a later join makes is left for the teacher to see. `400 display_name_invalid` (blank or invisible, over `DISPLAY_NAME_MAX_LENGTH` code points, a control or format character), `400 invalid_request` (a malformed body), a teacher `403`. Rode along (#66's review): `JOIN_CODE_LENGTH` lives in `@bali/shared`, and the history's two `400`s carry `invalid_request` / `unknown_cursor`
- **A9** Portal: the live grid shows an unlock's reason, an unlock recorded against protection off, and late records that survive the refresh — ✅ the chip carries the student's latest unlock since they were last in focus, after its label: "Unlocked · bathroom", "Left · unlocked · nurse", and on a protection-off chip the unlock itself, "Protection off · unlocked · nurse" — red, never softened into the unlock chip, never green. The snapshot (`GET /v1/sessions/{id}`) carries, beside each row, what it does not show — that `unlock` (reason, note, time) and `protectionOffAfterEnd` — so a late record's "Left ·" chip survives the 15 s refresh (the engine still leaves the ended row alone, A2c), and it carries every student the session's feed can name: the active roster plus anyone with a participation or an unlock here who has since left the class, so every tab shows the same chip. The grid reads the snapshot's unlock and the streamed one through one function: a note of no live participation ends the chip (a student the tab never saw leave read a live "Unlocked"), a note of protection off keeps it protection off. Names: a rename reaches every chip on an open grid at its next 15 s snapshot (no stream carries it); the class page's roster list is read at page load, so it shows there on reload. Rode along (#67's review): `renameStudent` runs in `withDeadlockRetry`, and the stored name and the comparison share one blank class (`tidyDisplayName`), so `"⠀Bea"` is stored `Bea`
- **D1** Design the student screens with no reference screen, on a canvas built with the Bali Design System — ✅ approved (2026-09-24) after the owner's changes: a light theme like the teacher app, the ring mark without its tile, no allowed-apps screen, and a Focus screen in three states (normal, final two minutes, offline): [Bali student app screens](https://claude.ai/artifact/DdfRPhHu4whXLxe58hBAie)
- **B1a** `BaliCore` Swift package: skeleton, every wire type, fixture decode tests, a Linux Swift CI job — ✅ `ios/BaliCore` (Swift 6, Foundation only; iOS 17, macOS 14, and Linux for the tests): every student endpoint's request and response and the vocabularies they use, mirroring `@bali/shared`. A closed vocabulary decodes as `OrUnknown` — a value this build does not know is `.unknown`, never a failed decode — and an error's `reason` it does not know reads as none. Times accept `toISOString()`'s milliseconds or none, and encode with them. The contract test walks `contracts/fixtures/` in place: each body decodes strictly as the type it names and encodes back the same, each request body encodes as sent, a fixture of a type BaliCore does not map fails; the vocabularies are also checked against the TypeScript lists themselves. CI: "BaliCore Swift tests (Linux)" in `ci.yml`, in `swift:6.4-noble`, on every PR — making it required is the owner's ruleset call
- **B1b** The outbox tables in BaliCore: `tapDisposition`, `stateChangeDisposition` and `unlockDisposition` ported, and `readMayReconcile`; the contract test checks each fixture's `disposition` against the port — ✅ `UnlockContract.swift` and `OutboxContract.swift`: the same names, a `SendResult` (a status, or `.networkError`) and the answer decoded as its response type — nil when there is none or it does not decode, and an outcome the build does not know is `.unknown`: both `retry`, the record kept — each rule's comment carried over (no unlock result ever means discard; a refused state change is final for its `eventId`), exhaustive switches in place of the TS `Record` tables. Parity, both ways: every fixture's `disposition` must be the port's (a disposition on an endpoint with no port fails), and `contracts/outbox/` holds the TypeScript's own answer on inputs the API does not send — 25 results (no answer, each status class's edges, 408, 429) × 37 bodies (none; every outcome any table knows, each unknown to another, and five none knows; with a session, a null one, none) per table, and 81 pairs of stamps for `readMayReconcile` — written by a golden test in `@bali/shared` (`outbox-cases.test.ts`), which `npm test` fails on drift and `npm run fixtures` (now every workspace's generator) rewrites; CI diffs all of `contracts/`. The cases reach every value of each TS disposition union, and the Swift enums must be exactly the values they reach; `readMayReconcile`'s scenarios are ported as Swift tests. Rode along (#69's review): the inline unions BaliCore mirrors are `as const` lists in `@bali/shared` (`UPDATE_ME_OUTCOMES`, `CHECK_IN_STATUSES`, `REFOCUS_OUTCOMES`, `PROTECTION_OFF_OUTCOMES`, `ENROLLMENT_JOIN_OUTCOMES`, `END_ENROLLMENT_OUTCOMES`, `END_ENROLLMENT_REASONS`), read by the vocabulary test and used by the fixture schemas; and each null field of a fixture is now compared too — sent a probe no type takes, which BaliCore must refuse or bring back
- **B1c** The API client: `URLSession` with async/await and an injected token provider (`FoundationNetworking` on Linux), coding with `BaliJSON`
- **B2** App + extension skeleton (XcodeGen: app, DeviceActivity monitor, shield UI, app group) + macOS CI on GitHub-hosted runners, only on PRs touching `ios/` (decision 9). Identifiers — v2's, as the Family Controls entitlement request used them: team `H535678UF8`; app `com.bali.Bali`; extensions `com.bali.Bali.BaliShield` (shield UI) and `com.bali.Bali.BaliMonitor` (DeviceActivity monitor); app group `group.com.bali.shared`
- **B3** GRDB outbox + sync engine — first decide a bound for `retry_and_surface`: an unlock refused forever blocks every read reconcile (`readMayReconcile`), and a tap `409` that never lands retries forever (#59's review). The same bound should cover a 2xx whose body never decodes: BaliCore's tables read it as no answer, so it is kept and retried, never surfaced (B1b's review) · **B4** Cognito PKCE sign-in
- **B5** Enforcement: shields (every app a third party can block — `.all()` apps and web domains, no picker), session schedule, monitor extension, custom shield — 📱 settles Phase 0's open question. A tap the server has not answered yet schedules the 50-minute cap of decision 7. Note: "only a re-tap leaves protection off" holds per participation, not per phone — an armed tap converted at another teacher's Start joins that session focused, so the phone must re-report protection off there at its next check-in
- **B6** NFC tap → local record → shield → outbox — 📱
- **C1–C6** Screens: onboarding · join + preview · home / waiting · focus · unlocked, protection off, session over · history + me
- **E1** Device test gate: ISSUES #2 on hardware — 📱

## Go-live features

### In scope for launch (phase noted)

| Feature | Phase | Notes |
|---|---|---|
| Core loop: tap→shield offline, armed taps, live grid, unlock always-recorded, refocus, join codes, roster, removal, self-expiry | 1–2 | ✅ built |
| 30s check-in that verifies shields before claiming them | 3 | rule 3. **API ✅ (A2):** a revoked permission is reported with `POST /v1/sessions/{id}/protection-off`; refocus is refused out of it and an unlock never softens it (the grid mirrors the unlock rule; a refocus is never recorded out of it, so there is none to mirror) — only a re-tap returns to focus. A report that first reaches the server after the bell is recorded with a note, like a late unlock (A2c). The phone's half is B3/B5 |
| Shields survive force-quit; bell frees phone via extension | 3 | pending spike confirmation |
| Onboarding: privacy contract → sign-in → Screen Time grant | 3 | no allow-list step: the shield blocks every app it can (2026-09-24) |
| Consent preview before joining a class | 3 | **API ✅ (A6):** `GET /v1/join-codes/{code}` — the class, its teacher's name, already enrolled; matched as the join matches, and refused as it refuses. The screen is C2 |
| Unlock with optional, skippable reason (bathroom/nurse/other) | 3 | replaces full "passes" at launch. **API ✅ (A1):** optional `reason` on unlock, stored as `payload.reason`, never a reason to refuse. It is fixed once recorded (a replay keeps the stored one), so C5 either asks before sending or holds the send until the picker is answered or skipped. **Portal ✅ (A9):** the grid shows it on the chip, a protection-off one included |
| Custom shield screen ("Focused with Bali until 9:42") | 3 | bundle ID in entitlement request |
| Minimal student personal history + edit own name | 3 | backs the privacy contract. **API ✅ (A7):** `GET /v1/me/history` — the moments a teacher sees, newest first, paged by an event-id cursor; the explicit tiebreak (`seq` inverts the converted-tap pair and `occurred_at` ties it) is a leave before anything else at one instant, then `seq` — see `events_user_occurred_idx`; `armed_tap_skipped` shows as a declined tap naming the class it counted in, never a join. **API ✅ (A8):** `PATCH /v1/me` — the student's own name, unique within each class (decision 8; serialised by class locks), recorded as a `display_name_changed` event; a join or a sign-in's fill is never refused over a name. An open grid shows it at its next 15 s snapshot (A9). The screen is C6 |
| Sign in with Apple (App Review guideline 4.8) | 5 | Cognito IdP |
| End-of-session recap card (portal) | 4 | |
| Reports: class focus minutes + unlock list; aggregates only, never rankings | 4 | `armed_tap_skipped` names a student who did NOT join — never count it as a join. An unlock or protection off noted `after_session_end` reached the server after the end, and its time is clamped to the scheduled window, so after an early end it can fall past `ended_at` — never count time beyond it |
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
6. How a waiting (armed) phone learns the teacher pressed Start — student
   phones get no live feed, so nothing tells it (lean: poll `GET /v1/me` while
   the app is open and on resume; push rides the fast-follow push work).
   Before C3.
7. The default end for a tap made with no signal — **decided 2026-09-24:**
   shield at once; if the phone never reaches the server, the shields come off
   on their own after **50 minutes** (the owner's length; iOS can't schedule
   under 15). The real end time replaces the cap as soon as the phone reaches
   the server; Emergency Unlock works throughout. B5 implements it.
8. Policing an edited display name — **decided 2026-09-24:** unique within
   each class; a name a classmate in any shared class already uses is refused,
   ignoring case. A8 ✅ implements it.
9. macOS CI for the iOS build — **decided 2026-09-24:** GitHub-hosted macOS
   runners, only on PRs that touch `ios/` (free while the repo is public).
   Revisit when the owner makes the repo private: minutes then count (macOS at
   10×), so the job moves to the owner's Mac as a self-hosted runner (safe only
   on a private repo), and a personal account needs GitHub Pro to keep branch
   rulesets enforced there.
10. A protection-off that first reaches the server after the bell —
    **decided 2026-09-24:** recorded with a note, like a late unlock, so the
    history says why the phone went quiet (a `409` → `200` correction; A2c ✅).

Parked by design, blocking before real students: data-deletion policy,
under-13 parental-consent machinery.

## External / waiting

- **Family Controls distribution entitlement** (Apple) — applied for; blocks
  TestFlight/App Store, not development builds. Bundle IDs incl. monitor
  extension (and shield-UI extension) should be in the request — it used v2's
  identifiers, which v3 reuses (listed on B2).
- Apple checklist: bundle IDs registered, App Store Connect record created.

## Decision log

Moved to `docs/DECISIONS.md` (2026-09-23). A pointer of the form "docs/PLAN.md
decision log, <date>" means the entry with that date there.

## How to update this file (every session that changes code)

- Flip statuses, refresh **Now**, and re-date the header line.
- Made a real decision? It goes at the top of `docs/DECISIONS.md`, not here.
- Built a new feature? Add a row under Go-live features with a one-line
  architecture note; if a design decision changed, ARCHITECTURE.md is updated
  too.
- Keep it scannable — statuses and one-liners, not essays. History belongs in
  git; this file is the current truth.
