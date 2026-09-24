# Bali v3 — build plan & live status

The one file every session reads (after ARCHITECTURE.md) and updates when it
finishes work. ARCHITECTURE.md says *how*; this file says *what* and *where we
are*. Update rules are at the bottom.

_Last updated: 2026-09-23 — **Phase 3 (iOS student app) has started**, API and contract work first: the step list is under Phases, A1 (the unlock's optional reason) and A2 (protection off, end to end on the server) have landed. **Phase 2 is complete: the exit demo ran green against Railway dev.** Retroactive audit of the pre-gates Phase 1/2 code: nine findings confirmed, landing as gated PRs; offset timestamps and the SSE write-after-end crash are on `main`. **The owner ruled on the audit's held `/v1` questions (yes to all five): #29, then #28, then the block fix.** `/v1/me` now stores a display name the token actually carries, so the live grid shows a readable name wherever the token has one, instead of a UUID prefix._

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
  fill, never an overwrite: "edit own name" (below, phase 3) makes that field the
  student's own once they set it. Where the pool's usernames are readable, a
  remote exit-demo run labels its actors with them, because `me.user.displayName`
  finally answers. **Not checked yet:** whether the dev pool's usernames are
  readable. A pool that signs users in by email (`UsernameAttributes: ['email']`)
  gives every user a UUID username, which is not stored, and its access tokens
  carry no `name`; there the grid keeps its UUID prefix until "edit own name"
  (phase 3) or a pre-token-generation Lambda supplies one.
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
- **The owner ruled on #28's held question (2026-09-22): the `409`s stand.**
  A retried tap that landed is replayed only while what it recorded is still
  true (the participation live, its session running). Otherwise, a retry that
  reaches a running session is refused with `EVENT_ID_CONFLICT`,
  `NOT_PARTICIPATING` or `SESSION_NOT_RUNNING`, all `409`, so the outbox keeps
  the record; one that reaches nothing running is answered `replay` with no
  session by `armTap` (tap step 10). The `409`s are not final yet: that needs
  the tap-side outbox disposition (and a "recorded, no longer current" answer),
  which is Phase 3. The spent-armed-tap skip it depended on landed first, in
  #29, so these refusals no longer feed the period-5 shield.
- **Found while fixing the audit, on `main` rather than in the audit's list:**
  the SSE hub's `close()` did not wait for a LISTEN it had started, so a
  shutdown during setup left a query on a pool being torn down — an unhandled
  `write CONNECTION_ENDED` that failed the real-Postgres lane with every test
  green (**landed**; see `docs/DECISIONS.md`).
- **Phase 3 is under way** (2026-09-23): the step list under Phases replaces
  the earlier unwritten 10-step outline. The API and shared-contract steps land
  first, so the iOS client implements against finished, tested contracts —
  the `unlockDisposition` pattern. **A1 (unlock reason) and A2 (protection off) landed; A2b is next, then A3.** The
  owner decisions Phase 3 needs are items 6–10 under Open product decisions;
  steps that need the owner's iPhone are marked 📱. Phase 0's open question
  gates B5: confirm the DeviceActivity extension fires at interval END with
  the app force-quit.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 | iOS enforcement spike | ✅ NFC → shields <1s proven on device. ⚠️ Still to confirm before Phase 3 step B5: DeviceActivity extension fires at interval END with the app force-quit. |
| 1 | The spine: monorepo, CI, schema + constraints, transition engine, Cognito auth, `/v1/me`, `/v1/taps`, session start, armed taps, Railway dev deploy | ✅ on `main` |
| 2 | Walking skeleton: real-Postgres CI lane + race tests, unlock recorded-with-a-note contract, enrollments, classes/blocks, session lifecycle + silence events, events feed + SSE (LISTEN/NOTIFY), teacher portal + live grid, phone simulator | ✅ **complete** — merged to `main` and the exit demo passed against dev (2026-09-22) |
| 3 | iOS student app: BaliCore (contract fixtures TS↔Swift), GRDB outbox + sync engine, enforcement (shields + DeviceActivity extension), Cognito PKCE auth, screens, device test gate (ISSUES #2 on hardware) | 🔨 in progress — steps below |
| 4 | Reports + recap, rate limiting (ISSUES #1 per-account budgets), school-behind-one-IP load gate (k6), OpenAPI snapshot check | ⬜ |
| 5 | Pilot readiness: prod environment, monitoring/Sentry, backup restore drill, Vercel flip (portal + marketing), TestFlight, App Store submission, teacher invite gating docs | ⬜ |

### Phase 3 steps (one PR each; 📱 = needs the owner's iPhone)

API and shared contracts come first; Swift lives in a root `ios/` folder (the
plan backstop already treats it as source).

- **A1** Unlock takes an optional reason (bathroom / nurse / other) — ✅
- **A2** `POST /v1/sessions/{id}/protection-off`; refocus refused while protection is off (a re-tap returns) — ✅
- **A2b** Deadlock retry: unlock, refocus and protection-off take the session lock before the participation row while the silence sweep takes the row first — an unlock racing the sweep deadlocks (40P01, measured 83/100 on real Postgres; pre-existing, now reachable through protection-off too). A tap switching the student out of the session deadlocks the same way (measured: protection-off lost 6 of 20 races, unlock 4 of 20); check armed-tap conversion too. `withDeadlockRetry` around both sides, plus the sweep and a switching tap as rivals in the race test
- **A3** Outbox dispositions in `@bali/shared`: `tapDisposition` (the tap-side twin of `unlockDisposition`) and one for refocus / protection-off — a refused change is dropped and the truth re-read, never resent
- **A4** A retried tap that is recorded but no longer current answers `200 replay` with no session instead of `409`. Settle the same case for refocus here, before a phone ships: its replay after the participation ended in a still-running session answers that row's last state (protection-off refuses it — A2's decision-log entry)
- **A5** Contract fixtures: real response JSON per student endpoint, checked in, CI fails on drift. First decide whether errors get a machine-readable `details` code: `PROTECTION_OFF` and `NOT_PARTICIPATING` both reach the phone as `conflict`, told apart only by message
- **A6** Join-code preview · **A7** `GET /v1/me/history` · **A8** edit own name — each after its screen design; A8 after decision 8
- **A9** Portal: the live grid shows an unlock's reason (the privacy contract promises the teacher sees it) — including an unlock recorded against a protection-off row, which today leaves the chip unchanged, so it shows only in the event log. Also: a student the snapshot no longer carries (it holds active enrollments only) whose phone unlocks after the overlap window reads "Unlocked", not "Left ·" (pre-existing)
- **D1** Design the student screens with no reference screen, on a canvas built with the Bali Design System — first pass up for review: [Bali student app screens](https://claude.ai/artifact/DdfRPhHu4whXLxe58hBAie)
- **B1** `BaliCore` Swift package (types, API client, both dispositions, fixture contract tests) + a Linux Swift CI job
- **B2** App + extension skeleton (XcodeGen: app, DeviceActivity monitor, shield UI, app group) + macOS CI — after decision 9
- **B3** GRDB outbox + sync engine · **B4** Cognito PKCE sign-in
- **B5** Enforcement: shields, allow-list, session schedule, monitor extension, custom shield — 📱 settles Phase 0's open question. Note: "only a re-tap leaves protection off" holds per participation, not per phone — an armed tap converted at another teacher's Start joins that session focused, so the phone must re-report protection off there at its next check-in
- **B6** NFC tap → local record → shield → outbox — 📱
- **C1–C6** Screens: onboarding · join + preview · home / waiting · focus · unlocked, protection off, session over · history + me
- **E1** Device test gate: ISSUES #2 on hardware — 📱

## Go-live features

### In scope for launch (phase noted)

| Feature | Phase | Notes |
|---|---|---|
| Core loop: tap→shield offline, armed taps, live grid, unlock always-recorded, refocus, join codes, roster, removal, self-expiry | 1–2 | ✅ built |
| 30s check-in that verifies shields before claiming them | 3 | rule 3. **API ✅ (A2):** a revoked permission is reported with `POST /v1/sessions/{id}/protection-off`; refocus is refused out of it and an unlock never softens it (the grid mirrors the unlock rule; a refocus is never recorded out of it, so there is none to mirror) — only a re-tap returns to focus. The phone's half is B3/B5 |
| Shields survive force-quit; bell frees phone via extension | 3 | pending spike confirmation |
| Onboarding: privacy contract → sign-in → Screen Time grant → allow-list | 3 | |
| Consent preview before joining a class | 3 | small |
| Unlock with optional, skippable reason (bathroom/nurse/other) | 3 | replaces full "passes" at launch. **API ✅ (A1):** optional `reason` on unlock, stored as `payload.reason`, never a reason to refuse. It is fixed once recorded (a replay keeps the stored one), so C5 either asks before sending or holds the send until the picker is answered or skipped; the portal shows it in A9 |
| Custom shield screen ("Focused with Bali until 9:42") | 3 | bundle ID in entitlement request |
| Minimal student personal history + edit own name | 3 | backs the privacy contract; **it needs an explicit tiebreak — `seq` inverts the converted-tap pair and `occurred_at` ties it** — see the note on `events_user_seq_idx`; and `armed_tap_skipped` carries the student's id, so it shows here too — render it as a declined tap, never a join |
| Sign in with Apple (App Review guideline 4.8) | 5 | Cognito IdP |
| End-of-session recap card (portal) | 4 | |
| Reports: class focus minutes + unlock list; aggregates only, never rankings | 4 | `armed_tap_skipped` names a student who did NOT join — never count it as a join |
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
7. The default end for a tap made with no signal, before the server has
   answered (lean: shield at once with no countdown until the answer, capped
   at a default length — the length is the owner's). Before B5.
8. What, if anything, polices an edited display name — a student can pick a
   classmate's (the 2026-09-22 display-name entry leaves this to edit-own-name).
   Before A8.
9. macOS CI minutes for the iOS build (lean: a GitHub-hosted macOS job that
   runs only on PRs touching `ios/`). Before B2.
10. Whether a protection-off that first reaches the server after the bell is
    recorded (like an unlock, with a note) instead of refused. Today it is
    refused and never recorded, so the teacher never saw protection off: the
    grid showed that phone green until 90 s after its last contact, then
    silent — green through the bell if the bell came first (lean: record it,
    so the history says why the phone went quiet). Before B3.

Parked by design, blocking before real students: data-deletion policy,
under-13 parental-consent machinery.

## External / waiting

- **Family Controls distribution entitlement** (Apple) — applied for; blocks
  TestFlight/App Store, not development builds. Bundle IDs incl. monitor
  extension (and shield-UI extension) should be in the request.
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
