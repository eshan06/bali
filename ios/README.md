# Bali for iOS

The student app and its two extensions, `BaliCore`, the Swift package they share, and
`BaliOutbox`, the student's outbox and the sync engine that drains it (`docs/ARCHITECTURE.md`,
"iOS app structure").

| Folder         | What it is                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `project.yml`  | The Xcode project, as [XcodeGen](https://github.com/yonaskolb/XcodeGen)'s spec                                         |
| `Bali/`        | The app, `com.bali.Bali` — a placeholder screen until C1–C6, which starts the sync engine and the enforcer             |
| `BaliMonitor/` | The DeviceActivity monitor extension, `com.bali.Bali.BaliMonitor`: at the bell, it takes the shields off, app closed   |
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

**Set up once, on dev.** A session needs a teacher, a class, a block and a student. The teacher's
side is `npm run dev:teacher`, from a checkout on your Mac (`npm ci` once): it signs in as the exit
demo's teacher, with the demo's variables and `.env.demo` (README, "Running it against a deployed
API"), and never prints a credential.

```sh
set -a; . ./.env.demo; set +a
read -rsp 'demo password: ' DEMO_PASSWORD && export DEMO_PASSWORD
npm run dev:teacher -- class   # the class "Device check", made or reused: prints its join code
npm run dev:teacher -- block   # the block DEVICE-CHECK-1, registered to the teacher
```

**The phone signs in as a student** of the dev pool — one of the demo's test students, such as
`DEMO_USER_ANA`'s account, in the hosted UI — never as the teacher.

**Then, on the phone**, each with what the readout or `watch` must show:

1. **Sign in** opens Cognito's hosted UI; after the password, `Signed in: yes`.
2. Swipe the app away and open it again: still signed in.
3. **Sign out**, then **Sign in**: the password is asked again (the ephemeral browser session keeps
   no cookie).
4. `Link: reached`, and the server last answered moments ago.
5. Lock the phone, unlock it and relaunch: still signed in — a locked Keychain is never a sign-out.
6. The Keychain works on the device: 1 saved, 2 and 5 loaded, 3 cleared. A failure shows — a
   sign-in `notKept`, "not known yet" on an unlocked phone, a sign-out's `Failure(status: …)`.
7. **Allow Screen Time**: iOS asks for Face ID or the passcode; then `Screen Time: approved`.
8. **Join** with the code `class` printed: `joined Device check`.
9. `npm run dev:teacher -- start` (20 minutes; `-- start 5` for five, `-- extend` adds ten), then
   `npm run dev:teacher -- watch`, left running: it prints each student's state as the portal's
   grid would show it — focused, unlocked with its reason, protection off, silent, left — and
   when the phone was last seen, so each check-in shows too.
10. **Tap** with `DEVICE-CHECK-1`: `Standing: focused until` the bell, `shields on, due until` the
    bell, and `watch` shows the student focused. Every app and website is shielded — iOS's own
    shield until B5c draws Bali's — while calls, FaceTime and Messages still work. (Tapped in
    Airplane Mode, the shields go on at once, `due until` the tap's time plus 50 minutes — decision
    7's cap — until the answer comes.)
11. **Emergency Unlock**: the shields are off at once and the apps open; `watch` shows unlocked.
    **Tap** again: shielded and focused once more.
12. Settings → Screen Time → Apps with Screen Time Access → turn Bali off, and go back to the
    app: `denied · shields off` at once (`notDetermined`, if iOS reads it so: reported all the
    same, a check-in later), and within about 30 seconds `watch` shows **protection off**.
    **Allow Screen Time** again: still no shields — only a re-tap leaves protection off — and
    **Tap** brings the shields and focus back.
13. Swipe the app away while shielded, turn on Airplane Mode and open it: still shielded,
    `due until` the bell — a relaunch starts where the phone stood. Airplane Mode off: `watch`
    still shows focused — no false protection off after a relaunch: a permission Family Controls
    reads as `notDetermined` for a moment is reported only if it still reads so a check-in later.
14. With the app open, the bell (or Ctrl-C on `watch` and `npm run dev:teacher -- end`, found at
    the next check-in) takes the shields off: `Standing: in no session`.

Still to come, with its part: Bali's own shield, "Focused with Bali until 9:42" (B5c).

### Round 2 (B5b): the bell with the app closed

After round 1, on the same build and phone: signed in, Screen Time allowed, the class joined, and
`npm run dev:teacher -- watch` running. "Force-quit" is swiping the app away in the app switcher.
The readout's `Monitor:` line says what the DeviceActivity monitor did at its last wake — the time,
what it did, and how long it took — since the monitor can show nothing itself.

1. **The window is registered.** `npm run dev:teacher -- start 20`, then **Tap** with
   `DEVICE-CHECK-1`: `shields on, due until` the bell, and no `bell NOT scheduled` on that line.
2. **Force-quit, the bell — Phase 0's question.** Force-quit the app while shielded and leave the
   phone until the bell. Within a minute after the bell, with the app still closed, blocked apps
   open again; `watch` showed the student silent a minute and a half after the force-quit, then
   the session over. Open the app: `Monitor: <a time within a minute after the bell> · cleared ·`
   and a fraction of a second.
3. **A window shorter than iOS's 15-minute floor.** `start 15`, wait 5 minutes, **Tap** (10
   minutes left), force-quit: as step 2 — off within a minute after the bell, `Monitor: … · cleared`.
4. **An Emergency Unlock cancels the window.** `start 15`, **Tap**, **Emergency Unlock**,
   force-quit: the apps stay open, and after the bell the `Monitor:` line is still step 3's — nothing
   woke it.
5. **An extension moves the window.** `start 15`, **Tap**, then `npm run dev:teacher -- extend 10`
   with the app open until the next check-in moves `due until` 10 minutes on (still no
   `bell NOT scheduled`). Force-quit: still shielded past the first bell; off within a minute after
   the new one, `Monitor: … · cleared`.
6. **Decision 7's cap with the app closed.** With no session running, turn on **Cap a tap at 15 min
   (device check)**, turn on Airplane Mode, and **Tap**: `due until` the tap's time plus 15 minutes
   (the floor, not 50). Force-quit: within a minute after that time the apps open, the tap never
   answered. Open the app, still in Airplane Mode: `Monitor: … · cleared`, `Standing: in no session`.
   Turn the cap off and Airplane Mode off: the tap is answered armed —
   `Standing: waiting for the teacher's Start` — and a `start` today would join it, so run this
   step last.
7. **The monitor never stalls.** Every `Monitor:` line above took a fraction of a second, never the
   2-second bound on waiting for the file, and the app, opened straight after each wake, started
   normally — no `The outbox could not be opened`, no `storage failed`. A wake that could not read
   the file says `file not read — kept, again <time>`, and tries again a minute on.

## CI

The **iOS** workflow (`.github/workflows/ios.yml`) runs on every PR that touches `ios/`: it
generates the project, builds the app for the iOS Simulator with signing off, and runs
`BaliCore`'s and `BaliOutbox`'s tests on an iOS Simulator. Both packages' tests also run on
Linux on every PR ("BaliCore Swift tests (Linux)" in `ci.yml`); on Linux, GRDB builds against
the system SQLite, so `BaliOutbox` needs `libsqlite3-dev` there.
