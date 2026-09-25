# Bali v3 — build plan & live status

The one file every session reads (after ARCHITECTURE.md) and updates when it
finishes work. ARCHITECTURE.md says *how*; this file says *what* and *where we
are*. Update rules are at the bottom.

_Last updated: 2026-09-25 — **Phase 3 (iOS student app) has started**, API and contract work first: the step list is under Phases, A1 (the unlock's optional reason), A2 (protection off, end to end on the server), A2b (no deadlock reaches a phone as a 500), A2c (a protection-off reaching the server after the bell is recorded with a note), A3 (the tap and state-change outbox tables, in `@bali/shared`), A4 (a retried tap or refocus recorded but no longer current is answered `200 replay` naming no session), A5 (contract fixtures of every student endpoint in `contracts/fixtures/`, and a machine-readable `reason` on errors), A6 (the join-code preview, `GET /v1/join-codes/{code}`), A7 (the student's own history, `GET /v1/me/history`), A8 (a student edits their own display name, `PATCH /v1/me`, unique within each class) and A9 (the portal's live grid shows an unlock's reason, an unlock under protection off, and late records that survive the refresh) have landed — the API and contract steps are done. **A10 has landed too, on the owner's ruling: a late unlock — stuck on the phone while the student's own refocus or tap went ahead of it — is recorded, never applied (noted `superseded`), and ARCHITECTURE gained two clauses (a stuck record stops holding reads; the live grid keeps a student removed mid-session).** **A11 has landed, on the owner's decision 11: an unlock made while the phone's own tap is unanswered is sent under that tap (`POST /v1/taps/{eventId}/unlock`, BaliCore's `unlock(tap:_:)`) and filed in whatever session the tap landed in, or kept with no session, noted `tap_armed` / `unknown_tap` — and a tap landing after its unlock files it then, so both arrival orders end alike. A late unlock stays `superseded` once the student has left the session (#76's review).** **A12 has landed, on the owner's ruling: the phone's own order, not its clock, decides whether a student's unlock came after their own refocus or tap — one optional `order` field (its outbox file's install and the record's seq) on every record the outbox sends, BaliOutbox sending it — so a clock turned back between the two never undoes a real unlock.** **A13 has landed, on the owner's ruling: the same order, read the other way — a refocus or re-tap the phone made before an unlock the server already has, landing after it, is recorded, never applied (noted `superseded`), so the unlock stands; A12's disclosed gap is closed.** **A14 has landed, on the owner's ruling: the same order, tap against tap — a tap the phone made before a later tap of its own into another class, reaching the server after it, is recorded, never applied (noted `superseded`): no switch back, and no arm a Start would convert; A13's disclosed tap-versus-tap gap is closed.** **The iOS steps have begun, and B1 — BaliCore — is complete: B1a (the `BaliCore` Swift package — every student wire type, decoded against every contract fixture on a Linux Swift CI job), B1b (the outbox tables ported to Swift, proven equal to the TypeScript's on every fixture and on generated cases in `contracts/outbox/`) and B1c (the API client: one call per student endpoint, answering with exactly what the outbox tables take, auth through an injected token provider) have landed. B2 has landed too: the app and its two extensions as an XcodeGen project (`ios/project.yml`; the Xcode project is generated, not committed), built and BaliCore tested on an iOS Simulator by a macOS CI job on PRs that touch `ios/` — and BaliCore's client now refuses redirects. B3a has landed: the phone's outbox store (`ios/BaliOutbox`, GRDB in the app group), BaliCore's tables applied, with a retry bound — a refused record, or one left unsettled by 8 server answers, is stuck: kept (an unlock until recorded), retried and shown, holding neither the records behind it nor the phone's reads, though an unrecorded unlock still guards its session. B3b has landed, in two parts — the sync engine (`SyncEngine`, in `ios/BaliOutbox`). B3b-1, its drain: the outbox sent through the app's one `APIClient`, a retry-now, and the waits on sign-in (no token: nothing sent or counted; a 401: B4's refresh, then everything again at once, once per rejection), with `settle` reading an answer only by its own record's table. B3b-2: the 30-second check-in in the foreground; the reconcile — the phone's truth (`SyncState.standing`, and a tap not yet answered) from its own changes, their answers and reads stamped by `readMayReconcile`, with the unlock guard — observable for the screens and enforcement; and one outbox file for the app and its extensions (a busy timeout, suspension behind the app, persistent WAL). B4, sign-in, ships in three for size: B4a has landed — the API accepts a list of app client ids (`AUTH_AUDIENCE`: the portal's and the phone's own, in one pool), and the dev pool has the phone's client and a hosted-UI domain — and B4b has landed: BaliCore's `SignIn`, Cognito's hosted UI with PKCE over the phone's public client, the tokens in the Keychain, renewed one at a time on their own clock, and only Cognito refusing the refresh token (`invalid_grant`) signs anyone out — and B4c has landed, so B4 is complete: the app's one sync engine starts over the sign-in (`SyncEngine.make`), dev's API and sign-in are in `ios/project.yml`, a Debug-only readout shows the engine reaching dev for B5's device check, and a locked phone's Keychain is never a sign-out (only an item not found is nobody signed in). B5 (enforcement, 📱) ships in three, and B5a has landed: the shields follow the sync engine (`Enforcer` — focused, until the bell; a tap not yet answered, to decision 7's 50-minute cap), the Screen Time permission's API for C1, rule 3's check before each check-in (the shields put back, protection off reported — again whenever the phone stands focused, A13's rider), and the standing kept in the app group, so a relaunch keeps the shields; its device checklist, which opens with B4c's sign-in, is the owner's to run. B5b has landed too (below), and B5b-2 (its riders and #91's review), and B5c (Bali's own shield); B6 (the NFC tap) is next.** **T1 has landed: `npm run dev:teacher`, the device checks' teacher on dev from the terminal — a class, a block, a session and each student's state as it changes — since the portal cannot reach dev yet.** **B5a-2 has landed: #86's four review WARNs, fixed before the owner's device check — a standing the app group will not give back never takes the shields off, a check's finding is never lost to a pass, and a permission read not determined is reported only once it lasts a check-in interval, so a relaunch shows no false protection off.** **B5a-3 has landed: the remaining WARNs of #86's and #88's reviews, fixed before the device check — an Emergency Unlock kept with its standing in one write, so a relaunch after a kill never shields over it; rule 3's check offline too; no protection off after the phone's own bell, nor from a clock set forward; an unread standing that keeps an armed tap waiting and lets the enforcer's own shields go at the cap; the kept standing's form pinned — and the cause of `ReadTests.cadence`'s CI flake, an alarm ringing a pause it no longer owned.** **B5b has landed: the bell with the app force-quit, ARCHITECTURE's leaning (a) — the window the shields are on is registered with iOS as a DeviceActivity schedule (ending at the first whole minute on or after the bell or decision 7's cap, and 15 minutes long, iOS's floor: a shorter window starts in the past, its end never moved), and the monitor extension clears the shields at its end by the phone's clock and the standing kept in the app group — never over a session the standing says still runs, nor over a file it cannot read within 2 s, where it keeps them and tries again a minute on. Rider: the test rig's held sleeps. Its round 2 device checklist — Phase 0's question — is the owner's.** **B5b-2 has landed: B5b's app-side riders — an app test target (`BaliTests`, on the iOS Simulator) pinning the foreground check reading the scene phase as it runs, and the Info.plist keys pinned to BaliCore's config reader (`AppConfig`) — and #91's review: the app's open of the outbox never waits with no end, and only its first grant opens the file; a window iOS refuses the monitor, the app closed, is shown at the app's next open; the monitor's whole open and read waits at most 2 s; the cap never takes the last run's shields off over a standing not read (B5b's rider reversed: a session they may be for may still run); and B5b's stated bound corrected — with the app closed, the shields come off less than a minute after the bell, or less than two when iOS wakes the monitor early.** **B5c has landed: Bali's own shield over a blocked app, in D1's light look with the ring mark — "Focused with Bali until 9:42", the bell read from the standing the app keeps in the app group as the monitor reads it (within 2 s), in the phone's own time format; "Focused with Bali — waiting for your class" while a tap is unanswered; and "Focused with Bali" alone when the bell cannot be known — never a wrong time. Its round 3 device checklist is the owner's.** **The owner ruled on open decisions 7–11 (2026-09-24):** decision 11 files an unlock made while the phone's own tap is unanswered under that tap — A11 built its endpoint, B6 and C5 use it. **The owner ruled out a student allow-list — the shield blocks every app a third party can block — and approved D1, so A6–A8 no longer wait on it (2026-09-24).** **Phase 2 is complete: the exit demo ran green against Railway dev.** Retroactive audit of the pre-gates Phase 1/2 code: nine findings confirmed, landing as gated PRs; offset timestamps and the SSE write-after-end crash are on `main`. **The owner ruled on the audit's held `/v1` questions (yes to all five): #29, then #28, then the block fix.** `/v1/me` now stores a display name the token actually carries, so the live grid shows a readable name wherever the token has one, instead of a UUID prefix._

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
  where the tap landed — decision 11), A12 (the phone's own order, not
  its clock, orders a student's unlock against their return — the owner's
  ruling), A13 (the same order, the other way: a return older than an
  unlock the server has is recorded, never applied — the owner's ruling)
  and A14 (the same order, tap against tap: a tap older than a later tap
  into another class is recorded, never applied — the owner's ruling)
  landed, and so has all of B1 — B1a (BaliCore's wire
  types and the fixture contract tests), B1b (the outbox tables in Swift)
  and B1c (the API client) — B2 (the app skeleton and its macOS CI), B3a
  (the outbox store and its retry bound), B3b, the sync engine (B3b-1,
  its drain; B3b-2, the check-in, the reconcile and one file for the app
  and its extensions), B4a (the API accepts the phone's own app client
  beside the portal's: `AUTH_AUDIENCE` is a list), B4b (BaliCore's
  sign-in: `SignIn` and its Keychain store) and B4c (the app's wiring: the
  one engine over the sign-in, dev's values, a Debug readout) — B4 is
  complete — B5a (the shields follow the engine, the permission,
  rule 3's check and protection off, the standing kept), B5a-2 (#86's
  review: no false protection off after a relaunch, no standing from
  nothing) and B5a-3 (the rest of #86's and #88's reviews: an unlock
  kept with its standing, the check offline too, the unread standing's
  gaps, and `cadence`'s flake), B5b (the schedule and the monitor: the
  bell with the app force-quit), B5b-2 (its app-side riders, an app test
  target among them, and #91's review) and B5c (Bali's own shield, its
  words from the kept standing); B6 is next.**
  Of the owner decisions Phase 3
  needs (items 6–11 under Open product decisions), 7–11 are decided
  (2026-09-24), and 6 is open;
  steps that need the owner's iPhone are marked 📱. Phase 0's open question
  is B5b's round 2 on the owner's iPhone: confirm the DeviceActivity
  extension fires at interval END with the app force-quit.
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
- **A late return is recorded, never applied** (owner, 2026-09-24; A13 ✅):
  a refocus whose request outlived the phone's wait, or a re-tap stuck at
  the retry bound, that lands after the student's own later unlock is noted
  `superseded` and changes nothing — by the phone's order only; with none,
  or another install's, it applies as it arrives. **To know (owner):** one
  shape stays open, outside the ruling. A re-tap older than a *protection
  off* report still applies, lifting the row to focus over a phone iOS
  unshielded — the phone now says so again (B5a ✅): its check before the
  next check-in reports protection off again whenever the phone stands
  focused while the permission is off, so the grid is green for at most
  one check-in; the owner can still extend the rule to it on the server.
  The other shape A13 disclosed — a tap older than a later tap into another
  class switching the student back — is closed by A14 ✅. Why:
  `docs/DECISIONS.md`.
- **A late tap is recorded, never applied** (owner, 2026-09-25; A14 ✅):
  a tap the phone made before a later tap of its own into another class,
  reaching the server after it, is noted `superseded` and changes nothing —
  no switch back, no join; one that would only arm is kept consumed, so no
  Start converts it; and a waiting tap such a later tap went ahead of is
  declined at its Start, recorded there, never joined (decision 5's second
  exception). By the phone's order only; with none, or another install's,
  it applies as it arrives. **To know:** a student's taps now serialise on
  a per-student lock (~0.6 ms a tap with the look, measured); a tap that
  arms takes no lock, so one racing the later tap may still arm — its Start
  then declines it. Why: `docs/DECISIONS.md`.
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
  sign-in". Both are in place (2026-09-25): the client id is on dev's
  `AUTH_AUDIENCE` (appended once B4a had deployed), and both values are in
  `ios/project.yml` (B4c). The client's refresh-token expiration is raised
  above Cognito's 30-day default, at which every student would be signed
  out monthly — done for dev (owner, 2026-09-25; 365 days was asked for).
  Production's client and domain are still to make (Phase 5), that setting
  with them.
- **BaliCore signs the student in** (B4b ✅, 2026-09-25): `SignIn` runs
  Cognito's hosted UI with PKCE in a browser session the app hands it
  (ephemeral: no cookie outlives a sign-out), keeps the tokens in the
  Keychain (`WhenUnlockedThisDeviceOnly` — B5 revisits it if work behind a
  locked phone needs a token), and signs out only when Cognito refuses the
  refresh token (`invalid_grant`); a network blip, a 5xx or the API's own
  `401` never does, and a sign-out never touches a queued record. **To
  know:** the Keychain store has no test in the package — a package's tests
  carry no entitlement, so the Keychain refuses them — so it first runs in
  the app, on the owner's iPhone (B5's checklist); how it reads each
  Keychain status is pinned on the iOS Simulator (B4c). Why:
  `docs/DECISIONS.md`.
- **The app signs in and syncs with dev** (B4c ✅, 2026-09-25): `BaliApp`
  starts the app's one sync engine over `SignIn` (`SyncEngine.make`), with
  dev's API and sign-in in `ios/project.yml`. A Debug build's placeholder
  shows a temporary readout — the engine's link (reached, unreachable,
  sign-in, storage failed), when the server last answered, whether someone
  is signed in — with **Sign in** and **Sign out**, for B5's device check;
  C1–C6 draw the real screens. **To know:** the app has only ever been
  built on CI's simulator — its first run on a phone, the Keychain's
  included, is B5's checklist (under Phases). Rode along (#83's review):
  the PKCE verifier and state come from `SymmetricKey`; a sign-out the
  locked Keychain could not make is made at the next ask; a token the API
  refused stays refused across a relaunch. Why: `docs/DECISIONS.md`.
