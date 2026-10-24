# Bali for iOS

The student app and its two extensions, `BaliCore`, the Swift package they share, and
`BaliOutbox`, the student's outbox and the sync engine that drains it (`docs/ARCHITECTURE.md`,
"iOS app structure").

| Folder         | What it is                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `project.yml`  | The Xcode project, as [XcodeGen](https://github.com/yonaskolb/XcodeGen)'s spec                                         |
| `Bali/`        | The app, `com.bali.Bali` — its screens (C1–C6, `Bali/UI/`) over `Phone`, which starts the sync engine and the enforcer |
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
phone's sign-in"). In a Debug build, the device check's readout sits behind the **Readout** button
at the top right of every screen, in a sheet — the engine's link to the API, when the server last
answered, whether someone is signed in, where the phone stands, what rule 3's check found of the
shields and what the outbox holds — with **Sign in**, **Sign out**, **Allow Screen Time**, **Join**
(a class's code), **Scan** (the block, read over NFC: B6), **Read block code** (read only), **Tap**
(a block's tag, typed — rounds 1–3), **Emergency Unlock** and **History** beside the screens. A
screen a later step draws shows a placeholder naming that step meanwhile. A Debug build launched
with `-bali-screen <name>` — `xcrun simctl launch booted com.bali.Bali -bali-screen signIn` — shows
that named state with no server, frozen (`Bali/UI/PreviewFixtures.swift` lists the names); with
`-bali-intro-page 1` or `2` beside `-bali-screen intro`, the intro opens on its second or third page.

NFC and Screen Time shields need a real iPhone, which is why B5 and B6 are device checkpoints;
the simulator only proves it builds. Family Controls works in development builds already —
Apple's distribution entitlement, which TestFlight and the App Store need, was granted for
the app and both extensions (2026-09-24).

## To run it on your iPhone: B5's device check

A Debug build, run from Xcode as above, against dev. `docs/PLAN-ARCHIVE.md`'s B5 step keeps the
same list and its status.

**Set up once, on dev.** A session needs a teacher, a class, a block and a student. The teacher's
side is `npm run dev:teacher`, from a checkout on your Mac (`npm ci` once): it signs in as the exit
demo's teacher, with the demo's variables and `.env.demo` (README, "Running it against a deployed
API"), and never prints a credential.

```sh
set -a; . ./.env.demo; set +a
printf 'demo password: ' && read -rs DEMO_PASSWORD && echo && export DEMO_PASSWORD
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
7. **Allow Screen Time**: iOS asks for Face ID or the passcode; then `Screen Time: approved` and
   `Marker: present` (F1b). Installed over an earlier build with access already allowed, nothing is
   asked: opened, `Asked iOS:` shows one line no press made — Bali's silent check, `given in` a few
   hundredths of a second, with no prompt on screen — and `Marker: present`.
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
12. Settings → Screen Time → Apps with Screen Time Access (or Bali's own page in Settings) → turn
    Bali off, and go back to the app **without closing it**. A running Bali still reads `approved`
    (#144: `iOS: Family Controls reads Approved`), so it judges by its marker (F1b): as it comes
    back to the front, `Marker: MISSING — access taken back`,
    `Screen Time: notDetermined · shields off`, the Screen Time off screen with **Turn on Screen
    Time**, and within seconds `watch` shows **protection off** — with no relaunch. The blocked
    apps open (iOS dropped the shields), and `Screen Time:` never says `shields on` again until
    access is back: Bali puts none back over a missing marker. Run it three times, a 50-minute
    class (`-- start 50`): in front with more than 15 minutes to the bell, in front within the last
    15, and with Bali behind for a minute, then opened — the same each time. Note in #144 how long
    after Bali came to the front **protection off** showed on `watch`.
    **Turn on Screen Time**: iOS's prompt appears; **Allow**: a new `Asked iOS:` line, `given in …`,
    `Marker: present`, and, with no tap (#167), the Screen Time off screen gives way to Focus at
    once: `Standing: focused`, `shields on`, `iOS:` holding `bali` to the bell again, and within
    seconds `watch` shows the student **focused**; the readout's `Outbox:` lists
    `Screen Time back on` until it is answered. Bali's History shows **Screen Time off**, then
    **Screen Time back on**. Watch `Marker:` for a minute: it must stay `present` (iOS empties the
    stores as access comes back; a marker emptied after it was written would read as access taken
    back again). Next time, press **Turn on Screen Time** twice quickly: one prompt, one new
    `Asked iOS:` line, no error under the button, and one `Screen Time back on`.
    **Then unlocked (#167):** **Emergency Unlock**, then turn Bali's access off in Settings and go
    back to Bali: the Screen Time off screen, its second step "Bali puts you back in class by
    itself"; **Turn on Screen Time** → **Allow**: still unlocked — the apps stay open, Unlocked's
    screen with **Lock my apps again** and "Want to say why?" as before (a pick saves) — and
    `watch` shows **unlocked**, never focused.
    **Then a launch with access off (#145):** focused again, swipe Bali away, turn its access off in
    Settings and open Bali: the Screen Time off screen at once — no "Checking Screen Time…" wait —
    and `watch` shows **protection off** within seconds. Turn access back on in Settings and press
    **Turn on Screen Time** in Bali (iOS answers with no prompt): focused again, no tap (#167).
    **Then through the bell with Bali closed (the monitor's note):** `-- start 20`, **Tap**, swipe
    Bali away, and in the class's last 15 minutes (the bell's window running) turn its access off;
    open Bali only after the bell: `Marker:` ends `the monitor found it gone at` about when you
    turned it off, and Bali's History shows **Screen Time off** in that class, "Arrived after class
    ended" — the server records a late report so.
    **The marker restricts nothing:** Settings → Screen Time → Content & Privacy Restrictions reads
    as before Bali ran and can be changed, and explicit music still plays.
13. Swipe the app away while shielded, turn on Airplane Mode and open it: still shielded,
    `due until` the bell — a relaunch starts where the phone stood. Airplane Mode off: `watch`
    still shows focused — no false protection off after a relaunch. Swipe it away and open it twice
    more: never a Screen Time off screen nor "Checking Screen Time…" — `Marker: present` decides at
    once — and note in #145 what `Launch:` says each time (Family Controls' own read, which only a
    phone with no marker written yet waits on, for up to 10 seconds).
14. With the app open, the bell (or Ctrl-C on `watch` and `npm run dev:teacher -- end`, found at
    the next check-in) takes the shields off: `Standing: in no session`.
15. **A wait the server has dropped is Home, never Waiting (#166).** A phone still on Waiting from
    an earlier build, opened online: the regular Home within moments — a read says no tap waits.
    With no session running, **Tap**: Waiting, and
    `Standing: waiting for the teacher's Start, until` the coming midnight. Turn on Airplane
    Mode, run `npm run dev:teacher -- start 5` and then `-- end` (the Start takes the waiting tap,
    and the class is then over), and turn Airplane Mode off: with Bali open, within 30 seconds,
    the regular Home with no Waiting card and `Standing: in no session` — the build before kept
    Waiting. **The owner's case:** **Tap** in the evening with nothing running, and leave the
    phone. The next day, open Bali: Home, not Waiting. `-- start`: the phone does not lock, and
    Home's card says "Device check is in session. Tap your teacher's block to join." — **Tap in**
    locks it. **Offline:** the same evening tap, then Airplane Mode on before opening Bali the next
    day: Home all the same, by the phone's own clock.

Bali's own shield, "Focused with Bali", is round 3's (B5c, B5c-2), below.

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
`nothing to clear`; one iOS ended before it finished stays `not finished`. iOS also wakes the monitor
the moment the app stops or replaces a window — at an Emergency Unlock, the end, an extension — and
such a wake is like any other: it reads the truth, and with the shields already off says
`nothing to clear` (`docs/DECISIONS.md`, 2026-09-29). One exception, so that the monitor's own wakes
never set each other off (B5b-5): a `tick` or `tock` wake more than a minute before the end the
monitor asked for there is a stop's or a replacement's, never its window's end, and asks for nothing
— `kept — its window stopped or replaced, not ended: nothing asked`. Should iOS refuse the
monitor its next wake, the `Screen Time:` line says so from the next open, unless a later wake
ended well: `the monitor's bell NOT scheduled at <time>, app closed`. Its `bell NOT scheduled` is
a window the app asked for — the bell's or its backup — refused, and asked for again.

**"Within a minute after the bell"** below is when iOS wakes the monitor at the end of its window,
the first whole minute on or after the bell. If iOS wakes it early, before the bell, the monitor
keeps the shields and asks to be woken again the next whole minute on: they come off less than
_two_ minutes after the bell, and that second wake's line is `tick`'s. Two minutes after the bell's
window, the backup wakes the monitor too — after the bell's wake, it finds nothing to clear.

**Short classes work.** Every window is exactly 15 minutes long, iOS's floor, and ends at the bell
rounded up to the whole minute; the backup's ends two minutes after that — a bell at 10:04:00.4 ends
its window at 10:05 and the backup's at 10:07. So a class shorter than 15 minutes starts its window
in the past: steps 3–6 run in 3-minute classes. Steps 1–2's 20-minute class, tapped promptly, starts
it in the future, as a real class does. On dev a class closes within a minute of its bell since A15
(#111), the API's own sweep — verified there: a 1-minute class closed 22 s after its bell, where
Railway's cron had taken minutes. Let `watch` show it over before the next `start`, which otherwise
hands the old session back.

1. **The window is registered.** `npm run dev:teacher -- start 20`, then **Tap** with
   `DEVICE-CHECK-1`: `shields on, due until` the bell, and no `bell NOT scheduled` on that line.
2. **Force-quit, the bell — Phase 0's question.** Force-quit the app while shielded and leave the
   phone until the bell. Within a minute after the bell, with the app still closed, blocked apps
   open again; `watch` showed the student silent a minute and a half after the force-quit, then
   the session over. Open the app: `Monitor:` shows
   `<a time within a minute after the bell> · bell · cleared ·` and a fraction of a second —
   opened two minutes after that or later, with
   `<that time plus two minutes> · backup · nothing to clear ·` above it — and no
   `bell NOT scheduled` on the `Screen Time:` line.
3. **A class shorter than iOS's 15-minute floor.** `start 3`, **Tap** (its window starts in the
   past), force-quit: as step 2 — off within a minute after the bell, `bell · cleared`.
4. **An Emergency Unlock cancels the windows.** `start 3`, **Tap**, **Emergency Unlock**,
   force-quit: the apps stay open. The unlock's stop of both windows wakes the monitor at once:
   `<the unlock's time> · bell · nothing to clear ·` and the same for `backup`, each a fraction of a
   second. After the bell, and two minutes on, those are still the newest `Monitor:` lines —
   nothing woke it since.
5. **An extension moves the windows.** `start 3`, **Tap**, then `npm run dev:teacher -- extend 3`
   with the app open until the next check-in moves `due until` 3 minutes on (still no
   `bell NOT scheduled`). Force-quit: still shielded past the first bell, and nothing woke the
   monitor then; off within a minute after the new one, `bell · cleared` — with a `tick` or `tock`
   line beside it, `nothing to clear`: moving the windows at the check-in woke the monitor there,
   and it asked for that extra wake (`docs/DECISIONS.md`, 2026-09-29).
6. **A lost wake: the backup clears (B5b-3).** `start 3`, **Tap**, turn on **Lose the bell's next
   wake (device check)**, and force-quit. At the bell the apps stay shielded — the monitor does
   nothing at the bell's wake, as if it had died there — and two to three minutes after the bell
   they open, the app still closed. Open the app: `Monitor: <that time> · backup · cleared ·` and a
   fraction of a second, above
   `<the bell's wake> · bell · lost on purpose (device check) — nothing done`, and the toggle off
   again: it loses one wake only.
7. **Decision 7's cap with the app closed.** With no session running, turn on **Cap a tap at 15 min
   (device check)**, turn on Airplane Mode, and **Tap**: `due until` the tap's time plus 15 minutes
   (the floor, not 50). Force-quit: within a minute after that time the apps open, the tap never
   answered. Open the app, still in Airplane Mode: `Monitor: … · bell · cleared`,
   `Standing: in no session`. Turn the cap off and Airplane Mode off: the tap is answered armed —
   `Standing: waiting for the teacher's Start` — and a `start` today would join it, so run this
   step last.
8. **The monitor never stalls.** Every `Monitor:` line above took a fraction of a second, never the
   2-second bound on its whole open and read of the file, and none says `not finished`; and the
   app, opened straight after each wake, started normally — no `Bali couldn't open its storage`, no
   `storage failed`. A wake that could not read the file says `file not read — kept, again <time>`,
   and the monitor tries again a minute on, as `tick` or `tock`.
9. **Two extensions in one class: the monitor's own wakes never set each other off (B5b-5).**
   Before step 7, which runs last. `start 3`, **Tap**, then `npm run dev:teacher -- extend 3` with
   the app open until the next check-in moves `due until`, then `extend 3` again and another
   check-in, then force-quit: still shielded past both earlier bells; off within a minute after the
   last, `bell · cleared` — any `tick` or `tock` line beside it says `nothing to clear`. After each
   check-in the newest `Monitor:` lines are the check-in's — `bell`, `backup`, perhaps a `tick`
   saying `nothing asked`, a stop's wake — and a few seconds later (switch away from Bali and back)
   they are the same: never `tick` and `tock` lines ticking on, one after another, each
   `kept until` the bell.

### Round 3 (B5c): Bali's own shield

After rounds 1 and 2, on the same build and phone, `npm run dev:teacher -- watch` running. The shield
extension draws Bali's shield each time iOS asks for one, with the same words whatever the phone
stands in: it reads nothing — iOS's sandbox refuses a shield extension the outbox file (B5c-2) — and
never shows a time; Bali does. D1's colours, the ring mark and the words are Bali's; the font, sizes
and layout are iOS's.

1. **Tapped in: Bali's shield.** `npm run dev:teacher -- start 20`, **Tap** with `DEVICE-CHECK-1`,
   then open any blocked app: Bali's shield, light even with the phone in dark mode, never iOS's own —
   the ring mark (a green arc open at the upper left, on a pale green track), the title
   `Focused with Bali` with no time, and under it "This app is paused for class. Calls, FaceTime,
   Messages and Emergency SOS always work. Open Bali to see when class ends. Emergency Unlock is
   always there." **OK**, white on dark green, closes the app. Then `npm run dev:teacher -- extend 10`:
   a blocked app says the same — the new bell is Bali's to show.
2. **After Emergency Unlock: no shield.** **Emergency Unlock**: every app opens, with no shield at
   all, Bali's or iOS's.
3. **A tap not yet answered: the same words.** Turn on Airplane Mode and **Tap**: shielded at once,
   and a blocked app says `Focused with Bali` and the same line, with no time. Airplane Mode off: once
   `watch` shows focused, the same words.

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

## Phase 7's phone sitting, on prod: C7, L8, M8 and M8b, then L9, M10 and W6

One sitting on TestFlight build 10 (prod, from `1d4496b6`), the owner's iPhone and the prod portal. It covers
C7's first-launch check, L8's, M8's and M8b's device checks, and the three exit checks. Everything happens
on prod: the answers you give are real records there, so use your own accounts and your own class.

**Before you start, once:**

- Install build 10 from the TestFlight app once Apple has processed it.
- On a laptop, keep two windows open on `https://bali-portal.vercel.app`: your prod teacher account in
  one, and your prod student account in a second browser profile for W6.
- Upload a real lesson deck on the portal's **Your slides**: a PDF exported with photos, 10–25 MB and
  200 pages at most. Prod's deck bucket is already in the portal's security header, so the browser
  accepts the upload.
- Have your prod block, the sticker, at hand.

### Part 1 — C7: the first launch

**Starting state:** no class running. Bali is deleted from the phone, then build 10 is installed fresh from
TestFlight. Airplane Mode is off. You won't need the sticker.

1. Open Bali: **Sign up or sign in**. Tap **Sign up**: **When were you born?**, both menus on
   **Choose**. Pick a month and year 13 or more years ago, then **Continue**. The intro's pages follow,
   and its last button opens prod's sign-up page. Close that page without signing up: you're back on
   Sign in, and nothing was kept.
2. Tap **Sign in** and sign in with your prod student account. There's no birth question, because Bali's
   server already holds your yes. If you're in a class, **Your teacher can ask questions now** shows
   once: tap **Continue**. Then the Screen Time ask (allow it) and Home, which lists your class.

**Check:** the birth question comes only with Sign up; Sign in goes straight through; the one-time screen
shows once and never again after a relaunch.

### Part 2 — L8: a locked phone answers

**Starting state:** your class is running on prod (tap the block, or press Start on the portal). You're
tapped in and Focused, with your apps locked. Bali is open on Focus. Airplane Mode is off. The sticker is
your prod block.

1. On the portal's class page, under **Questions and slides**, write a question with 4 options, mark one
   correct, and **Ask**. Within about 2 seconds the phone's big ring becomes a strip (the time left and
   **Focused**), the question card appears under it, and **Emergency Unlock** stays pinned at the
   bottom.
2. Tap **B**: "Your answer is in." Tap **C**: your answer moves to C. The portal says 1 answered, and
   shows no breakdown under 3 answers.
3. On the portal, close the question with the answer shown. The phone marks the correct option with a
   check and C as **Your answer**. Nothing is red, and there's no X. Tap **Hide**: the card goes and
   the ring comes back.
4. Ask a second question. While it's open, hold **Emergency Unlock** for 1 second: you're unlocked at
   once, and Unlocked shows the card above **Want to say why?**. Answer from there, then **Lock my apps
   again**.
5. Turn on VoiceOver and swipe through the card. Each option reads its letter and its text, yours reads
   **Your answer**, and the strip reads the time left. Turn VoiceOver off.
6. **Battery:** set Auto-Lock to Never and note the battery level. Keep Bali open on Focus with a question
   showing for 30 minutes, then note the level again. Bali checks for questions every 2 seconds only
   while it's on screen.

**Check:** no phone screen shows a count or who answered; an answer changes until the close; nothing is
ever red.

### Part 3 — M8 and M8b: slides

**Starting state:** your class is running, you're tapped in and Focused, Bali is open on Focus, and
Airplane Mode is off.

1. On the class page, tap **Show slides**, pick your deck, page 1. The phone shows **Slide loading**,
   then the page. Pinch to zoom. Page forward and back on the portal: the phone follows within about 2
   seconds.
2. On a photo-heavy page, watch for any stutter while it draws. Hold **Emergency Unlock** just as a new
   page arrives: the hold still takes 1 second, no longer. Then **Lock my apps again**.
3. With VoiceOver on, the slide reads its page's words. A page with no words says which slide it is.
4. Ask a question while a slide shows: the question comes first, the slide under it. Tap a link inside
   the PDF, if it has one: nothing opens.
5. Unlock (hold for 1 second). Unlocked shows the card, then the slide. **Lock my apps again**.
6. Show a different big deck and lock the phone at once; unlock it 10 seconds later. The slide is
   there, or "Bali couldn't load the slides." with **Try again**, which loads it.
7. Switch between two big decks 3 or 4 times: no crash and no slowdown.
8. Sign out and sign in again: the slide loads again, because the deck was dropped at sign-out.

**If a second iPhone is around:** run step 1 on both phones at once, on the same Wi-Fi. That checks a big
deck against the 30-second limit on one access point.

### Part 4 — the exit checks: L9, M10, W6

**Starting state:** your class is running on prod, with your phone tapped in and Focused. On the laptop,
the teacher's class page is in one window. Your student is in the other, on the lesson page (the student
home's **Open the lesson**). Airplane Mode is off.

1. **L9:** ask a question, answer it on the phone, close it with the answer shown, then **End** the
   class. Check: the class page and Present never name who answered, and the session's report page shows
   the question's totals only. Under 3 answers, that's "N answered" with no breakdown.
2. **M10:** show a deck and page through it. The phone and the student web both follow.
3. **W6:** at each change, your chip on the student web matches your tile on the teacher's grid.
   Focused; unlock on the phone, and both say Unlocked; lock again, and both say Focused.

With one student, you, these checks prove the parts work end to end. A class with several students, the
pilot's own, is the full exit check.

## CI

The **iOS** workflow (`.github/workflows/ios.yml`) runs on every PR that touches `ios/`: it
generates the project, builds the app for the iOS Simulator with signing off, and runs the app's
own tests (`BaliTests`, hosted in the app) and `BaliCore`'s and `BaliOutbox`'s on an iOS
Simulator. Both packages' tests also run on Linux on every PR ("BaliCore Swift tests (Linux)" in
`ci.yml`); on Linux, GRDB builds against the system SQLite, so `BaliOutbox` needs
`libsqlite3-dev` there.
