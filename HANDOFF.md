# Bali v2 — Session Handoff

## ⚡ SESSION 3 — START HERE (written 2026-06-12, mid device-test)

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
