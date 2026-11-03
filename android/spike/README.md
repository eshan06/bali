# AN1's lock spike (throwaway)

The lock spike of `docs/PLAN-ANDROID.md`, AN1: both candidate locks, measured on Android 15, 16
and 17 emulators (part 1, 2026-11-03), then on a real Pixel and a real Samsung (part 2). It lives
on the branch `spike/android-lock`, is never merged and never gets a PR. It isn't the product:
plain Views, no server, no tests but `BlockTag`'s port. The findings are in `docs/DECISIONS.md`
(2026-11-03, "AN1 part 1").

## What's here

- `app/` (`com.bali.spike`): a fake session (a window of N minutes on the phone's clock), the two
  locks, Emergency Unlock (a one-second hold, on the cover and in the app), the allow-list taken
  from Android itself, a protection-off detector, a check-in tick every 30 s, and an NFC reader.
  - **(a)** `BlockAccessibilityService`: reads the windows on screen and covers each blocked app's
    window at its bounds, with an accessibility overlay.
  - **(b)** `PollService`: a foreground service that polls usage events (250 ms, 500 ms or 1 s)
    and puts an overlay ("Display over other apps") over the whole screen while a blocked app's
    activity resumed last.
  - `AllowList`: the default phone app (the dialer role), the default messaging app (the SMS
    role), emergency calls (the emergency dialer and Telecom), Settings (with the permission
    screens and Uninstall, so Bali never blocks its own removal), the enabled keyboards, the home
    app, System UI and Bali.
  - `BlockTag`: BaliCore's rules, ported, for part 2's real block.
- `target/` (`com.bali.spike.target`): a stand-in blocked app that plays a tone, goes into
  picture-in-picture and posts a notification on demand.
- `scripts/`: `tickserver.mjs` (the host end of the tick), `analyze.mjs` (launch-to-cover times
  from a log), `find.mjs` (a node's centre in a uiautomator dump), `sp.sh` (adb helpers), and
  `device/` (the coverage and timing loops, run on the phone).

## Build and install (Git Bash)

```sh
cd android/spike
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="C:\\Users\\toesh\\AppData\\Local\\Android\\Sdk"
./gradlew :app:assembleDebug :target:assembleDebug :app:testDebugUnitTest
adb install -r -g app/build/outputs/apk/debug/app-debug.apk
adb install -r -g target/build/outputs/apk/debug/target-debug.apk
```

## Driving it

```sh
adb shell am start -n com.bali.spike/.MainActivity --es cmd start --es mode a --ei minutes 50
adb shell am start -n com.bali.spike/.MainActivity --es cmd start --es mode b --ei poll 250 --ei minutes 50
adb shell am start -n com.bali.spike/.MainActivity --es cmd end
adb shell am start -n com.bali.spike/.MainActivity --es tickHost 192.168.1.20:8787   # a phone: the PC's address
node scripts/tickserver.mjs 8787
adb logcat -v epoch -s BaliSpike BaliSpikeTest ActivityTaskManager
```

Every event is one `BaliSpike` line with `wall=` (the phone's clock, logcat's own), `elapsed=` and
`uptime=` beside it. A tick logs `sleptMs`, elapsed minus uptime since the lock started: above 0,
the CPU slept (an emulator never does).

## Part 2, on the phones

What the emulators couldn't answer: a real block read over NFC (Read a block, with Bali open; then
with Bali closed, the block's `bali://t/<code>` link), the Samsung's battery saver and its in-call
screen (`com.samsung.android.incallui`, a package of its own beside Samsung's dialer, which the
allow-list must also find), and the battery a lesson costs. Run every other line again on both phones: the emulators' timings are slower than a phone's,
and a phone's CPU sleeps in Doze, which an emulator's doesn't.
