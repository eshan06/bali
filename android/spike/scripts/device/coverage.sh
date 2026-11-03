#!/system/bin/sh
# Runs on the phone: `adb shell sh /data/local/tmp/coverage.sh <label>`, a session already on.
# Every app with a launcher icon, then the allow-list's parts that have none, each opened from
# Home: how many covers are up 4 s later, which window has focus, and a screenshot.
L=$1
check() {
  sleep 4
  c=$(dumpsys window windows | grep -c "BaliCover-")
  f=$(dumpsys window | grep -m1 mCurrentFocus | sed 's/.* u0 //; s/}.*//')
  log -t BaliSpikeTest "COVCHECK label=$L what=$1 covers=$c focus=$f"
  screencap -p "/sdcard/spike-$L-$1.png"
}
for comp in $(cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER | grep /); do
  pkg=${comp%%/*}
  input keyevent KEYCODE_HOME
  sleep 2
  log -t BaliSpikeTest "COV label=$L what=$pkg comp=$comp"
  am start -n "$comp" > /dev/null 2>&1
  check "$pkg"
done
input keyevent KEYCODE_HOME
sleep 2
log -t BaliSpikeTest "COV label=$L what=emergency-dialer"
am start -a com.android.phone.EmergencyDialer.DIAL > /dev/null 2>&1
check emergency-dialer
input keyevent KEYCODE_HOME
sleep 2
# The keyboard: Messages' new message, its field focused.
log -t BaliSpikeTest "COV label=$L what=keyboard"
am start -a android.intent.action.SENDTO -d smsto:5551234 > /dev/null 2>&1
check keyboard
dumpsys input_method | grep -m3 -E "mInputShown|isInputViewShown|mVisibleBound" | while read -r line; do log -t BaliSpikeTest "IME $line"; done
input keyevent KEYCODE_HOME
sleep 2
# System UI: the shade pulled down over a covered app.
log -t BaliSpikeTest "COV label=$L what=shade-over-blocked"
am start -n com.google.android.deskclock/com.android.deskclock.DeskClock > /dev/null 2>&1
sleep 3
cmd statusbar expand-notifications
check shade-over-blocked
cmd statusbar collapse
sleep 2
c=$(dumpsys window windows | grep -c "BaliCover-")
log -t BaliSpikeTest "COVCHECK label=$L what=after-shade covers=$c"
input keyevent KEYCODE_HOME
log -t BaliSpikeTest "DONE label=$L"
