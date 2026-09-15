# Bali — TestFlight readiness

Written 2026-09-09, from a live inspection of the Xcode project, entitlements, plists, signing
identities and the device. This is the list of things that will *actually* stop a TestFlight
upload, in the order they will stop you.

**Short version:** the **teacher app can go to TestFlight in days**; the **student app cannot go
until Apple approves a Family Controls (Distribution) entitlement**, which is a manual review of
~4 business days to several weeks. Submit those three requests first — everything else on this
page is work you can do while you wait.

---

## 0. What TestFlight does and does not solve

TestFlight replaces the *install* channel (cable / LAN / provisioning profiles). It does **not**
give the app a backend.

A TestFlight build is compiled `Release`, which means:

- every `#if DEBUG` seam is gone — including **Dev sign-in**. Testers must sign in with a real
  Cognito account. A real *student* Cognito signup has never been exercised end to end
  (`docs/HANDOFF.md`), so test that on a Debug build **before** you depend on it in TestFlight.
- `BALI_DEV_API_HOST` is not read, so the LAN/tunnel host does not apply.
- `APIConfig.baseURL` falls back to `https://api.bali.app/v1`, **which does not exist**. A
  TestFlight build pointed there is dead on arrival.

`APIConfig` now reads an override so this is fixable without a code change per build — see §5.

---

## 1. HARD BLOCKER — Family Controls (Distribution) entitlement

`com.apple.developer.family-controls` is auto-provisioned for **development** only. Apple DTS is
explicit that distribution signing — App Store, **and hence TestFlight, including internal
testers** — requires the separate distribution entitlement. Without it the archive fails with:

```
Provisioning profile failed qualification: Profile doesn't support Family Controls (Development).
Provisioning profile failed qualification: Profile doesn't include the
com.apple.developer.family-controls entitlement.
```

It is granted **per bundle ID**, and every extension that carries the entitlement needs its own
request. Bali needs **three**:

| Bundle ID | Target | Why it needs Family Controls |
|---|---|---|
| `com.bali.Bali` | student app | `FamilyActivityPicker` for the one-time allow-list; `ManagedSettingsStore` shields |
| `com.bali.Bali.BaliShield` | shield UI extension | renders the shield shown over a blocked app |
| `com.bali.Bali.BaliMonitor` | DeviceActivity extension | watchdog that lifts the shield at the bell if the app is dead |

`com.bali.teacher` does **not** carry the entitlement and is unaffected.

**Do this today.** Start from Apple's own page (the form URL has moved before):
<https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement>

### Draft justification (adapt, don't paste blind)

> Bali is a classroom focus tool for K-12. A teacher starts a class session; a student opts in by
> tapping an NFC tag on their own desk. For the length of that one class period the student's
> device shields distracting apps, and the shield lifts automatically at the bell.
>
> We use FamilyControls to let the student authorize which apps stay available during focus — a
> one-time on-device selection the student makes themselves, which we never transmit or inspect
> (the tokens are opaque to us by design). We use ManagedSettings to apply that shield for the
> duration of the session only, and DeviceActivity to guarantee the shield is lifted at the
> scheduled end time even if our app is not running.
>
> The student always holds the exit: an in-app emergency unlock ends the shield immediately, with
> no approval step. The teacher sees only a focus status — never app names, usage, screenshots,
> location, or any per-student ranking or comparison.
>
> Screen Time entitlements are the only way to deliver this, because the product's guarantee is
> that the shield is enforced by the OS and lifts on time without our server being reachable.

Emphasise: **student-initiated, time-boxed, student-revocable, status-only reporting.** Full-focus
`.all(except:)` shielding reads as aggressive, so lead with the consent and exit story.

---

## 2. HARD BLOCKER — there are no app icons

There is **no asset catalog anywhere under `ios/`** — no `.xcassets`, no `AppIcon`, no
`ASSETCATALOG_COMPILER_APPICON_NAME` build setting. Both apps currently ship a blank white icon.

App Store Connect **rejects** uploads without a 1024×1024 marketing icon. This blocks the teacher
app too — it is the first thing to fix if you want a TestFlight build this week.

Needed per app target: an `Assets.xcassets` with an `AppIcon` set (a single 1024×1024 PNG, no
alpha channel, no rounded corners) and `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`.
`apps/web/src/app/icon.svg` is the existing brand mark and is the obvious source.

This is less work than it looks: the project uses Xcode 16 **synchronized folders**
(`PBXFileSystemSynchronizedRootGroup`), so every build phase is legitimately empty and an
`Assets.xcassets` dropped into `ios/Bali/Bali/` is picked up with **no pbxproj edit at all**. Only
the `ASSETCATALOG_COMPILER_APPICON_NAME` build setting has to be added. The modern rejection code
for a missing icon is **ITMS-90713** (missing `CFBundleIconName`); both Info.plists lack that key
and `GENERATE_INFOPLIST_FILE = NO`, so Xcode injects none.

