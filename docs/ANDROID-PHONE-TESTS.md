# Bali for Android — the phone tests

The checks only Android phones can answer, the twin of `ios/README.md`'s device checks: AN1's
part 2 and the device gate, AP3 (`docs/PLAN-ANDROID.md`). Each is 📱, on the owner's Pixel and
Samsung (`docs/PLAN-ANDROID.md`, Open owner items, 1), with USB debugging on, driven from the PC
whose clone is `C:\dev\bali` (GOTCHAS, "Android's SDK on Windows"). A phone test opens every part
with its starting state (CLAUDE.md, the owner's standing orders): the phone and its Android version,
the class, focused or unlocked, the screen, Airplane mode, the sticker.

## AN1, part 2: lock (a) on the phones

Part 1's lines again on both phones, from the spike (`spike/android-lock`, its README's "Part 2, on
the phones"): a real block read over NFC with Bali open and closed, the Samsung's battery saver and
its in-call screen (`com.samsung.android.incallui`), Doze with a CPU that sleeps, and every other
line of AN1. Lock (a) alone: (b) is dropped and (c) left out (`docs/DECISIONS.md`, 2026-11-04). Then
the battery test below, which measures the battery plan (ARCHITECTURE, "Android app structure").

### The battery test

From the battery research of 2026-11-04 (`docs/DECISIONS.md`, 2026-11-04): its runs, its pass marks
and its makers' checks.

**First, in the spike:** the battery plan as AN7 will build it, each part with a switch so a run can
turn it off. Check-ins by the screen (every 30 s while it is on, one as it goes off, one as it comes
on) in place of the spike's 30-s tick, which no run uses; the service subscribing to nothing outside
a lesson and to window events in one, with no node read (its `window.root` fallback gone); and the
covered app sent to the background.

**Setup:**

- Install the spike's lock (a) with `adb install`.
- Each run twice: first with check-ins off, to measure the lock alone; then with check-ins by the
  screen, to price them.
- Every run the same: Wi-Fi (R2 once more on cellular), brightness at 50% with adaptive brightness
  off, the always-on display off, the battery between 50 and 90%, and no cable and no adb while it
  runs. Each opens with its starting state: the phone and its Android build, a session or none, the
  screen, Airplane mode off, Wi-Fi or cellular, the battery %, and the Samsung's sleeping lists.
- R1 and R2 run as pairs, back to back: A with the service on and no session, B with a session.
  Bali's cost is B minus A. R3 runs once, as B, judged on Bali's own numbers.

**Before each run:**

```sh
adb shell dumpsys batterystats --enable full-wake-history
adb shell dumpsys batterystats --reset
adb shell "dumpsys battery | grep -iE 'level|counter'"   # the charge counter (µAh): note it
```

Then start the fake session and unplug.

**The runs:**

- **R1, a desk lesson (50 min):** the screen off, the phone lying still. At minute 10, wake it, open
  a blocked app (is it covered?) and turn the screen off again. The same at minute 48: the lock after
  the deepest Doze the lesson reached.
- **R2, a busy lesson (50 min):** the screen on for about 35 minutes. Every 2 minutes, open a blocked
  app, switch to Messages, scroll, and go home.
- **R3, a school day (about 4 h):** four lessons, R1, R2, R1 and R2, with 10 minutes of screen off
  between them.

**After each run,** plugged in:

```sh
adb shell "dumpsys battery | grep -iE 'level|counter'"
adb shell dumpsys batterystats <pkg> > bs-<phone>-<run>.txt
adb shell dumpsys batterystats --checkin > bs-<phone>-<run>.csv
adb shell "dumpsys alarm | grep -A4 <pkg>" ; adb shell "dumpsys jobscheduler | grep -A12 <pkg>"
adb shell am get-standby-bucket <pkg> ; adb shell dumpsys procstats --hours 5 <pkg>
adb shell "dumpsys accessibility | grep -iA6 <pkg>"
adb bugreport bugreport-<phone>-<run>.zip
```

**Reading the numbers:**

- Bali's block in `bs-*.txt`: wake locks, wakeup alarms, jobs, foreground services, Wi-Fi and mobile
  bytes, total CPU, and its line under "Estimated power use (mAh)".
- Doze: the phone's "Device light idling" and "Device full idling" lines.
- Check-ins: the tick host's log, by time, shows whether anything was sent between a screen-off and
  the next screen-on.
- Bali's process state, once, with the cable in: `adb shell "dumpsys activity processes <pkg> | grep
  -i procstate"` with the screen on, then again 30 s after it goes off. It should drop.
- On the Pixel: Android Studio's Power Profiler on R2's A and B (its readings are the whole phone's).
- Battery Historian is unmaintained and may not read a 16 or 17 bugreport: read `bs-*.txt` instead.

**Pass marks, every run.** The research's proposals, not yet measured: the owner confirms them with
the numbers.

- Background work: no wake lock, wakeup alarm or foreground service, and no job unless a record was
  waiting. Android warns at an hour of wake locks and Play at two a day; Bali's bar is none.
- Network: nothing between a screen-off and the next screen-on, but the one screen-off check-in when
  check-ins are on.
- CPU: under 2 s in R1, and under a minute per hour of screen-on in R2.
- Energy, by the charge counter: B minus A at most half a point of battery in R1 and one point in
  R2; Bali's own estimate at most 0.1% of the battery in R1, 0.5% in R2 and 1% in R3. For scale, an
  idle phone loses about 0.5–1% an hour, and Doorman's users report about 2%.
- Doze and buckets: R1's B run reaches light and deep Doze as its A run does; Bali's bucket stays
  `active` or `working_set`; the Samsung doesn't put Bali in Sleeping; and no battery warning shows.

**The makers' checks,** each mid-session with Bali closed, then undone:

- Samsung: Optimize now; Memory's Clean now; Power saving on; Bali put in Sleeping, then in Deep
  sleeping; its battery set to Restricted (or `adb shell cmd appops set <pkg> RUN_ANY_IN_BACKGROUND
  deny`); `adb shell am set-standby-bucket <pkg> restricted`; and an update over itself
  (`adb install -r`).
- Pixel: Battery Saver; Restricted; the restricted bucket; and hibernation, by Google's steps, which
  must not happen while the lock is on.

After each: is the blocked app still covered? Is Bali's switch still on, and the service bound in
`dumpsys accessibility`? Does the protection-off detector say the right thing? Once FCM exists
(AN11, AN12), does a push still arrive?

### The phone questions beside it

From the same research, on both phones unless a line says otherwise.

- **The two conflicts first.** Deep Doze's timing: `dumpsys deviceidle` prints the constants in
  force, in a plain lesson and under Battery Saver, beside the ticks' `sleptMs` and `gapMs`. And
  whether the bound service keeps its network in Doze: `dumpsys activity processes <pkg>` and
  `dumpsys netpolicy` while the phone is asleep.
- **The CPU asleep in a lesson,** the service widened: `sleptMs` above 0 in the ticks, and
  batterystats' wakeups for Bali's uid (the Power Profiler on the Pixel, Perfetto's battery counters
  on the Samsung).
- **A day's cost,** a day each with the switch off, with the service narrowed, and as part 1's spike
  ran: Bali's CPU in batterystats, the calls into Bali in a Perfetto binder trace, and `dumpsys
  accessibility` showing the narrowing took.
- **The cache's event stream:** read one node, call `setServiceInfo`, scroll Chrome, and count the
  calls into Bali; again with packageNames [Bali], and with `setCacheEnabled(false)`.
- **The screen kept on:** play YouTube, start a lesson, put the phone down. Does the screen time
  out? `dumpsys window` (`mHoldScreenWindow`), `dumpsys power`, and `dumpsys gfxinfo <pkg>` for
  frames drawn under the cover; with the covered app sent to the background, and without.
- **The cover's delay** at a `notificationTimeout` of 0, 50 and 100 ms, timed as part 1 timed it.
- **Battery settings,** Restricted and the Samsung's sleeping lists: is the service still bound, does
  a lesson still cover, does a push still arrive?
- **Other apps' cost:** a scripted Compose scroll, with Bali's switch on and off.
- **Check-ins by the screen against a control,** a 30-s check-in held by a foreground service and a
  wake lock: on Wi-Fi and on LTE, one script (45 minutes of screen off, 5 on), three runs each.
- **The Samsung's app killers over a school day:** `ApplicationExitInfo`'s reasons, gaps in the
  check-ins, and whether the service stays on.
- **Timings:** from screen-on to a landed check-in after 45 minutes asleep, on Wi-Fi and on LTE.
- **Later, once the app has them:** the TLS handshakes a lesson costs (OkHttp's `EventListener`,
  AN5), and the doorbell's delay in deep Doze and with notifications off (AN11, AN12).
- **Lock (c), only if it comes back:** tun0's `tx_dropped` in `/proc/net/dev`, a blocked app's
  retries with the tunnel unread against answered, how long DNS takes to fail, and what Settings'
  battery screen blames.

## AN6c, sign-in on the phones

What the emulator couldn't show (`docs/DECISIONS.md`, 2026-11-05, AN6c): its Chrome 124 has neither
the Auth Tab nor ephemeral tabs, and stops at its first run. Once the owner has made Android's dev
client and its id is in the build (`docs/DEPLOY.md`, "The phone's sign-in"), and a screen or AN7's
readout starts a sign-in, on both phones, each with its browser and that browser's version noted.
Until AN6e lands, sign in only where the phone's Chrome is 136 or later: an older one shares its
cookies with the tab, so Cognito's session stays there for another app to use (`docs/DECISIONS.md`,
2026-11-13).

- **Sign up, then sign in**, through the hosted UI: which tab opens (an Auth Tab on Chrome 137 and
  later), and Bali signed in after.
- **Sign out, then sign in again:** the password asked again where the tab was ephemeral; where the
  browser has no ephemeral tab, whether the hosted UI skips it (its cookies kept, the conductor's
  call).
- **The tab closed with no sign-in:** nothing said, and Sign in works again.
- **The phone rotated while the tab is open,** then the sign-in finished: signed in.
- **Bali relaunched:** still signed in; **reinstalled:** signed out.

## AN7, the lock on the phones

AN7f's device check (`docs/PLAN-ANDROID.md`), on both phones, a Debug build on each, offline before
AN9 and on dev after it (`docs/DECISIONS.md`, 2026-11-05, Q8). AN7c, AN7d and AN7e each add what the
emulators couldn't answer, and AN7f adds B5 round 1's steps in Android's terms. On dev, this round and
AN8's sign in as a student account that passed the 13+ check on an iPhone: the yes is kept per account, on
the server, and the readout has no 13+ button before AS2 (`docs/DECISIONS.md`, 2026-11-05, AN9a's Q7).

**The service (AN7c),** each part opening with its starting state as the header asks; a session's tap
is typed in the Debug readout (AN7d), or scanned from a block (AN8):

- **Safe Mode.** *Start:* in a class, focused, the screen on, Airplane mode off, the service on. The
  service off Android's list after it, as AN1 saw on the emulators, and what Bali reports once the
  student switches it on again and opens Bali (ISSUES #6, gap 1).
- **A reboot.** *Start:* in a class, focused, the screen on, Airplane mode off, the service on, a screen
  lock set. Nothing of Bali's runs before the first unlock, since Android starts a service that isn't
  direct-boot aware only then; after it, how long the service takes to bind, against the 30-s grace
  (Q3; the Debug readout's Launch line, AN7d).
- **A force-stop, and the process killed** (`adb shell run-as com.bali.bali kill -9 <pid>`). *Start:*
  in a class, focused, the screen on, Airplane mode off, the service on. The force-stop takes the
  service off the list until the student switches it on, while Android starts and binds it again by
  itself after a kill, as on the emulators. Note which of the two each maker's own buttons do.
- **Doze over a lesson** (the battery test's R1). *Start:* in a class, focused, the screen on, the phone
  still, Airplane mode off. The screen then off for 50 minutes: one check-in as it goes off, none until it
  comes on, then one at once; the service still bound after; and the network in Doze, as the battery
  test asks.
- **The makers' battery savers** (the battery test's makers' checks). *Start:* in a class, focused,
  Bali closed, the screen on, Airplane mode off. After each, the service still on the list and bound in
  `dumpsys accessibility`, listening to nothing outside a lesson (`eventTypes=` empty) and to the
  window events in one.
- **The restricted-settings install path** (Android 13 and later). *Start:* out of a class, the screen
  on, Airplane mode off, Bali installed from a downloaded APK, not `adb install`, its service off. The
  service switched on in
  Settings: what Android shows, and App info's "Allow restricted settings" (AN1 saw "App was denied
  access").

**The readout (AN7d),** the Debug build's launcher entry, Bali readout (Debug): signed out, its engine
sends nothing (the build signs in on dev since AN6d), so these need no server and no sticker, the tag
typed:

- **A typed tap held offline to its cap.** *Start:* out of a class, unlocked, the readout on screen,
  Airplane mode on, the service on, Cap a tap at 15 min on. A tag typed and Tap: Lock says locked, due 15
  minutes on, and Service listening to the windows. Bali swiped away from recents and opened again: still
  locked, to the same end. At the end, with nothing woken: not locked, listening to nothing. Then a tap
  again and Emergency Unlock: not locked at once.

**The cover (AN7e),** what the emulators couldn't answer (`docs/DECISIONS.md`, 2026-11-05, AN7e); each
lock a typed tap in the readout, as above:

- **The in-call screen.** *Start:* in a class, focused, a blocked app beside the readout in split screen,
  the screen on, Airplane mode off, the service on. A call coming in, then one placed from the dialer: the
  in-call screen and the call's notification never covered, never sent home; on the Samsung, its own
  in-call screen (`com.samsung.android.incallui`) above all, which the allow-list should find as the
  system's in-call screen. The emergency dialer opened from the lock screen and from the power menu,
  never dialled: never covered.
- **Switching Bali off, and removing it.** *Start:* in a class, focused, the screen on, Airplane mode off,
  the service on. Bali's switch in Accessibility settings (on the Samsung, its own Accessibility pages),
  and Bali's uninstall asked and never confirmed: never covered, never sent home (ISSUES #7).
- **Emergency alerts and the Safety app.** *Start:* in a class, focused, the screen on, Airplane mode off,
  the service on. An emergency alert's test message, where the phone offers one, and the Safety app's
  emergency information, opened, SOS never triggered: never covered. On the Samsung, whose alerts app may
  be its own, which Bali finds only if it keeps Android's list of alerts: its alerts list opened from
  Settings, never covered.
- **A contact opened from the Phone app.** *Start:* in a class, focused, the screen on, Airplane mode off,
  the service on. Phone, then a contact: whether the contact's screen is another app's, covered and sent
  home with the Phone app's own task under it.
- **A permission prompt.** *Start:* in a class, focused, the screen on, Airplane mode off, the service on,
  a blocked app never opened. Opened: what shows behind its prompt, and the cover once the prompt is
  answered (ISSUES #6, gap 6).
- **Sound playing on.** *Start:* out of a class, a video app and a music app each playing, the screen
  on, Airplane mode off, the service on. A tap, then each opened: which go quiet once sent home, and a
  video in a split half and in picture-in-picture, which stay covered (gap 4).
- **Launch to cover on hardware.** *Start:* in a class, focused, the screen on, Airplane mode off, the
  service on. Contacts and a video app from Home, three times each, the first cold, against the
  emulators' times (gap 3).
- **A window on screen as the lock comes on.** *Start:* out of a class, a video playing beside the
  readout in split screen, then in picture-in-picture, the screen on, Airplane mode off, the service on.
  A tap: how long each shows before it changes or is touched (gap 3).
- **Advanced Protection through Settings.** *Start:* out of a class, the screen on, Airplane mode off,
  the service on, the Android 17 phone with a screen lock. Advanced Protection switched on in Settings:
  whether the service stays on and still covers, and whether it can be switched on again (gap 7).

The readout's Launch line, how long the service took to bind, is read in the service's reboot part above.
What the readout records with nobody signed in stays queued on the phone, and goes to dev under the
first account signed in there: clear Bali's storage, or uninstall it, before signing in on a phone that
ran these checks.

## AN8, the tap on the phones

AN8's 📱 check (`docs/PLAN-ANDROID.md`), on both phones, a Debug build on each, offline before AN9 and on
dev after it, as AN7's: the readout's Scan reads a block over NFC and taps it, and Read block code only
reads one (`docs/DECISIONS.md`, 2026-11-05, AN8). A block is any NFC sticker holding ten letters and digits
in a Text record, or at the end of a `bali://t/<code>` or `https://<host>/t/<code>` link: `ios/README.md`'s
round 4 says how to write one. Android plays its own sound as it reads a tag. Each part on each phone opens
with the phone and its Android version, then the starting state its *Start* names.

- **The block's code.** *Start:* out of a class, unlocked, the readout on screen, Airplane mode on, NFC on,
  the block's sticker written with a code. Read block code, the back of the phone held to the block: `block
  <CODE>: read only, nothing recorded`, `Outbox: empty`.
- **A real block, offline, in under a second.** *Start:* out of a class, unlocked, the readout on screen,
  Airplane mode on, NFC on, the service on, Cap a tap at 15 min off, the block's sticker. Scan, the phone
  held to the block: `block <CODE>: tap recorded, locked <n> ms after the read`, Lock locked and due 50
  minutes on, `Outbox: Tap`, and a blocked app opened next covered. From the phone touching the block to
  the note, under a second: <n> is Bali's part, the rest Android's read. Three times on each phone, each
  <n> noted.
- **Held on the block after the read.** *Start:* as above, focused by the tap, the phone left on the block's
  sticker for 5 s after the note. Nothing else opens: not the link's browser, nor Android's word that no app
  reads the tag.
- **Airplane mode and NFC.** *Start:* out of a class, unlocked, the readout on screen, Airplane mode off, NFC
  on, the block's sticker. Airplane mode on, then Scan: whether the phone switched NFC off with it, as some
  makers' do (the scan then says `NFC is switched off`), or the block reads.
- **Not a Bali block.** *Start:* out of a class, unlocked, the readout on screen, Airplane mode on, NFC on; a
  sticker holding a web link, a blank sticker, and a bank or ID card. Scan with each sticker: `not a Bali
  block — nothing recorded`, `Outbox: empty`. Scan with the card: the scan goes on, the card passed over as
  iOS's NDEF session passes it, until Home. Then the card kept behind the phone in its case, Scan, and the
  block's sticker touched: whether the block reads, and whether Android's sound repeats while the card
  stays (a card whose id changes at each read can be heard again and again).
- **NFC switched off.** *Start:* out of a class, unlocked, the readout on screen, Airplane mode on, NFC off in
  Settings, the block's sticker. Scan: `NFC is switched off — nothing recorded` at once. Then NFC on, Scan,
  and NFC switched off from quick settings while the scan waits: the same.
- **A scan left.** *Start:* out of a class, unlocked, the readout on screen, Airplane mode on, NFC on, the
  block's sticker, a scan waiting. Home, or the screen turned off: `scan cancelled — nothing recorded`. Back
  in the readout, Scan reads the block again.
- **The block's link with Bali closed** (once AN1's part 2 runs). *Start:* out of a class, unlocked, Bali
  swiped away from recents, the home screen, Airplane mode off, NFC on, the block's sticker with its link.
  The block touched: what opens, if anything (the browser, for an `https://` link). AN8 builds nothing for
  it: a block's link opening Bali waits for AN1's part 2 and for Phase 10's screens.

## AP3, the device test gate

Before Android launches: a Pixel and a Samsung through the whole loop on dev, as B5 and B6 ran it on
the iPhone, on the build students will install; and every gap in `docs/ISSUES.md` #6 checked again
on both phones, each as its *Checked* line says.
