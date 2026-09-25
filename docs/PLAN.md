# Bali v3 — build plan & live status

The one file every session reads (after ARCHITECTURE.md) and updates when it
finishes work. ARCHITECTURE.md says *how*; this file says *what* and *where we
are*. Update rules are at the bottom.

_Last updated: 2026-09-25 — **Phase 3 (iOS student app) has started**, API and contract work first: the step list is under Phases, A1 (the unlock's optional reason), A2 (protection off, end to end on the server), A2b (no deadlock reaches a phone as a 500), A2c (a protection-off reaching the server after the bell is recorded with a note), A3 (the tap and state-change outbox tables, in `@bali/shared`), A4 (a retried tap or refocus recorded but no longer current is answered `200 replay` naming no session), A5 (contract fixtures of every student endpoint in `contracts/fixtures/`, and a machine-readable `reason` on errors), A6 (the join-code preview, `GET /v1/join-codes/{code}`), A7 (the student's own history, `GET /v1/me/history`), A8 (a student edits their own display name, `PATCH /v1/me`, unique within each class) and A9 (the portal's live grid shows an unlock's reason, an unlock under protection off, and late records that survive the refresh) have landed — the API and contract steps are done. **A10 has landed too, on the owner's ruling: a late unlock — stuck on the phone while the student's own refocus or tap went ahead of it — is recorded, never applied (noted `superseded`), and ARCHITECTURE gained two clauses (a stuck record stops holding reads; the live grid keeps a student removed mid-session).** **A11 has landed, on the owner's decision 11: an unlock made while the phone's own tap is unanswered is sent under that tap (`POST /v1/taps/{eventId}/unlock`, BaliCore's `unlock(tap:_:)`) and filed in whatever session the tap landed in, or kept with no session, noted `tap_armed` / `unknown_tap` — and a tap landing after its unlock files it then, so both arrival orders end alike. A late unlock stays `superseded` once the student has left the session (#76's review).** **A12 has landed, on the owner's ruling: the phone's own order, not its clock, decides whether a student's unlock came after their own refocus or tap — one optional `order` field (its outbox file's install and the record's seq) on every record the outbox sends, BaliOutbox sending it — so a clock turned back between the two never undoes a real unlock.** **The iOS steps have begun, and B1 — BaliCore — is complete: B1a (the `BaliCore` Swift package — every student wire type, decoded against every contract fixture on a Linux Swift CI job), B1b (the outbox tables ported to Swift, proven equal to the TypeScript's on every fixture and on generated cases in `contracts/outbox/`) and B1c (the API client: one call per student endpoint, answering with exactly what the outbox tables take, auth through an injected token provider) have landed. B2 has landed too: the app and its two extensions as an XcodeGen project (`ios/project.yml`; the Xcode project is generated, not committed), built and BaliCore tested on an iOS Simulator by a macOS CI job on PRs that touch `ios/` — and BaliCore's client now refuses redirects. B3a has landed: the phone's outbox store (`ios/BaliOutbox`, GRDB in the app group), BaliCore's tables applied, with a retry bound — a refused record, or one left unsettled by 8 server answers, is stuck: kept (an unlock until recorded), retried and shown, holding neither the records behind it nor the phone's reads, though an unrecorded unlock still guards its session. B3b has landed, in two parts — the sync engine (`SyncEngine`, in `ios/BaliOutbox`). B3b-1, its drain: the outbox sent through the app's one `APIClient`, a retry-now, and the waits on sign-in (no token: nothing sent or counted; a 401: B4's refresh, then everything again at once, once per rejection), with `settle` reading an answer only by its own record's table. B3b-2: the 30-second check-in in the foreground; the reconcile — the phone's truth (`SyncState.standing`, and a tap not yet answered) from its own changes, their answers and reads stamped by `readMayReconcile`, with the unlock guard — observable for the screens and enforcement; and one outbox file for the app and its extensions (a busy timeout, suspension behind the app, persistent WAL). B4, sign-in, ships in three for size: B4a has landed — the API accepts a list of app client ids (`AUTH_AUDIENCE`: the portal's and the phone's own, in one pool), and the dev pool has the phone's client and a hosted-UI domain — and B4b has landed: BaliCore's `SignIn`, Cognito's hosted UI with PKCE over the phone's public client, the tokens in the Keychain, renewed one at a time on their own clock, and only Cognito refusing the refresh token (`invalid_grant`) signs anyone out. B4c (the app's wiring) is next.** **The owner ruled on open decisions 7–11 (2026-09-24):** decision 11 files an unlock made while the phone's own tap is unanswered under that tap — A11 built its endpoint, B6 and C5 use it. **The owner ruled out a student allow-list — the shield blocks every app a third party can block — and approved D1, so A6–A8 no longer wait on it (2026-09-24).** **Phase 2 is complete: the exit demo ran green against Railway dev.** Retroactive audit of the pre-gates Phase 1/2 code: nine findings confirmed, landing as gated PRs; offset timestamps and the SSE write-after-end crash are on `main`. **The owner ruled on the audit's held `/v1` questions (yes to all five): #29, then #28, then the block fix.** `/v1/me` now stores a display name the token actually carries, so the live grid shows a readable name wherever the token has one, instead of a UUID prefix._

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
  (edit own name, unique within each class), A9 (the live grid's unlocks
  and late records), A10 (a late unlock recorded, never applied — the
  owner's ruling), A11 (an unlock sent under its unanswered tap, filed
  where the tap landed — decision 11) and A12 (the phone's own order, not
  its clock, orders a student's unlock against their return — the owner's
  ruling) landed, and so has all of B1 — B1a (BaliCore's wire
  types and the fixture contract tests), B1b (the outbox tables in Swift)
  and B1c (the API client) — B2 (the app skeleton and its macOS CI), B3a
  (the outbox store and its retry bound), B3b, the sync engine (B3b-1,
  its drain; B3b-2, the check-in, the reconcile and one file for the app
  and its extensions), B4a (the API accepts the phone's own app client
  beside the portal's: `AUTH_AUDIENCE` is a list) and B4b (BaliCore's
  sign-in: `SignIn` and its Keychain store); B4c is next.** Of the owner decisions Phase 3
  needs (items 6–11 under Open product decisions), 7–11 are decided
  (2026-09-24), and 6 is open;
  steps that need the owner's iPhone are marked 📱. Phase 0's open question
  gates B5: confirm the DeviceActivity extension fires at interval END with
  the app force-quit.
- **BaliCore has landed** (B1a, 2026-09-24): `ios/BaliCore`, the iOS apps'
  Swift package, decodes every contract fixture in the "BaliCore Swift tests
  (Linux)" CI job — and since B1b its outbox tables must give every fixture's
  disposition and every generated case in `contracts/outbox/` the
  TypeScript's answer there too, so a change to a table in `@bali/shared`
  fails that job until the port follows — and since B1c its API client must
  send every fixture's request as recorded and return its answer as the
  status and body that land on its disposition. **Owner's call:** whether to make
  that job a required check in `protect-main` — it runs on every PR, not
  path-filtered, so requiring it never leaves a PR waiting on a check that
  did not run.
- **The iOS app skeleton has landed** (B2, 2026-09-24): `ios/project.yml`
  generates the Xcode project — the app and its DeviceActivity monitor and
  shield extensions, on v2's identifiers — and the **iOS** workflow's
  "iOS app + BaliCore tests (iOS Simulator)" job builds the app and runs
  BaliCore's tests on an iOS Simulator (Xcode 26.6, GitHub's `macos-26`) on
  every PR that touches `ios/`; other PRs skip it, and a skipped job reports
  success. **To run it on your iPhone** (B5, B6): `ios/README.md` —
  `brew install xcodegen`, `xcodegen generate` in `ios/`, sign in to team
  `H535678UF8` in Xcode, run the **Bali** scheme on the phone. **Owner's
  calls:** whether to make the job required in `protect-main` (it reports on
  every PR, so requiring it never leaves one waiting); and once the repo is
  private, moving it to your Mac is its `runs-on` line (decision 9).
