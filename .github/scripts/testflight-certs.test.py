#!/usr/bin/env python3
"""The TestFlight run's certificate cleanup, against canned App Store Connect answers.

Run from the repository root: python3 .github/scripts/testflight-certs.test.py

Every answer holds the three certificates the owner keeps (2026-11-07), and an older run's
leftover: all were made before any run, so no answer may ever choose one.
"""
import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

SPEC = importlib.util.spec_from_file_location(
    "testflight_certs", Path.cwd() / ".github/scripts/testflight-certs.py"
)
CERTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CERTS)


def cert(id, name, kind, expires):
    """One certificate as GET /v1/certificates lists it."""
    return {
        "type": "certificates",
        "id": id,
        "attributes": {
            "name": f"{'Apple Development' if kind == 'DEVELOPMENT' else 'Apple Distribution'}: {name}",
            "displayName": name,
            "certificateType": kind,
            "platform": None,
            "serialNumber": "6C2B8F7AD1A0C3E4",
            "expirationDate": f"{expires}T00:00:00.000+0000",
            "certificateContent": "MIIFujCCBKKgAwIBAgIQ",
        },
        "links": {"self": f"https://api.appstoreconnect.apple.com/v1/certificates/{id}"},
    }


# A person's certificate carries their name, which the run's public log must never say.
PERSON = "Pat Example"

# Kept by the owner on 2026-11-07, and never to be touched: theirs, the cloud-managed one, theirs.
KEPT = [
    cert("KEPTDEV001", PERSON, "DEVELOPMENT", "2027-06-01"),
    cert("KEPTMGD001", "Distribution Managed", "DISTRIBUTION", "2027-08-18"),
    cert("KEPTDST001", PERSON, "DISTRIBUTION", "2027-09-20"),
]
# An earlier run's certificate, there before this run's first list: not this run's to revoke.
EARLIER = cert("EARLIER001", "Created via API", "DEVELOPMENT", "2027-11-07")
OLD = KEPT + [EARLIER]
OLD_IDS = {c["id"] for c in OLD}

# What this run's signing made.
NEW_DEV = cert("RUNDEV0001", "Created via API", "DEVELOPMENT", "2027-11-08")
NEW_DEV_2 = cert("RUNDEV0002", "Created via API", "DEVELOPMENT", "2027-11-08")
NEW_DIST = cert("RUNDST0001", "Created via API", "DISTRIBUTION", "2027-11-08")


def answer(*certs, next_page=False):
    """GET /v1/certificates's answer: the list, and a next page when it was cut short."""
    links = {"self": "https://api.appstoreconnect.apple.com/v1/certificates?limit=200"}
    if next_page:
        links["next"] = links["self"] + "&cursor=Mg"
    return {"data": list(certs), "links": links, "meta": {"paging": {"total": len(certs), "limit": 200}}}


# Lists that aren't whole, as the before list or the after one.
NOT_WHOLE = {
    "a list with a next page": answer(*OLD, NEW_DEV, next_page=True),
    "an error answer": {"errors": [{"status": "401", "code": "NOT_AUTHORIZED"}]},
    "data that isn't a list": {"data": "certificates", "links": {}},
    "an id that isn't one": answer(*OLD, dict(NEW_DEV, id="../RUNDEV0001")),
    "a certificate with no id": answer(*OLD, {"type": "certificates", "attributes": {}}),
    "a list, not an answer": [NEW_DEV],
}


def chosen(before, after):
    revoke, warnings = CERTS.choose(before, after)
    return [c["id"] for c in revoke], warnings


