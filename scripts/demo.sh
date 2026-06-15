#!/usr/bin/env bash
# One-command demo bring-up for the Bali teacher iOS app on the physical iPhone.
#
#   ./scripts/demo.sh          # start servers + relaunch the app with the current LAN IP
#   ./scripts/demo.sh --build  # also rebuild + reinstall the app first (needed after iOS code changes)
#
# Why this exists: the Mac's LAN IP is handed out by DHCP and CAN change between sessions.
# The app persists BALI_DEV_API_HOST to UserDefaults, so a plain icon-tap keeps working —
# but only until the Mac's IP changes. This script always relaunches with the IP detected NOW,
# which re-persists the correct host. Run it once before the demo and you're safe.
set -euo pipefail

DEV=CB970F97-E09E-5D3F-99E2-83B775E5C520            # Eshan's iPhone 15 Pro
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # xcode-select points at CLT
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 1. Detect the Mac's current LAN IP (en0 Wi-Fi, fallback en1).
IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$IP" ]; then echo "❌ No LAN IP on en0/en1 — is Wi-Fi connected?"; exit 1; fi
echo "▸ Mac LAN IP: $IP"

# 2. Start the dev servers if they aren't already listening.
start_server() {  # $1=port $2=npm-script $3=logfile
  if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "▸ server already up on :$1"
  else
    echo "▸ starting $2 (log: $3)"
    nohup npm run "$2" > "$3" 2>&1 &
  fi
}
start_server 3001 dev:api /tmp/bali-api.log
start_server 3000 dev:web /tmp/bali-web.log

# 3. Wait for the API to report ready.
echo -n "▸ waiting for API"
if ! curl -s --retry 60 --retry-all-errors --retry-delay 1 --retry-connrefused \
      "http://localhost:3001/v1/ready" | grep -q '"ready":true'; then
  echo " — ❌ API never became ready; check /tmp/bali-api.log"; exit 1
fi
echo " — ready ✓"

# 4. Confirm the phone can reach the API on the LAN IP.
if ! curl -s --max-time 5 "http://$IP:3001/v1/ready" | grep -q '"ready":true'; then
  echo "❌ API not reachable on $IP:3001 (firewall? wrong interface?)"; exit 1
fi
echo "▸ API reachable at http://$IP:3001 ✓"

# 5. Optional rebuild + reinstall of BOTH apps (only needed after iOS source changes).
#    Always build against a concrete single-arch device destination (the Xcode 26.5
#    explicit-modules workaround) — scheme BaliTeacher = teacher; scheme Bali = student + appex.
build_install() {  # $1=scheme $2=.app name
  echo "▸ building $1 (single-arch device destination)…"
  xcodebuild -project ios/Bali/Bali.xcodeproj -scheme "$1" \
    -destination 'generic/platform=iOS' -configuration Debug -allowProvisioningUpdates build \
    >"/tmp/bali-build-$1.log" 2>&1 || { echo "❌ $1 build failed; see /tmp/bali-build-$1.log"; exit 1; }
  local app; app="$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/Bali-*/Build/Products/Debug-iphoneos/"$2" | head -1)"
  echo "▸ installing $app"
  xcrun devicectl device install app --device "$DEV" "$app" >/dev/null
}
if [ "${1:-}" = "--build" ]; then
  build_install BaliTeacher BaliTeacher.app
  build_install Bali        Bali.app
fi

# 6. Relaunch BOTH apps with the freshly-detected IP so each re-persists BALI_DEV_API_HOST
#    (a plain icon-tap afterwards keeps working — until the Mac's IP changes again).
#    The student app is launched last so it ends up foregrounded (web is the teacher side).
echo "▸ pinning BALI_DEV_API_HOST=$IP into both apps…"
xcrun devicectl device process launch --device "$DEV" \
  -e "{\"BALI_DEV_API_HOST\":\"$IP\"}" com.bali.teacher >/dev/null && echo "  · teacher app launched"
xcrun devicectl device process launch --device "$DEV" \
  -e "{\"BALI_DEV_API_HOST\":\"$IP\"}" com.bali.Bali >/dev/null && echo "  · student app launched (foreground)"
echo "✅ Demo ready — both apps talk to http://$IP:3001."
echo "   • Teacher (web):    http://localhost:3000  → /app, start a session on a class's Live page."
echo "   • Student (phone):  Bali app → Dev sign-in as 'Jordan Park' (in Period 3 — Algebra II)."
echo "   • NFC tag codes (Period 3): T7XK2M9QPF · W3RD8K2QAN · D9QM4T6XKE  (write one via the teacher app's Tags screen)."
