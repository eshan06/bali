#!/usr/bin/env python3
"""A TestFlight run revokes the Apple Development certificate its signing made, and no other.

A GitHub runner starts with an empty keychain, so archiving with automatic signing makes a new
Apple Development certificate ("Created via API") every run; left there, they piled up until
Apple refused another (2026-11-07). testflight.yml lists the team's certificates through the
App Store Connect API before anything is signed, and again once the run is over. The one
certificate new since the first list is revoked when it is a development one. Anything else
revokes nothing and says what it saw in a warning: a list that failed or isn't whole, more than
one new certificate (a run makes one), a new one that isn't a development one.

    python3 .github/scripts/testflight-certs.py list <file>    # before signing: saves the list
    python3 .github/scripts/testflight-certs.py clean <file>   # after: revokes the run's own

Both exit 0 whatever happens, so the cleanup never fails the upload. The key is the workflow's:
KEY_ID, ISSUER_ID and KEY_PATH. No key or token is ever printed.
"""
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.appstoreconnect.apple.com/v1/certificates"
# Apple's ids are letters and digits; anything else never reaches a URL.
ID = re.compile(r"[A-Za-z0-9]+")
# The name the developer account gives a certificate the API made, as each run's is.
MADE_BY_API = "Created via API"


def certificates(answer):
    """{id: certificate} for one whole list answer; None for a failed, cut short or odd one."""
    try:
        if answer["links"].get("next"):
            return None  # a next page: certificates missing from this one would look new
        found = {}
        for item in answer["data"]:
            attributes = item.get("attributes") or {}
            if item.get("type") != "certificates" or not ID.fullmatch(item["id"]):
                return None
            found[item["id"]] = {
                "id": item["id"],
                "displayName": attributes.get("displayName"),
                "certificateType": attributes.get("certificateType"),
                "expirationDate": attributes.get("expirationDate"),
            }
        return found
    except (AttributeError, KeyError, TypeError):
        return None


def describe(cert):
    """A certificate on one line, by what the developer account's Certificates page shows: its
    type and expiry, and its id. A person's certificate carries their name and the run's log is
    public, so the only name said is the API's own."""
    made_by_api = f' "{MADE_BY_API}"' if cert["displayName"] == MADE_BY_API else ""
    text = (
        f"a {cert['certificateType']} certificate{made_by_api} that expires"
        f" {str(cert['expirationDate'])[:10]} (id {cert['id']})"
    )
    return " ".join(text.split())  # no line break, so no workflow command can start in it


def choose(before, after):
    """(the certificates to revoke, the warnings) from the list before signing and the one after.

    Either is None when it failed. Only the single certificate new since the first list, a
    development one, is chosen: whatever predates the run is in that list.
    """
    old, now = certificates(before), certificates(after)
    if old is None or now is None:
        when = "before signing" if old is None else "after the run"
        seen = ""
        if now is not None:
            mine = [c for c in now.values() if c["certificateType"] == "DEVELOPMENT"]
            seen = " The team's development certificates now: " + "; ".join(map(describe, mine)) + "."
        return [], [
            f"No whole list of the team's certificates {when}, so none is revoked: this run's"
            f' signing may have left an Apple Development certificate, "{MADE_BY_API}", that'
            f" expires a year from today. Revoke it in the developer account's Certificates.{seen}"
        ]
    new = [c for id, c in now.items() if id not in old]
    if len(new) > 1:
        return [], [
            f"{len(new)} certificates are new since signing began, where a run makes one, so none"
            " is revoked. Check them in the developer account's Certificates: "
            + "; ".join(map(describe, new))
            + "."
        ]
    if new and new[0]["certificateType"] != "DEVELOPMENT":
        return [], [f"The one new certificate is not a development one, so it stays: {describe(new[0])}."]
    return new, []


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jose(der):
    """An ECDSA P-256 signature from openssl's DER, SEQUENCE {INTEGER r, INTEGER s}, to JWT's r || s."""

    def integer(at):
        if at + 2 > len(der) or der[at] != 0x02 or at + 2 + der[at + 1] > len(der):
            raise ValueError("not a P-256 ECDSA signature")
        value = der[at + 2 : at + 2 + der[at + 1]].lstrip(b"\0")
        if len(value) > 32:
            raise ValueError("not a P-256 ECDSA signature")
        return value.rjust(32, b"\0"), at + 2 + der[at + 1]

    if len(der) < 2 or der[0] != 0x30 or der[1] != len(der) - 2:
        raise ValueError("not a P-256 ECDSA signature")
    r, at = integer(2)
    s, at = integer(at)
    if at != len(der):
        raise ValueError("not a P-256 ECDSA signature")
    return r + s