- **The shields follow the engine** (B5a ✅, 2026-09-25): while the phone
  stands focused, until the bell, and for a tap not yet answered, to
  decision 7's 50-minute cap; Emergency Unlock drops them at once. Rule 3's
  check before each check-in puts them back if iOS lost them and reports a
  revoked permission as protection off; the screens will claim only what
  it verified. The standing is kept in the app group, so a relaunch keeps
  the shields, offline too. **📱 Owner: the device checklist** (B5a's
  line under Phases, `ios/README.md` for the setup) — a Debug build
  against dev: the six sign-in checks from B4c, then the permission, a tap
  by a typed tag, Emergency Unlock, a revoked permission on the grid, a
  relaunch and the bell with the app open. **To know:** with the app
  closed, B5b's monitor takes the shields off at the bell (below; its
  round 2 checks it on the phone). The teacher's side is
  `npm run dev:teacher` (T1 ✅).
  **Hardened (B5a-2 ✅):** a standing the app group will not give back at
  launch leaves the shields as they were until it is read or the server
  answers, and a permission read not determined is reported only once it
  lasts a check-in interval — step 13 expects no false protection off after
  a relaunch. **Hardened again (B5a-3 ✅), the checklist unchanged:** an
  Emergency Unlock and the standing it leaves are one write, so a relaunch
  after a kill never shields over it; rule 3's check runs every 30 s in
  the foreground offline too; no protection off is reported for a session
  the phone's own clock has ended, nor from a clock set forward (the grace
  window is measured by uptime); the app's foreground check reads the
  phase as it runs, and a report the suspended file refuses shows no
  failure; the kept standing's form is pinned; over an unread standing an
  armed tap stays waiting, and the shields the enforcer put on for a tap
  still come off at the cap. Why: `docs/DECISIONS.md`.
