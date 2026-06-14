# Bali v2 — Session Handoff

## ⚡ SESSION 6 — START HERE (written 2026-06-14) — Teacher iOS on-device, perf pass, + the zero-setup pivot

Continued from session 5. The teacher app was compiled, run on the **physical iPhone 15 Pro**, and
walked by the owner (the §6 device pass — "everything looks great"). Then two things: a **loading-perf
optimization** (owner-confirmed "feels good"), a **schedule-alignment fix**, and a deep **multi-agent
analysis of pivoting Bali to a "Doorman-style" zero-setup model** (the big strategic thread to resume).

### What shipped this session (all committed to `main`, NOT pushed)

- `perf(api)` **f873ce2** — parallelized the teacher hot paths. `portal/home` was ~28 *sequential*
  RDS round-trips (an N+1: `classCard` ran 4 queries/class in a loop + a redundant open-session loop
  + a 5-query `getSessionDetail`). Now: resolve each class's open session once & reuse; `Promise.all`
  the independent reads; `getSessionDetail`'s 4 reads run concurrently; and `portal/home` **returns
  the class cards** so T1 is one round-trip. **Measured: portal/home ~4300ms → ~480ms warm** vs RDS.
- `perf(ios)+ui` **76dc948** — T1 reads cards from `portal/home` (one request, was portal+classes
  sequential); T6 + T9 fetch concurrently (`async let`); **Today's schedule times zero-padded to
  HH:MM + left-aligned** so the column is an exact grid. ⚠️ **Pending owner sign-off on the zero-pad
  style** (`08:05`/`02:50`) — if the leading zero / "02:50 for a PM class" reads wrong, the fix is a
  one-line revert in `T1Home.swift` `zeroPadHour`/`.frame(alignment:)` (alternatives: right-align +
  accept single-digit indent, or restore AM/PM).
- (session 5, already committed) **915a78e** unused-`try?` warning fixes · **bf517a4** SESSION 5
  handoff (the Xcode 26.5 build gotcha — see below).
- **NEW doc `ZERO_SETUP_ANALYSIS.md`** (root) — the synthesis of the zero-setup analysis. **Read it.**

### 🔭 THE BIG THREAD TO RESUME — `ZERO_SETUP_ANALYSIS.md`

A 5-agent workflow (Doorman research + iOS feasibility-reading-our-code + teacher/student/admin
personas) analyzed the owner's ask to make Bali work like Doorman (*zero parent setup, instant at
school, school full control, parent visibility; full-focus only OK*). Headlines:
1. **Doorman's lock is a soft VPN a student's own VPN defeats** (it only *detects* bypass). **Bali's
   FamilyControls shield is already stronger** (OS-enforced). → copy Doorman's *adoption model*, not
   its tech.
2. **True "zero setup" is impossible on iOS BYOD** — the FamilyControls authorization is an
   irreducible one-time student tap. Honest framing: *"zero parent setup, one 10-second student tap,
   then instant."* Literal zero-setup only exists on **school-managed/supervised (ASM+MDM)** devices.
3. **Recommendation: a two-tier hybrid** — Tier 1 BYOD one-tap full-focus (now) + read-only parent
   visibility (backend/web, reuses the event stream, no new iOS permission); Tier 2 ASM+MDM managed
   devices = literal zero-setup, hard-enforced (upsell), behind the existing `ScreenTimeService` seam.
4. **Full-focus-only: yes as default**, but all three personas independently demand a **safety
   carve-out** (calls/911 free anyway; assistive/medical/AAC must survive — ADA/IEP) and the teacher
   wants a **class-wide opt-in allow-list** on the roadmap.
5. **`ZERO_SETUP_ANALYSIS.md` §5** has the concrete code changes (drop `PolicySetupView`/`PolicyBuckets`,
   collapse `applyShields` → `.all()`, nullable-migrate `allowedAppLabels`/`messagesAllowed`, gut W6/T8
   editors, add managed conformer + parent-visibility surface). **§6 lists the open decisions for the
   owner — start there next session.**

### To resume tomorrow — running state & restart

The dev servers + on-device app were live at pause; background processes likely **died** when the
session ended. To get back to a working device loop:
```bash
cd ~/Downloads/github/bali
npm run dev:api  > /tmp/bali-api.log 2>&1 &     # :3001, talks to RDS via root .env (migration 0002 applied)
npm run dev:web  > /tmp/bali-web.log 2>&1 &     # :3000
curl -s localhost:3001/v1/ready                 # expect {"ready":true}
# Teacher app on the iPhone 15 Pro (devicectl id CB970F97-E09E-5D3F-99E2-83B775E5C520), Mac IP 10.0.0.115:
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
cd ios/Bali
xcodebuild -project Bali.xcodeproj -scheme BaliTeacher -destination 'generic/platform=iOS' -configuration Debug -allowProvisioningUpdates build
APP=~/Library/Developer/Xcode/DerivedData/Bali-*/Build/Products/Debug-iphoneos/BaliTeacher.app
xcrun devicectl device install app --device CB970F97-E09E-5D3F-99E2-83B775E5C520 "$APP"
xcrun devicectl device process launch --device CB970F97-E09E-5D3F-99E2-83B775E5C520 -e '{"BALI_DEV_API_HOST":"10.0.0.115"}' com.bali.teacher
```
The app reuses the persisted Google session (signed in as `toeshanshah@gmail.com`) → lands on T1
with the real RDS demo world. **Build gotcha (from session 5, still applies):** Xcode 26.5 defaults
to explicit modules; a destination-less `-sdk iphonesimulator` build fails on `smithy-swift`'s
`Logging` — always build with a **concrete single-arch `-destination`** (`generic/platform=iOS` for
device, `id=<sim-udid>` for simulator; iPhone 17 Pro sim = `34AD32D3-B30E-450C-831F-9E70312574F7`).