def token():
    """A JWT for the App Store Connect API, ES256 with the key's .p8, good for about 2 minutes."""
    now = int(time.time())
    header = {"alg": "ES256", "kid": os.environ["KEY_ID"], "typ": "JWT"}
    # Backdated a little, against a runner's clock running ahead of Apple's.
    claims = {"iss": os.environ["ISSUER_ID"], "iat": now - 30, "exp": now + 120, "aud": "appstoreconnect-v1"}
    signed = ".".join(b64url(json.dumps(part).encode()) for part in (header, claims))
    der = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", os.environ["KEY_PATH"]],
        input=signed.encode(),
        capture_output=True,
        check=True,
    ).stdout
    return signed + "." + b64url(jose(der))


def call(method, url):
    """(status, body) of one API request; an HTTP error raises, as urllib's do."""
    request = urllib.request.Request(url, method=method, headers={"Authorization": "Bearer " + token()})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, response.read()


def reason(error):
    """Why a step failed, in words that hold no key or token."""
    if isinstance(error, urllib.error.HTTPError):
        try:
            first = json.loads(error.read())["errors"][0]
            said = first.get("detail") or first.get("title") or ""
        except Exception:
            said = ""
        return " ".join(f"HTTP {error.code} {said}".split())[:300]
    if isinstance(error, subprocess.CalledProcessError):
        return "openssl could not sign the token with the key"
    return " ".join(f"{type(error).__name__}: {error}".split())[:300]


def fetch():
    """The team's certificates as GET /v1/certificates answers; None, said, when that fails."""
    try:
        _, body = call("GET", API + "?limit=200")
        return json.loads(body)
    except Exception as error:
        print(f"::warning::Could not list the team's certificates ({reason(error)}).")
        return None


def say(lines):
    """Each line printed, and added to the run's summary."""
    for line in lines:
        print(line)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as summary:
            summary.writelines(re.sub(r"^::\w+::", "", line) + "\n\n" for line in lines)


def save(path):
    answer = fetch()
    if answer is None:
        return  # no file: clean says the list before signing failed
    with open(path, "w") as f:
        json.dump(answer, f)
    found = certificates(answer)
    if found is None:
        print("::warning::The list of the team's certificates isn't whole: the run's own won't be revoked.")
    else:
        print(f"Certificates on the team before signing: {len(found)}.")


def clean(path):
    try:
        with open(path) as f:
            before = json.load(f)
    except (OSError, ValueError):
        before = None  # the list before signing failed: choose says so
    after = fetch()
    revoke, warnings = choose(before, after)
    lines, revoked = [], 0
    for cert in revoke:
        try:
            call("DELETE", f"{API}/{cert['id']}")
            revoked += 1
            lines.append(f"Revoked the certificate this run's signing made, {describe(cert)}.")
        except Exception as error:
            warnings.append(
                f"Could not revoke {describe(cert)}, the certificate this run's signing made"
                f" ({reason(error)}). Revoke it in the developer account's Certificates."
            )
    old, now = certificates(before), certificates(after)
    if old is not None and now is not None:
        count = f"Certificates on the team: {len(old)} before signing, {len(now)} after the run"
        lines.append(count + (f", {len(now) - revoked} after the revoke." if revoked else "."))
    say(lines + ["::warning::" + warning for warning in warnings])


def main(argv):
    if len(argv) != 3 or argv[1] not in ("list", "clean"):
        print("usage: testflight-certs.py list|clean <file>", file=sys.stderr)
        return 2
    try:
        (save if argv[1] == "list" else clean)(argv[2])
    except Exception as error:  # the cleanup never fails the upload
        print(
            f"::warning::testflight-certs.py {argv[1]} stopped ({reason(error)}): check the"
            " developer account's Certificates for one this run's signing left."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
