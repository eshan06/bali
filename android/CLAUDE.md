# Bali Android — session handoff

This file is auto-loaded by Claude Code when working in `android/`. It's a quick
orientation for a fresh session — read it once and you should know where things
stand without re-deriving from the diff.

## What it is

Kotlin / Jetpack Compose student companion app. Single-module Gradle project
under `android/`. Talks to the same backend as the web admin (`packages/api`)
but only the **student-facing JWT endpoints** — never the teacher routes, never
the hardware `apikey` endpoints.

Stack: Compose Material3 + Hilt + Retrofit/Moshi + DataStore (preferences) +
Amplify Cognito Auth + Navigation Compose.

## Module layout

```
app/src/main/java/com/bali/student/
  MainActivity.kt              — single Activity, hosts BaliNavHost
  BaliApplication.kt           — Hilt entry, Amplify.configure
  data/
    api/                       — Retrofit BaliApi + AuthInterceptor + NetworkModule
    auth/AmplifyAuth.kt        — Cognito wrapper with in-memory JWT cache
    focus/                     — FocusModePolicy, FocusModeStore (DataStore),
                                 AppPackageMap (iOS bundle → Android pkg)
    model/                     — DTOs that match @bali/shared response shapes
    prefs/StudentPrefs.kt      — setup-complete flag
  nfc/NfcReader.kt             — singleton, exposes SharedFlow<NfcTap>;
                                 enableReaderMode driven from MainActivity
  permissions/PermissionStatus.kt — accessibility / notif / battery / NFC checks
  service/
    FocusAccessibilityService.kt — window-state listener → BlockActivity
    BlockActivity.kt              — full-screen block screen
    FocusModeService.kt           — foreground service, polls session end
  ui/
    nav/BaliNavHost.kt         — routes + bottom nav
    screens/                   — Login, Setup, Classes (home), Join,
                                 JoinConfirm, ClassDetail, FocusMode,
                                 Profile, Settings
    theme/                     — BaliTheme, BaliBackground, colors, type
```

`AndroidManifest.xml` declares: NFC + INTERNET + POST_NOTIFICATIONS +
REQUEST_IGNORE_BATTERY_OPTIMIZATIONS + FOREGROUND_SERVICE permissions, the
accessibility service, the block activity, and a `dataSync` foreground
service.

## Backend endpoints actually called from Android

JWT-authed only. See `data/api/BaliApi.kt` for the canonical list.

- `GET /students/me`
- `POST /students/me` (profile update)
- `GET /students/me/classes/{classId}`
- `POST /students/me/classes/{classId}/simulate-check-in` — used by **both** the
  prototype button and the real NFC tap path
- `POST /invites/{inviteId}/accept`
- `GET /classes/{classId}/preview`
- `POST /classes/{classId}/join`

There is a real hardware `/api/checkin` endpoint (apikey auth) but the phone
doesn't call it — the phone is a JWT client and uses simulate-check-in so the
identity remains the student's. The real apikey endpoint is for the Bali block
hardware itself when it eventually ships.

## How check-in + Focus Mode flow end-to-end

1. NFC tag detected (real hardware OR `NfcReader.simulateTap()` from the
   prototype button) → emits to `NfcReader.taps`.
2. `ClassDetailViewModel` collects taps and calls `simulateCheckIn(viaNfc=true)`
   only when the visible class has an active session and the student is
   unchecked + has a device. Otherwise it sets a friendly error.
3. Server response includes a `BlockingSnapshot`. `persistPolicy` maps iOS
   bundle IDs to Android package names via `AppPackageMap` and writes a
   `FocusModePolicy` to `FocusModeStore` (DataStore + Moshi JSON).
4. If accessibility is enabled, status becomes `applied` and
   `FocusModeService.start(ctx)` runs as a `dataSync` foreground service
   with a "Focus Mode active for X" notification.
5. The `pendingFocusModeNav` flag triggers nav from ClassDetail → FocusMode.
6. While Focus Mode is active, `FocusAccessibilityService.onAccessibilityEvent`
   gets `TYPE_WINDOW_STATE_CHANGED` events; if the foreground package matches
   the policy it launches `BlockActivity` (debounced 500ms).
7. `FocusModeService` polls `/students/me/classes/{id}` every 30s. When
   `activeSession` is null or its id differs from the stored sessionId, status
   becomes `disabled`, the policy is cleared, notification flips to "Focus
   Mode ended", and the service self-stops.

Status reporting is **local-only** — there's no JWT-authed `/report` endpoint
(the server-side `/sessions/.../device-status/.../report` is apikey). Adding a
JWT variant was deferred to keep work Android-only. `FocusModePolicy.lastKnownStatus`
is the source of truth for the UI; the teacher dashboard doesn't see it yet.

## Running