class Choose(unittest.TestCase):
    def test_the_one_new_development_certificate_is_chosen(self):
        ids, warnings = chosen(answer(*OLD), answer(*OLD, NEW_DEV))
        self.assertEqual(ids, ["RUNDEV0001"])
        self.assertEqual(warnings, [])

    def test_no_new_certificate_chooses_nothing(self):
        self.assertEqual(chosen(answer(*OLD), answer(*OLD)), ([], []))

    def test_a_new_distribution_certificate_is_left_alone_and_named(self):
        ids, warnings = chosen(answer(*OLD), answer(*OLD, NEW_DIST))
        self.assertEqual(ids, [])
        self.assertEqual(len(warnings), 1)
        self.assertIn("RUNDST0001", warnings[0])

    def test_more_than_one_new_certificate_chooses_nothing_and_names_them(self):
        for extra in (NEW_DEV_2, NEW_DIST):
            with self.subTest(extra["id"]):
                ids, warnings = chosen(answer(*OLD), answer(*OLD, NEW_DEV, extra))
                self.assertEqual(ids, [])
                self.assertEqual(len(warnings), 1)
                self.assertIn("RUNDEV0001", warnings[0])
                self.assertIn(extra["id"], warnings[0])

    def test_a_failed_list_chooses_nothing(self):
        for before, after in ((None, answer(*OLD, NEW_DEV)), (answer(*OLD), None), (None, None)):
            with self.subTest(before=before is None, after=after is None):
                ids, warnings = chosen(before, after)
                self.assertEqual(ids, [])
                self.assertEqual(len(warnings), 1)

    def test_no_list_before_names_the_development_certificates_after(self):
        _, warnings = chosen(None, answer(*OLD, NEW_DEV, NEW_DIST))
        for id in ("KEPTDEV001", "EARLIER001", "RUNDEV0001"):
            self.assertIn(id, warnings[0])
        for id in ("KEPTMGD001", "KEPTDST001", "RUNDST0001"):
            self.assertNotIn(id, warnings[0])

    def test_a_person_is_never_named_but_the_apis_own_name_is(self):
        _, warnings = chosen(None, answer(*OLD, NEW_DEV))
        self.assertNotIn(PERSON, warnings[0])
        self.assertIn('certificate "Created via API" that expires 2027-11-08 (id RUNDEV0001)', warnings[0])
        _, warnings = chosen(answer(*OLD), answer(*OLD, NEW_DEV, dict(KEPT[0], id="PERSONDEV2")))
        self.assertNotIn(PERSON, warnings[0])
        self.assertIn("a DEVELOPMENT certificate that expires 2027-06-01 (id PERSONDEV2)", warnings[0])

    def test_a_list_that_isnt_whole_chooses_nothing(self):
        for name, bad in NOT_WHOLE.items():
            with self.subTest(name):
                self.assertEqual(chosen(bad, answer(*OLD, NEW_DEV))[0], [])
                self.assertEqual(chosen(answer(*OLD), bad)[0], [])

    def test_the_kept_and_earlier_certificates_are_never_chosen(self):
        # They predate the run, so its first list holds them: whatever the run made, and
        # whichever list failed, a set difference never reaches them. A first list that came
        # back empty would make them all look new, more than one: nothing either.
        befores = [answer(*OLD), answer(), None, *NOT_WHOLE.values()]
        afters = [
            answer(*OLD),
            answer(*OLD, NEW_DEV),
            answer(*OLD, NEW_DIST),
            answer(*OLD, NEW_DEV, NEW_DEV_2),
            None,
            *NOT_WHOLE.values(),
        ]
        for before in befores:
            for after in afters:
                ids, _ = chosen(before, after)
                self.assertFalse(OLD_IDS & set(ids), (before, after))


