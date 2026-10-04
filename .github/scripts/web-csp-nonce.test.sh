#!/bin/bash
# Self-test for web-csp-nonce.sh: a page whose scripts carry the CSP's nonce
# passes; a script without it, another nonce, a CSP with no script nonce, or a
# page with no script fails. CI runs it before the real check.
#
#   .github/scripts/web-csp-nonce.test.sh
set -euo pipefail

CHECK="$(cd "$(dirname "$0")" && pwd)/web-csp-nonce.sh"
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
failures=0

N='YWJjZGVm+/0='
csp="Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-$N' 'strict-dynamic'; style-src 'self' 'nonce-$N'"

# expect <pass|fail> <case> <headers> <body>
expect() {
  printf '%s\r\n' "HTTP/1.1 200 OK" "$3" "" >"$DIR/headers"
  printf '%s\n' "$4" >"$DIR/body"
  if "$CHECK" "$DIR/headers" "$DIR/body" >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" != "$1" ]; then
    echo "FAIL: $2: expected $1, got $got"
    failures=$((failures + 1))
  fi
}

page() {
  printf '<html><head><script src="/_next/a.js" async="" nonce="%s"></script></head>\n' "$1"
  printf '<body><script\n  nonce="%s">self.__next_f.push([1,""])</script></body></html>\n' "$2"
}

expect pass 'every script stamped' "$csp" "$(page "$N" "$N")"
expect pass 'the header in lower case' "${csp,,}" "$(page "${N,,}" "${N,,}")"
expect fail 'a script without the nonce' "$csp" "$(page "$N" '')"
expect fail 'a script with another nonce' "$csp" "$(page "$N" 'b3RoZXI=')"
expect fail 'no CSP' 'X-Other: 1' "$(page "$N" "$N")"
expect fail 'a nonce for styles only' "Content-Security-Policy: script-src 'self'; style-src 'nonce-$N'" "$(page "$N" "$N")"
expect fail 'no script on the page' "$csp" '<html><body>Not found</body></html>'

if [ "$failures" -gt 0 ]; then exit 1; fi
echo "web-csp-nonce.sh: all cases pass"
