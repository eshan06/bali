# Bali v2 — Session Handoff (written 2026-06-11, end of build session 1)

> **Who this is for:** the next working session (Claude Code acting as principal engineer
> on Bali, or any engineer picking this up). It is self-sufficient: read this file, then
> the two documents it chains to, and you have everything — the mission, the rules, what
> exists, what's verified, what's left, and every gotcha discovered today.
>
> **Read-first chain (in order):**
> 1. This file (state + what's next)
> 2. `WIRING_PLAN.md` (the architecture contract — target design, improvements over
>    legacy, API surface, flows, env strategy, judgment calls)
> 3. `DISCOVERY.md` (condensed inventory of the design handoff + the legacy app)
> 4. Before building any specific surface: its design doc section (map in §9 below)

---

## 1. Mission & operating rules (the standing contract)

The job: take the **finished design** in `design_handoff_bali_2/` and wire it into a
real, working application — backend, data, auth, the full path from teacher portal to
iOS — end to end. The new Bali is **intentionally different** from the old one: not a
re-skin, not a port. Reuse the old app's *connections* (AWS resources, env values,
proven service integrations); do **not** copy its structure or shortcuts. When the old
approach and good engineering disagree, choose good engineering and note why.

**The design bundle is law.** `design_handoff_bali_2/docs/01-product-spec.md` is the
authoritative spec; tokens/copy/timings are normative ("don't eyeball the screenshots —
the docs have exact numbers"). The README's "10 things you must not get wrong" is the
checklist that matters most.

**Guardrails (all still in force):**
- **Scope:** full shell freedom *inside* the repo root; anything with effects outside
  it (installs to /opt, system config, etc.) needs explicit OK first. AWS resources
  backing the app (the Cognito pool, the RDS instance, the `bali_v2` database) are
  treated as the app's own infrastructure — non-destructive provisioning inside them is
  in scope; destructive operations or *new* AWS services are not.
- **Commits:** as `eshan06 <eshan.nirav@gmail.com>` — NO Co-Authored-By, NO
  "Generated with" trailers, no Claude attribution of any kind. (`--no-verify -q` was
  used throughout.) Nothing has been pushed to origin; pushing was deliberately left to
  the user.
- **Secrets:** never print, paste, or commit secret values. Real values live in
  untracked `.env` files (see §5); committed files carry placeholders only.
- **`legacy/` is read-only.** It's the known-good fallback (own README explains how to
  run it). Don't modify it.
- **Autonomy:** plan → build without waiting for sign-off; only stop for decisions that
  are genuinely the user's. Note judgment calls in WIRING_PLAN §8 rather than blocking.
- Prefer the well-built choice over the fast one — this app's reason to exist is being
  better done than the old one.

## 2. The original plan (and where it lives)

- **Housekeeping** — move the old app to `legacy/` + write its run guide. ✅ done
- **Phase 0 — Discovery** — inventory both worlds, write `DISCOVERY.md`. ✅ done
- **Phase 1 — Wiring plan** — `WIRING_PLAN.md`: target architecture, 12 deliberate
  improvements over legacy (each with a reason), data model, full `/v1` API surface,
  surface-by-surface map, 7 traced end-to-end flows, reuse-vs-rebuild, env strategy,
  10 open questions with calls made. ✅ done
- **Phase 2 — Build** (incremental, runnable at every step):
  - **2a — vertical slice**: teacher portal → start session → student iOS → live
    status back to teacher. ✅ **done and verified** (details in §3)
  - **2b — remaining web surfaces**: ⏳ next up (itemized in §6)
  - **2c — remaining iOS surfaces + device**: ⏳ after 2b (itemized in §7)

## 3. What was accomplished today (session 1)

### Commits (all on `main`, local only — not pushed)

