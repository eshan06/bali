# Bali for iOS

The student app and its two extensions, `BaliCore`, the Swift package they share, and
`BaliOutbox`, the student's outbox and the sync engine that drains it (`docs/ARCHITECTURE.md`,
"iOS app structure").

| Folder         | What it is                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `project.yml`  | The Xcode project, as [XcodeGen](https://github.com/yonaskolb/XcodeGen)'s spec                                         |
| `Bali/`        | The app, `com.bali.Bali` — a placeholder screen until C1–C6, which starts the sync engine and the enforcer             |
| `BaliMonitor/` | The DeviceActivity monitor extension, `com.bali.Bali.BaliMonitor`: at the bell, it takes the shields off, app closed   |
| `BaliTests/`   | The app target's own tests, hosted in the app on the iOS Simulator                                                     |
| `BaliShield/`  | The shield configuration extension, `com.bali.Bali.BaliShield`: Bali's own shield over a blocked app, in D1's look     |
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
phone's sign-in"). Until C1–C6 draw the screens, a Debug build's placeholder shows a temporary
readout — the engine's link to the API, when the server last answered, whether someone is signed
in, where the phone stands, what rule 3's check found of the shields and what the outbox holds —
with **Sign in**, **Sign out**, **Allow Screen Time**, **Join** (a class's code), **Scan** (the
block, read over NFC: B6), **Read block code** (read only), **Tap** (a block's tag, typed — rounds
1–3), **Emergency Unlock** and **History** in their place.

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

Bali's own shield, "Focused with Bali until 9:42", is round 3's (B5c), below.

### Round 2 (B5b): the bell with the app closed

After round 1, on the same build and phone: signed in, Screen Time allowed, the class joined, and
`npm run dev:teacher -- watch` running. "Force-quit" is swiping the app away in the app switcher.
The readout's `Monitor:` lines say what the DeviceActivity monitor did at its last three wakes,
newest first — the time, which window woke it, what it did, and how long it took — since the
monitor can show nothing itself. The windows (B5b-3): `bell`, the one the app registers for the
bell; `backup`, registered beside it and ending two minutes later, in case the bell's wake is lost;
and `tick` and `tock`, the ones the monitor asks for itself, in turn — never the one that woke it,
since on iOS 18 asking for that one can hang the monitor. A wake that takes the shields off says
`cleared`; one that finds them off already — the backup, after the bell's wake — says
`nothing to clear`; one iOS ended before it finished stays `not finished`. Should iOS refuse the
monitor its next wake, the `Screen Time:` line says so from the next open, unless a later wake
ended well: `the monitor's bell NOT scheduled at <time>, app closed`. Its `bell NOT scheduled` is
a window the app asked for — the bell's or its backup — refused, and asked for again.

**"Within a minute after the bell"** below is when iOS wakes the monitor at the end of its window,
the first whole minute on or after the bell. If iOS wakes it early, before the bell, the monitor
keeps the shields and asks to be woken again the next whole minute on: they come off less than
_two_ minutes after the bell, and that second wake's line is `tick`'s. Two minutes after the bell's
window, the backup wakes the monitor too — after the bell's wake, it finds nothing to clear.

1. **The window is registered.** `npm run dev:teacher -- start 20`, then **Tap** with
   `DEVICE-CHECK-1`: `shields on, due until` the bell, and no `bell NOT scheduled` on that line.
2. **Force-quit, the bell — Phase 0's question.** Force-quit the app while shielded and leave the
   phone until the bell. Within a minute after the bell, with the app still closed, blocked apps
   open again; `watch` showed the student silent a minute and a half after the force-quit, then
   the session over. Open the app: `Monitor: <a time within a minute after the bell> · bell ·
   cleared ·` and a fraction of a second — opened two minutes after that or later, with
   `<that time plus two minutes> · backup · nothing to clear ·` above it — and no
   `bell NOT scheduled` on the `Screen Time:` line.
3. **A window shorter than iOS's 15-minute floor.** `start 15`, wait 5 minutes, **Tap** (10
   minutes left), force-quit: as step 2 — off within a minute after the bell, `bell · cleared`.
