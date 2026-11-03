#!/usr/bin/env bash
# The spike's helpers for Git Bash: `bash android/spike/scripts/sp.sh <helper> [args]`.
# DEV picks the device (default emulator-5554); OUT is where shots go (default .).
export PATH="/c/Users/toesh/AppData/Local/Android/Sdk/platform-tools:$PATH"
DEV="${DEV:-emulator-5554}"
OUT="${OUT:-.}"
HERE="$(dirname "${BASH_SOURCE[0]}")"
SPIKE=com.bali.spike
SERVICE=com.bali.spike/com.bali.spike.BlockAccessibilityService
TARGET=com.bali.spike.target

a() { adb -s "$DEV" "$@"; }
sh_() { adb -s "$DEV" shell "$@"; }

# A marker in the log, so a run's lines can be cut out of the capture afterwards.
mark() { sh_ log -t BaliSpikeTest "$*"; }

install_apks() {
  a install -r -g "$HERE/../app/build/outputs/apk/debug/app-debug.apk"
  a install -r -g "$HERE/../target/build/outputs/apk/debug/target-debug.apk"
}

# Lock (a)'s switch and lock (b)'s access, set through adb for the runs (the restricted-settings
# line switches them on through Settings' own screens instead).
enable_a() { sh_ settings put secure enabled_accessibility_services "$SERVICE"; sh_ settings put secure accessibility_enabled 1; }
disable_a() { sh_ settings delete secure enabled_accessibility_services; }
grant_b() {
  sh_ appops set "$SPIKE" GET_USAGE_STATS allow
  sh_ appops set "$SPIKE" SYSTEM_ALERT_WINDOW allow
  sh_ pm grant "$SPIKE" android.permission.POST_NOTIFICATIONS
  sh_ pm grant "$TARGET" android.permission.POST_NOTIFICATIONS
}

# start_session a|b [poll ms] [minutes]
start_session() { sh_ am start -n "$SPIKE/.MainActivity" --es cmd start --es mode "$1" --ei poll "${2:-500}" --ei minutes "${3:-50}"; }
end_session() { sh_ am start -n "$SPIKE/.MainActivity" --es cmd end; }

home() { sh_ input keyevent KEYCODE_HOME; }
shot() { a exec-out screencap -p > "$OUT/$1.png"; }

# The screen's accessibility tree, and a tap on the first node whose text or description matches.
ui() { sh_ uiautomator dump /sdcard/ui.xml > /dev/null 2>&1; a exec-out cat /sdcard/ui.xml; }
tap_text() {
  local xy
  xy=$(ui | node "$HERE/find.mjs" "$1") || { echo "not found: $1"; return 1; }
  sh_ input tap $xy
}

# How many covers of lock $1 the window manager has on screen.
covered() { sh_ dumpsys window windows | grep -c "BaliCover-$1"; }

"$@"