```
964cc0b docs: record wiring-plan deviations (root .env, no-device route); ios Info.plist relocation
56a1934 ios: new student app — tokens, API client, focus engine (offline-safe unlock queue), S0/S2/S3/S4/S6/S7 slice screens; builds for Simulator
40ec370 web: tokens + Bali component kit, login (W1), portal home, classes (W3), live dashboard (W4, six states, SSE), roster (W5 core)
ffe7908 api: empty-body JSON tolerance, honest error codes, heartbeat returns derived state; full slice integration test green (SSE incl.)
4c3229d api: fastify v1 — auth/bootstrap, classes, sessions+SSE, tap-in/heartbeat/unlock/pass lifecycle, portal home, sweeper
258be97 v2 foundations: workspaces, shared state system + DTOs, drizzle schema on bali_v2 (RDS), canonical demo seed
e5549bc docs: phase 0 discovery summary, v2 wiring plan, legacy run guide
33132d0 chore: generalize gitignore build-artifact paths for legacy/ and future app dirs
f82af54 design: add design_handoff_bali_2 (full product design bundle)
ed4fe39 chore: relocate old Bali app into legacy/ as reference baseline
(+ one more at session end: membership removal endpoint, z-index fix, slice test moved
 into scripts/, error-handler typing, this handoff)
```

### Infrastructure (real AWS, shared with legacy, legacy untouched)

- **`bali_v2` database created** on the existing RDS instance (`bali-db`, us-east-1) —
  legacy's `bali` database untouched. Drizzle migrations applied
  (`packages/db/migrations/0000_far_ares.sql`), canonical demo data seeded.
- **Same Cognito pool** as legacy (`us-east-1_MwuzsGGtT`, client
  `3hsgud7pr2k0emhsodctqg4okd`). No Cognito changes were made or needed.

### Backend — `apps/api` (Fastify 5 + TS + zod + Drizzle, port 3001)

Everything in WIRING_PLAN §3 that the slice needs, fully working:
- Auth: Cognito ID-token verification (`aws-jwt-verify`), `POST /v1/auth/bootstrap`
  with **seed adoption** (teacher row claimed by email match; student row claimed by
  first+last name match — "Jordan Park" becomes the persona), DB-authoritative roles.
