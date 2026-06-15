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
BUNDLE=com.bali.teacher
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

# 5. Optional rebuild + reinstall (only needed after iOS source changes).
if [ "${1:-}" = "--build" ]; then
  echo "▸ building BaliTeacher (single-arch device destination — the Xcode 26.5 workaround)…"
  xcodebuild -project ios/Bali/Bali.xcodeproj -scheme BaliTeacher \
    -destination 'generic/platform=iOS' -configuration Debug -allowProvisioningUpdates build \
    >/tmp/bali-ios-build.log 2>&1 || { echo "❌ build failed; see /tmp/bali-ios-build.log"; exit 1; }
  APP="$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/Bali-*/Build/Products/Debug-iphoneos/BaliTeacher.app | head -1)"
  echo "▸ installing $APP"
  xcrun devicectl device install app --device "$DEV" "$APP" >/dev/null
fi

# 6. Relaunch the app with the freshly-detected IP (re-persists BALI_DEV_API_HOST).
echo "▸ launching app on the iPhone with BALI_DEV_API_HOST=$IP …"
xcrun devicectl device process launch --device "$DEV" \
  -e "{\"BALI_DEV_API_HOST\":\"$IP\"}" "$BUNDLE" >/dev/null
echo "✅ Demo ready. Teacher app is live on the phone, talking to http://$IP:3001."
echo "   Parent-visibility web surface: http://localhost:3000  (sign in on /app, open a roster → 'Parent link')."