### Suggested next-session order

1. Owner makes the `ZERO_SETUP_ANALYSIS.md` §6 decisions (full-focus-only? carve-out scope? tiers?
   under-13? marketing language). That gates the iOS/backend simplification work.
2. Quick win regardless of the pivot: ship the **read-only parent-visibility** web surface (pure
   backend/web, no iOS permission — cheapest part of the Doorman promise).
3. Then the web robustness backlog in `PRODUCTION.md` (mutation error-handling) — still open, still
   sandbox-doable.
4. Confirm/adjust the zero-pad time style (item above) and commit if changed.

---

## SESSION 5 (written 2026-06-14) — Teacher iOS compiles + runs under Xcode 26.5

The session-4 teacher app (T1 rev · T6–T12 · T3 rev) was authored in a Linux sandbox and
**never compiled**. This session did the real Swift build. Result: **all four targets BUILD
SUCCEEDED under Xcode 26.5** (Bali, BaliTeacher, BaliShield, BaliMonitor) — the authored
Swift was correct (zero source errors). The one real fight was the **toolchain**, documented
below so nobody loses an hour to it again.

### ⚠️ THE BUILD GOTCHA — Xcode 26.5 + Amplify (read before any iOS build)

Xcode 26.5 turns on **explicitly-built modules by default**. Building the way the session-4
handoff suggested — `-target BaliTeacher -sdk iphonesimulator` with **no `-destination`** —
forces a **multi-arch** build (arm64 **and** x86_64), and the explicit-module dependency
*scanner* then chokes on a transitive Amplify dep (`smithy-swift`'s `Smithy` importing
`swift-log`'s `Logging`):

```
error: unable to resolve module dependency: 'Logging'   (in target 'Smithy')
```

This is **not** a code bug and **not** flaky — it reproduces every clean build. Two dead ends:
- `SWIFT_ENABLE_EXPLICIT_MODULES=NO` *does* drop `-explicit-module-build`, but Xcode 26's SPM
  integration wires cross-package modules **through** explicit modules, so you then get
  `no such module 'Logging'` (Smithy's `-I` paths no longer include swift-log). Worse, not better.
- Plain rebuilds — deterministic failure, not a race.

**✅ THE FIX: build against a concrete single-arch destination.** A single active arch sidesteps
the multi-arch scanner bug entirely. No dependency bumps, no project edits, no source changes.

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer        # xcode-select → CLT
SIM=34AD32D3-B30E-450C-831F-9E70312574F7                               # iPhone 17 Pro (iOS 26)
cd ios/Bali
xcodebuild -project Bali.xcodeproj -scheme BaliTeacher -destination "id=$SIM" -configuration Debug build
xcodebuild -project Bali.xcodeproj -scheme Bali        -destination "id=$SIM" -configuration Debug build  # student + both .appex
```

Device builds use `-destination 'generic/platform=iOS'` (or `id=<UDID>`) — that's arm64-only =
single-arch, so the device pass is **unaffected** by this bug. The trap is *only* the
destination-less simulator invocation. (First build resolves the Amplify SPM graph — slow once.)

### What this session changed (all on `main`, NOT pushed)

- **iOS:** 5 trivial `_ = try? await store.api.postVoid(...)` warning fixes (T2Live ×2, T3Student,
  T7Roster ×2) so the teacher target builds **warning-clean**, matching the `_ = try?` discard
  pattern already used in T6/T8. **No other source changes** — the compile fix was the *invocation*,
  not the code.
- **Docs:** this block.

### What this session verified

- **Compile:** BaliTeacher + Bali + BaliShield + BaliMonitor all BUILD SUCCEEDED (single-arch sim).
  0 errors, 0 warnings in our code. Bundles produced incl. both `.appex` embedded in `Bali.app/PlugIns`.
- **Runtime (sim):** BaliTeacher installs + launches + stays running on the iPhone 17 Pro sim (iOS 26),
  renders `TeacherSignInView` correctly (ArcMark, tokens, fields, disabled Sign-in state, Google
  button, DEBUG dev sign-in). AmplifyAuth.configure() succeeds. No launch crash.
- **Swift↔API contract (static, comprehensive):** every teacher Codable struct checked field-for-field
  against the live serializers — `portal/home`→THome, `classCard`→TClassCard, roster→TRoster,
  `sessions/:id/recap`→TRecap, `classes/:id/overview`→TClassOverview, `.../history`→TStudentHistory,
  `/events`→{events,nextCursor}, `/policies` (incl. `usedByClasses` on create/patch), tags, settings,
  `/me`, session detail. Optionals, the `class`→`cls` CodingKey, and ISO-8601 dates all line up. **No
  decode bugs** — the blank-screen risk compile can't catch is retired across all endpoints.

### What still remains (the user's device pass — unchanged from §6/session-4 checklist)

A real Swift compile + sim launch is now done; the **data-driven §6 visual walk** is still best on
the phone, because (a) it needs Google sign-in as `toeshanshah@gmail.com` against RDS (only the user
can), and (b) the new screens have **no DEBUG launch-arg nav seams**, so a sim can only reach T1
without UI-tap automation. Walk per the session-4 checklist: T1 hub → T6 (5 segments + XL Dynamic
Type reflow) → T9 → T2 → T10 recap → T7 → T8 → T12 → T3 Recent, and confirm the §6 gate visually.
Run with `npm run dev:api` + `npm run dev:web` on the Mac and `BALI_DEV_API_HOST=<mac-ip>` (sim can
use `localhost`). Student-only device bits (NFC, FamilyControls shields, watchdog) are unrelated to
the teacher app — the teacher target uses no ScreenTime APIs, so the simulator is a faithful render of it.

---

## SESSION 4 (written 2026-06-14) — Teacher iOS = full-control app

Scope of this session: upgraded the **teacher iOS app** from a thin companion into a
full-control app per `design_handoff_teacher_ios/` (T1 rev · T6–T12 · T3 rev). The
student app and web app were untouched except one additive shared change (below).
Backend was extended and **verified end-to-end against a local Postgres (41/41
integration checks green)**. The iOS could not be compiled in the Linux sandbox — it
was authored carefully and reviewed by a multi-agent compile/gate pass; **a real Xcode
build + device pass is the one remaining verification** (deferred — phone not connected).

### What shipped (all committed to main, NOT pushed)

**Backend (`apps/api`, `packages/db`, `packages/shared`)**
- Migration **`0002_previous_revanche`**: `memberships.default_no_device` (bool) +
  `memberships.source` (enum code|tag|manual). Additive, defaults backfill existing rows.
- New endpoints (all teacher-gated): `GET /classes/:id/overview` (T6 stats + last-session
  recap pointer), `GET /sessions/:id/recap` (T10), `GET /classes/:id/students/:sid/history`
  (T3 Recent), `PATCH /memberships/:id` (default-no-device).
- `reports.ts`: `sessionRecap`, `studentSessionHistory`, `classOverview` — reuse the W8
  focus-minute event algorithm; neutral counts, zero ranking. Recap partitions the roster
  by precedence (no_device > emergency > permission-off > pass > focused > never-joined).
- `domain.startSession` seeds default-no-device participations; `joinByCode` records source;
  `setMembershipDefaults` mirrors a live session immediately. `classCard` gains
  `autoApprove`, `archived`, `lastMetLabel`. Portal approvals now carry `classId` + newest-first.
- `seed.ts`: canonical addendum demo — Dana/Leo/Sofia pending in Period 1 (approval on,
  Sofia by tag), Priya (P3) + Hana (P1) default-no-device, and **5 ended Period 3 sessions**
  crafted so Sam Torres's Recent reads the spec rows and the last session is "26 of 28 focused".

**iOS (`ios/Bali/BaliTeacher` + one shared `BaliCore` change)**
- New: `TComponents.swift` (shared: ClassPrimaryAction, LiveBanner, projectable JoinCode,
  StatGrid, SegPicker, SummaryChips, StateIconDot, EventTimelineCard, FramingLine, FlowLayout),
  `T6ClassDetail.swift`, `T7Roster.swift`, `T8Policies.swift`, `T9StartSession.swift`,
  `T10Recap.swift`, `T12CreateClass.swift`. Revised: `T1Home.swift` (hub), `T3Student.swift`
  (Recent), `T2Live.swift` (End → T10), `TeacherModels.swift`, `TeacherApp.swift` (TeacherField).
- Shared `BaliCore/API.swift`: query strings no longer go through `appendingPathComponent`
  (was breaking `events?classId=`); added `delete()`. **Additive — student app unaffected.**
- Xcode project uses synchronized folder groups (PBXFileSystemSynchronizedRootGroup), so the
  new files auto-join the BaliTeacher target — **no .pbxproj edits needed**.

### ⚠️ To deploy / run on the device (DB is the shared RDS — do this deliberately)

1. **Apply the migration to RDS FIRST, before deploying the new API code** — the new code
   SELECTs `default_no_device`/`source`, so the API will 500 on every roster/class query if
   the columns are missing. `npm run db:migrate`.
2. The new endpoints work on EXISTING data after the migration (columns default sensibly).
   **Reseeding is optional** — only needed to get the new canonical demo content. If you
   reseed, note `npm run db:seed -- --reset` may NOT forward `--reset` through the nested npm
   script; run it directly: **`npx tsx packages/db/src/seed.ts --reset`**. A `--reset` WIPES
   the RDS demo world (incl. the real `toeshanshah@gmail.com` adoption — it re-adopts on the
   next Google sign-in + bootstrap since the email still matches a seed-% row).
3. Local verification harness used this session (safe, never touches RDS): docker postgres on
   :5433 + `ALLOW_DEV_TOKENS=1` + dev token `dev:rivera:teacher@example.com:Ms. Rivera`
   (bootstrap adopts seed Rivera by email). Tests in `/tmp/test-endpoints.mjs` (ephemeral).

### Device-test checklist for the new teacher screens (do after an Xcode build)

T1 hub (live + idle + empty) · tap class → T6 (all 5 segments; XL Dynamic Type reflow) ·
Start session from T6/T1 → live grid → End → **T10 recap auto-presents** · T7 approve/decline ·
T8 editor + in-use delete guard · T12 create → join-code reveal · T3 → Recent tab. The §6
gate (icon+label states, red only on revoked/destructive, framing line on T6/T10/T3, verbatim
T8 explainer + T3 boundary, 44pt) was reviewed in-repo but confirm visually.

---

## ⚡ SESSION 3 (written 2026-06-12, mid device-test)

Everything below the session-2 header further down is still accurate background.
This block is what changed since, and exactly where we stopped.

### What changed after the session-2 handoff was written (all committed AND pushed — origin/main == main @ ccbfce8)

1. **Demo-teacher ownership transferred to the real account.** The "Ms. Rivera" row
   (all Period classes, join code KM3W7Q2A, tag T7XK2M9QPF) now belongs to the user's
   real Cognito identity **toeshanshah@gmail.com — which is a GOOGLE-FEDERATED user
   (no password exists; never offer it email/password sign-in)**. Found by sub, no
   adoption step. `SEED_TEACHER_EMAIL` in `.env` updated to match.
   ⚠️ Never create a STUDENT account with that email (same sub; /v1/me resolves
   teacher-first → student app would loop). For the student device test use
   `toeshanshah+student@gmail.com` (same inbox, distinct Cognito user).
2. **Dev-token flows moved to a sandbox**: `dev:t-sandbox:sandbox-teacher@bali.dev:Sandbox Teacher`
   owns only the tests' "Slice Sandbox" class. Both python suites are now fully
   self-contained (create own class/tag, students join by code) and safe to run during
   live demos. Web dev sign-in button + teacher iOS DEBUG dev sign-in use the sandbox.
3. **Google sign-in shipped on the teacher iOS app** (Cognito Hosted UI via
   ASWebAuthenticationSession, reusing the already-registered `balistudent://callback/`
   redirect — zero Cognito changes). Web Google sign-in already worked.
4. **DB pool resilience**: an RDS idle reset emitted an unhandled pool 'error' and
   killed the API process mid-session. Fixed in packages/db/src/client.ts (error
   handler + keepalive + 30s idle timeout). If the API ever seems dead, check
   /tmp/bali-api.log — and note `tsx watch` does NOT restart on crash.
5. **BALI_DEV_API_HOST persists** from the devicectl launch env into UserDefaults, so
   icon-tap relaunches on the phone keep talking to the Mac (10.0.0.115:3001).

### Exact device-test position (iPhone 15 Pro, UDID 00008130-000A1D29260B803A / devicectl id CB970F97-E09E-5D3F-99E2-83B775E5C520)

- Both apps installed and launched with `BALI_DEV_API_HOST=10.0.0.115`; user has a
  blank NFC sticker ready. API + web dev servers were running on the Mac.
- **Next user action (where we stopped): teacher app → "Continue with Google" →
  pick toeshanshah@gmail.com → should land on all four Period classes.** If classes
  come back EMPTY, the Google-federated sub differs from the row's sub
  (54a84478-d021-7062-e9fa-19c6bf75c340) — repoint the teachers row to whatever sub
  the sign-in minted (check API log or query teachers for the new orphan row).
- Then the scripted flow: write NFC sticker (Tags tab → Period 3) → start session
  (≥15 min for the watchdog test) → student app: create account with the +student
  alias → S1 permission → join KM3W7Q2A → approve on web (localhost:3000, Google
  sign-in) → tap sticker → S5 picker (ALSO select "Bali Teacher" — shields are
  device-wide and both apps share the phone) → Start Focus → shield screen check →
  airplane-mode emergency unlock → pass → kill-app watchdog at the bell.
- Task #18 (device pass + VoiceOver listening pass) is the only open build task.

### The new backlog: ROADMAP.md (root)

36 adversarially-verified improvement ideas across student/teacher/admin/design-gap
lenses, each with file:line evidence and build corrections. Recommended order is at
the top: P0 honesty-bug cluster first (arc math, reason queue, S2 preview, S6
reconnect pill, email notifier), then Live Activity / phone approvals / teacher
invite code. Read it before starting any new feature work.

### Session-3 cadence reminders

- Commits as eshan06, multiple focused commits, NO Claude attribution. Pushing is
  allowed when the user asks (he had us push session 2).
- Verify the world first: dev servers up → `npm test -w packages/shared` →
  `python3 scripts/slice-test.py` → `python3 scripts/manage-test.py`.
- iOS builds: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
- Headless Chrome screenshot harness: scripts/shot.mjs (Chrome with
  --remote-debugging-port=9222 must be running).

---

# Session 2 handoff (still-accurate background) — originally titled: Bali v2 — Session Handoff (updated 2026-06-11, end of build session 2)

> **Who this is for:** the next working session (Claude Code acting as principal engineer
> on Bali, or any engineer picking this up). Read this file, then the documents it chains
> to, and you have everything — the mission, the rules, what exists, what's verified,
> what's left, and every gotcha discovered across both sessions.
>
> **Read-first chain (in order):**
> 1. This file (state + what's next)
> 2. `WIRING_PLAN.md` (the architecture contract — now with §8.11–20 session-2 deviations)
> 3. `DISCOVERY.md` (condensed inventory of the design handoff + the legacy app)
> 4. Before touching any surface: its design doc section (map in §9 below)

---

## 1. Mission & operating rules (the standing contract — unchanged)

Wire the **finished design** in `design_handoff_bali_2/` into a real application,
end to end, reusing legacy's *connections* (AWS resources, env values, proven
integrations) but never its structure. The design bundle is law: exact copy, tokens,
the 7-state system, red only for revoked/destructive, the banned-vocabulary list,
reduced-motion everywhere.

**Guardrails:**
- **Scope:** full shell freedom inside the repo root; system-level changes need OK.
  The app's AWS resources (shared Cognito pool, RDS, `bali_v2` db) are in scope for
  non-destructive operations.
- **Commits:** as `eshan06 <eshan.nirav@gmail.com>` — NO Co-Authored-By, NO "Generated
  with" trailers. Multiple focused commits per concern. Nothing pushed to origin —
  pushing stays the user's call.
- **Secrets:** never printed or committed; real values live in untracked `.env`s (§5).
- **`legacy/` is read-only** (fallback + reference).
- Prefer the well-built choice; record judgment calls in WIRING_PLAN §8.

## 2. Plan status

- Housekeeping / Phase 0 / Phase 1 — ✅ (session 1)
- **2a — vertical slice** — ✅ verified (session 1)
- **2b — remaining web surfaces** — ✅ **done and verified** (session 2, §3)
- **2c — remaining iOS + teacher app** — ✅ **built; Simulator-verified** (session 2, §3)
- **Remaining:** the physical-device pass (§6) + quality backlog (§7)

## 3. What session 2 accomplished (all on `main`, local only)

### Backend (commits `91f39f4`, `513abe7`)
- **2b endpoint batch:** `PATCH /v1/classes/:id` (edit/archive, 409 if a session is
  live), policies CRUD (+`policy_in_use` 409 guard; delete nulls FK provenance, snapshots
  keep history), tags lifecycle (create with server code or device-written code,
  rename, deactivate/reactivate + events), `GET/PATCH /v1/me/settings` (now incl.
  `notifyPassEndings` — migration `0001_lazy_dreadnoughts`), reports
  (`/v1/reports/unlocks` with per-student 6-week sparkline buckets + CSV export whose
  header carries the framing line verbatim; `/v1/reports/focus-minutes` computed by
  walking the append-only event stream — pass time counts, unlock/revoked gaps don't),
  `GET /v1/events` (type-group + class filters, bigserial cursor pagination),
  **rate limiting** (`@fastify/rate-limit`, per-route opt-in on student writes, keyed
  by bearer token so a classroom NAT never throttles as one client; 429s use the
  standard `{error,message}` envelope via HttpError).
- `scripts/manage-test.py` — integration suite for all of the above (idempotent;
  cleans up after itself). Run it like the slice test.

### Web (commits `f9c2ff1`…`821f6ca`, one per surface)
- **W6 policies** — list + editor (locked Phone row, Messages toggle, label tag-input,
  honesty explainer verbatim, "Used by N classes", guarded delete + confirm).
- **W7 desk tags** — TagCard grid with **real SVG QR** (`QrSvg`, native path rendering,
  quiet zone; encodes `<origin>/t/<code>`), create dialog, deactivate warning naming
  the blast radius, deactivated cards at 62%, print sheet (`@media print` rules in
  globals.css — only the sheet prints).
- **W8 reports** — framing line as designed copy (italic, in the header), filter chips
  (classes + This week/This month), unlocks table (skipped/pending tertiary, 5px
  orange-300 sparklines, stone-200 zero weeks), focus-minutes bars + honest
  "Out of a {N}-minute period" caption, CSV download with auth.
- **W9 event log** — type-group + class chips, EventTimeline reuse, "Load older events".
- **W10 settings** — profile ("Shown to students as" feeds every student screen via
  `reload()`), school, email toggles.
- **W5 polish / W3** — shared `ProjectCodeOverlay` ("Project this", 88px mono,
  Esc/click dismiss) on roster + created-class state.
- **W2 `/t/[code]`** — public fallback (SSR fetch, deep-link button to `bali://t/<code>`,
  mono code pill, store-badge placeholder, honest inactive-tag copy).
- **Landing** — full §05 page faithfully ported from `Bali - Landing.html`: hero
  (underline sweep, ticking 198px arc with draw-in, floating chips, ambient dashed
  rings, cursor tilt), interactive **hold-to-unlock demos** (hero + dark band; spring-back,
  complete state, Enter/Space one-step), how-it-works pops, dark exit band, teacher
  glance cascade, privacy contract, CTA band, footer; **frozen-timeline-safe reveal**
  (rect-based + 250ms poll + snap timers + anim-settled) per doc 06.
- **Cross-cutting:** 1024 stacking (portal/roster/policies/reports), `select`/`textarea`
  focus rings, banned-vocabulary grep clean (the landing's "No surveillance, no
  lockdown theater" is the design's own disavowal copy).

### iOS student (commits `c4f1845`…`616cc27`)
- **Real Cognito SRP via Amplify Swift 2.58.1** (package pinned in committed
  Package.resolved): S0 sign-in/create-account segmented flow, email confirmation step,
  needs-name bootstrap step; dev path stays DEBUG-only. `amplifyconfiguration.json`
  untracked in `BaliCore/` (example committed).
- **S1 onboarding** — 3 cards + permission moment; **verbatim PrivacyContractCard**
  (shared with S9), real `AuthorizationCenter.requestAuthorization`, calm denied state
  with "Join without focus (status-only)" + consequence line.
- **S5 policy setup** — FamilyActivityPicker flow, count-honesty check (mismatch screen
  with "Re-open picker" / "Looks right — confirm"), **PolicyBuckets** (selection stored
  locally keyed by label set; Bali never sees app lists). `RealScreenTimeService` now
  shields **`.all(except: selection)`** (apps + web domains) — the slice-era shield-all
  remains only as the no-bucket fallback.
- **S8 history** (week bars, streak, factual session rows) + **session detail**
  (student-side EventTimeline, "Only you see this page…"), **S9 settings** (permission
  health row, account/privacy/history, class rows with policy + leave path, About)
  + **S9 privacy** (contract verbatim + revocation honesty note).
- **S10 shield extension** (`BaliShield` target): six primitives only — dark blur,
  green-tinted darkness, runtime-drawn arc icon, "Focused with {teacher}",
  "Until {time} · Emergency? Open Bali", OK on #2C6F51, "Open Bali" secondary; context
  via app group `group.com.bali.shared` (written by FocusEngine, cleared on end).
- **NFC + deep link** — NDEF read on device (`TagCodeReader`; text or URI records;
  the Simulator keeps the tag-entry sheet), NDEF **write** (`TagCodeWriter`, used by
  the teacher app), `bali://t/<code>` scheme + `DeepLinks` handler (W2's button
  verified routing into the app via `simctl openurl`).
- **DeviceActivity watchdog** (`BaliMonitor` target): `intervalDidEnd` clears all
  shields + shield context even if Bali was killed; armed at focus start, re-armed on
  teacher extend (heartbeat detects `endsAt` movement), disarmed on end/reset; pads
  sub-15-min sessions to the API minimum.
- **S6 XL Dynamic Type** — arc 218pt, countdown 50pt, control 76pt at ≥XXL.
- Entitlements: app = family-controls + NFC formats + app group; extensions =
  family-controls + app group; teacher = NFC formats.

### iOS teacher (commit `2852ffc`)
- **`BaliTeacher` target** (`com.bali.teacher`, light theme, email/password SRP only,
  DEBUG dev sign-in) over a new **`BaliCore`** synced folder shared by both apps
  (Tokens incl. new Light state pairs, APIClient incl. `patch`, Models, AmplifyAuth,
  NFC, Brand/ArcMarkView, amplify config).
- **T1** home (class cards, live chip + "Open live grid"), start-session sheet
  (ends-at prefilled to the bell, policy menu, allowed-list caption), minimal
  create-class sheet, empty state. **T2** live grid (38pt arc + mm:ss header, Extend/
  End with confirm, summary chips, 2-col 46pt phone chips with pass timers + staleness,
  5s poll, **emergency toast** with "Open student" + single soft pulse). **T3** student
  sheet (tapped-in header, timeline, GrantPassForm 5/10/15/Custom + reason + auto-return
  caption, no-device toggle). **T4** tags (class picker, rows, **NFC write flow** with
  written/verify state, native deactivate alert). **T5** active passes (live tickers)
  + notify toggles (incl. Pass endings) + dashboard footnote.

### Verification evidence (all green at handoff)
1. `npm run typecheck` — zero errors, all workspaces.
2. `npm test -w packages/shared` — 12/12.
3. `python3 scripts/slice-test.py` — ALL SLICE CHECKS PASSED (SSE included).
4. `python3 scripts/manage-test.py` — ALL MANAGE CHECKS PASSED (incl. CSV framing
   line, cursor pagination, 429 envelope, archive guard).
5. Screenshots vs design (headless Chrome harness `scripts/shot.mjs` + Simulator):
   W6/W7/W8/W9/W10/projector/W2/landing (hero, bands, working hold-demo complete
   state), S0/S1 (cards 1–2, denied)/S8/S9 (live data), T1/T2 (live grid with real
   session), S6 XL variant — all rendered against the live local API + RDS.
6. `xcodebuild` — Bali, BaliShield, BaliMonitor, BaliTeacher all **BUILD SUCCEEDED**
   for Simulator AND signed `generic/platform=iOS` device builds (provisioning incl.
   family-controls, app group, NFC resolved under team H535678UF8).

## 4. Repo map (root — changes from session 1 marked ←)

```
bali/
├── HANDOFF.md / WIRING_PLAN.md / DISCOVERY.md / design_handoff_bali_2/ / legacy/
├── scripts/  slice-test.py · manage-test.py ← · shot.mjs ← (CDP screenshot harness)
├── apps/
│   ├── api/src/  routes/{auth,public,teacher,manage ←,reports ←,student}.ts ·
│   │             reports.ts ← (framing line, sparklines, focus-minutes walker) ·
│   │             app.ts (now + rate-limit) · domain.ts · serialize.ts · …
│   └── web/src/  app/{page (landing ←), landing.tsx ←, t/[code] ←, app/{policies,tags,
│                 reports,logs,settings ←}} · components/bali/{QrSvg ←, ProjectCode ←, …} ·
│                 styles/landing.css ←
├── packages/
│   ├── shared/   dto.ts (+policyId nullable, notifyPassEndings)
│   └── db/       schema.ts (+notify_pass_endings) · migrations/0001 ←
├── ios/Bali/
│   ├── Bali.xcodeproj      4 targets ← (Bali, BaliTeacher, BaliShield, BaliMonitor;
│   │                       2 shared schemes; amplify-swift 2.58.1 pinned)
│   ├── Bali/               App/ · Core/{Auth,FocusEngine,ScreenTime(+buckets,watchdog,
│   │                       ShieldContext),…} · Features/{SignIn,Onboarding ←,PolicySetup ←,
│   │                       Home,Join,TapIn,FocusActive(+XL),History ←,Settings ←}
│   ├── BaliCore/ ←         Tokens(+Light states) · API(+patch) · Models · AmplifyAuth ·
│   │                       NFC(read+write+DeepLinks) · Brand · amplifyconfiguration.json (untracked)
│   ├── BaliTeacher/ ←      TeacherApp · TeacherModels · T1Home · T2Live · T3Student ·
│   │                       T4Tags · T5Passes
│   ├── BaliShield/ ←       ShieldConfigurationExtension
│   ├── BaliMonitor/ ←      SessionMonitor
│   ├── Info.plist (+bali:// scheme, NFC usage) · {Bali,BaliShield,BaliMonitor,BaliTeacher}.entitlements ←
│   └── {BaliShield,BaliMonitor,BaliTeacher}-Info.plist ←   (all OUTSIDE synced folders — §8.2)
└── .env / apps/web/.env.local   (real values, untracked — §5)
```

## 5. How to run everything

Env files unchanged from session 1 (root `.env` + `apps/web/.env.local`, real values
untracked; recreate from `legacy/` per WIRING_PLAN §7 if lost). `SEED_TEACHER_EMAIL`
is now `toeshanshah@gmail.com`.

**Who owns what (since 2026-06-11):** the demo teacher row ("Ms. Rivera", all Period
classes, code KM3W7Q2A, tag T7XK2M9QPF) is owned by the user's REAL Cognito account
(`toeshanshah@gmail.com`) — sign in with email+password on web or either iOS app and
the demo world is there. Dev-token flows (`dev:t-sandbox:…`) own a separate "Slice
Sandbox" world that the integration tests create for themselves; the suites never
touch the real teacher's classes and can run during live demos. Two cautions:
(1) don't create a STUDENT account with the teacher's email — same Cognito sub, and
`/v1/me` resolves teacher-first, so the student app would loop; use any other email
(a `+alias` works). (2) avoid the web "Continue with Google" button for that email —
Google federation mints a different sub and would create a second, empty teacher.

```bash
cd ~/Downloads/github/bali
npm run dev:api                  # :3001
npm run dev:web                  # :3000
npm test -w packages/shared      # 12 unit tests
python3 scripts/slice-test.py    # e2e slice (ends its own session)
python3 scripts/manage-test.py   # e2e management/report surface
# screenshots: launch Chrome headless once →
#   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
#     --remote-debugging-port=9222 --user-data-dir=/tmp/bali-chrome about:blank &
#   node scripts/shot.mjs http://localhost:3000/app/reports /tmp/x.png --token 'dev:t-sandbox:sandbox-teacher@bali.dev:Sandbox Teacher'
```

**iOS Simulator** (iPhone 17 Pro `34AD32D3-B30E-450C-831F-9E70312574F7` has both apps):

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # xcode-select → CLT!
cd ios/Bali
xcodebuild -project Bali.xcodeproj -scheme Bali        -destination "id=$SIM" build
xcodebuild -project Bali.xcodeproj -scheme BaliTeacher -destination "id=$SIM" build
# student dev auth:  defaults write com.bali.Bali bali.devToken "dev:s-jordan::Jordan Park"
# teacher dev auth:  defaults write com.bali.teacher bali.teacher.devToken "dev:t-sandbox:sandbox-teacher@bali.dev:Sandbox Teacher"
# DEBUG screenshot seams: -bali.onboardingStep N · -bali.route settings|history|privacy ·
#                         -bali.teacher.route live
```

## 6. Remaining — the physical-device pass (needs the iPhone unlocked, in hand)

The signed device builds already succeed; what's left is literally the phone:

1. Unlock the iPhone 15 Pro (UDID `00008130-000A1D29260B803A`), plug in / same Wi-Fi,
   keep Developer Mode on. Then:
   ```bash
   xcodebuild -project Bali.xcodeproj -scheme Bali -destination "id=00008130-000A1D29260B803A" -allowProvisioningUpdates build
   xcrun devicectl device install app --device <UDID> <path-to-Bali.app>
   xcrun devicectl device process launch --device <UDID> com.bali.Bali
   # + BaliTeacher the same way; BALI_DEV_API_HOST=<mac-LAN-IP> via Settings/scheme env
   ```
   (Legacy recipe in `legacy/README.md` still applies; same bundle id replaces the
   legacy install — intentional.)
2. **On-device acceptance:** S1 permission grant (real dialog) → S5 picker (real apps)
   → tag NDEF write (T4) → student NFC tap → S6 shields on (check the **S10 shield
   screen** appearance) → emergency unlock offline (airplane mode) → pass round-trip →
   bell clears shields → kill the app mid-session and let the **BaliMonitor watchdog**
   clear shields at ends_at.
3. **VoiceOver listening pass** against doc 03's scripts (labels are all in place —
   the audit is the human pass).
4. First Amplify sign-in on device exercises the real `amplifyconfiguration.json`
   (bundled from BaliCore/; copy from legacy if a fresh checkout lacks it).

## 7. Quality backlog (post-MVP, either side)

API integration tests in vitest (port the two python suites) · Swift mirror tests for
`deriveParticipantState` · email notifier stub wiring for the four notify_* prefs ·
W4 staleness for `not_joined` (n/a by design — confirm) · CI · production API host in
`APIConfig` (currently a TODO) · App Store badge asset on W2.

## 8. Gotchas & hard-won knowledge (sessions 1+2 — read before touching anything)

1. **`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`** for all xcodebuild.
2. **Info.plists stay OUTSIDE synced folders** (app + all three new targets follow
   this; the synced root group would double-process them).
3. **SourceKit single-file diagnostics are noise** ("Cannot find type …", macOS-
   availability complaints). Trust `xcodebuild` only.
4. **Web fonts** route through `--font-instrument`/`--font-jbmono`; don't simplify.
5. **StatusChip classes are literal strings** (Tailwind scanner).
6. **SSE is fetch-streamed** (Authorization header); poll fallback in `lib/live.ts`.
7. **Empty-body POSTs** rely on the custom JSON parser in `app.ts`.
8. **Seed adoption**: teacher by email (`seed-%`), student by first+last (NULL sub).
9. **Dev tokens** need `ALLOW_DEV_TOKENS=1` (web hidden button, iOS DEBUG, tests).
10. **The sweeper** (15s) is the bell; reads lazily end overdue sessions.
11. **Pinned versions**: drizzle-orm 0.38.4 / fastify 5.8.5 / next 15.5.19 /
    aws-amplify 6.18.0 (web) / amplify-swift 2.58.1 (iOS) / @fastify/rate-limit 11.
12. **Design rules that bite**: red ONLY revoked/destructive; emergency always orange
    and calm; exact unlock copy; Skip first-class; staleness is a badge; mono only for
    codes; SF Rounded only for big numerals; banned words never in UI or
    `renderEvent` strings.
13. **Never name a web class `ring`** — Tailwind's `ring` utility paints a blue
    box-shadow on it (cost an hour on the landing's ambient SVGs → now `orbit`).
14. **`Runtime.evaluate` top-level await** needs the async-IIFE wrap (shot.mjs does
    this; its `--js` flag reports exceptions).
15. **@fastify/rate-limit's `errorResponseBuilder` return value is THROWN** — return
    an `HttpError`, not a plain object, or 429s become 500s.
16. **Per-route rate-limit keying must be per-token**, never per-IP (school NAT).
17. **DeviceActivity schedules need ≥15 minutes** — pad short sessions (watchdog only).
18. **`xcrun simctl io tap` doesn't exist** — use the DEBUG launch-arg seams (§5) for
    screen-state screenshots; `simctl ui <sim> content_size` (underscore) sets Dynamic
    Type; a queued `simctl openurl` re-prompts "Open in Bali?" until the sim reboots.
19. **FamilyActivitySelection persists fine in UserDefaults** (Codable); buckets are
    keyed by sorted lowercased label set (`PolicyBuckets`).
20. **The student app's `/me` teacher branch** doesn't include notifyPassEndings —
    T5 reads `/me/settings` (which does).

## 9. Design-doc → surface map (for any revisit)

| Surface | Read first |
|---|---|
| Any web page | docs/05 §page + its `design-files/*.html` frame |
| Landing motion | docs/06 §landing + §frozen-timeline |
| iOS S-screens | docs/04 §screen + `design-files/pass3/S*.html` |
| Teacher T1–T5 | docs/04 §T1–T5 + `pass3/T*.html` |
| Shield S10 | docs/01 §Shield constraint (six primitives) |
| Components | docs/03 (PolicyEditor, TagCard, GrantPassForm, chips…) |
| Copy/voice | docs/01 + the banned list in §8.12 above |

## 10. Definition of done (doc 07 — verbatim checklist)

Every state visible somewhere with icon+label, never color-only · red only for
revoked/destructive · emergency path reads safe and shame-free · the grid passes a
6-foot squint test · dark student screens feel native, not inverted · the XL Dynamic
Type layout doesn't break · copy obeys the voice laws · no banned visual defaults ·
every interactive element has a visible focus state · `prefers-reduced-motion`
respected everywhere.

## 11. Suggested order for session 3

1. Re-orient: this file → `git log --oneline | head -25` → dev servers → both python
   suites (proves the world).
2. **The device pass (§6)** with the phone in hand — it's the only remaining 2c item.
3. Then the quality backlog (§7) in any order; vitest port of the python suites first
   gives the most safety per hour.
4. Keep the cadence: typecheck + both suites before every commit; commit per surface;
   update WIRING_PLAN §8 + this handoff at session end.

---

*Everything above verified at handoff: 12/12 unit, both integration suites green,
typecheck clean, 4 iOS targets building for Simulator + signed device arch, every new
surface screenshot-compared against the design with live RDS data. Nothing pushed to
origin — that stays the user's call.*