---

## 3. Signing and account prerequisites

Verified on this Mac right now:

| Thing | Status |
|---|---|
| Apple Development certificate | present (`eshan.nirav@gmail.com`, PTLRFTMCKW) |
| **Apple Distribution certificate** | **absent** — required for any TestFlight archive |
| Provisioning profiles | none installed locally |
| App Store Connect API key | none (`~/.appstoreconnect/private_keys` does not exist) |
| Team | `H535678UF8` (paid) |

Also required, none of which exist yet:

- **App Store Connect app records** for `com.bali.Bali` and `com.bali.teacher` (name, SKU,
  primary language). The names must be unique across the whole store.
- Explicit **App IDs** in the developer portal for all four bundle IDs with the right
  capabilities ticked (Family Controls, NFC, App Groups `group.com.bali.shared`).
- The Apple ID signing in must have **App Manager or Admin** on team `H535678UF8` — confirm this,
  because the local certificate is under a different address than the account that owns the team.
- For TestFlight specifically: a **privacy policy URL** (you already have `/privacy` on the web
  app) and App Privacy answers in App Store Connect.

Uploading: easiest is Xcode Organizer (Archive → Distribute App → TestFlight). For scripting it
later, create an App Store Connect API key and use the current Apple upload tooling — `altool` is
not installed on this machine today.

---

## 4. Build numbers and the encryption question

- Every target is `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1`. App Store Connect
  rejects a re-upload of an existing (version, build) pair, so **`CURRENT_PROJECT_VERSION` must
  increment on every upload**. Bump it in the project, or pass
  `CURRENT_PROJECT_VERSION=<n>` on the `xcodebuild` command line.
- `ITSAppUsesNonExemptEncryption` is **absent from every Info.plist**, so App Store Connect will
  ask the export-compliance question on every single upload and hold the build until you answer.
  Bali uses only standard HTTPS/TLS and Cognito SRP, so adding
  `<key>ITSAppUsesNonExemptEncryption</key><false/>` to both app Info.plists removes the prompt.
  (Confirm that characterisation yourself — it is a legal declaration.)

---

## 5. Pointing a TestFlight build at a real API

`APIConfig` (in `ios/Bali/BaliCore/API.swift`) now resolves its base URL in this order:

- **Debug** — `BALI_DEV_API_HOST` from the launch environment, then the persisted `UserDefaults`
  copy. It accepts **either** a bare host (`10.0.0.68` → `http://10.0.0.68:3001/v1`, the
  `demo.sh` convention) **or** a full URL (`https://x.trycloudflare.com` →
  `https://x.trycloudflare.com/v1`). Falls back to `localhost`.
- **Release** — the `BALIAPIBaseURL` Info.plist key, which the `BALI_API_BASE_URL` build setting
  substitutes. Undefined or empty falls back to the old hardcoded `https://api.bali.app/v1`, so
  existing behaviour is unchanged.

So a TestFlight build can be aimed at a staging host with no code edit:

```bash
xcodebuild -project ios/Bali/Bali.xcodeproj -scheme Bali -configuration Release \
  -destination 'generic/platform=iOS' \
  BALI_API_BASE_URL=https://your-staging-host.example.com \
  CURRENT_PROJECT_VERSION=2 \
  archive -archivePath build/Bali.xcarchive
```

Whatever host you choose must also be reflected in: the API's `CORS_ORIGIN`, the web app's
`NEXT_PUBLIC_API_URL`, and the **Cognito app client's callback / sign-out URLs**. A Cloudflare
*quick* tunnel URL changes on every restart, which makes it a poor fit for TestFlight — use a
named tunnel on a domain you own, or a real deployment (`apps/api/Dockerfile` is ready), before
you cut a build.

Do **not** ship a build pointed at a tunnel that fronts a dev API with `ALLOW_DEV_TOKENS=1` —
anyone with the URL could impersonate any student or teacher.

---

## 6. Recommended order

1. Submit the three Family Controls (Distribution) requests. *(today — it is the long pole)*
2. Make app icons and add the asset catalogs. *(blocks even the teacher app)*
3. Confirm the signing Apple ID has App Manager/Admin on `H535678UF8`; create the Apple
   Distribution certificate, the four explicit App IDs, and the two App Store Connect records.
4. Add `ITSAppUsesNonExemptEncryption` and a build-number bump strategy.
5. Stand up a real API host; wire `CORS_ORIGIN`, `NEXT_PUBLIC_API_URL` and the Cognito callback
   URLs to it.
6. Verify a **real** student Cognito signup on a Debug build — TestFlight has no dev sign-in.
7. Ship the **teacher** app to TestFlight (unblocked once 2–5 are done).
8. Ship the student app when Apple approves the entitlement.

Until then, the fastest device loop is still the cable: `./scripts/demo.sh --build`, or
`--tunnel` when the phone cannot reach the Mac over the local network.