- **No student allow-list, and D1 approved** (owner, 2026-09-24). The shield
  blocks every app a third party can block (`.all()`, no app picker anywhere);
  iOS itself keeps calls, FaceTime, Messages and Emergency SOS working. Known
  gap: an app a student medically needs is blocked too — Emergency Unlock is
  the exit at launch, and any carve-out is the owner's later call
  (ARCHITECTURE, iOS "Decided later"). D1's screens are approved, so A6–A8 no
  longer wait on the owner. Why: `docs/DECISIONS.md`.
- **A late unlock is recorded, never applied** (owner, 2026-09-24; A10 ✅):
  an unlock stuck on the phone while the student's own refocus or tap went
  ahead of it lands noted `superseded`, the return left standing. **To know:**
  closed for a build that sends the phone's own order (A12 ✅ — BaliOutbox
  sends it with every record): "after" is then the order the phone acted in,
  so a clock turned back between the student's tap and a real unlock no
  longer makes that unlock read as late. It stays for a build that sends no
  order, and for a pair the order cannot place (another install's return — a
  reinstall, another phone): there the clamped times still decide, so such a
  clock makes a real unlock read as late — recorded all the same, and
  answered with the focus the phone then shields to, so the grid is never
  green over an unshielded phone, but that unlock does not take until the
  clock is right (C5). Why: `docs/DECISIONS.md`.