- **The bell with the app closed** (B5b ✅, 2026-09-25): the app registers
  the window the shields are on as a DeviceActivity schedule — ending at the
  first whole minute on or after the bell, or decision 7's cap, 15 minutes
  long (iOS's floor; a shorter window, a tap in a session's last minutes,
  starts in the past and keeps its end) — again as it moves, and cancelled
  once the shields are off. At its end the monitor extension reads the
  standing and the queue the app keeps and clears the shields when nothing
  keeps them on by the phone's clock; a session the standing says still runs
  keeps them, and so does a file it cannot read within 2 s, where it asks to
  be woken a minute on. **📱 Owner: round 2** (B5b's line under Phases,
  `ios/README.md`): force-quit at the bell, a window under the floor, an
  unlock and an extension, the cap with the app closed (a Debug toggle caps
  a tap at 15 minutes), and the monitor never stalling — its readout line
  says when it woke and how long it took. **To know:** a window starting in
  the past, and a wake no earlier than the whole minute, are iOS behaviour
  assumed, and round 2 settles them with Phase 0's question; if iOS will not
  honour a window under 15 minutes, a tap in a session's last minutes keeps
  its shields until the app is opened. With the app closed, the shields come
  off less than a minute after the bell — less than two if iOS wakes the
  monitor before it, which then keeps them and asks to be woken the next
  whole minute on (B5b-2 corrected the bound; round 2 says so). Why:
  `docs/DECISIONS.md`.
- **B5b's riders and #91's review** (B5b-2 ✅, 2026-09-25): the app has a
  test target, `BaliTests`, hosted in the app and run by the iOS Simulator
  job — it pins the foreground check reading the scene phase as it runs, and
  that the built app's Info.plist gives a config; the config reader is
  BaliCore's `AppConfig`, its keys pinned to `Bali/Info.plist` and
  `project.yml` on Linux too. From #91's review: the app's open of the
  outbox ends in an error it shows, with Try again, if NSFileCoordinator
  ever returns without granting, and only the first grant opens the file; a
  window iOS refuses the monitor, the app closed, is shown at the app's next
  open (`Protection.monitorUnscheduled`) until one is registered again, and
  the skip rule of the registration is tested behind a protocol
  (`BellCenter`); the monitor's whole open and read waits at most 2 s,
  SQLite's locks included; and over a standing not read, the cap never takes
  off the last run's shields — a session they may be for may still run —
  so only the file read again, or the server's truth, ends them. **To
  know:** that reverses B5b's rider (#90's review): an offline tap over an
  unreadable standing keeps the last run's shields past its cap until the
  file reads or the server answers, as B5a-2 had it. Why:
  `docs/DECISIONS.md`.
