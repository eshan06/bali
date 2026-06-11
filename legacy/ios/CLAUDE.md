# Bali iOS — session handoff

This file is auto-loaded by Claude Code when working in `ios/`. It's a quick
orientation for a fresh session — read it once and you should know where things
stand without re-deriving from the diff.

> **Run Claude from the repo root** (`/Users/eshanshah/Downloads/github/bali`),
> not from `ios/`. From root, Claude still sees `packages/shared` (the data
> contracts), `packages/api` (the backend this app integrates with), and
> `android/` (the sibling student app to mirror). This nested file is still
> picked up automatically when iOS files are in play.

## What it is

SwiftUI student companion app — the iOS counterpart to the Kotlin app in
`android/`. Talks to the same backend as the web admin (`packages/api`) but
**only the student-facing JWT endpoints** — never the teacher routes, never the
hardware `x-api-key` endpoints.

Status: **greenfield.** As of this writing the project is the default Xcode
SwiftUI template (`ContentView.swift` "Hello, world!"). Nothing app-specific is
built yet. **The authoritative UI/UX spec is
`ios/design_handoff_bali_student_app/` — read its `README.md` and screenshots
first** (high-fidelity, final). Then `android/CLAUDE.md` for the feature set and
`docs/hardware-and-blocking-design.md` for the backend contract.

## Project layout

```
ios/
  Bali/
    Bali.xcodeproj
    Bali/
      BaliApp.swift          — @main App entry
      ContentView.swift      — default template (to be replaced)
      Assets.xcassets
```

- Bundle identifier: `com.bali.Bali` (org identifier `com.bali`). Android uses
  `com.bali.student`; iOS doesn't need to match — bundle namespaces are
  per-platform.
- SwiftUI lifecycle, Swift, no Core Data / SwiftData (data comes from the REST
  API). Storage = None, Testing = None at scaffold time.
- Part of the monorepo's single git repo — **not** a nested git repo. Do not
  `git init` inside `ios/`.

## Backend integration

Same API server as web/Android. In **dev** the API runs at `localhost:3001`
(`npm run dev:api` from repo root). Unlike the Android emulator (which needs the
`10.0.2.2` alias), the **iOS Simulator shares the host network**, so the base
URL is simply:

```
http://localhost:3001/api
```

- **App Transport Security:** plain `http://localhost` is allowed from the
  Simulator, but for a physical device on a LAN IP you'll need an ATS exception
  (`NSAppTransportSecurity` → `NSAllowsLocalNetworking`, or an allowed-domains
  entry) in `Info.plist`. Keep prod (`https://`) the default; gate the dev base
  URL behind a build config.
- Production base URL is the deployed API Gateway URL (see `.env`'s
  `NEXT_PUBLIC_API_URL` for the web equivalent / `docs/aws-setup.md`).

### Auth — AWS Cognito

Same user pool as web + Android (email/password + Google OAuth). The user has
Cognito configured in AWS already; values live in the root `.env`
(`COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN`). Two viable
Swift paths:

- **Amplify Swift** (`Amplify` + `AWSCognitoAuthPlugin`) — closest parity with
  Android's Amplify usage; handles the hosted-UI OAuth flow.
- Raw `AWSCognitoIdentityProvider` + `ASWebAuthenticationSession` for OAuth — more
  control, less dependency weight.