class Main(unittest.TestCase):
    """The commands, with the API answered by `fake` in place of the network."""

    def run_main(self, command, before, after, revoke_ok=True):
        calls = []

        def fake(method, url):
            calls.append((method, url))
            if method == "GET":
                if after is None:
                    raise urllib.error.URLError("no network")
                return 200, json.dumps(after).encode()
            if not revoke_ok:
                raise urllib.error.HTTPError(url, 403, "Forbidden", {}, io.BytesIO(b"{}"))
            return 204, b""

        real = CERTS.call
        CERTS.call = fake
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path = os.path.join(tmp, "certificates.json")
                summary = os.path.join(tmp, "summary.md")
                if before is not None:
                    with open(path, "w") as f:
                        json.dump(before, f)
                out = io.StringIO()
                # The run's summary in a file of the test's own, never CI's job summary.
                with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": summary}):
                    with contextlib.redirect_stdout(out):
                        code = CERTS.main(["testflight-certs.py", command, path])
                written = said = None
                if os.path.exists(path):
                    with open(path) as f:
                        written = json.load(f)
                if os.path.exists(summary):
                    with open(summary) as f:
                        said = f.read()
        finally:
            CERTS.call = real
        return code, [c for c in calls if c[0] == "DELETE"], out.getvalue(), written, said

    def test_clean_revokes_the_chosen_certificate_and_nothing_else(self):
        code, deletes, out, _, said = self.run_main("clean", answer(*OLD), answer(*OLD, NEW_DEV))
        self.assertEqual(code, 0)
        self.assertEqual(deletes, [("DELETE", CERTS.API + "/RUNDEV0001")])
        self.assertIn("Revoked", out)
        self.assertNotIn("::warning::", out)
        self.assertIn("RUNDEV0001", said)
        self.assertIn("4 before signing, 5 after the run, 4 after the revoke", said)

    def test_clean_never_fails_the_run(self):
        cases = {
            "no list before": (None, answer(*OLD, NEW_DEV), True),
            "the list after fails": (answer(*OLD), None, True),
            "the revoke is refused": (answer(*OLD), answer(*OLD, NEW_DEV), False),
            "two new": (answer(*OLD), answer(*OLD, NEW_DEV, NEW_DEV_2), True),
        }
        for name, (before, after, revoke_ok) in cases.items():
            with self.subTest(name):
                code, deletes, out, _, said = self.run_main("clean", before, after, revoke_ok)
                self.assertEqual(code, 0)
                self.assertIn("::warning::", out)
                # The summary says it too, as words: no workflow command in it.
                self.assertIn("revoke", said.lower())
                self.assertNotIn("::warning::", said)
                if revoke_ok:
                    self.assertEqual(deletes, [])
                else:
                    self.assertIn("RUNDEV0001", out)
                self.assertNotIn(PERSON, out + said)

    def test_list_saves_the_answer_or_nothing(self):
        code, deletes, out, written, _ = self.run_main("list", None, answer(*OLD))
        self.assertEqual((code, deletes, written), (0, [], answer(*OLD)))
        code, deletes, out, written, _ = self.run_main("list", None, None)
        self.assertEqual((code, deletes, written), (0, [], None))
        self.assertIn("::warning::", out)

    def test_usage(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(CERTS.main(["testflight-certs.py"]), 2)
            self.assertEqual(CERTS.main(["testflight-certs.py", "revoke", "x"]), 2)


class Jose(unittest.TestCase):
    def test_a_der_signature_becomes_r_and_s_of_32_bytes_each(self):
        r = bytes([0x80]) + bytes(range(1, 32))  # high bit set: DER puts a zero byte before it
        s = bytes(range(1, 32))  # 31 bytes: its leading zero byte left out of DER
        der = bytes([0x30, 2 + 33 + 2 + 31, 0x02, 33, 0]) + r + bytes([0x02, 31]) + s
        self.assertEqual(CERTS.jose(der), r + b"\0" + s)

    def test_anything_else_is_refused(self):
        for der in (b"", b"\x30\x00", b"\x31\x06\x02\x01\x01\x02\x01\x01", b"\x30\x03\x02\x01\x01"):
            with self.subTest(der.hex()):
                with self.assertRaises(ValueError):
                    CERTS.jose(der)


if __name__ == "__main__":
    unittest.main()