4. **An Emergency Unlock cancels the windows.** `start 15`, **Tap**, **Emergency Unlock**,
   force-quit: the apps stay open, and after the bell, and two minutes on, the `Monitor:` lines are
   still step 3's — nothing woke it.
5. **An extension moves the windows.** `start 15`, **Tap**, then `npm run dev:teacher -- extend 10`
   with the app open until the next check-in moves `due until` 10 minutes on (still no
   `bell NOT scheduled`). Force-quit: still shielded past the first bell, and nothing woke the
   monitor then; off within a minute after the new one, `bell · cleared`.
6. **A lost wake: the backup clears (B5b-3).** `start 15`, **Tap**, turn on **Lose the bell's next
   wake (device check)**, and force-quit. At the bell the apps stay shielded — the monitor does
   nothing at the bell's wake, as if it had died there — and two to three minutes after the bell
   they open, the app still closed. Open the app: `Monitor: <that time> · backup · cleared ·` and a
   fraction of a second, above `<the bell's wake> · bell · lost on purpose (device check) — nothing
   done`, and the toggle off again: it loses one wake only.
7. **Decision 7's cap with the app closed.** With no session running, turn on **Cap a tap at 15 min
   (device check)**, turn on Airplane Mode, and **Tap**: `due until` the tap's time plus 15 minutes
   (the floor, not 50). Force-quit: within a minute after that time the apps open, the tap never
   answered. Open the app, still in Airplane Mode: `Monitor: … · bell · cleared`,
   `Standing: in no session`. Turn the cap off and Airplane Mode off: the tap is answered armed —
   `Standing: waiting for the teacher's Start` — and a `start` today would join it, so run this
   step last.
8. **The monitor never stalls.** Every `Monitor:` line above took a fraction of a second, never the
   2-second bound on its whole open and read of the file, and none says `not finished`; and the
   app, opened straight after each wake, started normally — no `The outbox could not be opened`, no
   `storage failed`. A wake that could not read the file says `file not read — kept, again <time>`,
   and the monitor tries again a minute on, as `tick` or `tock`.

### Round 3 (B5c): Bali's own shield

After rounds 1 and 2, on the same build and phone, `npm run dev:teacher -- watch` running. The shield
extension draws Bali's shield each time iOS asks for one, from where the phone stands in the outbox
file: D1's colours, the ring mark and the words are Bali's; the font, sizes and layout are iOS's. The
bell is written as the phone writes a time — `9:42 AM`, or `09:42` with 24-Hour Time on.

1. **Tapped in: the bell.** `npm run dev:teacher -- start 20`, **Tap** with `DEVICE-CHECK-1`, then
   open any blocked app: Bali's shield, light even with the phone in dark mode, never iOS's own — the
   ring mark (a green arc open at the upper left, on a pale green track), the title
   `Focused with Bali until` and the bell, and under it "This app is paused for class. Calls,
   FaceTime, Messages and Emergency SOS always work. If you need out, Emergency Unlock is always in
   the Bali app." **OK**, white on dark green, closes the app. Then `npm run dev:teacher -- extend 10`:
   once a check-in has moved `due until`, a blocked app says the new bell. If it still says the old
   one, iOS keeps a shield's words until the shields change — note it: that is a follow-up.
2. **After Emergency Unlock: no shield.** **Emergency Unlock**: every app opens, with no shield at
   all, Bali's or iOS's.
3. **A tap not yet answered: no time.** Turn on Airplane Mode and **Tap**: shielded at once, and a
   blocked app says `Focused with Bali — waiting for your class`, with no time — the phone has not
   heard the bell. Airplane Mode off: once `watch` shows focused, a blocked app says
   `Focused with Bali until` and the bell again (if it still waits, the same note as step 1).

### Round 4 (B6): the block, read over NFC

After rounds 1–3, on B6's build and the same phone: signed in, Screen Time allowed, the class
joined. The readout's `Outbox:` line lists what the phone has queued and not yet had answered —
`empty` when nothing is — and **History** shows the student's latest moments, newest first.