- **Bali's own shield** (B5c ✅, 2026-09-25): over a blocked app,
  "Focused with Bali until 9:42" — the bell from the standing the app
  keeps in the app group, read by the shield extension as the monitor
  reads it (within 2 s), in the phone's own time format (its locale,
  12- or 24-hour as set, its zone) — in D1's light look with the ring
  mark and D1's line beneath; "Focused with Bali — waiting for your
  class" while a tap is unanswered, and "Focused with Bali" alone when
  the bell cannot be known: never a wrong time. **OK** closes the app;
  Emergency Unlock stays in the app (C5). **📱 Owner: round 3** (B5c's
  line under Phases, `ios/README.md`): the bell over a blocked app, and
  the new one after an extension; no shield after Emergency Unlock; the
  waiting words for a tap in Airplane Mode, then the bell once it is
  answered. **To know:** whether iOS asks for the words each time a
  shield shows, or keeps them until the shields change, is not
  documented — if it keeps them, an extension leaves the old bell up
  (round 3's step 1 shows it), and the follow-up is the app writing the
  store again as the bell moves. D1's font, sizes and layout are iOS's
  on a shield. Why: `docs/DECISIONS.md`.
- **The device checks' teacher, from the terminal** (T1 ✅, 2026-09-25):
  `npm run dev:teacher -- class | block | start | watch | extend | end`
  signs in as the exit demo's teacher (`.env.demo`, the demo's variables)
  and does on dev what the portal cannot yet — its dev client has no
  localhost callback, and no screen registers a block: a class and its join
  code, the block `DEVICE-CHECK-1`, a session, and `watch`, each student's
  state as the portal's grid would show it. **To know:** its first real run
  is the owner's — no session here has dev's credentials. Why:
  `docs/DECISIONS.md`.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 | iOS enforcement spike | ✅ NFC → shields <1s proven on device. ⚠️ Still to confirm on the owner's iPhone, B5b's round 2 (B5b is built): DeviceActivity extension fires at interval END with the app force-quit. |
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
- **A13** A return the phone made before an unlock the server already has is recorded, never applied (owner ruling, 2026-09-24; after B4, before B6) — ✅ closes A12's disclosed gap: a refocus whose request outlived the phone's wait, or a re-tap stuck at the retry bound while the unlock behind it went first, landed after that unlock and applied, and the next check-in put the shields back over the emergency unlock. `refocus` (`changeState`, its `returning` rule) and `tapIn` judge a return late when the student has an unlock in that session from the same install with a higher seq (`unlockedSince`) — any such unlock, whatever its note: the order says which action came last. By the order only: with none on either side, or another install's, the arrival order stands. Late, it is recorded, noted `superseded` (`RETURN_RECORDED_AS`, additive; BaliCore's `ReturnRecordedAs`), and changes nothing — no join, switch or reopening; on a live row, contact — and is answered as its retry is: `replay` with the truth now, the session and the state the unlock left (`apply_session`: deleted, the phone applies `unlocked`), or no session once the student is not live there (`reread`). Judged only where it would apply, so every refusal stands; protection off is never late; a tap is judged before it files what was kept under it (A11), and a late one still files it. Under the session lock, in the old lock order. Readers: the grid leaves the chip alone, the snapshot's turn looks past a late record of either kind, the history shows it with its note. Tests: the engine on PGlite, a real-Postgres race in both orders (unlocked either way), the API (refocus and tap, their dispositions, replay), two fixtures (`*/replay-superseded`) and a late refocus in `history/every-kind`, the grid, the snapshot, the history, BaliCore's vocabulary. Rider: `docs/GOTCHAS.md` — a draft marked ready reads green before its review runs
- **A14** A tap the phone made before a later tap into another class, reaching the server after it, is recorded, never applied (owner ruling, 2026-09-25; before B6) — ✅ closes A13's disclosed tap-versus-tap gap: a tap into A whose request was slow, then a tap into B that landed first, and A's tap then switched the student back. A tap is late when the student already has a `tap_in` recorded from the same install with a higher seq in another session (`tappedSince`, one range of the new `events_order_tap_idx`) — any such tap, whatever its note or whether they are still in its session; a tap into the same session stays A13's, and an armed tap is no later tap (arming ends nothing). By the order only: with none, or another install's, the arrival order stands. Judged wherever a tap takes effect: `tapIn` (late: its `tap_in` noted `superseded`, A13's vocabulary — no join or switch, contact on a live row, answered `replay` naming the session only while the student is live there, else none: `reread`), `armTap` (late: kept as a row consumed on arrival, answered `replay`, no session — no Start converts it) and the Start (`convertArmedTaps`: a waiting tap older than such a tap is recorded in the new session, noted, consumed, never joined — decision 5's second exception). A late tap's kept unlocks: filed where it is recorded, by the unlock's rules (noted `no_live_participation` there, so the class reads "Left · unlocked" either arrival order), or on the arm path kept unattached as for any armed tap. A student's taps serialise on a per-student lock (`lockStudentTaps`: after `lockTap`, before the session; a Start takes its students' in id order before any participation) — ~0.6 ms a tap with the look; `armTap` takes none, and its Start judges again. Readers unchanged: the grid leaves the chip alone, the snapshot shows no row, the history shows the late tap with its note. Tests: the engine on PGlite, five real-Postgres races (both arrival orders at a tap, at an arm and its Start, and at a Start, and each lock staged: without it the student ends back in the older tap's class), the API (`POST /v1/taps`, its disposition, `GET /v1/me`, the snapshot, the arm path and its Start), the grid, BaliCore on the fixtures. Riders: #85's review — `tap_in` in the history's `NOTED` is pinned (a late re-tap and a late tap in the API history test, and a second `superseded` moment in `history/every-kind`); dev's refresh-token expiration confirmed raised (`docs/DEPLOY.md`)
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
- **B4c** The app's wiring: `SyncEngine.make`, `BaliApp` starting the one engine over `SignIn`, the sign-in's build settings in `ios/project.yml` (the API, the hosted-UI domain, the phone's client id, the redirect URI), and the BaliOutbox suites' time limits raised to 3 minutes. B1c's `TokenProvider`: nil when there is no token right now, which is never a sign-out; refreshing after a `reauth` is B4's, through `SyncEngine`'s `refresh` seam (true once a fresh token is ready: the engine then sends everything again at once; it returns at once — false when only the student can give a token — since the drain waits on it), with `retryNow()` once a sign-in gives the provider a token. **B4's contract with the engine:** `refresh` is asked once per rejection — a fresh token rejected too is not refreshed again until an answer that is not a 401, or `retryNow()` — so from there recovery is B4's: `accessToken()` never gives a token it knows has expired, and every token B4 gets but through `refresh` (a sign-in, a refresh of its own) is followed by `retryNow()`. The app's one `SyncEngine` starts with B4's provider: `run()` for the app's life, and `setForeground` from the scene phase, beside `BaliApp`'s `Outbox.suspend()` and `resume()` — ✅ `SyncEngine.make(outbox:api:signIn:)` (`ios/BaliOutbox`) builds the app's one engine: the API client's tokens are `SignIn`'s, a 401's `refresh` is `SignIn.refresh()`, and `whenTokenArrives` is the engine's `retryNow()`. `BaliApp`'s `Phone` starts it once, over `KeychainTokenStore` and one `URLSessionTransport`; a start that fails (a build with no sign-in set, an outbox that will not open) says so, with Try again. Dev's values in `ios/project.yml`, read from Info.plist: the API, the hosted-UI domain `https://bali-dev.auth.us-east-1.amazoncognito.com`, the client `bali-ios-dev` (`33qr62dl4ee4inigneidmfe2s9`, on dev's `AUTH_AUDIENCE`) and `bali://auth/callback`. A Debug-only readout on the placeholder, temporary until C1–C6: the engine's link, when the server last answered, whether someone is signed in (or not known yet: the Keychain locked), with Sign in (the hosted UI in an ephemeral `WebAuthenticationSession`) and Sign out. The Keychain on a locked phone: only `errSecItemNotFound` is nobody signed in; `errSecInteractionNotAllowed` — the phone locked, or not unlocked since it started — and every other failure throw, which `SignIn` reads as no token right now: never a sign-out, never cleared (`KeychainTokenStore.read`, tested on the iOS Simulator; `SignIn` over a store whose read fails, on Linux too). Riders (#83's review): the verifier and state from `SymmetricKey`; a clear the locked Keychain refused after `invalid_grant`, made at the next ask; the token the API refused, marked so in the store too, so a relaunch renews it first. Tests: `SignInEngineTests` (the engine over the real sign-in — signed out, a record waits and the sign-in sends it at once; a 401 renews and sends again; `invalid_grant` keeps the record for the next sign-in; a renewal of the sign-in's own sends what waited), `KeychainTests`, and two more in `SignInTests`; of 5 mutations of `SignIn` tried, 5 turn a test red. The BaliOutbox suites' limits are 3 minutes, as BaliCore's
- **B5** Enforcement: shields (every app a third party can block — `.all()` apps and web domains, no picker), session schedule, monitor extension, custom shield — 📱 settles Phase 0's open question. Ships in three for size (B5a–B5c, below). Note: "only a re-tap leaves protection off" holds per participation, not per phone — an armed tap converted at another teacher's Start joins that session focused, so the phone re-reports protection off there (B5a: the report is per session, and again whenever the phone stands focused).
- **B5a** The shields follow the engine, the Screen Time permission, rule 3's check before each check-in, and protection off reported — ✅ `Enforcer` (`ios/BaliOutbox`) follows `SyncEngine.updates()`: shielded while `standing` is `focused`, until `endsAt`, and for `pendingTap` until decision 7's 50-minute cap — unless the student unlocked after it, acted on at once (decision 11) — and off when unlocked, protection off, a state this build does not know, waiting or out (`SyncState.shieldedUntil`); taken off at the end by the phone's own clock while the app runs. Screen Time sits behind `ScreenTime`: the app's `PhoneScreenTime` is one named `ManagedSettingsStore` (`.all()` app categories and web domains) and Family Controls' `.individual` authorization, whose request and status are `Enforcer.requestPermission()` and `Protection.permission` — the API C1 calls. Rule 3: before each check-in (`SyncEngine.beforeEachCheckIn`) and as the app comes to the foreground, the shields go back on if the store lost them, and a permission found off in a session whose row is not protection off already is `record(.protectionOff(session:))` — once there (B3a's), and again whenever the phone stands focused there: `SyncEngine.record` re-arms the report (A13's rider — a re-tap older than the report can put the row back to focused; so can an armed tap converted at another teacher's Start, another session). A screen claims `Protection` — the store and the permission, as checked — never `standing` alone. The standing is kept in the outbox file as it changes (`Outbox.standing()`), and an engine starts from it and its queue, so a relaunch, offline too, never takes the shields off, and B5b's monitor can read it. A Debug-only readout adds the standing, the claim, and triggers in place of the screens and the NFC tap: **Allow Screen Time**, **Join** (a code), **Tap** (a typed tag) and **Emergency Unlock**. Riders (#84's review): `docs/DEPLOY.md` lists dev's API URL; `SignIn`'s `unsaved` comment names the relaunch case. Tests on Linux and the iOS Simulator (`EnforcementTests.swift`); of 19 mutations of the rules, all 19 turn a test red. Rode along: B4b's `TokenTests` wait on the requests' own signal instead of a ten-second clock the simulator's stalls outran (38 and 100 s on this PR's runs), BaliOutbox's `patience` is 150 s, and the real-socket tests (`URLSessionTransportTests`) wait up to 240 s on their local server, which a 78-s stall froze past the apps' 15-s timeout
  - 📱 **The device check, from a Debug build** — the owner's, after B5a merges; `ios/README.md`, "To run it on your iPhone", has the setup: `npm run dev:teacher` (T1) for the teacher's side — `class` (its join code) and `block` (`DEVICE-CHECK-1`) — and the phone signed in as a student.
    1. **Sign in** opens Cognito's hosted UI, and after the password comes back signed in (readout: signed in yes).
    2. After a relaunch (swipe the app away, open it again), still signed in.
    3. After **Sign out**, **Sign in** asks for the password again: the ephemeral browser session keeps no cookie.
    4. The readout shows the engine reaching dev: link `reached`, and the server last answered moments ago.
    5. Lock the phone, then unlock it and relaunch: still signed in — a locked Keychain is never a sign-out.
    6. The Keychain's save, load and clear work on the device: 1 saves, 2 and 5 load, 3 clears. A failure shows in the readout — a sign-in `notKept` (save), "not known yet" on an unlocked phone (load), a sign-out's `Failure(status: …)` (clear).
    7. **Allow Screen Time**: iOS asks for Face ID or the passcode; then `Screen Time: approved`.
    8. **Join** with the class's code: `joined <the class>`.
    9. `npm run dev:teacher -- start` (20 minutes), then `-- watch`, left running: each student's state as the grid would show it.
    10. **Tap** with `DEVICE-CHECK-1`: `Standing: focused until` the bell, `shields on, due until` the bell; `watch` shows focused; every app and website is shielded (iOS's own shield until B5c) while calls and Messages work. Tapped in Airplane Mode: shielded at once, `due until` 50 minutes on, until the answer.
    11. **Emergency Unlock**: shields off at once, `watch` unlocked; **Tap** again: back on.
    12. Settings → Screen Time → Apps with Screen Time Access → Bali off: `denied · shields off` at once (`notDetermined`, if iOS reads it so: reported all the same, a check-in later), and **protection off** in `watch` within about 30 seconds. Allowed again, still no shields until a **Tap**.
    13. Swipe the app away while shielded, then open it in Airplane Mode: still shielded, `due until` the bell. Airplane Mode off: `watch` still focused — no false protection off after a relaunch: a permission read `notDetermined` for a moment is reported only if it still reads so a check-in later (B5a-2).
    14. With the app open, the bell (or `npm run dev:teacher -- end`, found at the next check-in) takes the shields off: `Standing: in no session`.
- **B5a-2** Enforcement hardening from #86's Claude Review, before the owner's first iPhone check — ✅ four WARNs, each a real defect, each fixed test-first: `Enforcer.apply()` reads `protection` after its last wait, so a check made meanwhile keeps `unreported` (a protection off it could not queue); a standing the app group will not give back at launch is `Standing.unread`, never `.out` — the shields never taken off over it, nothing written over the file's, the file read again within a minute, and the server's truth settling it (an armed answer asks the server); `Protection.unreported` tested, raised when the report cannot be queued and cleared by the next check; and denied reported at once, not determined only once checks have read it so for a check-in interval (30 s, two in a row), so a launch's passing read never reports and a phone never granted still does. Rode along: three protection-off tests wait for the check-in to be due before moving the clock (a race one lost here). Tests on Linux and the iOS Simulator; of 17 mutations of the fixes, all 17 turn a test red
- **B5a-3** Enforcement hardening, round 2: the remaining WARNs of #86's and #88's Claude Reviews, before the owner's first iPhone check — ✅ eight, each a real defect on `main`, each fixed test-first: the standing a change leaves is kept in the change's own write (`Outbox.record(_:now:standing:)`), so a relaunch after a kill never stands focused beside an Emergency Unlock; the app's foreground check reads the phase as it runs, and a report the suspended file refuses is no failure shown (`unreported` left as it was); no protection off for a session the phone's own clock has ended (`endsAt > now`, the shields' own test); rule 3's check at each wake of the read loop in the foreground — before the check-in, or the re-read in its place, which offline never completes; `Standing` kept in a form of its own, pinned and additive only (`{"standing":"in_session","sessionId",…}`); over an unread standing, an armed tap carried through its re-read (`.waiting` when it names no session), and the shields the enforcer put on for a tap taken off at the cap (`putOn`) while the last run's stay; and the not-determined window measured by uptime (`SyncClock.uptime()`), which no setting of the clock moves. Rider (#89's CI flake): `ReadTests.cadence` was not out of budget — a pause's alarm, going off as another ring ended the pause, rang the next one, an early check-in that stalled every later wait; an alarm now rings only its own pause (`lateAlarm` pins it). Tests on Linux and the iOS Simulator; of 18 mutations of the fixes, all 18 turn a test red; under CPU stress, the whole suite green 25 runs of 25 and `ReadTests` 50 of 50
- **B5b** The session schedule and the monitor extension — the window the shields are on registered as a `DeviceActivitySchedule` (the session's end, or the cap for a tap not yet answered; at least 15 minutes, iOS's floor), so `SessionMonitor.intervalDidEnd` (`ios/BaliMonitor`) clears the shields at the bell with the app force-quit — ARCHITECTURE's leaning (a), which this settles or not: it opens the outbox file, reads B5a's kept standing and queue, clears the store when nothing keeps it on (`shieldedUntil`), and closes, since iOS gives an extension no notice before suspending it. #84's Info.plist rider and #90's app test target, planned here, are B5b-2 (split for size) — ✅ `Bell` (`ios/BaliOutbox`) holds the rules. **The window** (`Bell.window`): it ends at the first whole minute on or after `shieldedUntil` — never before it, whatever granularity iOS keeps, and less than a minute after — and is exactly the floor long, its start moved back: a window shorter than the floor (a tap in a session's last ten minutes, the device check's 15-minute cap) starts in the past, which iOS takes as an interval under way; its end is never moved. **Registered** by the enforcer for the shields the store holds (`Protection.shielded`: denied cancels it, but a read of not determined, for a moment, never does), as their end moves — a new session, an unlock (cancelled), the bell (cancelled), an extension, a re-tap — through `ScreenTime.schedule`; over an unread standing never cancelled (the last run's window may be what ends its shields) and registered only for a pending tap's cap; a window iOS refuses is shown (`Protection.unscheduled`, the readout's `bell NOT scheduled`) and asked for again at each pass. **The monitor** (`Bell.wake`, `SessionMonitor`): the file opened within 2 s (NSFileCoordinator's blocking call on a thread of its own, cancelled past the bound; an open already under way is waited for, never left locking the file — its asynchronous call hung every open on the iOS Simulator; since B5b-2, SQLite's lock waits end by the same 2 s), the standing and the queue read, the file closed, then by the phone's clock (decision 6): nothing keeps the shields on — cleared (`clearAllSettings` on the app's named store); something does (a session the standing says still runs, a later cap) — kept, and iOS asked to wake it again at their end, never less than a minute on (so a wake that came early never asks for the window that woke it — and so, woken before the bell, the shields come off less than two minutes after it, not one: B5b-2 corrected the stated bound), and not at all when iOS holds that window already (a replacement may wake the monitor, and the two would never end); the file not read in time — **the fail-safe**: kept, never cleared over what it cannot read (B5a-2's rule), and woken again a minute on. `intervalDidStart` does nothing: the app shields at the tap and registers after. The DeviceActivity and ManagedSettings calls are thin adapters in `ios/BaliOutbox` (iOS only), shared by the app and the monitor, which now links BaliOutbox. A Debug build's device check: **Cap a tap at 15 min** (`SyncEngine.setTapCap`, kept in the app group's defaults for the monitor) and the monitor's last wake in the readout. Riders (#90's review): over an unread standing, the last run's shields a pending tap keeps on are its cap's — off at the cap, left at its answer (reversed by B5b-2: a session they may be for may still run); and the test rig's `cancel` resumes a sleep `advance(by:holdingWakes:)` held, so a test that stops early fails fast — each red first. Tests: `BellTests.swift` (the window and the floor, the wake — pure and through the app's own file after a force-quit, the file closed after it on Linux — the bound, and the registrations through the enforcer), `unreadCappedOverHeld`, `heldSleepCancels`; of 25 mutations of the rules, 24 turn a test red, and the 25th — the monitor's read without its explicit close — changes nothing a caller can see: the file is closed as the read returns all the same
  - 📱 **Round 2 — the owner's, after B5b merges** (`ios/README.md`, "Round 2 (B5b)", has each step's expected result), after round 1 on the same build, `npm run dev:teacher -- watch` running:
    1. `start 20`, **Tap**: `due until` the bell, no `bell NOT scheduled`.
    2. Force-quit while shielded: within a minute after the bell — two, if iOS wakes the monitor early — the apps open with the app closed — Phase 0's question; reopened, `Monitor: <time> · cleared`, and no `bell NOT scheduled`.
    3. `start 15`, wait 5 minutes, **Tap** (a window under the floor), force-quit: as 2.
    4. `start 15`, **Tap**, **Emergency Unlock**, force-quit: nothing wakes the monitor at the bell.
    5. `start 15`, **Tap**, `extend 10`, a check-in, force-quit: shielded past the first bell, off after the new one.
    6. **Cap a tap at 15 min**, Airplane Mode, no session, **Tap**, force-quit: off within a minute after the cap (two, woken early); the tap then answered armed — run it last.
    7. The monitor never stalls: every wake took a fraction of a second, never the 2 s bound on its whole open and read, and the app opens normally after each.
- **B5b-2** B5b's app-side riders, split from it for size, and #91's review — ✅ (1) #84's review: the app's Info.plist keys (`BaliAPIURL`, `BaliCognitoClientID`, `BaliCognitoDomain`, `BaliCognitoRedirectURI`) read by BaliCore's `AppConfig`, pinned by `AppConfigTests` — the reader, `Bali/Info.plist` and `project.yml` agree, on Linux too, both files read in place — and by `AppTests.config`: the built app's own Info.plist gives a config. (2) #90's review (comment 5830059620): `BaliTests`, an app unit-test target in `ios/project.yml`, hosted in the app and depending on the packages as the app does, run by the iOS Simulator job (`ios.yml` only gains its run), pinning B5a-3's app-side fix — the foreground check reads the scene phase as it runs (`Phone.onPhase`, the seam `Phone.setForeground` drives). Ported by hand from the snapshot branch onto `main`, which keeps #91's final open. (3) #91's review (comment 5832095914 and its first review), each red first: the app's open of the outbox — NSFileCoordinator's blocking call, inline — never waits with no end: an asking over with no grant and no error is refused (`over`, a `CocoaError` the app shows with Try again), and only the first claim has the file — a grant, a refusal or the giving up — so a request calling back twice opens it once (`Outbox.granted`, `Access`); a window iOS refuses the monitor, the app closed, is kept in the app group (`Bell.monitorUnscheduled`) and shown from the app's next open (`Protection.monitorUnscheduled`, the readout's "the monitor's bell NOT scheduled") until a window is registered again, and `Bell.register`'s skip rule — none asked for while iOS holds one ending there — is tested behind `BellCenter`, which `DeviceActivityCenter` adopts; the monitor's whole open and read wait at most 2 s, SQLite's lock waits ending by the same deadline (a busy callback) instead of a 5 s busy timeout at each; over a standing not read, the cap never takes off the last run's shields (`capOf` gone: a session they may be for may still run); and the stated bound corrected, with a test: with the app closed, less than a minute after the bell, less than two when iOS wakes the monitor early (README's round 2 says so). Tests: `AppConfigTests`, `AppTests` (the simulator only), and in BaliOutbox `overUngranted`, `grantedTwice`, `monitorRefused`, `RegisterTests`, `WakeTests.bound`, `heldPastBound` (Linux only: it races a bound against a lock), and `unreadCappedOverHeld`, now the other way round; of 9 mutations of the fixes and the pin, all 9 turn a test red
- **B5c** The custom shield — `ShieldConfigurationExtension.shield()` (`ios/BaliShield`) shows "Focused with Bali until 9:42", the end read from the standing kept in the app group, in D1's approved look (light, the ring mark); nothing new designed. 📱 the shield's words over a blocked app — ✅ `ShieldWords` (`ios/BaliOutbox`) holds the words, from the standing and the queue the app keeps, read through B5b's bounded open (the whole open and read within 2 s, SQLite's locks included; the file closed before it returns): focused in a session, "Focused with Bali until 9:42", in the phone's own short time (its locale, 12- or 24-hour as set, its zone: "9:42 AM", "09:42"); a tap not yet answered keeping the shields on (`SyncState.tapHeldUntil`, the rule `shieldedUntil` already used), "Focused with Bali — waiting for your class", no time — its answer may move the bell; anything else — the file not read, the bell past, nothing keeping them on — "Focused with Bali", never a wrong time; beneath, D1's line ("This app is paused for class…", "This website…" over a website). The extension carries D1's look as far as `ShieldConfiguration` goes: stone-50 over a light material, the ring mark without its tile (the artboard's SVG, a vector asset, never tinted), text-primary and text-secondary, and **OK** in white on green-700 — with no shield action extension, iOS's own action: the blocked app closes; the shield cannot open Bali, where Emergency Unlock is (C5). Not carried: D1's font, sizes and layout, which are iOS's. It links BaliOutbox, as the monitor does. Tests: `ShieldWordsTests` (Linux and the iOS Simulator), `AppTests.mark` (the simulator: the extension ships the mark, drawn as D1 has it); of 12 mutations of the rules, all 12 turn a test red
  - 📱 **Round 3 — the owner's, after B5c merges** (`ios/README.md`, "Round 3 (B5c)", has each step's expected result), after rounds 1 and 2 on the same build, `npm run dev:teacher -- watch` running:
    1. `start 20`, **Tap**, a blocked app: Bali's shield — light, the ring mark, "Focused with Bali until" the bell, D1's line; **OK** closes the app. `extend 10`, a check-in: the new bell (the old one still up: iOS keeps a shield's words — a follow-up).
    2. **Emergency Unlock**: every app opens, no shield.
    3. Airplane Mode, **Tap**: "Focused with Bali — waiting for your class", no time; Airplane Mode off, the tap answered: the bell again.
- **B6** NFC tap → local record → shield → outbox — 📱 The app's NFC entitlement and usage string are in (B2); v2 read the block with `NFCNDEFReaderSession`. An emergency unlock made while that tap is still unanswered is filed under the tap (decision 11): sent with the tap's `event_id` to A11's `POST /v1/taps/{eventId}/unlock` through BaliCore's `APIClient.unlock(tap:_:)`, answered as any unlock (`unlockDisposition`), and always sent there, even once the tap's answer names a session: a retry is answered where it was recorded, and the session route would refuse an id another session holds. Its tap, answered later, may say `joined` and `unlocked` — the unlock filed then: `apply_session`, no shield. Its request carries the record's order like every other outbox record (A12: `OutboxRecord.request`), so the server orders it after its tap whatever the clock says
- **C1–C6** Screens: onboarding · join + preview · home / waiting · focus · unlocked, protection off, session over · history + me. C5: an unlock answered `superseded` means a return to focus went ahead of it — the shields come back. From a build that sends the order (A12) it never means a wrong clock: the phone's own returns are placed by its counter, so with no refocus or tap of the phone's since, the return that went ahead is one the order cannot place (another install's — a reinstall, another phone — or one sent without an order); say so. Only for a build with no order does it mean the clock is behind — say why, and how to set the time right (A10). One answered with no state — the student has left the session — re-reads the truth (A11)
- **E1** Device test gate: ISSUES #2 on hardware — 📱
- **T1** The device checks' teacher on dev, from the terminal (B4c, B5a; later B5b, B5c, B6, E1) — ✅ `npm run dev:teacher -- <command>` (`apps/api/scripts/dev-teacher.ts`), the exit demo's remote mode reused — its variables, Cognito sign-in, teacher check and HTTP caller: `class [name]` makes or reuses the teacher's class by name and prints its join code, `block [tag]` registers `DEVICE-CHECK-1` (a re-run, the same block), `start [minutes]` / `extend [minutes]` / `end` the class's session (`--class` names another class), and `watch` reads the session's snapshot every 2 s and prints each student's line as it changes, through the portal's own grid rules (`apps/web/src/lib/grid-state.ts` — the web workspace is `"type": "module"` now, like the others, so Node imports them). Never prints a credential. Tests: `apps/api/test/dev-teacher.test.ts`, every command against the in-process server, a student joining and tapping, the watch's failed and expired reads, and no password, token or sweep key in any output

## Go-live features

### In scope for launch (phase noted)

| Feature | Phase | Notes |
|---|---|---|
| Core loop: tap→shield offline, armed taps, live grid, unlock always-recorded, refocus, join codes, roster, removal, self-expiry | 1–2 | ✅ built |
| 30s check-in that verifies shields before claiming them | 3 | rule 3. **API ✅ (A2):** a revoked permission is reported with `POST /v1/sessions/{id}/protection-off`; refocus is refused out of it and an unlock never softens it (the grid mirrors the unlock rule; a refocus is never recorded out of it, so there is none to mirror) — only a re-tap returns to focus. A report that first reaches the server after the bell is recorded with a note, like a late unlock (A2c). **Phone ✅ (B3b-2):** the check-in every 30 s in the foreground, its answer reconciled. **Shields ✅ (B5a):** before each check-in and on coming to the foreground, the shields go back on if iOS lost them, a revoked permission in a session is reported (again whenever the phone stands focused there), and a screen claims only what the check found (`Protection`); a permission read not determined is reported only once it lasts a check-in interval, so a relaunch shows no false protection off (B5a-2); the check runs every 30 s in the foreground offline too, never reports for a session the phone's own clock has ended, and its grace window is measured by uptime, so a clock set forward reports nothing (B5a-3) |
| Shields survive force-quit; bell frees phone via extension | 3 | pending spike confirmation (B5b's round 2, on the owner's iPhone). **The bell with the app closed ✅ (B5b):** the window the shields are on registered with iOS as a DeviceActivity schedule, and the monitor extension clearing them at its end, the bell or decision 7's cap, by the phone's clock — never over a session still running nor a file it cannot read; its whole open and read bounded at 2 s, and a wake iOS refuses it shown at the app's next open (B5b-2). **Relaunch ✅ (B5a):** the standing is kept in the app group, so reopening the app — offline too — never takes the shields off, nor does a standing the file will not give back (B5a-2); a change and the standing it leaves are one write, so a relaunch after a kill never shields over an Emergency Unlock, and the kept form is pinned for later builds (B5a-3) |
| Onboarding: privacy contract → sign-in → Screen Time grant | 3 | no allow-list step: the shield blocks every app it can (2026-09-24). **Sign-in ✅ (B4):** BaliCore's `SignIn` — Cognito's hosted UI with PKCE in an ephemeral browser session, the tokens in the Keychain, signed out only by Cognito refusing the refresh token — wired into the app with dev's values (B4c), a Debug readout until C1 draws the screen. **Screen Time grant API ✅ (B5a):** `Enforcer.requestPermission()` (Family Controls, `.individual`) and `Protection.permission`, which C1 calls |
| Consent preview before joining a class | 3 | **API ✅ (A6):** `GET /v1/join-codes/{code}` — the class, its teacher's name, already enrolled; matched as the join matches, and refused as it refuses. The screen is C2 |
| Unlock with optional, skippable reason (bathroom/nurse/other) | 3 | replaces full "passes" at launch. **API ✅ (A1):** optional `reason` on unlock, stored as `payload.reason`, never a reason to refuse. It is fixed once recorded (a replay keeps the stored one), so C5 either asks before sending or holds the send until the picker is answered or skipped. **Portal ✅ (A9):** the grid shows it on the chip, a protection-off one included |
| Custom shield screen ("Focused with Bali until 9:42") | 3 | its extension, `com.bali.Bali.BaliShield`, has the Family Controls distribution entitlement (granted 2026-09-24). **✅ (B5c):** Bali's own shield in D1's light look with the ring mark — the bell from the kept standing, in the phone's own time format; "waiting for your class" while a tap is unanswered; Bali's name alone when the bell cannot be known. Round 3 checks it on the owner's iPhone |
| Minimal student personal history + edit own name | 3 | backs the privacy contract. **API ✅ (A7):** `GET /v1/me/history` — the moments a teacher sees, newest first, paged by an event-id cursor; the explicit tiebreak (`seq` inverts the converted-tap pair and `occurred_at` ties it) is a leave before anything else at one instant, then `seq` — see `events_user_occurred_idx`; `armed_tap_skipped` shows as a declined tap naming the class it counted in, never a join. **API ✅ (A8):** `PATCH /v1/me` — the student's own name, unique within each class (decision 8; serialised by class locks), recorded as a `display_name_changed` event; a join or a sign-in's fill is never refused over a name. An open grid shows it at its next 15 s snapshot (A9). The screen is C6 |
| Sign in with Apple (App Review guideline 4.8) | 5 | Cognito IdP |
| End-of-session recap card (portal) | 4 | |
| Reports: class focus minutes + unlock list; aggregates only, never rankings | 4 | `armed_tap_skipped` names a student who did NOT join — never count it as a join. An unlock or protection off noted `after_session_end` reached the server after the end, and its time is clamped to the scheduled window, so after an early end it can fall past `ended_at` — never count time beyond it. An unlock noted `superseded` changed no state — the student's own refocus or tap came after it — so never end focus time at it, after the end included. One kept unattached (`tap_armed`, `unknown_tap`, like `unknown_session`) is in no class; if its tap files it later, the filed one names it (`unattached_event_id`) — count one, never both. An unlock the phone's order applied (A12) can carry a time before the return it followed — order a student's own unlock and return as the engine did (by their `order_install` / `order_seq` when both carry one from the same install), never by the times alone. A return noted `superseded` (A13) changed no state either — the unlock after it stands — so never start focus time at it; nor at a tap noted so because a later tap of the student's into another class went ahead of it (A14), which joined nothing — never count it as a join |
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
   the server; Emergency Unlock works throughout. B5a shields to the cap
   while the app runs; B5b schedules it for a closed app.
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