- Teacher: classes list/create/get (card payloads), roster (members + pending +
  live state), approve/decline/**remove** memberships, policies list, session
  start/end/extend (snapshot frozen at start), grant pass, no-device flag,
  per-student session timeline, **portal home composite**, **SSE stream**
  (`GET /v1/sessions/:id/stream`).
- Student: join by code (approval-aware), home, tag resolve (returns the S4 variant
  server-side), tap-in (idempotent via clientEventId; re-tap after unlock = refocus),
  heartbeat (30s; carries `permissionOk`/`shieldsApplied`; flips revoked↔focused;
  returns **derived** state + pass sync), **emergency unlock** (idempotent,
  offline-replayable, kills active passes), share reason (one-shot), refocus,
  personal history (S8 data: week bars, streak, per-session timelines), leave.
- Public: `GET /v1/public/tags/:code` (W2 fallback; class name only), `GET /v1/health`.
- Infra: in-process session bus → SSE fan-out; **15s sweeper** ends overdue sessions
  (the bell) and expires passes (lazy checks on reads back it up); transactions on all
  multi-step writes; append-only `events` table renders every timeline string
  server-side in one place (`serialize.ts: renderEvent`); empty-JSON-body tolerance;
  clean error envelope `{error, message}`.

### Web — `apps/web` (Next 15 App Router + Tailwind 3 + tokens, port 3000)

- **Token system installed**: `src/styles/tokens.css` + `bali-tokens.cjs` (canonical
  copies of the design bundle's token files), Instrument Sans + JetBrains Mono via
  `next/font` mapped into the token vars, focus rings global, motion utilities
  (`pulse-once`, `toast-in`, `fade-up` snap-safe) with reduced-motion fallbacks.
- **Bali component kit** (`src/components/bali/`): StatusChip (all 7 states + stale
  badge + sizes grid/proj/mini + a11y labels), SummaryStrip, Arc (rounded-cap SVG,
  final-2 emphasis), ArcMark, Button (primary/secondary/ghost/destructive/
  quiet-destructive + loading), Input/Toggle/Segmented/Label, EventTimeline,
  JoinCodeBadge + CopyButton, ReconnectingPill, AlertToaster (sticky emergency that
  updates in place when the reason arrives, sticky revoked, auto-dismiss info).
- **Pages**: `/login` (W1, exact layout incl. "Students don't sign in here" line +
  Google button), `/auth/callback`, `/app` (portal home: greeting, live-now card with
  ticking countdown + six-state summary, today rows with **Start at H:MM** buttons that
  really start sessions, approvals rail, recent-activity timeline, snap-safe entrance),
  `/app/classes` (W3 list + create dialog + created/join-code state), 
  **`/app/classes/[id]/live` (W4 — all six states)**: healthy grid (4-up, no scroll),
  emergency toast docking left-of-panel when StudentPanel is open + 2-pulse chip,
  no-session inline start card, 0-tapped-in hint row, ReconnectingPill + stale badges
  with 5s poll fallback, projector mode (`?projector=1`, fullscreen takeover, sizes
  up), StudentPanel (timeline + GrantPassForm 5/10/15/Custom + no-device toggle), End
  session confirm dialog, Extend (+5m). `/app/classes/[id]/roster` (W5 core: pending
  card, members table with live mini-chips, remove, join-code card). Stubs for
  policies/tags/reports/logs/settings (`ComingSoon`) so the shell never 404s.
- **Live transport**: `src/lib/live.ts` — SSE via fetch-streaming (EventSource can't
  send Authorization headers) with automatic 5s-poll fallback and `reconnecting` state.
- Landing page `/` is a branded placeholder — the full marketing page is 2b.

### iOS — `ios/Bali` (new SwiftUI app, iOS 16.4+, builds & runs in Simulator)

- **Hand-written Xcode 16 project** (`objectVersion 77`, PBXFileSystemSynchronizedRootGroup —
  the whole `Bali/` folder auto-includes; shared scheme committed). Bundle
  `com.bali.Bali`, team `H535678UF8` (drop-in replacement for the legacy install).
- `Core/Tokens.swift` (exact dark/light token mirror), `Core/Models.swift` (DTOs),
  `Core/API.swift` (async client; `BALI_DEV_API_HOST` env/UserDefaults override →
  `http://<host>:3001/v1`, the legacy LAN convention), `Core/Auth.swift` (AuthStore;
  dev-token sign-in in DEBUG; Amplify comes in 2c), `Core/ScreenTime.swift`
  (protocol seam: stub on Simulator, `RealScreenTimeService` shielding via
  ManagedSettings on device), `Core/FocusEngine.swift` (the student state machine:
  tap-in → focused → pass/unlocked/revoked/ended; 30s heartbeats; **local-first
  emergency unlock with a UserDefaults-backed replay queue** — shields drop before any
  network).
- Screens: S0 sign-in (token-styled; design-gap call), S2 join (8 mono cells,
  preview-before-join, invalid + pending states), S3 home (StatusBanner free/focused/
  unlocked + Re-focus, class rows, empty state), S4 tap-in (ready / not-member /
  no-session variants, server-decided), **S6 Focus Active** (hero arc 244pt with
  one-time 600ms draw-in + reduced-motion path, ticking SF-rounded tabular countdown,
  final-2 emphasis incl. one-time VoiceOver announcement, pass variant in blue with
  "shields return automatically" chip, AllowedAppsRow with generic glyphs), the
  **EmergencyUnlockControl** (1.0s hold, orange fill with clipped ink duplicate label,
  haptic ramp light→medium→success thud, 280ms spring-back on early release with no
  error, VoiceOver one-step "Unlock now" action, exact copy), S7 reason sheet
  (five equal chips, Skip first-class, "Ms. Rivera was notified.").
- Tag entry sheet stands in for NFC in the Simulator (same `tags/resolve` path the
  real NFC reader will use).

### Verification evidence (all green at session end)

1. `packages/shared` state-machine tests: **12/12 pass** (`npm test -w packages/shared`).
2. **`scripts/slice-test.py`** (integration, against live local API + real RDS):
   teacher adoption → start session → student adoption ×2 → tag resolve → tap-in
   (+idempotent replay) → heartbeat → emergency unlock (+offline-replay no-op) →
   reason → pass grant → revoked↔restored round-trip → refocus → counts/timeline/
   portal/history asserts → end session → **ALL SLICE CHECKS PASSED**, with the SSE
   listener observing 22 messages (snapshot/participant/event/session).
3. **Simulator screenshot of S6** rendering a live RDS-backed session (Period 3,
   ticking arc, exact unlock copy) — the app's own 30s heartbeats observed landing on
   the teacher side (`staleSeconds: 19`).
4. `npm run typecheck` — zero errors across all workspaces; `next dev` compiles all
   routes; `xcodebuild` **BUILD SUCCEEDED** (Simulator).

## 4. Repo map (root)

```
bali/
├── HANDOFF.md                ← you are here
├── WIRING_PLAN.md            ← architecture contract (kept current w/ deviations)
├── DISCOVERY.md              ← phase-0 inventory of design + legacy
├── design_handoff_bali_2/    ← THE SPEC (docs/01..07, tokens/, design-files/, screenshots/)
├── legacy/                   ← old working app, untouched; legacy/README.md = run guide
├── scripts/slice-test.py     ← end-to-end integration test (python3, needs dev servers)
├── apps/
│   ├── api/src/  env.ts · auth.ts (verify+bootstrap+adoption+dev-tokens) · bus.ts ·
│   │             serialize.ts (DTOs + renderEvent) · domain.ts (ALL lifecycle logic) ·
│   │             live.ts (SSE) · app.ts · index.ts (sweeper) · routes/{auth,public,teacher,student}.ts
│   └── web/src/  styles/{tokens.css,bali-tokens.cjs,globals.css} · lib/{api,auth,live,format,types} ·
│                 components/bali/* · components/shell/{Sidenav,ComingSoon} ·
│                 app/{page,login,auth/callback,app/{page,classes,classes/[id]/{live,roster},stubs…}}
├── packages/
│   ├── shared/src/ states.ts (deriveParticipantState — THE law) · dto.ts · codes.ts  + test/
│   └── db/        src/{schema,client,migrate,seed,create-database}.ts · migrations/ · drizzle.config.ts
├── ios/Bali/      Bali.xcodeproj (hand-written, synced-folder) · Info.plist (OUTSIDE Bali/ — see §8) ·
│                  Bali/{App,Core,Features}/*.swift
├── package.json   (workspaces: apps/*, packages/*) · tsconfig.base.json · .env.example
└── .env / apps/web/.env.local   (real values, untracked — see §5)
```

## 5. How to run everything (tomorrow-morning checklist)

Untracked env files **already exist locally** with real values (recreate from
`legacy/.env` / `legacy/packages/web/.env.local` per WIRING_PLAN §7 if ever lost):
root `.env` (DATABASE_URL→`bali_v2`, COGNITO_*, DEFAULT_SCHOOL_ID, PORT=3001,
CORS_ORIGIN, SEED_TEACHER_EMAIL=aayan.nirav@gmail.com, ALLOW_DEV_TOKENS=1) and
`apps/web/.env.local` (NEXT_PUBLIC_API_URL=http://localhost:3001/v1, NEXT_PUBLIC_COGNITO_*,
NEXT_PUBLIC_REDIRECT_URI, NEXT_PUBLIC_ALLOW_DEV_TOKENS=1).

```bash
cd ~/Downloads/github/bali
npm install                      # usually a no-op
npm run dev:api                  # terminal 1 → :3001 (logs pretty-printed)
npm run dev:web                  # terminal 2 → :3000
npm test -w packages/shared      # 12 unit tests
python3 scripts/slice-test.py    # full e2e against live API + RDS (ends its session itself)
# db utilities: npm run db:generate | db:migrate | db:seed  (seed is idempotent; --reset reseeds)
```

**Demo in 3 minutes:** `localhost:3000/login` → "Dev sign-in (local only)" (or real
Cognito email/password — bootstrap adopts the seeded Ms. Rivera by email) → portal →
"Start at H:MM" on a future class, or open Period 3 → W4 state (c) → Start session →
in another shell run the student side:

```bash
S='dev:s-jordan::Jordan Park'
SID=<sessionId from the URL or GET /v1/classes>
curl -X POST localhost:3001/v1/sessions/$SID/tap-in -H "authorization: Bearer $S" \
  -H 'content-type: application/json' -d "{\"clientEventId\":\"$(uuidgen | tr A-Z a-z)\"}"
# watch the chip flip on W4 in ~real time (SSE)
```

**iOS Simulator:**

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # xcode-select points at CLT!
SIM=34AD32D3-B30E-450C-831F-9E70312574F7                          # iPhone 17 Pro (already has the app)
xcrun simctl boot $SIM
cd ios/Bali && xcodebuild -project Bali.xcodeproj -scheme Bali -destination "id=$SIM" build
APP=$(find ~/Library/Developer/Xcode/DerivedData/Bali-*/Build/Products/Debug-iphonesimulator -name Bali.app | head -1)
xcrun simctl install $SIM "$APP"
xcrun simctl spawn $SIM defaults write com.bali.Bali bali.devToken "dev:s-jordan::Jordan Park"
xcrun simctl launch $SIM com.bali.Bali
xcrun simctl io $SIM screenshot /tmp/shot.png                     # screenshots are readable!
```

Sign-in via the app UI also works (any first/last name; matching a seeded roster name
adopts that student — roster names in `packages/db/src/seed.ts`).

## 6. Remaining — Phase 2b (web). Spec per surface in §9.

**API endpoints still to build** (shapes already specced in WIRING_PLAN §3):

| Endpoint | Powers |
|---|---|
| `PATCH /v1/classes/:id` (edit + archive) | W3/W5 management |
| `POST/PATCH/DELETE /v1/policies` (+in-use delete guard 409) | W6 |
| `GET/POST /v1/classes/:id/tags` · `PATCH /v1/tags/:id` | W7 + T4 |
| `GET /v1/reports/unlocks` (+`?format=csv` w/ framing line in header) · `GET /v1/reports/focus-minutes` | W8 |
| `GET /v1/events?type=&classId=&cursor=` | W9 |
| `GET/PATCH /v1/me/settings` | W10 |
| `@fastify/rate-limit` on student writes (quality item) | — |

**Web surfaces:**
- **Marketing landing `/`** — replace the placeholder with the full §05 page: hero
  (display type, underline sweep, interactive hold-to-unlock demo, 198px live arc,
  floating chips, ambient rotating rings, cursor tilt on fine pointers), how-it-works
  pops, dark "exit" band with second live demo, teacher-glance cascade, privacy
  contract, demo band, footer. Port the **frozen-timeline-safe reveal pattern**
  (design doc 06 — rect-based reveal + 250ms poll + snap timers); all motion behind
  `prefers-reduced-motion`. Reference implementation: `design-files/Bali - Landing.html`
  (already read end-to-end today — it's the closest thing to product code in the bundle).
- **W2 `/t/[code]`** — public mobile page; `GET /v1/public/tags/:code` is live. Deep
  link `bali://t/<code>` (register the URL scheme in iOS Info.plist during 2c), App
  Store badge placeholder, mono tag code.
