# AN1's lock spike (throwaway)

The lock spike of `docs/PLAN-ANDROID.md`, AN1: the candidate locks, measured on Android 15, 16
and 17 emulators (part 1, 2026-11-03; part 1c, the VPN, 2026-11-03), then on a real Pixel and a
real Samsung (part 2). It lives on the branch `spike/android-lock`, is never merged and never gets
a PR. It isn't the product: plain Views, no server, no tests but `BlockTag`'s port. The findings
are in `docs/DECISIONS.md` (2026-11-03, "AN1 part 1" and "AN1 part 1c").

## What's here

- `app/` (`com.bali.spike`): a fake session (a window of N minutes on the phone's clock), the two
  locks, Emergency Unlock (a one-second hold, on the cover and in the app), the allow-list taken
  from Android itself, a protection-off detector, a check-in tick every 30 s, and an NFC reader.
  - **(a)** `BlockAccessibilityService`: reads the windows on screen and covers each blocked app's
    window at its bounds, with an accessibility overlay.
  - **(b)** `PollService`: a foreground service that polls usage events (250 ms, 500 ms or 1 s)
    and puts an overlay ("Display over other apps") over the whole screen while a blocked app's
    activity resumed last.
  - **(c)** `BlockVpnService`: a VPN on the phone alone (no server, nothing forwarded). While a
    session runs it routes only the blocked apps into it, one `addAllowedApplication` each, and
    never reads the tunnel, so every packet they send, DNS included, is dropped unread. A VPN
    routes by uid, so an app sharing a uid with the allow-list, or running as a system uid, is
    never routed (SIM Toolkit runs as the phone's uid). Mode `ac` runs (a) and (c) together.
  - `AllowList`: the default phone app (the dialer role), the default messaging app (the SMS
    role), emergency calls (the emergency dialer and Telecom), Settings (with the permission
    screens and Uninstall, so Bali never blocks its own removal), the enabled keyboards, the home
    app, System UI and Bali.
  - `BlockTag`: BaliCore's rules, ported, for part 2's real block.
- `target/` (`com.bali.spike.target`): a stand-in blocked app that plays a tone, goes into
  picture-in-picture and posts a notification on demand, and, for (c), probes the host every
  100 ms, holds a stream open from it, and looks a name up (`Net.kt`).
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

"Another VPN" for (c)'s takeover line is a second build of the spike under its own package name,
so no VPN app comes from the web: `./gradlew -PspikeId=com.bali.spike.other :app:assembleDebug`
(copy the APK out before building the main one again; it lands on the same path).

## Driving it

```sh
adb shell am start -n com.bali.spike/.MainActivity --es cmd start --es mode a --ei minutes 50
adb shell am start -n com.bali.spike/.MainActivity --es cmd start --es mode b --ei poll 250 --ei minutes 50
adb shell am start -n com.bali.spike/.MainActivity --es cmd start --es mode c --ei minutes 50    # or ac
adb shell am start -n com.bali.spike/.MainActivity --es cmd arm   # (c) armed again: asks, or takes the VPN back
adb shell am start -n com.bali.spike/.MainActivity --es cmd end
adb shell am start -n com.bali.spike.target/.TargetActivity --es do net --ei ms 100   # netstop, stream, dns
adb shell am start -n com.bali.spike/.MainActivity --es tickHost 192.168.1.20:8787   # a phone: the PC's address
node scripts/tickserver.mjs 8787
adb logcat -v epoch -s BaliSpike BaliSpikeTest BaliSpikeTarget ActivityTaskManager Vpn
```

From Git Bash, a device path such as `/sdcard/ui.xml` is rewritten into a Windows path unless the
command runs with `MSYS_NO_PATHCONV=1`. On Android 15 and later a stand-in app sent to the
background loses its own network within seconds (netpolicy's `APP_BACKGROUND`), whatever the lock:
probe it in front.

Every event is one `BaliSpike` line with `wall=` (the phone's clock, logcat's own), `elapsed=` and
`uptime=` beside it. A tick logs `sleptMs`, elapsed minus uptime since the lock started: above 0,
the CPU slept (an emulator never does).

## Part 2, on the phones

What the emulators couldn't answer: a real block read over NFC (Read a block, with Bali open; then
with Bali closed, the block's `bali://t/<code>` link), the Samsung's battery saver and its in-call
screen (`com.samsung.android.incallui`, a package of its own beside Samsung's dialer, which the
allow-list must also find), and the battery a lesson costs. Run every other line again on both phones: the emulators' timings are slower than a phone's,
and a phone's CPU sleeps in Doze, which an emulator's doesn't.
