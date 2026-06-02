# Bali iOS — Design & Build Plan

> Principal-level design doc + phased build plan for the **student** iOS app.
> Authoritative inputs read for this plan: `ios/CLAUDE.md`,
> `ios/design_handoff_bali_student_app/README.md` + all 18 `screenshots/`,
> `ios/design_handoff_bali_student_app/bali.css`, `android/CLAUDE.md`,
> `docs/hardware-and-blocking-design.md`, `packages/shared/src/*`, and the real
> student API handlers in `packages/api/src/handlers/**`.
>
> **Status: AWAITING APPROVAL. No app code is written yet.** Build proceeds
> phase by phase only after sign-off, starting at Phase 0.

---

## 0. TL;DR

A SwiftUI student companion app that mirrors the Kotlin app in `android/` but is
**hardware-ready from day one**: real Core NFC check-in and real Screen Time
(FamilyControls) blocking — never "simulate" framing in the UI. It talks **only
to student JWT endpoints**, reproduces the `bali.css` design system at high
fidelity, and is structured so the Simulator can run everything except the two
device-only subsystems (NFC scan, real shielding), which fall back to honest
"needs a physical iPhone" states.

The plan calls out **12 assumptions / backend-or-shared changes** (§9) that must
be confirmed before the app depends on them — most importantly that the
student-authenticated NFC check-in endpoint the handoff describes **does not yet
exist**, and that there is a **nested git repo at `ios/Bali/.git`** that violates
a hard constraint and must be removed.

---

## 1. App architecture

### 1.1 Pattern — MV (Model–View) with `@Observable` stores

SwiftUI views observe a small set of `@Observable` state objects directly. No
per-screen ViewModel layer.

**Why:** For an app this size (≈18 screens, REST-backed, no offline DB), Apple's
"MV" pattern (View + `@Observable` model, injected through `@Environment`) is the
least-ceremony approach that still keeps logic out of views. The Observation
framework re-renders only the views that read a changed property, avoiding the
over-invalidation and `objectWillChange` foot-guns of `@Published`.

**Rejected:**
- **MVVM (one VM per view):** boilerplate with no payoff here; tends to grow
  god-VMs and fights SwiftUI's native data flow.
- **TCA / Redux-style:** powerful but heavy dependency + learning curve;
  overkill for straightforward REST + a couple of device integrations.
- **VIPER:** wildly over-engineered for this surface.

### 1.2 The stores / services (dependency boundaries)

Views never touch the network or device frameworks directly — they read stores
and call store methods. Stores depend on services through **protocols**, so the
two device-only services have Simulator stubs.

| Object | Kind | Responsibility |
|---|---|---|
| `AuthStore` | `@Observable` | Cognito session, JWT cache, role gate, auth phase |
| `AppModel` | `@Observable` | Dashboard data (classes, invites, profile), checked-in map, polling |
| `AppRouter` | `@Observable` | Selected tab, per-tab `NavigationPath`, active sheet, overlays |
| `FocusModeController` | `@Observable` | Screen Time auth → token selection → shields → DeviceActivity → status |
| `NFCCheckInController` | `@Observable` | Drives the NFC sheet phases + calls `CheckInService` |
| `APIClient` | service (proto) | Request building, JSON (de)coding, typed error mapping |
| `CognitoService` | service (proto) | Amplify wrapper (real) / stub (tests) |
| `NFCReader` | service (proto) | `CoreNFCReader` (device) / `UnavailableNFCReader` (Simulator) |
| `ScreenTimeService` | service (proto) | `FamilyControls`/`ManagedSettings` (device) / stub (Simulator) |
| `DeviceIdentity` | service | Stable per-install device ID, keychain-persisted |
| `NotificationManager` | service | Local notifications now; APNs-ready |

Composition root: `AppEnvironment` builds the graph in `BaliApp` and injects via
`.environment(...)`. Device-only services resolve to stubs when
`NFCReaderSession.readingAvailable == false` / running on Simulator, so the whole
UI is runnable without a device.

### 1.3 Folder structure (`ios/Bali/Bali/`)

```
App/            BaliApp.swift · RootView.swift (phase gate) · AppEnvironment.swift
DesignSystem/
  Tokens/       Color+Bali · Typography+Bali · Spacing · Radius · Shadow · Theme
  Components/   BaliButton · Card · Badge · IconTile · AttendanceRing · BaliTextField
                SegmentedControl · Eyebrow · Wordmark · BottomSheetContainer
                PulseDot · NfcMark · ShieldTile · AppTile · RadarView
Models/         DTOs mirroring @bali/shared (StudentSelf, StudentClassSummary,
                StudentClassDetail, BlockingSnapshot, PendingInvite, ClassJoinPreview,
                Student, enums) + BlockingPresetCatalog (mirror of constants.ts)
Networking/     APIClient · APIConfig · APIError · Endpoints
Auth/           AuthStore · CognitoService
State/          AppModel · AppRouter · Navigation (Tab/Sheet/Route enums)
Features/
  Auth/         LoginView
  Onboarding/   OnboardingFlow · RegisterDeviceView · PermissionsView
  Shell/        MainTabView (custom bar + center NFC FAB)
  Home/         HomeView · HeroCard · StatRow
  Classes/      ClassesView · ClassCard · JoinClassView · ClassDetailView
  Focus/        FocusModeView (active/resting) · FocusPolicyPreviewView
                EmergencyUnlockSheet · SessionEndedOverlay
  CheckIn/      NfcCheckInSheet
  Profile/      ProfileView · SettingsView · DeviceInfoView · NotificationsView
Services/
  Focus/        FocusModeController · ScreenTimeService · PolicyTokenMapper
                ShieldController · DeviceActivityScheduler
  NFC/          NFCReader (proto) · CoreNFCReader · CheckInService
  Device/       DeviceIdentity · Keychain
  Notifications/NotificationManager
Resources/      Info.plist additions · Bali.entitlements · amplifyconfiguration.json
```