- **W5 polish** — "Project this" join-code fullscreen (88px mono per spec); W3's
  identical button shares it.
- **W6 Policies** — list + PolicyEditor (Phone locked-on row, Messages toggle,
  "Also allowed" tag-input, honesty explainer verbatim, "Used by N classes", guarded
  delete).
- **W7 Tags** — TagCard grid (real SVG QR via the installed `qrcode` package, encoding
  `https://<web-host>/t/<code>`), print sheet (print CSS), deactivate warning dialog,
  "NFC writing happens on iPhone" note.
- **W8 Reports** — framing line as designed copy, filter chips, unlocks table
  ("skipped" in tertiary, never highlighted) + 6-week sparklines (5px orange-300 bars),
  focus-minutes bars + "out of a 50-minute period · averages only" caption, CSV export.
- **W9 Logs** — filter chips (All/Emergencies/Passes/Permission/Sessions + class),
  EventTimeline rows, "Load older events" cursor pagination.
- **W10 Settings** — profile ("Shown to students as" = `displayName`, feeds every
  student screen), school, email-toggle prefs (stored only; delivery is a stub —
  WIRING_PLAN §8.6).
- **Cross-cutting pass:** 1024 breakpoint (sidebar fixed, cards stack), keyboard-focus
  audit, copy audit vs the banned-vocabulary list, reduced-motion audit.

