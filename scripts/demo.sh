#!/usr/bin/env bash
# One-command demo bring-up for the Bali iOS apps on the physical iPhone.
#
#   ./scripts/demo.sh                    # servers + relaunch both apps pinned to the Mac's LAN IP
#   ./scripts/demo.sh --build            # also rebuild + reinstall first (after iOS code changes)
#   ./scripts/demo.sh --tunnel           # pin a PUBLIC https tunnel URL instead of the LAN IP
#   ./scripts/demo.sh --build --tunnel   # both
#
# Why the LAN mode exists: the Mac's LAN IP is handed out by DHCP and CAN change between
# sessions. The app persists BALI_DEV_API_HOST to UserDefaults, so a plain icon-tap keeps
# working — but only until the Mac's IP changes. This script always relaunches with the
# value detected NOW, which re-persists the correct host.
#
# Why --tunnel exists: on a network that isolates clients from each other (campus Wi-Fi),
# the phone CANNOT reach the Mac's LAN IP at all. --tunnel puts the API behind a public
# Cloudflare HTTPS URL, which the phone reaches from any network — so the phone no longer
# has to share a network with the Mac. APIConfig accepts either a bare host or a full URL.
#
# ⚠️  --tunnel exposes the dev API to the public internet. With ALLOW_DEV_TOKENS=1 anyone
#     holding the URL can impersonate any student or teacher against your real database.
#     The URL is random and unlisted, but stop the tunnel when you're done:
#         pkill -f 'cloudflared tunnel'
set -euo pipefail

DEV=CB970F97-E09E-5D3F-99E2-83B775E5C520            # Eshan's iPhone 15 Pro
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer   # xcode-select points at CLT
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TUNNEL_LOG=/tmp/bali-tunnel.log

BUILD=0; TUNNEL=0
for arg in "$@"; do
  case "$arg" in
    --build)  BUILD=1 ;;
    --tunnel) TUNNEL=1 ;;
    *) echo "unknown flag: $arg (want --build and/or --tunnel)"; exit 2 ;;
  esac
done

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

# 4. Decide what host to pin into the apps, and prove the phone will be able to reach it.
if [ "$TUNNEL" = "1" ]; then
  command -v cloudflared >/dev/null || { echo "❌ cloudflared not installed — brew install cloudflared"; exit 1; }
  if ! pgrep -f 'cloudflared tunnel' >/dev/null; then
    echo "▸ starting cloudflared quick tunnel…"
    nohup cloudflared tunnel --url http://localhost:3001 --no-autoupdate > "$TUNNEL_LOG" 2>&1 &
  else
    echo "▸ cloudflared already running"
  fi
  PIN=""
  for _ in $(seq 1 40); do
    PIN="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1)"
    [ -n "$PIN" ] && break
    sleep 1
  done
  [ -z "$PIN" ] && { echo "❌ no tunnel URL in $TUNNEL_LOG"; tail -20 "$TUNNEL_LOG"; exit 1; }
  echo "▸ tunnel: $PIN"

  # Some networks (this campus among them) block DNS for *.trycloudflare.com, so the Mac
  # may be unable to resolve its own tunnel. That does NOT break the tunnel — cloudflared
  # dials out — but it does mean we must verify through a public resolver, and that THE
  # PHONE must be on a network that resolves it (cellular works; campus Wi-Fi may not).
  HOSTNAME_ONLY="${PIN#https://}"
  TIP="$(dig +short "$HOSTNAME_ONLY" | tail -1)"
  RESOLVER="this network"
  if [ -z "$TIP" ]; then
    TIP="$(dig +short @1.1.1.1 "$HOSTNAME_ONLY" | tail -1)"
    RESOLVER="1.1.1.1 (this network's DNS blocks it)"
  fi
  [ -z "$TIP" ] && { echo "❌ tunnel hostname will not resolve anywhere"; exit 1; }
  if curl -s --max-time 20 --resolve "$HOSTNAME_ONLY:443:$TIP" "$PIN/v1/ready" | grep -q '"ready":true'; then
    echo "▸ tunnel reachable over public HTTPS ✓  (resolved via $RESOLVER)"
  else
    echo "❌ tunnel URL did not serve /v1/ready"; exit 1
  fi
  if [ "$RESOLVER" != "this network" ]; then
    echo "   ⚠️  This Mac's DNS blocks *.trycloudflare.com — the PHONE must be on cellular"
    echo "      (turn Wi-Fi off) or it will not resolve the tunnel either."
  fi
else
  PIN="$IP"
  if ! curl -s --max-time 5 "http://$IP:3001/v1/ready" | grep -q '"ready":true'; then
    echo "❌ API not reachable on $IP:3001 (firewall? wrong interface?)"; exit 1
  fi
  echo "▸ API reachable at http://$IP:3001 ✓"
  echo "   note: if the phone still can't reach it, this network isolates clients — use --tunnel."
fi

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
if [ "$BUILD" = "1" ]; then
  build_install BaliTeacher BaliTeacher.app
  build_install Bali        Bali.app
fi

# 6. Relaunch BOTH apps with the freshly-detected host so each re-persists BALI_DEV_API_HOST
#    (a plain icon-tap afterwards keeps working — until the pinned value changes again).
#    The student app is launched last so it ends up foregrounded (web is the teacher side).
echo "▸ pinning BALI_DEV_API_HOST=$PIN into both apps…"
# --terminate-existing: a running instance keeps its old env (or none, from an icon-tap
# launch) — without a restart the host pin silently doesn't apply.
xcrun devicectl device process launch --terminate-existing --device "$DEV" \
  -e "{\"BALI_DEV_API_HOST\":\"$PIN\"}" com.bali.teacher >/dev/null && echo "  · teacher app launched"
xcrun devicectl device process launch --terminate-existing --device "$DEV" \
  -e "{\"BALI_DEV_API_HOST\":\"$PIN\"}" com.bali.Bali >/dev/null && echo "  · student app launched (foreground)"
echo "✅ Demo ready — both apps talk to $PIN."
echo "   • Teacher (web):    http://localhost:3000  → /app, start a session on a class's Live page."
echo "   • Student (phone):  Bali app → Dev sign-in as 'Jordan Park' (in Period 3 — Algebra II)."
echo "   • NFC tag codes (Period 3): T7XK2M9QPF · W3RD8K2QAN · D9QM4T6XKE  (write one via the teacher app's Tags screen)."
# `&& echo` alone would make the script exit 1 on every non-tunnel run under `set -e`.
if [ "$TUNNEL" = "1" ]; then
  echo "   • ⚠️  Public tunnel is live. Stop it when done:  pkill -f 'cloudflared tunnel'"
fi
