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
  green (**landed**; see the decision log).
- **Phase 3 is under way** (2026-09-23): the step list under Phases replaces
  the earlier unwritten 10-step outline. The API and shared-contract steps land
  first, so the iOS client implements against finished, tested contracts —
  the `unlockDisposition` pattern. **A1 (unlock reason) and A2 (protection off) landed; A3 is next.** The
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
- **A2b** Deadlock retry: unlock, refocus and protection-off take the session lock before the participation row while the silence sweep takes the row first — an unlock racing the sweep deadlocks (40P01, measured 83/100 on real Postgres; pre-existing, now reachable through protection-off too). `withDeadlockRetry` around both, plus the sweep as a rival in the race test
- **A3** `tapDisposition` in `@bali/shared` — the tap-side twin of `unlockDisposition`
- **A4** A retried tap that is recorded but no longer current answers `200 replay` with no session instead of `409`
- **A5** Contract fixtures: real response JSON per student endpoint, checked in, CI fails on drift. First decide whether errors get a machine-readable `details` code: `PROTECTION_OFF` and `NOT_PARTICIPATING` both reach the phone as `conflict`, told apart only by message
- **A6** Join-code preview · **A7** `GET /v1/me/history` · **A8** edit own name — each after its screen design; A8 after decision 8
- **A9** Portal: the live grid shows an unlock's reason (the privacy contract promises the teacher sees it)
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
    refused and never recorded; the teacher saw that phone as silent in the
    meantime, never green (lean: record it, so the history says why the phone
    went quiet). Before B3.

Parked by design, blocking before real students: data-deletion policy,
under-13 parental-consent machinery.

## External / waiting

- **Family Controls distribution entitlement** (Apple) — applied for; blocks
  TestFlight/App Store, not development builds. Bundle IDs incl. monitor
  extension (and shield-UI extension) should be in the request.
- Apple checklist: bundle IDs registered, App Store Connect record created.

## Decision log

- **2026-09-23** — **A2: protection off, end to end on the server.**
  `POST /v1/sessions/{id}/protection-off` wires the engine's existing
  `protectionOff` (strict like refocus: a live participation or `409`). Two
  rules make ARCHITECTURE's "never green, never an unlock" hold in code rather
  than only in the grid's colours: **refocus is refused out of protection off**
  (`PROTECTION_OFF` → `409`, "tap the block to rejoin"; the refusal rolls the
  event back, and a replay of a refocus recorded earlier still answers the
  current truth), because iOS dropped every shield and only a re-tap
  re-shields; and **an unlock never softens it** — still recorded, never
  refused, noted `recorded_as: 'protection_off'` (additive vocab), state left
  alone — because otherwise a student who switched Screen Time off could turn
  their red chip orange with one request. The live grid mirrors the second
  rule (rule 2). Nothing reached protection off before this (no route called
  `protectionOff`), so neither rule changed a shipped answer. Each is pinned by
  a test that goes red when it is removed, and by a real-Postgres race (either
  order ends in protection off). **A change retried after the bell stays a
  `409 session has ended`, on purpose** — pinned now, because round 1 of the
  review suggested replaying it and round 2 showed why not: after an EARLY end
  the session's `endsAt` is still ahead, so a replay would hand a phone that
  already heard "gone" a window to shield to (a refocus answer turns shields
  back on) — rule 4's forbidden 200. The 409 costs nothing: A3's state-change
  table drops a refused change and re-reads the truth. Recorded rather than
  changed, since it is a shipped answer: a refocus REPLAYED in a running
  session whose participation has since ended answers that row's last state
  (pre-existing); A3's "never send a superseded refocus" keeps honest clients
  off it, and bounding it like `tapIn` would be a `/v1` 200 → 409 for the
  owner. The live grid gives a protection-off student whose participation
  ends (bell, removal, switch) its own loud chip, "Left · protection off" —
  it read "Left · unlocked", which protection off never is — and an unlock
  never relabels a protection-off row, live or ended, as the engine never
  changes one. From the santa-loop review, which also moved the unlock
  contract's docs (ARCHITECTURE, ISSUES #2, `@bali/shared`) to say a live
  participation can be recorded without being flipped, and made the endpoint's
  authorization test able to fail (a live student an outsider or the teacher
  could otherwise mark). The client half belongs to A3's outbox contract: a
  refused refocus or protection-off is final for its id (a late retry of a
  refused refocus, after a re-tap and a fresh unlock, would otherwise turn an
  unlocked phone green), a refocus a later tap or unlock superseded is never
  sent, and protection off is reported once per revocation (each report writes
  an event).
