# Bali for iOS

The student app and its two extensions, `BaliCore`, the Swift package they share, and
`BaliOutbox`, the student's outbox and the sync engine that drains it (`docs/ARCHITECTURE.md`,
"iOS app structure").

| Folder         | What it is                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `project.yml`  | The Xcode project, as [XcodeGen](https://github.com/yonaskolb/XcodeGen)'s spec                                         |
| `Bali/`        | The app, `com.bali.Bali` — a placeholder screen until C1–C6, which starts the sync engine and the enforcer             |
| `BaliMonitor/` | The DeviceActivity monitor extension, `com.bali.Bali.BaliMonitor`: iOS runs it at a session's edges                    |
| `BaliShield/`  | The shield configuration extension, `com.bali.Bali.BaliShield`: the shield over a blocked app                          |
| `BaliCore/`    | The API's wire types, the outbox tables, the API client and the sign-in — `swift test` there runs its tests, Linux too |
| `BaliOutbox/`  | The outbox store (GRDB in the app group), its sync engine and the shields' enforcer — `swift test` there too           |

All three targets are on team `H535678UF8`, share the app group `group.com.bali.shared`, and
carry Family Controls; the app also reads NFC tags.

## The Xcode project is generated, not committed

`Bali.xcodeproj` is written by XcodeGen from `project.yml`, and git ignores it. Change a
setting, a target or an entitlement in `project.yml` (or the `Info.plist` and `.entitlements`
files it names), never in Xcode: the next generation overwrites the project. XcodeGen also
reads each target's folder only when it runs, so generate again after adding or removing a
file, and after pulling a change to `ios/`.

## On your Mac

You need Xcode 16.3 or later — the manifests of GRDB and swift-crypto need Swift 6.1; CI builds
with Xcode 26.6 — and [Homebrew](https://brew.sh).

1. Install XcodeGen, once: `brew install xcodegen`.
2. Generate the project and open it:
   ```sh
   cd ios
   xcodegen generate
   open Bali.xcodeproj
   ```
3. Select the team, once: Xcode → Settings → Accounts → add the Apple ID that is on team
   `H535678UF8`. Each target's Signing & Capabilities tab then shows that team, with
   "Automatically manage signing" on — Xcode registers the identifiers, the app group and the
   development profiles itself on the first device build.
4. Run on your iPhone: connect it, turn on Developer Mode on it (Settings → Privacy & Security
   → Developer Mode, then restart), pick it as the run destination for the **Bali** scheme,
   and press Run (⌘R). The extensions are built and installed inside the app.

The build talks to dev: `project.yml` names dev's API and its sign-in (`docs/DEPLOY.md`, "The
phone's sign-in"). Until C1–C6 draw the screens and B6 reads the block, a Debug build's
placeholder shows a temporary readout — the engine's link to the API, when the server last
answered, whether someone is signed in, where the phone stands and what rule 3's check found of
the shields — with **Sign in**, **Sign out**, **Allow Screen Time**, **Join** (a class's code),
**Tap** (a block's tag, typed) and **Emergency Unlock** in their place.

NFC and Screen Time shields need a real iPhone, which is why B5 and B6 are device checkpoints;
the simulator only proves it builds. Family Controls works in development builds already —
Apple's distribution entitlement, which TestFlight and the App Store need, was granted for
the app and both extensions (2026-09-24).

## To run it on your iPhone: B5's device check

A Debug build, run from Xcode as above, against dev. `docs/PLAN.md`'s B5 step keeps the same
list and its status.

**Set up once, on dev.** A session needs a teacher, a class, a block and a student:

- **The teacher's side is the portal**, run on your Mac against dev (`docs/WEB.md`):
  `apps/web/.env.local` with `NEXT_PUBLIC_API_URL=https://bali-production-09a2.up.railway.app`,
  `NEXT_PUBLIC_COGNITO_DOMAIN=https://bali-dev.auth.us-east-1.amazoncognito.com` and
  `NEXT_PUBLIC_COGNITO_CLIENT_ID` = the dev pool's **web** client (not `bali-ios-dev`), then
  `npm run dev -w @bali/web`. Dev's API already lets `http://localhost:3000` in. Sign in as a
  teacher with a school — the exit demo's teacher is one (README, "Running it against a deployed
  API").
- **A class:** create one in the portal; it shows the join code.
- **A block:** the portal cannot register one yet (Phase 5), so register one once, with the
  portal's token — the browser's developer tools → Session Storage → `bali.access_token`:
  ```sh
  curl -X POST https://bali-production-09a2.up.railway.app/v1/blocks \
    -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"tagId":"DEV-B5"}'
  ```
- **The phone signs in as a student** of the dev pool — not as the teacher.

**Then, on the phone**, each with what the readout or the portal must show:

1. **Sign in** opens Cognito's hosted UI; after the password, `Signed in: yes`.
2. Swipe the app away and open it again: still signed in.
3. **Sign out**, then **Sign in**: the password is asked again (the ephemeral browser session keeps
   no cookie).
4. `Link: reached`, and the server last answered moments ago.
5. Lock the phone, unlock it and relaunch: still signed in — a locked Keychain is never a sign-out.
6. The Keychain works on the device: 1 saved, 2 and 5 loaded, 3 cleared. A failure shows — a
   sign-in `notKept`, "not known yet" on an unlocked phone, a sign-out's `Failure(status: …)`.
7. **Allow Screen Time**: iOS asks for Face ID or the passcode; then `Screen Time: approved`.
8. **Join** with the class's code: `joined <the class>`.
9. The portal: **Start session** (25 minutes; a shorter one is
   `curl -X POST …/v1/classes/<class id>/sessions -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"durationMinutes":5}'`).
10. **Tap** with `DEV-B5`: `Standing: focused until` the bell, `shields on, due until` the bell,
    and the grid shows the student focused. Every app and website is shielded — iOS's own shield
    until B5c draws Bali's — while calls, FaceTime and Messages still work. (Tapped in Airplane
    Mode, the shields go on at once, `due until` the tap's time plus 50 minutes — decision 7's cap
    — until the answer comes.)
11. **Emergency Unlock**: the shields are off at once and the apps open; the grid shows unlocked.
    **Tap** again: shielded and focused once more.
12. Settings → Screen Time → Apps with Screen Time Access → turn Bali off, and go back to the
    app: `denied · shields off` at once, and within about 30 seconds the grid shows **protection
    off**. **Allow Screen Time** again: still no shields — only a re-tap leaves protection off —
    and **Tap** brings the shields and focus back.
13. Swipe the app away while shielded, turn on Airplane Mode and open it: still shielded,
    `due until` the bell — a relaunch starts where the phone stood. Airplane Mode off: the grid
    still shows focused, never protection off — the permission reads as allowed after a launch.
14. With the app open, the bell (or **End session** in the portal, found at the next check-in)
    takes the shields off: `Standing: in no session`.

Still to come, with its part: the bell with the app force-quit — Phase 0's open question — and the
50-minute cap with the app closed (B5b); Bali's own shield, "Focused with Bali until 9:42" (B5c).

## CI

The **iOS** workflow (`.github/workflows/ios.yml`) runs on every PR that touches `ios/`: it
generates the project, builds the app for the iOS Simulator with signing off, and runs
`BaliCore`'s and `BaliOutbox`'s tests on an iOS Simulator. Both packages' tests also run on
Linux on every PR ("BaliCore Swift tests (Linux)" in `ci.yml`); on Linux, GRDB builds against
the system SQLite, so `BaliOutbox` needs `libsqlite3-dev` there.