```
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:PATH = "$env:JAVA_HOME\bin;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:PATH"
.\gradlew.bat installDebug
adb shell am force-stop com.bali.student
adb shell monkey -p com.bali.student -c android.intent.category.LAUNCHER 1
```

`JAVA_HOME` is set persistently in the user's env to the Studio JBR (JDK 21).
The system JDK is still Oracle 8 — Gradle would crash if it picked that up,
so always verify by running `gradlew --version`.

`adb` is **not** on persistent PATH; the prefix above is required every new
shell. (User has been asked twice; left as-is.)

The API base URL is hardcoded to `http://10.0.2.2:3001/api/` in
`app/build.gradle.kts`. That's the emulator's alias for the host's
`localhost:3001`, where `packages/api` runs in dev. **The app only works on
the emulator with this base URL** — for a physical device you'd need either
`adb reverse tcp:3001 tcp:3001` or a LAN-IP build variant.

## Enabling the accessibility service

Android disables it on every `installDebug` (security feature). Re-enable via:

```
adb shell settings put secure enabled_accessibility_services com.bali.student/com.bali.student.service.FocusAccessibilityService
adb shell settings put secure accessibility_enabled 0
adb shell settings put secure accessibility_enabled 1
```

The `0` → `1` toggle is required to make the system re-bind. The UI path
(Settings → Accessibility → Downloaded apps → Bali) also works.

**Gotcha we hit and fixed in `b7a01b0`:** Android's accessibility manager on
the AVD did **not** parse `res/xml/accessibility_service_config.xml` — the
bound service had empty `eventTypes`, so no events fired. The fix was to set
`AccessibilityServiceInfo` programmatically in `onServiceConnected`. The XML
is still in the manifest as a fallback, but the runtime config is now
authoritative.

## Testing the blocker on the emulator

Real NFC isn't possible on the AVD, but blocking works. The catch is that
common blocked apps (Instagram, TikTok, etc.) aren't on the emulator. Easy
test paths:

- Use a **Full Focus** policy server-side. Then opening Chrome / Settings /
  Photos on the emulator triggers the block screen because they're not in
  the allowed list.
- Or `adb install` an APK of a blocked app.
- Or add a package you do have (e.g. `com.android.chrome`) to a Custom policy.

Tail the service to see decisions in real time:
```
adb logcat -c
adb logcat -s FocusAccessibility:V
```
Look for `service connected, eventTypes=32`, `policy update: active=true ...`,
and `window=<pkg> blocked=true/false`.

## Known scope gaps / things deferred

- **iOS-to-Android package map is static** in `AppPackageMap.kt`. Unknown
  bundle IDs are dropped from the policy. Adding new apps means editing
  that file. A long-term fix is server-side per-platform package lists,
  but that's a backend change.
- **App-name resolution in BlockActivity** uses `PackageManager.getApplicationLabel`
  for the *installed* app — falls back to `"This app"` if the user has a
  pre-Android-11 device where querying other packages requires a `<queries>`
  manifest entry. Worth a check if we ever target API < 30.
- **NFC tap currently reads UID only.** No NDEF parsing, no
  tag-ID-to-class mapping; the simulate-check-in endpoint doesn't take the
  UID anyway. When hardware ships, we'll likely change endpoints.
- **Settings screen's permission rows are still placeholders** (all "Coming
  soon"). The Setup screen has real status — Settings can be brought in line
  in a follow-up.
- **Cognito JWT is cached in-memory only** (`AmplifyAuth.currentJwt`). On
  process death it's re-fetched from Amplify. We invalidate on
  signIn/signInWithGoogle/signOut.
- **Refresh-on-return for the Classes list** uses a savedStateHandle flag
  set by JoinConfirm. Other screens that mutate cross-tab state would need
  the same pattern.

## Commit history (most recent first)

```
b7a01b0 android: configure accessibility service info at runtime
31f35ad android: add NFC check-in simulator
7ea0a34 android: add focus mode lifecycle and status reporting
d437a6c android: add block screen and focus permissions flow
b1ad3d3 android: add focus mode app blocking service
5fc0a49 android: persist active focus mode policy
72847c0 android: add NFC check-in foundation
1ff490e android: working join flow, editable profile, structured settings
0cb3a6e android: cache cognito jwt in memory to speed up api calls
cc2f347 android: state-aware home screen with invites, active session banner, pull-to-refresh
1ba65d7 android: full class detail screen with focus mode, simulate check-in, recent sessions
8332440 android: scaffold student app shell with setup, join, focus, profile, settings + bottom nav
70268b1 add android student app with cognito + google sign-on
```

## Conventions for this codebase

- No co-author trailers in commits (project preference; also in user memory).
- Branch is `main`, push directly when the user asks.
- Keep commits focused; the NFC + blocking work was split into 6 commits with
  matching short messages spelled out in the spec.
- The teacher web console / API server are **out of scope** for the Android
  app. Any backend change should be flagged and confirmed first.