- **An unlock made before the tap's answer is filed under its tap** (owner
  decision 11; A11 ✅): `POST /v1/taps/{eventId}/unlock` files it in the
  session the caller's own tap landed in, or keeps it with no session —
  `tap_armed` (the Start then joins the student without it), `unknown_tap`
  (not arrived, refused, or another's). **To know, decided here:** a tap
  that lands after its unlock files the kept record then (a fresh `unlock`
  naming it, `unattached_event_id`), so the order the two reach the server
  never changes the truth; they serialise on the tap (an advisory lock),
  about 0.6 ms a tap. An armed tap's Start files nothing. Why:
  `docs/DECISIONS.md`.
- **The phone's sign-in exists on dev** (owner, 2026-09-24; B4a ✅): the
  pool's hosted-UI domain, `https://bali-dev.auth.us-east-1.amazoncognito.com`,
  and the phone's public client `bali-ios-dev` (`33qr62dl4ee4inigneidmfe2s9`),
  checked with an authorize request — `docs/DEPLOY.md`, "The phone's
  sign-in". Next: the planning session appends the client id to dev's
  `AUTH_AUDIENCE` once B4a has deployed, and B4c puts both values in
  `ios/project.yml`. **To confirm (owner):** the client's refresh-token
  expiration is above Cognito's 30-day default, at which every student
  would be signed out monthly. Production's are still to make (Phase 5).
- **BaliCore signs the student in** (B4b ✅, 2026-09-25): `SignIn` runs
  Cognito's hosted UI with PKCE in a browser session the app hands it
  (ephemeral: no cookie outlives a sign-out), keeps the tokens in the
  Keychain (`WhenUnlockedThisDeviceOnly` — B5 revisits it if work behind a
  locked phone needs a token), and signs out only when Cognito refuses the
  refresh token (`invalid_grant`); a network blip, a 5xx or the API's own
  `401` never does, and a sign-out never touches a queued record. **To
  know:** the Keychain store has no test in the package — a package's tests
  carry no entitlement, so the Keychain refuses them — and first runs in the
  app (B4c). Why: `docs/DECISIONS.md`.

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
- **A10** A late unlock — stuck on the phone (B3a's bound) while the student's own refocus or tap went ahead of it — is recorded, never applied (owner ruling, 2026-09-24) — ✅ `unlock` notes it `superseded` (`UNLOCK_RECORDED_AS`, additive) and flips nothing when the student's own `refocus` or `tap_in` in that session came after it. "After" is the server's order (rule 1): the clamped times, a return's never later than the server recorded it (`recorded_at` — a clock fast at the return cannot outrank the real unlocks after it), and a tie flips (a clock behind all lesson clamps every claim to the start). Protection off still comes first. Answered `recorded` with the session and the state it left alone — which the phone applies (B3b-2, unchanged) — so `unlockDisposition` deletes it; judged under the session lock (a real-Postgres race against the refocus or re-tap). The grid leaves the chip alone and the snapshot's turn looks past it; the history shows it at its own time with its note; BaliCore's `UnlockRecordedAs` has it, and a fixture (`unlock/recorded-superseded`). A clock turned back between the return and a real unlock is the one case a clock decides: recorded, and answered with the focus the phone shields to — never green over an unshielded phone — but that unlock does not take until the clock is right (closed by A12 for a build that sends the phone's order). ARCHITECTURE gained two clauses on the owner's word: a stuck record stops holding reads (the unlock guard aside), and the live grid keeps a student removed mid-session
- **A11** An emergency unlock made while the phone's own tap is unanswered is filed under that tap (owner decision 11) — ✅ `POST /v1/taps/{eventId}/unlock`, the session unlock's body and answer (`UnlockRequest`, `UnlockResponse`; `unlockDisposition`): `unlockUnderTap` files it in the session the caller's own `tap_in` under that id landed in, by that session's rules (`unlockIn`, shared with `unlock`: the notes, A10's, the clamp to its window), naming the tap (`payload.tap_event_id`) — or keeps it unattached like an unknown session's, noted `tap_armed` (the tap waits for Start; the Start joins the student without it) or `unknown_tap` (no tap of the caller's has that id: not arrived, refused, another student's — never filed into their session). A tap landing after the unlock sent under it (`tapIn`) files the kept record there, under a fresh id naming it (`unattached_event_id`), and answers the state it leaves (`joined`, `unlocked`), so both arrival orders end alike; the two serialise on the tap (`lockTap`, an advisory lock taken before the session's), and every tap looks through a partial index (`events_unattached_tap_idx`) — ~0.6 ms a tap for both, measured. Idempotent on the unlock's own id: a retry answers where it was recorded, never re-filed; an id another event holds is `409`. Never refused, a teacher's or a stranger's included. Tests: the engine on PGlite (filed, a switch, the rules, armed, unknown, another's, both orders, a late tap, a retry, the index), two real-Postgres races (both orders; the interleaving the lock exists for, staged), the API, five fixtures (`tap-unlock/*`, `taps/joined-unlocked`), BaliCore's vocabulary and `unlock(tap:_:)`. Riders (#76's review): a late unlock stays `superseded` once the student has left the session, so the grid never paints "Left · unlocked" over a phone shielded at the bell; and the snapshot looks past that note on an unlock only
- **A12** The phone's own order, not its clock, decides whether a student's unlock came after their own refocus or tap (owner ruling, 2026-09-24) — ✅ one optional field on every record the phone's outbox sends — the tap, both unlocks, the refocus, and protection off, whose body is the refocus's — `order: { install, seq }` (`ActionOrder`, `isActionOrder` in `@bali/shared`; BaliCore's request types): the outbox file's install, minted once per file (BaliOutbox's migration `v2`), and the record's own `seq`, a counter no clock moves, the same on every retry. The engine keeps it in two columns on `events` (`order_install`, `order_seq`, both or neither — off the live feed; an armed tap keeps it on `armed_taps` for the `tap_in` its Start records), and `returnedSince` reads it: a return from the unlock's install is after it exactly when its seq is greater; any other pair — no order on either side or on one (an old build's), another install's (a reinstall, another phone) — keeps A10's time rule. Protection off first; the ended row, A11's tap-bound unlock and `tapIn`'s filing of a kept one by the same order; occurred times unchanged (rule 1). A malformed order is taken as none on every endpoint, never a `400` (it would keep an unlock out for good); a forged one is the student's own claim about their own two actions, recorded either way. Tests: the engine on PGlite, a real-Postgres race (a late unlock against the return that went ahead of it, on a clock turned back), the API, five fixtures (`*-ordered`), BaliCore and BaliOutbox. Riders (#77's review): an unlock kept `unknown_tap` whose tap then arms is never filed — pinned by an engine test (the Start joins focused, the record in no class) — and the chip turn's unlock-only scope is commented as deliberate
- **D1** Design the student screens with no reference screen, on a canvas built with the Bali Design System — ✅ approved (2026-09-24) after the owner's changes: a light theme like the teacher app, the ring mark without its tile, no allowed-apps screen, and a Focus screen in three states (normal, final two minutes, offline): [Bali student app screens](https://claude.ai/artifact/DdfRPhHu4whXLxe58hBAie)
- **B1a** `BaliCore` Swift package: skeleton, every wire type, fixture decode tests, a Linux Swift CI job — ✅ `ios/BaliCore` (Swift 6, Foundation only; iOS 17, macOS 14, and Linux for the tests): every student endpoint's request and response and the vocabularies they use, mirroring `@bali/shared`. A closed vocabulary decodes as `OrUnknown` — a value this build does not know is `.unknown`, never a failed decode — and an error's `reason` it does not know reads as none. Times accept `toISOString()`'s milliseconds or none, and encode with them. The contract test walks `contracts/fixtures/` in place: each body decodes strictly as the type it names and encodes back the same, each request body encodes as sent, a fixture of a type BaliCore does not map fails; the vocabularies are also checked against the TypeScript lists themselves. CI: "BaliCore Swift tests (Linux)" in `ci.yml`, in `swift:6.4-noble`, on every PR — making it required is the owner's ruleset call
- **B1b** The outbox tables in BaliCore: `tapDisposition`, `stateChangeDisposition` and `unlockDisposition` ported, and `readMayReconcile`; the contract test checks each fixture's `disposition` against the port — ✅ `UnlockContract.swift` and `OutboxContract.swift`: the same names, a `SendResult` (a status, or `.networkError`) and the answer decoded as its response type — nil when there is none or it does not decode, and an outcome the build does not know is `.unknown`: both `retry`, the record kept — each rule's comment carried over (no unlock result ever means discard; a refused state change is final for its `eventId`), exhaustive switches in place of the TS `Record` tables. Parity, both ways: every fixture's `disposition` must be the port's (a disposition on an endpoint with no port fails), and `contracts/outbox/` holds the TypeScript's own answer on inputs the API does not send — 25 results (no answer, each status class's edges, 408, 429) × 37 bodies (none; every outcome any table knows, each unknown to another, and five none knows; with a session, a null one, none) per table, and 81 pairs of stamps for `readMayReconcile` — written by a golden test in `@bali/shared` (`outbox-cases.test.ts`), which `npm test` fails on drift and `npm run fixtures` (now every workspace's generator) rewrites; CI diffs all of `contracts/`. The cases reach every value of each TS disposition union, and the Swift enums must be exactly the values they reach; `readMayReconcile`'s scenarios are ported as Swift tests. Rode along (#69's review): the inline unions BaliCore mirrors are `as const` lists in `@bali/shared` (`UPDATE_ME_OUTCOMES`, `CHECK_IN_STATUSES`, `REFOCUS_OUTCOMES`, `PROTECTION_OFF_OUTCOMES`, `ENROLLMENT_JOIN_OUTCOMES`, `END_ENROLLMENT_OUTCOMES`, `END_ENROLLMENT_REASONS`), read by the vocabulary test and used by the fixture schemas; and each null field of a fixture is now compared too — sent a probe no type takes, which BaliCore must refuse or bring back
- **B1c** The API client: `URLSession` with async/await and an injected token provider (`FoundationNetworking` on Linux), coding with `BaliJSON` — ✅ `APIClient.swift`: one method per student endpoint, typed request in, `APIResponse` out — the `SendResult` and the body for that status (the response type on a 2xx, `ApiErrorBody` on any other, nil when it does not decode), which the outbox tables take whole; no method throws, and it sends each request once and judges nothing. The bearer token comes from an injected `TokenProvider`, asked before every request: none to give is `.networkError` with `noAnswer: .noToken` — nothing sent, the record kept, never a sign-out — and a `401` comes back as a value for the caller's `reauth`. An `HTTPTransport` seam, over an ephemeral, cache-less URLSession by default; 15 s without a byte, 30 s a whole exchange, a timeout `.networkError`; a JSON content type only with a body (Fastify 400s one on a bodiless `DELETE`); path and query values escaped. Its tests send every fixture's request through a transport double and feed its answer back to its disposition, plus no answer, undecodable bodies, a 401, no token, and a real local socket (an answer, and a timeout). Rode along (#70's review): `stateChangeDisposition` is one entry point, so a literal `nil` body compiles. **B1 is complete**
- **B2** App + extension skeleton (XcodeGen: app, DeviceActivity monitor, shield UI, app group) + macOS CI on GitHub-hosted runners, only on PRs touching `ios/` (decision 9). Identifiers — v2's, as the Family Controls entitlement request used them: team `H535678UF8`; app `com.bali.Bali`; extensions `com.bali.Bali.BaliShield` (shield UI) and `com.bali.Bali.BaliMonitor` (DeviceActivity monitor); app group `group.com.bali.shared` — ✅ `ios/project.yml` is the project: `xcodegen generate` writes `Bali.xcodeproj`, which git ignores (`ios/README.md` says how to open and run it). Three targets on iOS 17, iPhone only, Swift 6, automatic signing on the team: `Bali` (SwiftUI; a placeholder screen showing BaliCore is linked — the screens are C1–C6), `BaliMonitor` (principal class `SessionMonitor`, a `DeviceActivityMonitor`) and `BaliShield` (`ShieldConfigurationExtension`, iOS's default shield for now), both embedded in the app, their overrides empty with a `// B5:` note each. Hand-written `Info.plist` (only what Xcode does not generate) and `.entitlements` per target, v2's: Family Controls and the app group on all three, NFC tag reading (v2's formats, NDEF and TAG) and its usage string on the app. CI: the **iOS** workflow — a Linux job reads the PR's changed files, and only when `ios/` or the workflow changed does "iOS app + BaliCore tests (iOS Simulator)" run on `macos-26` with Xcode 26.6: XcodeGen 2.46.0 (pinned, checksummed), the app built for the simulator with signing off, BaliCore's tests run on it. Moving it to the owner's Mac is its `runs-on` line. Rode along (#71's review, security): BaliCore's URLSession transport refuses redirects — a 3xx comes back as its status (`retry`, the record kept) instead of resending the request, bearer token and all, to the host a `Location` names; proven over the local-socket harness. And #71's socket timeout test is bounded against a session of its own that would wait four minutes, not the default's fifteen seconds: the simulator on GitHub's runner stalls for up to thirteen seconds at a time, once past its old ten-second bound
- **B3a** The outbox store: GRDB in the app group, BaliCore's tables applied, and the retry bound — ✅ `ios/BaliOutbox` (GRDB 7.11.1, pinned; student-only, linked by the app): `outbox.sqlite` in `group.com.bali.shared` (`Outbox.appGroupURL`), one row per record (a UUIDv7 minted when the phone acted, its kind and payload, `recordedAt` sent as `deviceTime`, attempts, the next attempt, `stuck`, the last answer for a screen). `record(_:now:)` queues a change: a tap or an unlock supersedes every queued refocus, unsent, and protection off is reported once per revocation (again after a tap, `protectionRestored()`, or in another session). `nextDue(now:)` goes in the order the phone acted: a pending record holds the ones behind it, a stuck one steps aside, and a refocus waits for the unlock it returns from, stuck or not. `settle(eventId:with:now:)` applies the table: an ending disposition deletes, any other keeps, due after 2 s, 4 s, 8 s… capped at 60 s, plus up to as much again at random. **The bound** (#59's, #70's reviews): refused, or left unsettled by 8 server answers (any status but 401, 408, 429 — a 5xx, a 3xx, a 2xx this build cannot read), a record is stuck: kept (an unlock until recorded, a tap until a 2xx; a state change is never dropped for it), retried and shown, holding neither the records behind it nor the phone's reads (`awaiting()`), while an unrecorded unlock still guards its session (`holdsUnlock(session:)`: no read puts its shields back on). Its tests run on Linux (`ci.yml`) and on the iOS Simulator (`ios.yml`), against `contracts/outbox/` and the fixtures. Rode along: ESLint skips SwiftPM's `.build` (GRDB's checkout carries JavaScript)
- **B3b-1** The sync engine's drain: the loop draining `nextDue` through one shared `APIClient`, the waits on sign-in, a retry-now — ✅ `SyncEngine` (`ios/BaliOutbox/SyncEngine.swift`), an actor holding the app's one `APIClient` (one URLSession for the app's life; `engine.client` for the screens' own calls). `run()` drains in the order the phone acted: the record due is sent (`OutboxRecord.send(through:)`) and settled, then the next — or a wait for its backoff, or for a ring (`record`, the only way the app queues a change, or a retry). No token (`.noToken`): nothing was sent, so nothing is settled or counted, and the record waits on sign-in — a ring, or a minute — never a sign-out, never dropped. A 401 settles as `reauth` and asks B4's seam, `refresh` (true once a fresh token is ready), then sends everything again at once — once per rejection, so a server rejecting every token never makes the phone spin. `retryNow()` (`Outbox.retryNow(now:)`, moved from B3a): everything queued due now — the student's retry (rule 5), and B4's after a sign-in; stuck stays stuck. `updates()` streams `SyncState` for the screens: the queue (a stuck record with its last answer), the link (reached, unreachable, sign-in, storage failed), when the server last answered, when the outbox sends next, and the last state change the server refused — dropped for good, so kept to show. Rode along (#73's review): `settle` takes a `Sent`, which only `send(through:)` makes — the record's own endpoint, read by its own kind's table — so a mismatched answer cannot happen. Tests: the drain against a hand-answered transport and a clock the test moves, on Linux and the iOS Simulator. Split from B3b for size
- **B3b-2** The check-in and the reconcile, and one file for the app and its extensions — ✅ `SyncState.standing` is the phone's truth — out, waiting (armed), or in a session in a state, shielded only while `focused` (a state this build does not know never is) — beside `pendingTap`, a tap not yet answered, which B5 shields for at once to decision 7's cap. The phone's own change stands at once; a change's own answer applies when it names a live session (a session and a state) unless a later change of the phone's still waits for its own; armed waits for the Start but never ends a session the phone is in; an answer naming no live session re-reads the truth (`GET /v1/me`). Reads — the check-in every 30 s in the foreground only (`setForeground`), and `GET /v1/me` on coming to the foreground and whenever an answer says so — are stamped when sent and applied only when `readMayReconcile` says no change can be newer; `gone` or a `404` re-reads. The unlock guard: no read turns a session's shields back on over an unrecorded unlock (`holdsUnlock`) — its window applies, as `unlocked` — unless the phone is focused there already, by a refocus or a tap made since; the end, or another session, always applies. Each step changes the state at once, so enforcement never sees half of one. One file, as GRDB's "Sharing a Database" says: a 5 s busy timeout; `Outbox.suspend()` and `resume()`, posted by the app as it leaves and enters the foreground (`BaliApp`), so no lock is held while it is suspended (0xdead10cc) — a write refused then is no failure, and the engine sends again once the app is back; persistent WAL for the processes that only read; the open and the migration coordinated (`NSFileCoordinator`); a file a newer build migrated refused. Tests on Linux and the iOS Simulator, two connections on one file among them. An unlock made while the phone's own tap is unanswered is decision 11's, filed under that tap (A11's `POST /v1/taps/{eventId}/unlock`, BaliCore's `unlock(tap:_:)`; until B6 and C5 use it, `record` needs a session). Rode along (#74's review): a cancelled `run()` runs again; a refused change is shown until the phone's next change; `Sent` carries its answer's session and state, which the reconcile applies; two 401s at once — the drain's and a read's — share one refresh; and a failed read of the outbox anywhere in the engine is shown
- **B4a** The API accepts a list of Cognito app client ids — ✅ `AUTH_AUDIENCE` is comma-separated: the portal's web client and the phone's own share one pool, and WEB.md keeps them apart (their callback URLs and grant settings differ), so a token from any client the list names is accepted — an access token's `client_id`, an id token's `aud`. One id accepts exactly that client, as before; an empty entry fails the boot rather than drop a client. Owner action, done for dev the same day: the pool's hosted-UI domain and the phone's client, `bali-ios-dev` (`docs/DEPLOY.md`, "The phone's sign-in"), whose id is appended to dev's `AUTH_AUDIENCE` once this is deployed — a list set before would have matched no token. Rider (#78's review): `returnedSince` reads the student's returns within `[started_at, ends_at]`, sound only because a window never shrinks (`extendSession` only moves `ends_at` later) — commented there, and pinned by a PGlite test: a re-tap, an extension, then a late unlock still `superseded`. Split from B4 for size (612 counted lines)
- **B4b** Cognito PKCE sign-in in BaliCore: `SignIn`, B1c's `TokenProvider`, over a `TokenStore` — ✅ `SignIn` (`ios/BaliCore`), an actor: `signIn(through:)` opens Cognito's hosted UI in the browser session the app hands it — ephemeral (`WebAuthenticationSession`, B4c; C1's screen later), so BaliCore stays free of UI — with the code grant, PKCE (S256) and a state value, takes the code only at `bali://auth/callback` for its own attempt, and exchanges it at `/oauth2/token` as the phone's public client: no secret anywhere, no token in any URL. The tokens: `KeychainTokenStore` (`WhenUnlockedThisDeviceOnly`, no shared group; the engine sends only in the foreground, and B5 revisits it if background work needs a token), memory in the tests. An access token is given until its own lifetime (`exp` − `iat`, the server's clock) less 60 s has passed since it came, then renewed with the refresh token — one renewal at a time, every caller sharing it; a rotated refresh token is kept (saved again at the next ask if the Keychain refused it then). The engine's `refresh()` takes the rejected token out of use and renews it, never waiting on the student; every other token (a sign-in, a renewal of its own) runs `whenTokenArrives`, for the engine's `retryNow()` (B4c). Only `invalid_grant` — Cognito refusing the refresh token — signs out; a timeout, a 5xx, a 429, no network or the API's own `401` keep the tokens, and a sign-out never touches a queued record. `signedIn()` streams whether anyone is signed in, for C1's screen. `cognito` is `nonisolated` for the app (B4c's change, made here). SHA-256 on Linux from swift-crypto 4.5.2, exact. Tests: `SignInTests.swift` on Linux and the iOS Simulator — PKCE against RFC 7636's example, the callback, the exchange, the clock and margin, renewal, rotation, the one sign-out, the engine's refresh, a shared renewal, a locked Keychain, a sign-out or a sign-in mid-renewal; of 42 mutations of `SignIn`, 41 turn a test red, and the 42nd changes nothing a caller can see. `KeychainTokenStore` is not unit-tested: a package's test process has no Keychain entitlement (-34018), so its first run is the app's (B4c). Split from B4 for size
- **B4c** The app's wiring: `SyncEngine.make`, `BaliApp` starting the one engine over `SignIn`, the sign-in's build settings in `ios/project.yml` (the API, the hosted-UI domain, the phone's client id, the redirect URI), and the BaliOutbox suites' time limits raised to 3 minutes. B1c's `TokenProvider`: nil when there is no token right now, which is never a sign-out; refreshing after a `reauth` is B4's, through `SyncEngine`'s `refresh` seam (true once a fresh token is ready: the engine then sends everything again at once; it returns at once — false when only the student can give a token — since the drain waits on it), with `retryNow()` once a sign-in gives the provider a token. **B4's contract with the engine:** `refresh` is asked once per rejection — a fresh token rejected too is not refreshed again until an answer that is not a 401, or `retryNow()` — so from there recovery is B4's: `accessToken()` never gives a token it knows has expired, and every token B4 gets but through `refresh` (a sign-in, a refresh of its own) is followed by `retryNow()`. The app's one `SyncEngine` starts with B4's provider: `run()` for the app's life, and `setForeground` from the scene phase, beside `BaliApp`'s `Outbox.suspend()` and `resume()`
- **B5** Enforcement: shields (every app a third party can block — `.all()` apps and web domains, no picker), session schedule, monitor extension, custom shield — 📱 settles Phase 0's open question. A tap the server has not answered yet schedules the 50-minute cap of decision 7. Note: "only a re-tap leaves protection off" holds per participation, not per phone — an armed tap converted at another teacher's Start joins that session focused, so the phone must re-report protection off there at its next check-in. The seams are B2's: `SessionMonitor` (`ios/BaliMonitor`) — `intervalDidEnd` clears the shields — and `ShieldConfigurationExtension` (`ios/BaliShield`), whose one `shield()` draws the custom shield; each `// B5:` note says what goes there. And B3b's: the engine's `updates()` is what to shield to — `standing` (while `focused`, until `endsAt`) and `pendingTap` (the cap) — rule 3's check of the shields goes before each check-in (the engine's read loop), and protection found revoked is `record(.protectionOff(session:))`. The outbox file is ready for the extensions: iOS gives them no notice before suspending them, so they open it, act and close — and the 📱 checkpoint checks that the coordinated open (`NSFileCoordinator`) never stalls one, as a coordination held by a suspended process would; the standing lives in the engine's memory, and keeping it in the app group for the monitor is B5's. A stuck protection-off report stops holding reads (B3a's bound), so a read can put `standing` back to focused over it: what a screen claims is B5's check of the shields (rule 3), never `standing` alone
- **B6** NFC tap → local record → shield → outbox — 📱 The app's NFC entitlement and usage string are in (B2); v2 read the block with `NFCNDEFReaderSession`. An emergency unlock made while that tap is still unanswered is filed under the tap (decision 11): sent with the tap's `event_id` to A11's `POST /v1/taps/{eventId}/unlock` through BaliCore's `APIClient.unlock(tap:_:)`, answered as any unlock (`unlockDisposition`), and always sent there, even once the tap's answer names a session: a retry is answered where it was recorded, and the session route would refuse an id another session holds. Its tap, answered later, may say `joined` and `unlocked` — the unlock filed then: `apply_session`, no shield. Its request carries the record's order like every other outbox record (A12: `OutboxRecord.request`), so the server orders it after its tap whatever the clock says
- **C1–C6** Screens: onboarding · join + preview · home / waiting · focus · unlocked, protection off, session over · history + me. C5: an unlock answered `superseded` means a return to focus went ahead of it — the shields come back. From a build that sends the order (A12) it never means a wrong clock: the phone's own returns are placed by its counter, so with no refocus or tap of the phone's since, the return that went ahead is one the order cannot place (another install's — a reinstall, another phone — or one sent without an order); say so. Only for a build with no order does it mean the clock is behind — say why, and how to set the time right (A10). One answered with no state — the student has left the session — re-reads the truth (A11)
- **E1** Device test gate: ISSUES #2 on hardware — 📱

## Go-live features

### In scope for launch (phase noted)

| Feature | Phase | Notes |
|---|---|---|
| Core loop: tap→shield offline, armed taps, live grid, unlock always-recorded, refocus, join codes, roster, removal, self-expiry | 1–2 | ✅ built |
| 30s check-in that verifies shields before claiming them | 3 | rule 3. **API ✅ (A2):** a revoked permission is reported with `POST /v1/sessions/{id}/protection-off`; refocus is refused out of it and an unlock never softens it (the grid mirrors the unlock rule; a refocus is never recorded out of it, so there is none to mirror) — only a re-tap returns to focus. A report that first reaches the server after the bell is recorded with a note, like a late unlock (A2c). **Phone ✅ (B3b-2):** the check-in every 30 s in the foreground, its answer reconciled; checking the shields before each is B5's |
| Shields survive force-quit; bell frees phone via extension | 3 | pending spike confirmation |
| Onboarding: privacy contract → sign-in → Screen Time grant | 3 | no allow-list step: the shield blocks every app it can (2026-09-24). **Sign-in ✅ (B4b):** BaliCore's `SignIn` — Cognito's hosted UI with PKCE in an ephemeral browser session, the tokens in the Keychain, signed out only by Cognito refusing the refresh token; B4c wires it into the app, C1 draws the screen |
| Consent preview before joining a class | 3 | **API ✅ (A6):** `GET /v1/join-codes/{code}` — the class, its teacher's name, already enrolled; matched as the join matches, and refused as it refuses. The screen is C2 |
| Unlock with optional, skippable reason (bathroom/nurse/other) | 3 | replaces full "passes" at launch. **API ✅ (A1):** optional `reason` on unlock, stored as `payload.reason`, never a reason to refuse. It is fixed once recorded (a replay keeps the stored one), so C5 either asks before sending or holds the send until the picker is answered or skipped. **Portal ✅ (A9):** the grid shows it on the chip, a protection-off one included |
| Custom shield screen ("Focused with Bali until 9:42") | 3 | its extension, `com.bali.Bali.BaliShield`, has the Family Controls distribution entitlement (granted 2026-09-24); B5 draws it |
| Minimal student personal history + edit own name | 3 | backs the privacy contract. **API ✅ (A7):** `GET /v1/me/history` — the moments a teacher sees, newest first, paged by an event-id cursor; the explicit tiebreak (`seq` inverts the converted-tap pair and `occurred_at` ties it) is a leave before anything else at one instant, then `seq` — see `events_user_occurred_idx`; `armed_tap_skipped` shows as a declined tap naming the class it counted in, never a join. **API ✅ (A8):** `PATCH /v1/me` — the student's own name, unique within each class (decision 8; serialised by class locks), recorded as a `display_name_changed` event; a join or a sign-in's fill is never refused over a name. An open grid shows it at its next 15 s snapshot (A9). The screen is C6 |
| Sign in with Apple (App Review guideline 4.8) | 5 | Cognito IdP |
| End-of-session recap card (portal) | 4 | |
| Reports: class focus minutes + unlock list; aggregates only, never rankings | 4 | `armed_tap_skipped` names a student who did NOT join — never count it as a join. An unlock or protection off noted `after_session_end` reached the server after the end, and its time is clamped to the scheduled window, so after an early end it can fall past `ended_at` — never count time beyond it. An unlock noted `superseded` changed no state — the student's own refocus or tap came after it — so never end focus time at it, after the end included. One kept unattached (`tap_armed`, `unknown_tap`, like `unknown_session`) is in no class; if its tap files it later, the filed one names it (`unattached_event_id`) — count one, never both. An unlock the phone's order applied (A12) can carry a time before the return it followed — order a student's own unlock and return as the engine did (by their `order_install` / `order_seq` when both carry one from the same install), never by the times alone |
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
11. An emergency unlock made while the phone's own tap is still unanswered —
    what it is sent to. **Decided 2026-09-24 — built (A11 ✅); B6/C5
    use it:** it is filed under its tap. The phone sends it with the tap's
    `event_id` (`POST /v1/taps/{eventId}/unlock`, additive), and the server
    records it in whatever session that tap landed in — late or noted, as
    today — or as an unattached record with a note when the tap was only
    armed or never arrived; never lost. On the phone, as the lean had it: the
    unlock is queued behind its tap, acted on at once, and guards whatever
    session the tap's answer names. (Naming the session the phone was in
    before the tap is wrong once the tap switches it.) Until B6 and C5 use it,
    `SyncEngine.record` needs a session, so nothing sends one.

Parked by design, blocking before real students: data-deletion policy,
under-13 parental-consent machinery.

## External / waiting

- Apple checklist: bundle IDs registered, App Store Connect record created.

No longer waiting: the **Family Controls distribution entitlement** (Apple) —
✅ granted (owner, 2026-09-24), so TestFlight and the App Store no longer wait
on Apple. Apple approves it per bundle ID, and all three targets use it:
`com.bali.Bali`, `com.bali.Bali.BaliMonitor` and `com.bali.Bali.BaliShield` —
v2's identifiers, which the request used and v3 reuses (B2). In the developer
portal each one shows "Family Controls (Distribution)" among its capabilities;
one without it can't ship through TestFlight.

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