- **2026-09-23** — **Phase 3 started, API and contracts first** (step list
  under Phases). A1: the unlock takes an optional reason (`UNLOCK_REASONS` —
  bathroom, nurse, other — additive vocab), stored as `payload.reason` beside
  any `recorded_as` note, orphans included; an unlock without one writes
  exactly the payload it did before. The route parses it **leniently** — any
  JSON value that is not a known reason is recorded as no reason, never a 400
  (the only refusals left are Fastify's whole-body guards, the 1 MiB limit and
  prototype-poisoning keys, which predate this and no honest client trips) —
  because the unlock body's standing rule (2026-09-20) is that validation is
  never why an unlock goes unrecorded. The engine keeps only a known reason
  whatever its caller passes, since it is the one writer of `events`. The response's `reason` says what
  landed, so a phone can tell when its reason did not; a replay answers with
  the stored reason, not the retry's (rule 4). Pinned both ways: a strict
  parse, the reason not passed or not echoed, dropped from either payload, or
  a replay not reading its own event — each turns a test red. Two
  independent reviews passed it.
- **2026-09-23** — `docs/GOTCHAS.md` added to the read order: live
  environment/process traps only, one entry each, deleted when fixed. The
  routing rule (CLAUDE.md working rules): a critical or recurring finding
  becomes a regression test, a CI check, or a rule first — a GOTCHAS entry
  only when it is none of those.
- **2026-09-23** — Tooling adopted with review-set boundaries (#36 + follow-up):
  graphify is **optional local tooling** — vendored skill fires only on an
  explicit `/graphify`, never installs unattended, and its enforcement hooks
  live in untracked `.claude/settings.local.json`, never shared config;
  ARCHITECTURE.md and PLAN.md are always read from source, never answered
  from the graph. Ponytail (account-wide minimalism plugin) governs
  implementation, never the gates (CLAUDE.md working rule).
- **2026-09-22** — Display names come from the token's own claims — a real name
  first (`name`, `preferred_username`), then the pool's identifier
  (`cognito:username`, `username`) but only when it is readable — and are
  **filled, never synced**. The value is stripped of control and format
  characters (bar the ZWJ/ZWNJ joiners names need), line and paragraph
  separators, and lone surrogate halves (which Postgres would store as U+FFFD
  for good), trimmed, and clamped to 64 code points; a name with nothing
  visible left in it — only joiners, a Hangul filler, a blank braille cell, a
  musical null notehead — counts as no name. Invisible letters INSIDE a
  visible name are kept. All of this because `name` is an attribute the
  student can set on themselves and it lands in a teacher's grid. A
  machine-made identifier is
  **not** stored, since it would print worse than the grid's own
  eight-character fallback and the fill would make it permanent: a dashed UUID
  (what a pool signing in by email gives every user), or a federated username —
  one of Cognito's built-in provider names (`Google`, `Facebook`,
  `LoginWithAmazon`, `SignInWithApple`, any case), an underscore, and that
  provider's subject shape (ten or more digits for Google and Facebook, so
  `google_20290101` is a name). It is anchored on the provider because a rule that
  read any long tail with a digit as a subject would throw away
  `ana_rodriguez2029` and `p_kowalski1987`. A custom SAML/OIDC provider's names are the pool
  owner's choice, cannot be recognised by shape, and are stored as the pool
  spells them. Where the identifier IS readable the teacher sees it — an
  email, in a pool whose usernames are emails — which is accepted: it is the
  student's own teacher.
  Consequence to know: a fallback, once stored, is not replaced by a better name
  arriving later, because nothing records where the stored value came from. The
  designed remedy is "edit own name" (phase 3), not a Cognito-side change — a
  pre-token-generation Lambda emitting `name` would fill only rows still NULL,
  not ones that already hold a fallback. A new
  trust boundary comes with this and is worth stating rather than discovering:
  `name` and `preferred_username` are attributes a student can set on
  themselves, so a student now chooses the string their teacher reads in the
  grid and beside unlock records, and nothing stops them choosing a classmate's
  name. The field was always NULL before, so this is new surface, not a
  regression; "edit own name" should decide what, if anything, polices it.