### 1.4 Navigation

A **custom `MainTabView`**, not the stock `TabView`, because the design's bar has
a **raised 62×62 center NFC FAB** overlapping a translucent (`blur 22`) bar — the
stock tab item can't render that faithfully.

- `ZStack`: the selected tab's `NavigationStack` + a custom bottom bar overlay.
- Four tab roots — Home / Classes / Focus / Profile — each owns its own
  `NavigationPath` (typed `Route` enum) so pushed detail screens (Class Detail,
  Focus Policy Preview, Settings, Device Info, Notifications) keep per-tab back
  stacks and slide in from the right.
- **Sheets** (NFC, Emergency) and **overlays** (Session Ended) are presented from
  `AppRouter` state; styled to the spec (28px top radius, scrim, 420ms slide).
- **Focus Mode — Active** is a full-screen **dark takeover** (`fullScreenCover`),
  tab bar hidden, light status-bar content.
- Onboarding is a separate linear flow shown before the tabbed app.

**Rejected:** single global `NavigationStack` (loses per-tab back stacks);
default `TabView` center item (can't host the raised FAB).

### 1.5 Deployment target — **iOS 17.0** ✅ DECIDED

iOS 17 (above the handoff's 16+ floor) so we use the `@Observable` macro —
cleaner state, fewer view-invalidation bugs — fitting the 2026 timeframe and the
design's iPhone-15 reference hardware.

---

## 2. Networking + auth

### 2.1 Base URL strategy

`APIConfig.baseURL` resolved at build time:

- **Dev / Simulator:** `http://localhost:3001/api` (Simulator shares host net).
- **Dev / physical device:** `http://<mac-LAN-ip>:3001/api`, read from a
  Debug-only Info.plist key (`BALI_DEV_API_HOST`) so it's not hard-coded; or
  `https` tunnel. Documented in `ios/CLAUDE.md` follow-up.
- **Prod:** `https://<api-gateway>/api` from the Release config (value parallels
  web's `NEXT_PUBLIC_API_URL`).

**ATS:** keep `https` the default. Add `NSAllowsLocalNetworking` **Debug-only**
for `http://localhost`/LAN. Prod ships with no ATS exceptions.

### 2.2 Auth — AWS Cognito via **Amplify Swift** ✅ DECIDED

`Amplify` + `AWSCognitoAuthPlugin` (added via SwiftPM), behind a `CognitoService`
protocol. Chosen for **parity with the Android app** and a batteries-included
hosted-UI Google OAuth flow. Configured by an `amplifyconfiguration.json` that
mirrors Android's, with values from root `.env`: `COGNITO_USER_POOL_ID`,
`COGNITO_CLIENT_ID`, `COGNITO_DOMAIN`.

- **Email / password:** `Amplify.Auth.signIn` (SRP under the hood — no
  `USER_PASSWORD_AUTH` requirement on the app client).
- **Google:** `Amplify.Auth.signInWithWebUI(for: .google)` → Cognito Hosted UI
  via the platform web-auth session. Needs the OAuth **redirect URL scheme**
  registered (Info.plist + the app client's callback URLs).
- **Refresh / JWT:** `AuthStore.currentJwt` reads the id token from
  `Amplify.Auth.fetchAuthSession`, which auto-refreshes on expiry (mirrors
  Android's `AmplifyAuth.currentJwt`); cached in memory, invalidated on
  sign-in/out. Every request gets `Authorization: Bearer <idToken>`.
- **Role enforcement:** after sign-in, `GET /students/me`. If not a student
  (teacher / no `student`), sign out + inline "Bali is for students" message.
  Server also enforces (403).

### 2.3 Error handling

`APIError`: `.network`, `.decoding`, `.unauthorized` (401 → refresh once, else
sign out), `.http(status, code, message)` mapping the server `{error, message}`
body, and `.checkIn(CheckInErrorCode)` for typed check-in failures. Each screen
maps errors to the design's inline/sheet states (e.g. `UNASSIGNED_DEVICE` →
NFC sheet "Device not assigned"; `NO_ACTIVE_SESSION` → "No active session").

### 2.4 Exact student endpoints (JWT only) — verified against handlers

| Method · Path | Returns | Screen |
|---|---|---|
| `GET /students/me` | `StudentSelf` (`student`, `classes[]`, `pendingInvites[]`) | Home |
| `POST /students/me` | `{ student }` | Profile save |
| `GET /students/me/classes/{classId}` | `StudentClassDetail` | Class Detail, Focus poll |
| `POST /students/me/classes/{classId}/simulate-check-in` | `{ success, attendanceStatus, checkInTime, sessionId, classId, blockingPolicy }` (`blockingPolicy` = `BlockingSnapshot`) | **Check-in (only path that exists)** |
| `GET /classes/{classId}/preview` | `ClassJoinPreview` | Join confirm |
| `POST /classes/{classId}/join` | — | Join |
| `POST /invites/{inviteId}/accept` | — | Pending invite |

**Never called:** any teacher route, `POST /api/checkin` (x-api-key),
`GET /api/blocking/policy/:studentId` (x-api-key), `.../report` (x-api-key).

> ⚑ The handoff's desired `POST /students/me/check-in` / `/nfc-check-in` **does
> not exist**. See §4 and §9.2.

---

## 3. Design system (encode `bali.css` exactly)

Built **first** (Phase 1) so every screen composes from faithful primitives. A
`#Preview` gallery verifies fidelity in isolation.

- **Color** — `Color(hex:)` + a `BaliColor` namespace for every `:root` token
  (brand, ink/neutral, status + tints, focus-dark palette). Gradients
  (login hero, focus screen radial, shield tile, dark "checked-in" card) as
  reusable `LinearGradient`/`RadialGradient` constants.
- **Typography** — a `BaliText` style set matching the scale. Weight mapping:
  Display/H1 = `.heavy` (800); H2 (750) ≈ `.bold` nudged via `.fontWeight`;
  H3 = `.bold` (700); Body-strong = `.semibold` (600); Body = `.regular`.
  Letter-spacing → `.tracking()`, line-height → `.lineSpacing()`, updating
  numerics → `.monospacedDigit()` (countdown, IDs, times).
- **Shape/Elevation** — radius tokens (sm 12, r 18, lg 24, xl 30, pill, tile 13,
  sheet 28); the three `bali.css` shadows as stacked `.shadow` modifiers
  (`sh-1`, `sh-2`, `sh-blue`).
- **Spacing** — 4px-grid constants; screen H-padding 20; card padding 18; safe-area
  insets per spec.
- **Components** — `BaliButton` (primary/secondary/ghost/dark/danger/danger-soft/
  glass/glass-strong × sm/md/lg, 0.97 press), `Card`, `Badge` (+ `PulseDot` for
  LIVE/BLOCKING APPLIED), `IconTile`, `AttendanceRing` (animated conic),
  `BaliTextField` (focus ring, leading icon tint, read-only lock variant),
  `SegmentedControl`, `Eyebrow`, `Wordmark`, `BottomSheetContainer`, `NfcMark`,
  `ShieldTile`, `AppTile` (locked/greyscale + lock badge), `RadarView`.
- **Light vs Focus(dark) theme** — a `Theme` value the dark takeover screens
  switch to (focus-bg gradients, glass cards/lines, light text).
- **App catalog tiles** — replace the prototype placeholders ("Chatter",
  "Glimpse") with **real** snapshot data (appName + an SF-Symbol/category glyph
  derived from bundleId). No third-party brand logos.

---

## 4. Real NFC check-in (device-only)

**Flow:** present NFC sheet → `waiting` (begin Core NFC session, radar) → tag
detected → `reading` (parse payload) → POST check-in → map result to
`present` / `late` / `failed` / `notAssigned` / `noSession`; on `present`/`late`
auto-advance into Focus Mode. **No manual "simulate check-in" control ever.**

- **Core NFC:** `NFCTagReaderSession` (or `NFCNDEFReaderSession` if the Bali
  block exposes NDEF) behind the `NFCReader` protocol. `CoreNFCReader` is the
  device impl; on Simulator `readingAvailable == false` → the sheet shows an
  honest "NFC needs a physical iPhone" dev state (never a fake check-in).
- **Entitlement / Info.plist:** "Near Field Communication Tag Reading"
  capability + `com.apple.developer.nfc.readersession.formats`;
  `NFCReaderUsageDescription` string. (§9.12)
- **The endpoint gap:** the only student check-in path today is
  `POST /students/me/classes/{classId}/simulate-check-in` → `{ success,
  attendanceStatus, checkInTime, sessionId, classId, blockingPolicy }`. MVP calls **that**, but driven by a
  **real** Core NFC read, wrapped in a `CheckInService.checkIn(classId:tag:)`
  seam so the endpoint can be swapped with zero UI change once a real
  tag-aware `POST /students/me/check-in` (or `/nfc-check-in`) exists. Adding
  that real endpoint (payload = tag UID / NDEF; server resolves tag→device→
  student→session) is a **backend change** — confirm (§9.2).
- **Class context:** the sheet targets the "current/likely-live" class (active
  session the student hasn't checked into). Ambiguous/none → the matching result
  state.

---

## 5. Screen Time blocking (device-only)

Pipeline: **FamilyControls authorization → token selection → ManagedSettings
shields → DeviceActivity scheduling → local status report.** All behind
`ScreenTimeService`; a Simulator stub mocks "granted" + no-op shielding so the
UI/countdown still demo.

1. **Authorize** — `AuthorizationCenter.shared.requestAuthorization(for:
   .individual)` on the Permissions screen.
2. **Map policy → tokens** — the server policy is bundleId/appName + preset/mode,
   **not** tokens; iOS cannot map a bundleId to an opaque `ApplicationToken`.
   - MVP: the student grants authorization once and we capture a
     `FamilyActivitySelection` (apps/categories) via `FamilyActivityPicker`,
     persisted. Enforcement shields that selection; for `full_focus`
     (`block_all_except`) we shield broad categories minus essentials.
   - The policy's bundleId/appName is used to **render** "what's blocked"
     honestly (real data → SF-Symbol/category glyph).
   - **Faithful long-term:** server sends **semantic keys** (`blockedAppKeys`,
     category keys) so the device maps intent → tokens deterministically. That's
     a **backend + `packages/shared` change** (§9.3).
3. **Shield** — `ManagedSettingsStore().shield.applications/.applicationCategories`
   set for the session; cleared on session end / teacher end / approved
   emergency.
4. **Schedule** — a `DeviceActivitySchedule` bounds enforcement to the session
   window so the monitor extension auto-clears shields at end (defense-in-depth
   beyond foreground polling).
5. **Status** — no JWT report route exists → `lastKnownStatus`
   (applied/failed/disabled/unknown) is **local-only**, driving the
   "BLOCKING APPLIED"/failed badge. Teacher dashboard won't see iOS status until
   a JWT report endpoint is added (same gap as Android) (§9.4).
6. **Lifecycle** — while focus active, poll `GET /students/me/classes/{classId}`
   (~30s, mirroring Android). When `activeSession` becomes null/changes → clear
   shields, show Session Ended overlay, stop. (No server push/websocket;
   polling is the contract.)

**Device-only:** `com.apple.developer.family-controls` needs **Apple approval +
paid account**; real shielding does not work on Simulator (§9.12).

---

## 6. Build sequence (phased; each independently runnable)

Each phase = one focused `ios:` commit, **no co-author trailer**. Phases 1–5 run
on the Simulator; 6–7 require a physical iPhone (+ entitlements).

| Phase | Deliverable | Runnable | Commit |
|---|---|---|---|
| **0** | Repo hygiene + scaffold: remove nested `ios/Bali/.git`; confirm `.gitignore`; iOS 17 target; bundle id `com.bali.Bali` | builds | `ios: scaffold student app project` |
| **1** | Design system: tokens + component library + preview gallery | ✅ Sim | `ios: design system + component library` |
| **2** | App shell: RootView phase gate, custom MainTabView + center FAB, NavigationStacks, stubbed screens | ✅ Sim | `ios: app shell + tab navigation` |
| **3** | Auth: Amplify Cognito, LoginView (email/pw + Google), role gate, JWT in APIClient | ✅ Sim (dev API) | `ios: cognito auth + api client` |
| **4** | Data + read screens: models, endpoints, AppModel; Home, Classes, Class Detail, Focus Policy Preview, Profile, Settings, Device Info, Notifications(local) with polling + pull-to-refresh | ✅ Sim | `ios: student dashboard, classes, profile` |
| **5** | Join + onboarding: Join (code/link/QR) + confirm + invite accept; Register Device (keychain ID + status); Permissions (Family Controls request) | ✅ Sim | `ios: join flow + onboarding` |
| **6** | Real NFC check-in: NFCReader (Core NFC), NfcCheckInSheet phases, CheckInService, result states → hand-off to Focus Mode | 📱 Device | `ios: real nfc check-in` |
| **7** | Focus Mode + Screen Time: FamilyControls auth, picker/selection, ManagedSettings shields, DeviceActivity, FocusModeView active/resting, Emergency sheet (local), Session Ended overlay, local status | 📱 Device | `ios: focus mode + screen time blocking` |
| **8** | Notifications + polish: local notifications for the 4 event types (APNs-ready), animations (radar/pulse/countdown/transitions), empty/error states, accessibility, fidelity pass | ✅ Sim | `ios: notifications + polish` |

---

## 7. Hard constraints honored

- **Student-only JWT routes.** No teacher routes, no `x-api-key`/hardware
  endpoints (`/api/checkin`, `/api/blocking/policy/:id`, `.../report`).
- **No "simulate" framing** in the UI — check-in is a real Core NFC read.
- **No nested git repo** — the existing `ios/Bali/.git` will be removed (§9.1).
- **High-fidelity** reproduction of `bali.css` + the 18 screenshots.
- **Commits:** `ios:` prefix, **no co-author trailer**; push only when asked.
- **No teacher-dashboard features** (create class, start/end session, edit
  policy, roster, attendance override, any simulate affordance).

---

## 8. Testing reality

- **Simulator:** UI, design system, navigation, Cognito auth, all networking,
  read screens, join/onboarding. NFC + real shielding are stubbed to honest
  "needs a physical iPhone" states.
- **Physical iPhone (required):** Core NFC scan (Phase 6) and FamilyControls/
  ManagedSettings shielding (Phase 7) — and the Family Controls entitlement.

---

## 9. Assumptions & backend/shared changes — CONFIRM BEFORE DEPENDING ⚑

Nothing below will be silently assumed; each is flagged where it bites.

1. **Nested git repo.** `ios/Bali/.git` exists (verified) → violates the
   "no nested repo" constraint. **Proposed:** `rm -rf ios/Bali/.git` so the
   monorepo root tracks `ios/`. The `M .gitignore` already adds the iOS/Xcode
   ignores. **Confirm OK.**
2. **Check-in endpoint missing.** No `/students/me/check-in` or `/nfc-check-in`.
   MVP uses the existing `.../simulate-check-in` (real NFC-driven, no simulate
   UI) behind a `CheckInService`. A real tag-aware student endpoint is a
   **backend change** — confirm whether to add it and its payload.
3. **Semantic blocking keys.** `BlockingSnapshot` has only bundleId/appName, no
   `blockedAppKeys`/category keys → can't deterministically map to tokens. MVP
   renders from bundleId/appName + enforces a `FamilyActivityPicker` selection.
   Token-accurate enforcement needs a **backend + `packages/shared` change**.
4. **JWT status report.** No JWT `/report` route. Status stays **local-only**
   (teacher dashboard won't see iOS), same as Android. Confirm acceptable.
5. **Device registration.** `/devices/register` is teacher/admin; the student app
   has no register endpoint (Android doesn't register). MVP "Register this
   iPhone" generates + keychain-persists a stable device ID locally and shows
   assignment status; real student-side claim/register is a **backend change**.
6. **Emergency unlock.** No endpoint. MVP is local/optimistic ("Request sent",
   nothing bypassed). Real teacher-review flow is a **backend change**.
7. **Notifications.** No student notifications-list endpoint. The 4 event types
   are derived locally + APNs-ready. Real push needs **backend + APNs setup**.
8. **"Seat" / block name** (e.g. "Lab Bench 3"): not in any DTO. MVP maps to
   `device.friendlyName` or generic copy; a real seat field is a **backend
   change**.
9. **Streak / unread counts** (14-day streak, bell dot): not in the contract.
   MVP computes streak client-side from attendance history if present, else
   hides; unread is local. Confirm.
10. **Deployment target:** ✅ DECIDED — **iOS 17.0** (`@Observable`).
11. **Auth library:** ✅ DECIDED — **Amplify Swift** (`AWSCognitoAuthPlugin`),
    parity with Android; added as a SwiftPM dependency in Phase 3.
12. **Entitlements needing Apple/paid account:** Family Controls
    (`com.apple.developer.family-controls`, special request) and NFC Tag Reading.
    Real focus/NFC are device-only. Confirm the account has/will request these.
13. **Cognito app-client config (Amplify):** the OAuth **redirect URL scheme** +
    callback/sign-out URLs must be registered on the app client and match the
    app's `amplifyconfiguration.json` (values from root `.env`). Config +
    coordination, not app code — confirm.

---

## 10. Decisions — RESOLVED (2026-05-31)

1. **Deployment target:** iOS 17.0 (`@Observable`).
2. **Auth:** Amplify Swift (`AWSCognitoAuthPlugin`) — parity with Android.
3. **Backend gaps (§9.2–9.9):** proceed **MVP-local now, backend later** — build
   against existing student endpoints + local fallbacks behind clean seams; each
   backend change stays flagged for separate greenlight.
4. **Nested git:** remove `ios/Bali/.git` in Phase 0 (hard constraint).

Open items still needing your action (don't block Phases 1–5): §9.12 (Apple
entitlements for Family Controls + NFC, needed for Phases 6–7 on device) and
§9.13 (Cognito app-client config for raw auth, needed for Phase 3).

On your go-ahead I start at **Phase 0 → Phase 1**, one `ios:` commit per phase.

---

## 11. Resume here — session handoff (last updated 2026-06-01)

### Where we are

| Phase | Status | Commit |
|---|---|---|
| 0 scaffold + repo hygiene | ✅ done | `d18dcd5` |
| 1 design system | ✅ done | `faf0674` |
| 2 app shell + tab nav | ✅ done | `21a0cb3` (amended) |
| 3 auth (Cognito) + API client | ✅ done | `4ff80f9` |
| 4 dashboard / classes / profile | ✅ done | `40281d0` |
| 5 join + onboarding | ✅ done | `4e76e12` |
| 6 real NFC check-in | ✅ done | `ce007eb` |
| 7 Focus Mode / Screen Time | ✅ done | `bcfb5e5` |
| 8 notifications + polish | ✅ done | `9b02ae6` |

**All 8 phases complete + live Cognito auth wired (`3a08b6b`).** `main` is **16
commits ahead of origin, NOT pushed.** Working tree clean. Clean build = **0 errors
/ 0 warnings** (iPhone 17 sim). Every design screen (01–18) built + verified. The
app now runs on **real Cognito + the live dev API** (not just sample data) — sign-in
+ real DB data verified on the Simulator. (The 2 APIClient warnings below are fixed.)

⚠️ **Correction to the Phase-3 commit message:** it says "0 warnings", but a
*clean* build emits **2 real warnings** (they didn't appear in the incremental
builds I checked at commit time — my mistake). Both in
`Networking/APIClient.swift` (~lines 43 & 49): *"non-Sendable parameter type
'T.Type' cannot be sent … into main actor-isolated implementation; this is an
error in the Swift 6 language mode."* Harmless in the current Swift 5 mode, and
**FIXED in Phase 4** by making the data layer `nonisolated` (the target's default
isolation is MainActor — see the Phase 4 findings below). Don't trust
incremental-build warning counts — always confirm on a `clean build`.

### How to build / run (Xcode is installed; xcode-select points at CLT)

```
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
"$DEVELOPER_DIR/usr/bin/xcodebuild" -project ios/Bali/Bali.xcodeproj -scheme Bali \
  -destination 'platform=iOS Simulator,name=iPhone 17' -configuration Debug build
# then: simctl uninstall com.bali.Bali ; install <app> ; launch ; io <udid> screenshot
```
**Discipline:** gate on `grep -q "BUILD SUCCEEDED"` before install/screenshot;
always `simctl uninstall` first so you never screenshot a stale build; never
claim "0 warnings" without reading an actual BUILD SUCCEEDED. PNG screenshots
downscaled with `sips -Z 760` read reliably here; wide crops / JPEGs often don't.

### What's built (architecture is in place — Phases 4–8 mostly add files)

- **Design system** (`DesignSystem/`): all `bali.css` tokens + component library
  (BaliButton, Card, Badge/PulseDot, IconTile, AttendanceRing, BaliTextField,
  BaliSegmentedControl, Eyebrow, Wordmark, NfcMark, ShieldTile, AppTile,
  RadarView, IconButton, BaliScreen/ScreenHeader, DetailScaffold/StubPlaceholder,
  GoogleGGlyph). DEBUG-only `DesignGallery` preview.
- **Shell** (`Features/Shell/`): custom `MainTabView` (4 NavigationStacks in a
  ZStack, opacity-switched — **do not add `.zIndex` to the stacks or the tab bar
  gets covered**, learned the hard way) + `BaliTabBar` with the raised center NFC
  FAB. `AppRouter` (per-tab paths, sheets, overlay) + `Navigation.swift` enums.
- **Auth** (`Auth/`, `Networking/`): `AuthService` protocol (StubAuthService
  active; AmplifyAuthService behind `#if canImport(Amplify)`), `RoleGate`,
  `AuthStore` (phase gate), `APIClient`/`APIConfig`/`APIError`. `AppEnvironment`
  picks stub vs Amplify at compile time. `RootView` bootstraps + routes.
- **Stub screens** for every tab root + pushed detail + the two sheets — real
  navigation, placeholder bodies (replaced in Phases 4–8).

### Phase 4 — DONE (commit `40281d0`)

All Phase 4 code is on disk, builds clean (0/0), and every screen was launch-
verified on the iPhone 17 sim against the handoff. What landed:
- **Models** (`Models/`): `BlockingSnapshot` (+ preset/mode display, unknown
  enums → safe fallbacks), `StudentModels` (StudentSelf, summary/detail,
  sessions, invites, `CheckInResponse`, `StudentProfileUpdate`, `AttendanceStatus`),
  `AppCatalog` (bundleId → `AppVisual`, real category glyphs), `Formatting`
  (ISO / relative / dayLabel / percent). `DesignSystem/Tokens/ClassColor`.
- **Data** (`Data/`): `StudentRepository` (+ `LiveStudentRepository`),
  `SampleStudentRepository` (Maya Chen / Lincoln High: AP Biology live+Full Focus,
  World History No Social Media, Algebra II No Games, Chemistry invite). Sidecar
  `ClassPresentation` (policy/seat/nextLabel) + `StudentExtras` (streak) carry the
  fields the DTOs lack (§9). `State/AppModel` (@Observable) wired into
  `AppEnvironment` (stub→Sample, Amplify→Live) + `.environment(env.model)`.
- **Screens**: Home (live / checked-in / resting hero, attendance+streak, list),
  Classes (cards + pending invites + dashed join tile), ClassDetail (gradient
  header / live session+check-in CTA / stats / device+policy / recent),
  FocusPolicyPreview (real allowed/paused grids — NOT placeholder apps), Profile
  (editable + Save), Settings (grouped + sign out), DeviceInfo. Plus `ClassCard`.

KEY DECISIONS / FINDINGS — carry forward into Phases 5–8:
- **Target sets `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`** (Swift-5 mode). So
  the whole **data layer is explicitly `nonisolated`** (Codable models, APIClient,
  repository, Formatting) — else models are inferred @MainActor and `JSONDecoder`
  (nonisolated) can't build them off-main. **Stores/views stay @MainActor;
  presentation helpers that read BaliColor/AppVisual (AppCatalog, ClassColor)
  stay default (@MainActor).** New model/DTO/service types → mark `nonisolated`.
- **API envelope:** student endpoints return the object directly (`json(x)` =
  `JSON.stringify(x)`); errors are `{error}`. No `{data}` wrapper.
- **attendanceRate / attendance.rate are integer percents 0–100** (ring takes /100).
- **POST /students/me** body = `{firstName,lastName,grade?}`; returns `StudentSelf`.
- Xcode uses **filesystem-synchronized groups** — new files/folders under
  `ios/Bali/Bali/` are auto-built; **no pbxproj edits needed**.
- `ClassColor.palette` is a 6-color order chosen so the sample roster hashes to
  blue/violet/green (design fidelity); arbitrary real ids still get stable colors.
- **DEBUG launch-arg verification aids** (in `AuthService`/`AppRouter`/`Navigation`,
  `#if DEBUG`, no effect on normal runs; there's no `idb` on this host):
  `simctl launch <udid> com.bali.Bali -baliAutologin YES -baliTab <home|classes|
  focus|profile> -baliPush <classDetail|focusPolicy|settings|deviceInfo|
  notifications|join>` boots into / deep-links any authed screen for screenshots.
- SwiftUI gotcha hit: a helper that wraps content in `Card { content() }` must take
  the closure `@escaping` (Card stores it). Small batches + build between them.

### Phase 5 — DONE (commit `4e76e12`)

- **Join** (`JoinClassView`): Code / Link / QR → `joinPreview` → confirm card →
  `joinClass`. Links carry the classId; the short "code" has no resolver (§9) so
  it's passed through the seam (sample resolves it, live treats it as a classId);
  QR is an honest device-only state on Sim. Join optimistically adds to the roster.
- **Invites**: Classes invite cards Accept for real (`acceptInvite`), then the
  class moves into the roster.
- **Onboarding** (`Features/Onboarding/OnboardingFlow`): two full-screen steps
  (register device → Focus-blocking permissions) shown for `.onboarding`, then
  `auth.finishOnboarding()` → `.app`. Real FamilyControls auth deferred to Phase 7.
- **DeviceIdentity** (`Services/Device/`): keychain-persisted stable "BALI-…" id +
  registration flag (local, §9.5), nonisolated (ProcessInfo, not @MainActor
  UIDevice). Device Info shows the local id + registration; name/seat from server.
- Repo: `joinPreview`/`joinClass`/`acceptInvite` (Live + Sample). AppModel join/
  invite actions are optimistic. DEBUG aids: `-baliOnboarding[Step]`, `-baliJoinToken`.

### Phase 6 — DONE (commit `ce007eb`)

Real Core NFC behind a seam, no "simulate" UI. `Services/NFC/`: `NFCReader`
(`CoreNFCReader` device — built but EXCLUDED from the Sim slice via `#if`, so
NOT compile-verified here; `UnavailableNFCReader` Sim), `CheckInService` over the
existing simulate-check-in endpoint (§9.2 tag-aware endpoint still backend-side),
`NFCCheckInController` (@Observable: unavailable / waiting / reading / result). The
`NfcCheckInSheet` is state-driven; on success → `model.markCheckedIn` + Focus
Mode. `notAssigned` is driven by `DeviceIdentity.isRegistered` locally. DEBUG aids:
`-baliSheet nfc`, `-baliNfcState <waiting|reading|notAssigned|noSession|failed|
success|unavailable>`. Verified every sheet state on the Sim (the unavailable
state is the real Sim path; the rest via the DEBUG forcer).

⚠️ DEVICE TODO before a real scan works (user, with their Apple account): NFC Tag
Reading capability + `com.apple.developer.nfc.readersession.formats` entitlement +
an `NFCReaderUsageDescription` Info.plist string. `CoreNFCReader` is unverified
(Sim-excluded) — the first device build may need concurrency/entitlement tweaks.

### Phase 7 — DONE (commit `bcfb5e5`)

Focus Mode UI (Sim-verified) + the Screen Time seam (real shielding device-only).
`Services/Focus/`: `ScreenTimeService` (`StubScreenTimeService` Sim;
`RealScreenTimeService` device — FamilyControls / ManagedSettings, EXCLUDED from
the Sim slice → unverified). `FocusModeController` (@Observable): apply/clear
shields, local status (§9.4), an assumed 50-min countdown (no session end in the
DTO — §9), ~30s polling → Session Ended when the class session vanishes.
`FocusModeActiveView` (dark takeover via fullScreenCover from MainTabView; real
still-available / paused apps, no placeholders), `FocusModeView` resting +
collapsed-active, `EmergencyUnlockSheet` (local/optimistic §9.6),
`SessionEndedOverlay`. Verified active / resting / emergency / ended on the Sim
(10–13). DEBUG aids: `-baliCheckedIn`, `-baliSessionEnded`, `-baliSheet emergency`.

⚠️ DEVICE TODO (user, Apple account): Family Controls capability +
`com.apple.developer.family-controls` entitlement (Apple approval) + a one-time
FamilyActivityPicker selection. `RealScreenTimeService` is unverified (Sim-excluded).

### Phase 8 — DONE (commit `9b02ae6`)

`NotificationManager` (@Observable): local notifications feed for the 4 event
types, derived locally (§9.7); `requestAuthorization`/`notify` over
UNUserNotificationCenter (APNs-ready); `unreadCount`/`markAllRead`. Real
`NotificationsView` (18). Wired: Home bell badge → unread; check-in success +
session end post notifications; onboarding "Allow access" requests permission;
feed seeds on app load. DEBUG aid: `-baliPush notifications`.

### ✅ All 8 phases complete — remaining work (device + backend)

Every design screen (01–18) is built + Sim-verified on stub auth + sample data.
What's left is device-only or backend, all behind clean seams (§9):

- **Auth / live data: ✅ DONE (`3a08b6b`).** Amplify SPM (Amplify +
  AWSCognitoAuthPlugin) added; `BaliApp` configures Amplify; `AmplifyAuthService`
  imports `AWSPluginsCore`; login prefill removed. `amplifyconfiguration.json`
  (gitignored, mirrors android) is bundled. Runs on real Cognito + the dev API
  (`npm run dev:api` → localhost:3001, reads root `.env`). Sign-in needs a Cognito
  user with `custom:role = student` (the API verifies the **id** token, `tokenUse:'id'`).
  Remaining for *prod* auth: the `balistudent://` URL scheme for Google sign-in
  (email/pw already works) + a deployed HTTPS API URL (today the API is localhost-only).
- **Device (NFC + Focus Mode) — prep DONE in session 3; awaiting paid team + phone.**
  The user now has the paid Apple Developer account AND the physical NFC chips.
  Session-3 prep landed (commits `5800ca3`, `499a9b2`, `78108a1`):
  - ✅ The Sim-excluded device slice now **compile-verifies** against the iphoneos SDK
    (`xcodebuild -sdk iphoneos -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO`).
    Fixed `CoreNFCReader`'s 3 concurrency warnings (`@preconcurrency import CoreNFC` +
    `nonisolated(unsafe)` bindings for CoreNFC's non-Sendable session/tag).
  - ✅ `Bali/Bali.entitlements` (NFC `readersession.formats` = [NDEF, TAG] +
    `family-controls`), wired as `CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*]` so the Sim
    build (free team, test env) is untouched. Added `INFOPLIST_KEY_NFCReaderUsageDescription`.
  - ✅ **FamilyActivityPicker** (`Features/Focus/BlockedAppsView.swift`) — was a latent
    bug: `FocusSelectionStore` was only ever read, so `applyShields` always no-op'd.
    Now the student picks apps once (Settings → "Apps to block"), tokens persist,
    `RealScreenTimeService` enforces them. `ScreenTimeService.blockedSelectionCount`
    added; "Focus permissions" badge now reflects real auth status.

  STILL NEEDED (user actions, then device run):
  1. Add the **paid Apple ID to Xcode** (Settings → Accounts) so automatic signing can
     provision `family-controls` + NFC for *development* (the free `H535678UF8` team
     can't). Then switch `DEVELOPMENT_TEAM` to the paid team id (detect from Xcode prefs
     `IDEProvisioningTeamByIdentifier` or read off the account).
  2. **Connect + trust the iPhone.**
  3. Device build/run → real chip tap → check-in → real shielding. `CoreNFCReader` /
     `RealScreenTimeService` are now compile-verified but never *runtime*-verified.
  4. Device can't reach localhost → run with `-BALI_DEV_API_HOST <mac-LAN-ip>` + an **ATS
     exception**. ATS is a nested dict, NOT expressible via flat `INFOPLIST_KEY_*` — needs
     either `NSAllowsLocalNetworking` (may not cover raw private-IP literals) or a real
     `Info.plist`. Decide at device-run time once the LAN IP is known. (Sim allows
     http://localhost without any of this.)
  Note: `-baliAutologin` and the other DEBUG deep-link aids are **stub-mode only**; with
  live Amplify auth wired they no longer apply, so authed screens can't be screenshot on
  the Sim without a real Cognito student sign-in (needs `npm run dev:api` + credentials).
- **⚠️ Emergency stop / unlock — BUILD OUT (priority).** `EmergencyUnlockSheet` is
  local/optimistic only today: pick reason + note → "Request sent", nothing actually
  happens (§9.6). Build the real flow — a backend endpoint for the teacher to
  review/approve, and the actual stop/unlock behavior on approval (clear shields).
- **Backend / shared (§9; server-side, decoupled from NFC — buildable NOW via the dev
  API):** student device registration, JWT status-report route, the real tag-aware
  check-in endpoint (simulate-check-in is the MVP), semantic `blockedAppKeys`,
  push/APNs, seat / next-class / streak. Recommended first: device registration +
  status-report. (These touch the shared backend — web + android consume it too.)
- **Polish / ship:** accessibility pass (Dynamic Type, VoiceOver labels), deploy the
  API, App Store assets + privacy strings + Family Controls *distribution* approval +
  App Review.

DEBUG launch-arg aids (all `#if DEBUG`, no effect on normal runs):
`-baliAutologin`, `-baliTab`, `-baliPush`, `-baliSheet`, `-baliNfcState`,
`-baliCheckedIn`, `-baliSessionEnded`, `-baliOnboarding[Step]`, `-baliJoinToken`.

### Backend/shared changes still to confirm (see §9; all have local fallbacks)
Real student check-in endpoint (using `simulate-check-in` behind a
`CheckInService` seam, no "simulate" UI), semantic `blockedAppKeys`, JWT status
report, student device registration, emergency unlock, push notifications,
seat/block name, streak/unread. Decisions locked: iOS 17, **Amplify Swift**
(parity), MVP-local-now.

### Your open action items (don't block Phases 4–5; needed for 3 real-auth & 6–7)
- Add the **Amplify SPM package** in Xcode + a real (untracked)
  `amplifyconfiguration.json` to activate real Cognito (template at
  `ios/Bali/Bali/Resources/amplifyconfiguration.example.json`; steps in
  `Auth/AmplifyAuthService.swift`). Register the iOS OAuth redirect URI on the
  Cognito app client. Until then the **stub auth + sample data** run everything
  on the Simulator.
- Apple entitlements for **Family Controls** + **NFC Tag Reading** (Phases 6–7,
  device-only).
