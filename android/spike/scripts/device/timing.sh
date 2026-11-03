#!/system/bin/sh
# Runs on the phone: `adb shell sh /data/local/tmp/timing.sh <label>`, a session already on.
# Each app launched from Home three times, the first cold (force-stopped); a marker before each
# launch, so analyze.mjs can time launch → cover from the log.
L=$1
for comp in \
  com.google.android.deskclock/com.android.deskclock.DeskClock \
  com.google.android.calendar/com.android.calendar.AllInOneActivity \
  com.google.android.contacts/com.android.contacts.activities.PeopleActivity \
  com.bali.spike.target/.TargetActivity \
  com.android.chrome/com.google.android.apps.chrome.Main; do
  pkg=${comp%%/*}
  for i in 1 2 3; do
    input keyevent KEYCODE_HOME
    sleep 2
    kind=warm
    if [ "$i" = 1 ]; then am force-stop "$pkg"; kind=cold; fi
    sleep 1
    log -t BaliSpikeTest "RUN label=$L pkg=$pkg i=$i kind=$kind"
    am start -n "$comp" > /dev/null 2>&1
    sleep 4
    c=$(dumpsys window windows | grep -c "BaliCover-")
    log -t BaliSpikeTest "CHECK label=$L pkg=$pkg i=$i covers=$c"
  done
done
input keyevent KEYCODE_HOME
log -t BaliSpikeTest "DONE label=$L"