The app is a **JWT client**: attach the Cognito access/ID token as
`Authorization: Bearer <jwt>` on every request. Cache the JWT in memory; refresh
via Amplify on expiry (mirrors Android's `AmplifyAuth.currentJwt`).

### Student endpoints actually called (JWT-authed only)

- `GET  /students/me`
- `POST /students/me` (profile update)
- `GET  /students/me/classes/{classId}`
- `POST /students/me/check-in` (or `POST /students/me/nfc-check-in`) — **real**
  student-authenticated NFC check-in (see below). **Not** `simulate-check-in`.
- `POST /invites/{inviteId}/accept`
- `GET  /classes/{classId}/preview`
- `POST /classes/{classId}/join`

The phone is a **JWT client**. The real hardware `POST /api/checkin` (x-api-key)
is for the Bali tap device, **not** the phone — never call it from iOS. But the
iOS check-in is also **not** a "simulate" flow: it's a real student NFC check-in
(framing corrected below).

> The Android app currently calls `.../simulate-check-in`. iOS is being built
> **hardware-ready**, so it should call a real student NFC check-in endpoint. If
> that endpoint (`/students/me/check-in` / `/students/me/nfc-check-in`) does not
> yet exist server-side, adding it is a **backend change** — flag and confirm
> with the user before relying on it (backend is otherwise out of scope here).

## Check-in: real NFC, not simulation

This app is built **hardware-ready**. The check-in flow is:

1. The phone reads the passive Bali **NFC tag** using **Core NFC**
   (`NFCNDEFReaderSession` / `NFCTagReaderSession`).
2. The app calls a **student-authenticated** check-in endpoint
   (`POST /students/me/check-in` or `/students/me/nfc-check-in`) with its JWT,
   passing the tag payload (and class context as the contract requires).
3. Server maps device/tag → student → active session, records attendance, and
   returns the session's frozen Focus Mode policy.

Rules:
- **Do not** frame this around `simulate-check-in`. That was an Android/web
  prototype affordance; iOS is the real thing.
- **Do not** call the hardware `POST /api/checkin` (x-api-key) endpoint — the
  phone authenticates as the student via JWT, not as the device.
- **Core NFC requires a physical iPhone** + the **Near Field Communication Tag
  Reading** capability/entitlement and an `NFCReaderUsageDescription` in
  `Info.plist`. The **Simulator cannot scan NFC tags** — NFC work is
  device-only.

## Data contracts — single source of truth

DTOs must match the response shapes defined in **`packages/shared`** (TypeScript
+ zod). When modeling Swift `Codable` structs, mirror these — don't invent
shapes:

- `packages/shared/src/constants.ts` — blocking presets, app lists,
  `APP_NAME_BY_BUNDLE_ID`, lateness thresholds.
- `packages/shared/src/blocking-snapshot.ts` — `resolveBlockingSnapshot` +
  the `BlockingSnapshot` shape.

**Bundle IDs are display/reference metadata only — not the iOS enforcement
mechanism.** It's tempting to treat the snapshot as "iOS-bundle-id-native" and
assume the app can block `com.burbn.instagram` directly. It can't: iOS shields
apps through **opaque FamilyControls tokens**, not bundle IDs (Apple hides the
real identifiers for privacy). So:

- Use bundle IDs / `appName` to **render** the policy (which apps are blocked) in
  the UI.
- For **actual enforcement**, the backend should send a **semantic** policy —
  e.g. `blockedAppKeys: ["instagram", "snapchat"]` and/or category keys — and the
  iOS app maps those keys to **locally selected FamilyControls tokens** before
  applying `ManagedSettings` shields (see the blocking section below).
- Adding `blockedAppKeys`/category semantics to the snapshot is a **backend +
  `packages/shared` change** — flag and confirm before relying on it.

## The hard part: app blocking on iOS ≠ Android

Android blocks apps with an AccessibilityService that watches the foreground app
and slams a block screen over it. **iOS has no equivalent and won't allow it.**
The supported path is Apple's **Screen Time API**:

- **FamilyControls** — authorization + `FamilyActivityPicker` to select apps
  (you get opaque `ApplicationToken`s, **not** bundle IDs — Apple hides them for
  privacy).
- **ManagedSettings** — actually shield/block the selected apps.
- **DeviceActivity** — schedule/monitor enforcement windows.

### Policy model (semantic keys → local tokens)

The backend sends the session's **frozen Focus Mode policy** as **semantic app
keys / display metadata** (e.g. `blockedAppKeys: ["instagram", "snapchat"]`
and/or category keys, plus `appName`/bundle ID for display). The iOS app then:

1. Has the student grant **Family Controls authorization** once.
2. Maps the policy's app keys / categories to **locally selected FamilyControls
   tokens** (`ApplicationToken` / `ActivityCategoryToken`), typically captured
   via `FamilyActivityPicker` and persisted.
3. Applies/clears `ManagedSettings` **shields** on those tokens for the duration
   of the active session, scheduled/monitored with `DeviceActivity`.

So: **bundle IDs render the policy; tokens enforce it.** Treat the server policy
as semantic intent, not a literal "block this bundle ID" instruction.

Major design implications to flag before building the focus-mode feature:

1. **Family Controls entitlement** (`com.apple.developer.family-controls`)
   requires a **special request to Apple** and a paid developer account. Real
   shielding **does not work on the Simulator** — needs a physical device.
2. There is **no public bundle-id → token mapping**; tokens are opaque and
   user-granted. The realistic UX is "student grants Screen Time permission, then
   the app shields the policy's apps/categories during active sessions." If the
   snapshot doesn't yet carry semantic `blockedAppKeys`/categories, adding them is
   a **backend + `packages/shared`** change — confirm before relying on it.
3. Like Android, status reporting can stay local-only initially (there's no
   JWT-authed `/report` endpoint — the server-side report route is x-api-key).

For an MVP, the **real NFC check-in** + session flow, classes, join, and profile
can all ship before full Screen Time enforcement is wired. Treat Screen Time
shielding as its own milestone — but build check-in for real hardware from day
one, not as a simulation.

### Testing — physical device required for the real flows

- **NFC tag scanning (Core NFC)** and **Screen Time enforcement
  (FamilyControls/ManagedSettings)** must be tested on a **physical iPhone**.
- The **Simulator** is fine for ordinary UI, auth (Cognito), and API/networking
  work — but **not** for real NFC scans or final shielding behavior.

## Running

- Open `ios/Bali/Bali.xcodeproj` in Xcode; pick an iOS Simulator; ⌘R.
- Start the backend first if testing networked features: `npm run dev:api`
  (needs DB connectivity — see root `README` / `docs/aws-setup.md`).
- Xcode has **no built-in terminal**. Use Terminal.app or VS Code's integrated
  terminal, rooted at the repo root, for git / Claude / npm.

## Conventions for this codebase

- **No co-author trailers in commits** (project preference; also in user memory).
- Branch is `main`; push directly when the user asks.
- Keep commits focused with short `ios: ...` messages (mirrors the `android: ...`
  prefix convention).
- The teacher web console / API server are **out of scope** for the iOS app. Any
  backend change must be flagged and confirmed first.
- Don't call teacher routes or x-api-key/hardware endpoints from the app.

## Pointers

- **`ios/design_handoff_bali_student_app/`** — **the authoritative UI/UX design
  handoff. Read this first.** High-fidelity, final visual spec. Contains:
  - `README.md` — full design brief: overview, the prototype→native iOS mapping
    table (Core NFC, FamilyControls/ManagedSettings/DeviceActivity), exact design
    tokens (colors/type/spacing/radii), screen specs, copy, and behavior.
  - `bali.css` — the `:root` design tokens to reproduce as Swift design-system
    constants.
  - `*.jsx` + `Bali Student App.html` — an **interactive reference prototype**
    (HTML/CSS/React-via-Babel). Open the `.html` in a browser to navigate every
    screen/state. **Not production code** — recreate it natively in SwiftUI, don't
    port the HTML structure literally. The left "Screens" rail is a reviewer tool;
    **do not** reproduce it in the app.
  - `screenshots/` — 18 numbered captures of every screen/state (login →
    register-device → permissions → home → classes → NFC check-in → focus-mode
    active/resting → emergency-unlock → session-ended → profile/settings/etc.).
  - Note: the prototype's blocked/allowed app tiles use placeholder names
    ("Chatter", "Glimpse") — stand-ins for real app/category data, not brands.
- `android/CLAUDE.md` — the feature set, screen list, and flows (sibling app).
- `docs/hardware-and-blocking-design.md` — full backend/blocking contract, error
  codes, lifecycle.
- `docs/aws-setup.md` — AWS/Cognito setup.
- `packages/shared/` — the typed contracts to mirror in Swift.
</content>
</invoke>