**What a block is.** A Bali block is the code written on it: ten letters and digits, in an NFC
Text record — as v2's teacher app wrote every block (`T7XK2M9QPF`) — or at the end of a link,
`bali://t/<code>` or `https://…/t/<code>`. The chip's own id is not used. So any NFC sticker becomes
a block once written with such a code: in an NFC writer app (NFC Tools: Write → Add a record → Text),
ten letters and digits, `BALIDEVCHK` say.

1. **Register your block on dev.** Tap **Read block code** and hold the top of the iPhone to the
   block: iOS's sheet says `Bali block read`, and the readout's last line
   `block <CODE>: read only, nothing recorded` — its ten letters and digits — with `Outbox: empty`.
   On the Mac: `npm run dev:teacher -- block <CODE>` prints `block <CODE> is yours` (its "type it
   into the phone's Tap field" is for rounds 1–3's typed tag: this one is scanned). If the readout
   says `not a Bali block — nothing recorded`, nothing on it is a code: write one as above and read
   it again.
2. **A real scan.** `npm run dev:teacher -- start 20`, then `npm run dev:teacher -- watch`, left
   running. **Scan** and hold the phone to the block: `block <CODE>: tap recorded`, then
   `Standing: focused until` the bell, `shields on, due until` the bell, `Outbox: empty` once the
   tap is answered; `watch` shows the student focused, and a blocked app shows Bali's shield with
   the bell.
3. **Scanned with no signal, then Emergency Unlock before the answer.** Turn on Airplane Mode, then
   **Scan** the block: `tap recorded`, still shielded — `due until` 50 minutes on, the unanswered
   tap's cap (decision 7) — and `Outbox: tap`. **Emergency Unlock**: `recorded`, and the shields are
   off at once — `shields off`, every app opens — `Standing: unlocked until` the bell,
   `Outbox: tap · unlock under its tap`. Airplane Mode off: at the outbox's next try — within two
   minutes, its backoff — `Outbox: empty`, still `unlocked`, and the shields off throughout: they
   never come back on between the tap's answer and the unlock's. `watch` shows the student
   unlocked, and **History** begins `unlock <time> · tap_in <time> · tap_in <time>`: the unlock,
   filed under the tap just made, which joined first, then step 2's tap.
4. **A tag that is not a Bali block.** Any other NFC sticker or tag — one holding a web link, or a
   blank one — **Scan**: `not a Bali block — nothing recorded`, `Outbox: empty`, the standing and
   the shields as they were, and nothing new in `watch`.
5. **A scan cancelled.** **Scan**, then **Cancel** on iOS's sheet, holding it to nothing:
   `scan cancelled — nothing recorded`, `Outbox: empty`, nothing else changed.
6. **A scan that joins no class, then Emergency Unlock before its answer (B6b, the owner's
   ruling).** Write a second sticker with ten letters and digits no teacher registered —
   `BALINOCLAS`, say — as in "What a block is". In a running session, focused with step 2's block,
   turn on Airplane Mode and **Scan** the new sticker: `tap recorded`, still shielded. **Emergency
   Unlock**: `recorded`, the shields off at once, `Outbox: tap · unlock under its tap`. Airplane
   Mode off: the scan is refused — its block is no one's — and within two minutes
   `Outbox: tap (stuck: 404)`: the unlock went under the scan, kept with no class, and again to the
   class you are in. The shields stay off throughout, `watch` shows the student unlocked — the
   class's grid sees the unlock — and **History** begins `unlock`.

Emergency Unlock over a standing the phone cannot read back (B6b) has no step here: a phone cannot
be made to lose its standing by hand, so the tests cover it.

## CI

The **iOS** workflow (`.github/workflows/ios.yml`) runs on every PR that touches `ios/`: it
generates the project, builds the app for the iOS Simulator with signing off, and runs the app's
own tests (`BaliTests`, hosted in the app) and `BaliCore`'s and `BaliOutbox`'s on an iOS
Simulator. Both packages' tests also run on Linux on every PR ("BaliCore Swift tests (Linux)" in
`ci.yml`); on Linux, GRDB builds against the system SQLite, so `BaliOutbox` needs
`libsqlite3-dev` there.
