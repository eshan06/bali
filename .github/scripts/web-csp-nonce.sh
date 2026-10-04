#!/bin/bash
# Fails unless a portal page's scripts carry its CSP's nonce: the response's
# Content-Security-Policy names a script-src nonce, and every <script> on the
# page has nonce="<that nonce>". A script without it is refused by the browser,
# and a page whose scripts are all refused is blank (Phase 6, S4).
#
#   .github/scripts/web-csp-nonce.sh <response headers file> <response body file>
# (as `curl -D <headers> -o <body>` writes them)
set -euo pipefail

headers=$1
body=$2
script_src=$(grep -i '^content-security-policy:' "$headers" | tr -d '\r' | cut -d: -f2- | tr ';' '\n' \
  | grep -E '^ *script-src ' || true)
nonce=$(grep -oE "'nonce-[^']+'" <<<"$script_src" | head -n 1 | sed -E "s/^'nonce-(.*)'$/\1/" || true)
if [ -z "$nonce" ]; then
  echo "::error::the response's Content-Security-Policy has no script-src nonce"
  exit 1
fi
scripts=$(tr '\n' ' ' <"$body" | grep -oE '<script[^>]*>' || true)
if [ -z "$scripts" ]; then
  echo "::error::the page has no <script>: is this the portal's page?"
  exit 1
fi
if unstamped=$(grep -vF "nonce=\"$nonce\"" <<<"$scripts"); then
  echo "$unstamped"
  echo "::error::the scripts above lack the CSP's nonce, so the browser refuses them"
  exit 1
fi
echo "every script carries the CSP's nonce ($(wc -l <<<"$scripts") scripts)"