## 7. Remaining — Phase 2c (iOS + device)

- **Amplify Swift via SPM** (Auth only): real Cognito SRP sign-in/up replacing S0's
  dev path (keep the dev path DEBUG-only). Copy `amplifyconfiguration.json` from
  `legacy/ios/.../amplifyconfiguration.json` (untracked; commit an `.example`).
  Legacy's `AmplifyAuthService` is the proven reference (`#if canImport(Amplify)`).
- **S1 onboarding** — 3 cards + the privacy-contract card **verbatim** (it's restated
  in S9 and the landing; never paraphrase), permission framing → real
  `AuthorizationCenter.requestAuthorization` → denied state with "Join without focus
  (status-only)" path.
- **S5 policy setup** — FamilyActivityPicker flow, count-mismatch honesty screen,
  persist the `FamilyActivitySelection`; **rewire `RealScreenTimeService.applyShields`**
  to shield everything *except* the stored selection (today it shields all categories —
  slice-scope shortcut, flagged in code).
- **S8 history + session detail** (API already serves it), **S9 settings/privacy**
  (contract verbatim + revocation honesty note), **S10 shield screen** — new
  ShieldConfiguration **app-extension target** in the pbxproj (six primitives only:
  dark blur, arc icon asset, "Focused with Ms. Rivera", "Until 10:45 · Emergency? Open
  Bali", OK `#2C6F51`, "Open Bali").
- **NFC** — `NFCNDEFReaderSession` read path (replaces the tag-entry sheet on device;
  same `tags/resolve` call), entitlements file (family-controls + NFC formats — not
  yet created; legacy's `Bali.entitlements` is the template), URL scheme `bali://t/<code>`
  for the W2 deep link.
- **DeviceActivity schedule** so shields clear at `ends_at` even if the app is killed
  (legacy proved the pattern; today's engine handles it only while alive).
- **Teacher iOS app (T1–T5)** — second target `BaliTeacher` (`com.bali.teacher`,
  email/password SRP only — no new Cognito callback URIs needed): T1 home/start sheet,
  T2 phone grid (reuse SSE or 5s poll), T3 student sheet (pass form parity with web
  StudentPanel), T4 tag list + **NFC write** flow + deactivate confirm, T5 active
  passes + notify toggles. Light theme per tokens.
- **Real-device run** — `legacy/README.md` has the exact build/install/launch recipe
  (UDID, `BALI_DEV_API_HOST=<mac-LAN-IP>`, `xcrun devicectl`); same applies to the new
  app. Installing replaces the legacy app (same bundle id — intentional, WIRING_PLAN §6).
- **XL Dynamic Type variant of S6** (arc 218pt, control 76pt — spec'd in doc 04) +
  VoiceOver pass against doc 03's scripts.

**Quality backlog (either phase):** API integration tests in vitest (port
`scripts/slice-test.py`), Swift mirror tests for `deriveParticipantState` fixtures,
W4 grid `not_joined` staleness… (n/a — by design), email notifier stub, CI.

## 8. Gotchas & hard-won knowledge (read before touching anything)

1. **`xcodebuild` needs `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`**
   (xcode-select points at CLT on this machine).
2. **`ios/Bali/Info.plist` must stay OUTSIDE the synced `Bali/` source folder** — the
   synchronized root group would copy it as a resource AND process it →
   "Multiple commands produce Info.plist". Same trap awaits the 2c extension target:
   give the extension its own folder + plist outside the app's synced group.
3. **SourceKit single-file diagnostics in Swift are noise** ("Cannot find type …",
   "No such module UIKit", macOS-availability complaints). Trust `xcodebuild` only.
4. **Web fonts**: token font stacks route through `--font-instrument`/`--font-jbmono`
   (next/font hashed family names) — mapping lives in `globals.css` `:root` override +
   the `fontFamily` override in `tailwind.config.ts`. Don't "simplify" it back to
   literal family names; they won't resolve.
5. **StatusChip state classes are literal strings** (`STATE_CLASSES` map) so Tailwind's
   scanner keeps them. Never template-generate `bg-state-${x}` class names.
6. **SSE is fetch-streamed**, not EventSource (Authorization header). Parser +
   poll-fallback live in `apps/web/src/lib/live.ts`. The API's in-process bus means
   ONE api instance locally — fine; the poll fallback covers any multi-instance future.
7. **Empty-body POSTs** (refocus/end/approve) work because of the custom JSON
   content-type parser in `app.ts` — don't remove it; Fastify's default 400s on
   `content-type: application/json` with no body.
8. **Seed adoption**: teacher = email match on rows with `cognito_sub LIKE 'seed-%'`;
   student = case-insensitive first+last match on rows with NULL `cognito_sub`.
   `SEED_TEACHER_EMAIL` in root `.env` (currently the user's email).
9. **Dev tokens** (`Bearer dev:<sub>:<email>:<name>`) require `ALLOW_DEV_TOKENS=1` and
   non-production — used by web's hidden "Dev sign-in", the iOS DEBUG sign-in, and the
   slice test. Real Cognito works in parallel at all times.
10. **The sweeper** (15s) is the bell; reads also lazily end overdue sessions
    (`findOpenSessionForClass`). Demo sessions clean themselves up.
11. **Drizzle versions**: drizzle-orm 0.38.4 / drizzle-kit 0.30.6 / fastify 5.8.5 /
    next 15.5.19 / aws-amplify 6.18.0 (web) — pinned in lockfile; don't bump casually.
12. **Design rules that bite**: red ONLY for revoked/destructive; emergency is always
    orange and calm; the unlock copy is exact ("Hold to unlock — your teacher will be
    notified"); Skip is a first-class chip; staleness is a badge, never a state; mono
    only for codes; SF Rounded only for large numerals; banned words (caught,
    violation, offender, lockdown, monitored, tracked, surveillance, jail, prison,
    cheating) must never appear in UI OR in server-rendered event strings
    (`renderEvent` is the chokepoint — it's compliant today, keep it that way).

## 9. Design-doc → remaining-surface map (read these before building)

| Building | Read first |
|---|---|
| Landing | docs/05 §landing + docs/06 §landing-motion + §frozen-timeline + `design-files/Bali - Landing.html` |
| W2 | docs/05 §W2 + `design-files/W1-W3 …html` (W2 frame) |
| W5 polish / W6 / W7 | docs/05 §W5–W7 + docs/03 (PolicyEditor, TagCard) + `design-files/W5-W7 …html` *(not yet read this session)* |
| W8–W10 | docs/05 §W8–W10 + `design-files/W8-W10 …html` + screenshot `w8-reports.png` *(not yet read)* |
| S1, S5, S7–S10 | docs/04 per-screen + `design-files/pass3/S*.html` *(pass3 HTML not yet read — docs were sufficient for the slice screens; read the HTML for the rest)* |
| T1–T5 | docs/04 §T1–T5 + `design-files/pass3/T*.html` + screenshot `ios-teacher.png` |
| Shield S10 | docs/01 §Shield constraint (six primitives — hard API limit) |
| Any motion | docs/06 (budget ≤300ms, the one 600ms moment, haptics map) |

## 10. Definition of done (from doc 07 — verbatim checklist)

Every state visible somewhere with icon+label, never color-only · red only for
revoked/destructive · emergency path reads safe and shame-free · the grid passes a
6-foot squint test · dark student screens feel native, not inverted · the XL Dynamic
Type layout doesn't break · copy obeys the voice laws (no banned words; "notified,"
never "reported"; Skip first-class) · no banned visual defaults · every interactive
element has a visible focus state · `prefers-reduced-motion` respected everywhere.

## 11. Suggested order for session 2

1. Re-orient: this file → WIRING_PLAN.md → `git log --oneline | head -15` → start dev
   servers → `python3 scripts/slice-test.py` (proves the world still works).
2. **2b backend first** (one commit: the §6 endpoint table — they're all small
   handlers over existing domain helpers), then surfaces in this order:
   **W6 → W7 → W8 → W9 → W10 → W5 polish → W2 → Landing** (CRUD pages bed the API in;
   the landing is the biggest pure-frontend lift, best done last with fresh context on
   the motion doc).
3. Then **2c** in the §7 order (Amplify + S1/S5 first — they unlock the real student
   path; shield extension + teacher app after; device run last).
4. Keep the cadence: typecheck + slice test before every commit; commit per surface;
   update WIRING_PLAN deviations + this handoff at session end.

---

*Everything above was verified working at handoff time: 12/12 unit tests, full
integration suite green (SSE included), web typecheck clean, Simulator build + S6
screenshot against live RDS. Servers may need restarting tomorrow (§5). Nothing is
pushed to origin — that decision stays with the user.*