- **2026-09-22** — **The owner ruled on the audit's held `/v1` questions: yes
  to all five** ([the ask](https://github.com/eshan06/bali/pull/29#issuecomment-5774512834)).
  One principle covers the `/v1` items, and it is written into ARCHITECTURE
  API decision 2 now: correcting a response that told a client something
  false is not a behaviour change, so it may change a status in place, `200`
  to `409` included, and each correction is listed here. Where each landed:
  - **Items 3 and 5, #29.** `POST /v1/taps` answers `409` for an `event_id`
    that is not this caller's tap — another student's or another event
    type's, and (item 5) one recorded as this student's `tap_in` under
    ANOTHER teacher. `armTap`'s `events` lookup reaches `classes.teacher_id`
    through a LEFT join on `class_id`, which is nullable: an orphan unlock
    records with no class, and an inner join reads its id as unused and arms
    it — "refuses an id recorded with no class at all" goes red under
    `innerJoin`, measured. The same-teacher residual stays as the armed-tap
    entry below writes it up: an id spent in an earlier session of the same
    teacher still answers `replay`, because that is also exactly what the
    honest retry of a lost 200 looks like. Tap step 9 now says what happens
    to an id on record for a different event.
    The TYPE axis — a phone's own `unlock` id sent again as a tap — is not
    literally one of the five items, so it is named here for the owner to
    see: on `main` the arm path accepted it (`200 armed`, then converted
    under a fresh id at Start) while the join path already refused it with
    `409`, under 2026-09-20's "an `event_id` identifies one event". #29
    applies that existing decision to the arm path.
  - **Item 4, #29.** ARCHITECTURE decision 5 carries its one exception: a
    waiting tap whose id is already this student's own `tap_in` was honoured
    elsewhere, so it is consumed without joining — and RECORDED, the honesty
    half of the same decision: an `armed_tap_skipped` event (additive vocab)
    in the session whose Start declined it, under a fresh id, payload
    `{ armed_tap_event_id }`, stamped with the Start's clock. The grid
    ignores it, pinned — it is history, not a join, and painting a chip from
    it would put a student in a session they are not in. Phase 4's reports
    must not count it as a join either. Pinned both ways: the skip's
    history row (session, class, payload, and the Start's stamp rather than
    a fast phone clock's claim that the clamp would keep) — including a skip
    declined by another teacher's Start, which leaves the student live where
    they are — and its absence on each shape of conversion: a plain join, a
    decision-4 switch, and a fresh-id conversion. Exactly once under two
    racing Starts, on the real-Postgres lane: with `FOR UPDATE` removed, five
    runs of five record two skips for one tap. The `409` is pinned on the
    wire as well as in the engine, and `tapIn` refuses the same reuse
    (asserted with the first session over).
  - **Item 2, #28** — rule 4 and tap steps 9–10 amended there: a retry is
    replayed while what it recorded is still true, and refused with `409`
    rather than a `200` naming a session that is over. One split is left and
    recorded in #28's entry: a spent id reused at ANOTHER teacher's block
    while the first participation is still live is replayed on the join path
    (the replay is keyed on student and type) and refused on the arm path
    (item 5's teacher scope). It needs id reuse across physical taps or a
    moved block; neither answer shields a student anywhere new.
  - **Item 1** — `POST /v1/blocks` hands a teacher their own block back
    instead of `409`; split out of #23 before it merged, landed as its own PR
    after #29. `createBlock` re-reads the tag's live holder after its
    `ON CONFLICT DO NOTHING`: the caller's own block comes back as
    `already_registered` (the retry of a lost response), another teacher's
    is still `tag_taken`. Pinned in the engine, on the wire, and on the
    real-Postgres lane for a request racing its own retry. One window is
    disclosed rather than looped over: a holder soft-removed between the
    insert and the re-read answers `tag_taken` for a tag that is briefly
    free — unreachable, since nothing outside tests writes
    `blocks.removed_at`, and settled with the block-removal endpoint.
  Not changed by the ruling, and still Phase 3: a tap `409` is kept and
  retried but not surfaced, because no tap-side outbox disposition exists
  yet. That is also where a "recorded, but no longer current" answer
  belongs.

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
  chosen. (**Ruled 2026-09-22: scoped to the teacher too** — see the entry
  above.) Answering `replay` for a stranger's id
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
  Known and accepted at the time: a skipped spent tap was consumed with no
  event and no contribution to `armedConverted`, so nothing in the feed
  recorded that a waiting tap was dropped; naming it in the permanent log
  meant new event vocabulary, worth doing with the contract decision rather
  than ahead of it. **Done with the ruling:** the skip is recorded as
  `armed_tap_skipped` — see the entry above. It still adds nothing to
  `armedConverted`.
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
  shows. (**Corrected later:** a tap 409 is retried but not shown —
  `retry_and_surface` is the unlock contract's, and the tap-side disposition
  is Phase 3.) Harmless on `main` (nothing in `armTap` threw a `TransitionError`
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
  no separate ruling if (b) goes against the 409. **Ruled 2026-09-22: yes to
  all three** — ARCHITECTURE decision 5 and API decision 2 are amended, and
  (c) is done; see the entry above.
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
  same shape, one table over. Pinned by a test at the time rather than only
  described; since the ruling that test asserts the `409` instead.
  That lookup is LOOSER than `insertEvent`'s own replay key (type + session +
  user), so the same reuse is already answered two ways on nothing the client
  controls — 409 when Y has a session running and the tap routes to `tapIn`,
  a silent 200 `replay` when Y has nothing running and it routes to `armTap`.
  The quiet answer is a rule 5 silent drop, so scoping this lookup to the
  teacher is the better behaviour — **recommended, and added to the owner's
  ask** rather than done here, since it is another shipped `/v1` 200 → 409,
  the category already with them, and a held PR is not the place to widen it.
  (**Done once the owner ruled** — see the entry at the top of this log.)
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
  or reassignment endpoint, not before it. **Since the ruling, the `events`
  lookup carries the same cost**: scoped to the teacher, it answers the
  honest retry of a tap that DID land with `409` once the block has moved,
  where it answered `replay` before. That endpoint must settle both lookups
  — the consume-and-answer fix above does nothing for this one.
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
  `endParticipationsElsewhere` (a skipped tap must never end a
  participation), so
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
  SKIPPED tap is consumed and mints nothing under its own id (its skip is
  recorded under a fresh one, since the ruling), so the event under that id is
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

- **2026-09-22** — Two engine idempotency holes, both from the same habit of
  deciding something outside the transaction that only holds inside it.
  **Ruled in by the owner (2026-09-22)** and landed after #29; ARCHITECTURE
  rule 4 and tap steps 9–10 now say what the bounded replay answers. Merging
  #29 left one split between the two tap paths: a spent id reused at another
  teacher's block while the first participation is still live is replayed by
  `tapIn` (keyed on student and type, naming the first session) and refused
  by `armTap` (teacher-scoped). Once the first session is over both refuse,
  and "refuses an id spent under another teacher, as tapIn does" pins that.
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
  **And the deadlock-counter test I had just added was resting on a false
  claim about its own fixture.** Its comment said `makeTestDb` gives the suite
  a fresh database so "nothing else can contribute to" the counter. Not true:
  `makeTestDb` is called once in a file-scope `beforeAll` and the database is
  shared by all three describes in `races.test.ts` — including "a removal
  racing a cross-class switch-tap", which provokes 40P01 deliberately and says
  so in its own comment. The before/after delta covers most of that but not
  all: `pg_stat_clear_snapshot()` drops only the READING backend's cached
  snapshot, and other backends flush pending stats on their own schedule, so a
  deadlock from the earlier test arriving mid-window lands in the delta and
  reddens CI over correct code. The crossing-taps test runs on a database of
  its own now, which makes the claim true and lets the assertion be absolute
  rather than a delta; green 3 of 3 on sound code, red 3 of 3 with the lock
  reintroduced.
  **Two more from the next round, and one of them was another overclaim of
  mine.** The comment on `tapIn`'s replay reads said the session-before-
  participation order was "staged and confirmed". It is not: swapping the two
  reads leaves both lanes green, 122/122 on real Postgres, checked. It is a
  DISCLOSED SURVIVOR now, with the reason it cannot be staged — pausing
  between the two reads would need a seam, and neither read takes a lock
  another connection could hold, so nothing can be timed to land between them.
  The order costs nothing and is kept for the reasoning; the residual window
  after both reads is reachable by no test here, only by the next check-in.
  The other was a real coverage gap in something deliberate: the replay keys
  on `(event_id, type, user_id)` and not on the session, so a phone reusing
  its own spent id while the student physically taps ANOTHER teacher's block
  is answered `200 replay` naming the first teacher's session — that join
  suppressed, teacher B's grid empty while the student stands in the room.
  Documented in two places and pinned in none. It has a test now, because it
  is one of the things the owner is ruling on and a decision nothing tests is
  a decision that can change by accident; if the ruling adds a "recorded, but
  no longer current" answer, that test is the one that should change.
  **The mapped `INVALID_EXTENSION` message had no test that reached it**, and
  it took three rounds to see why. Every route that can raise it caps
  `durationMinutes` with zod first, so a wire test sending `0` is rejected
  before the mapper runs and asserts against zod's message instead — each
  round I made the test's NAME more honest about that without ever making it
  reach the thing it was supposed to cover. The answer was to stop going
  through the wire: `apps/api/test/transition-errors.test.ts` exercises
  `mapTransitionError` directly, over a `Record<TransitionErrorCode, …>` so a
  new engine code without an expectation fails typecheck rather than slipping
  through. Reverting the message, or mapping it to `conflict`, each turns it
  red; the wire test stays green for both, which is the point.
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
  tap is recorded with the ruling (the "Item 2, #28" line and the split in
  the entry at the top of this log), because the same missing field answers
  both.

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
  `armTap` de-duped against `armed_taps.event_id` and never against `events`
  (it refuses such an id at arming now), so a SPENT id was
  accepted. The next Start converts it, `insertEvent` sees
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
  grid with nothing in `events` to say why (at the time; since the ruling the
  skip is recorded, but the dropped fresh tap would still be recorded
  nowhere). Reproduced. A standing row whose
  id is already on record is stale, so the fresh tap takes the slot. For an
  id that is this student's own `tap_in` that is the same reason an expired
  row is stale — the conversion will not honour it. The check is broader than
  the skip (an id held by any other event would convert under a fresh id),
  and taking such a row over is harmless: the student is joined either way. The phone mints one id per
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
  shape that is wrong in neither direction.) **Skipped only when the id is on
  record as this student's own `tap_in`** — a later review caught the skip
  firing on any `EVENT_ID_CONFLICT`, which `insertEvent` also raises for an id
  held by another type or another user (the phone's own `unlock` id, a
  stranger's tap). Neither means this tap landed, so skipping it dropped a
  genuine unhonoured tap with nothing in `events` (at the time; since the
  ruling it would be recorded as a skip, which is worse — a tap that never
  landed, on record as one that did). Those convert under a fresh
  id again, as they did before the skip, and are pinned both ways ("… is
  still converted, under a fresh id"), with main's `armed_tap_event_id`
  payload linking each back to its armed row. Such rows are reachable on
  current code, not only from old deploys: `armTap`'s refusal holds only as
  of arming, and `tapIn`/`unlock` never consult `armed_taps`. This narrows the
  skip, and so narrows what finding (a) above leaves for the owner's ruling;
  it does not decide that ruling. Nothing is weakened: the armed tap's id exists to de-dupe
  ARMING, and the conversion was already exactly-once, consumed in the same
  transaction. Both reviewers on the tap-replay step reproduced this
  independently and flagged it as worse than anything that step fixed; it is
  pre-existing on `main`, reproduced there before the fix.
  This also removes the sharp edge under the tap path's refusals: each of them
  is a 409 the outbox keeps retrying, and this was where that retrying ended
  up. The contract question — a tap that landed but is no longer current has
  no honest `200` — was open for the owner then, and it can no longer cost a
  teacher their day. (Since the ruling the `409`s stand; the honest terminal
  answer belongs to Phase 3's tap-side outbox disposition — see the entry at
  the top of this log.)
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
  teacher who already owns the tag, was **split out and waiting on the owner**
  (ruled in 2026-09-22 and landed as its own PR — see the ruling entry):
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
