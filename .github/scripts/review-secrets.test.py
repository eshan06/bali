#!/usr/bin/env python3
"""The review's secret scan against made-up secrets, and against ordinary reviews.

Run from the repository root: python3 .github/scripts/review-secrets.test.py

Every sample is assembled from pieces, so no whole credential-shaped string sits
in the repository for push protection or a scanner to trip on. None is real.
"""
import contextlib
import importlib.util
import io
import shutil
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "review_secrets", Path.cwd() / ".github/scripts/review-secrets.py"
)
SCAN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCAN)

FILLER = "Q7xR2mK9pL4vN8wT3zY6bC1dF5gH0jS"  # 31 characters, not a key


def body(n):
    return (FILLER * 4)[:n]


SECRETS = {
    "AWS access key id": "AK" + "IA" + "Q7XR2MK9PL4VN8WT",
    "AWS temporary key id": "AS" + "IA" + "Q7XR2MK9PL4VN8WT",
    "private key, real newlines": "-----BEGIN " + "PRIVATE KEY-----\n" + body(64) + "\n",
    "RSA private key": "-----BEGIN RSA " + "PRIVATE KEY-----\n" + body(64),
    "private key, escaped newlines": '"-----BEGIN EC ' + "PRIVATE KEY-----\\n" + body(40) + '"',
    "GitHub classic token": "gh" + "p_" + body(36),
    "GitHub OAuth token": "gh" + "o_" + body(36),
    "GitHub fine-grained token": "github" + "_pat_" + "11ABCDEFG0" + body(50),
    "Anthropic API key": "sk-" + "ant-" + "api03-" + body(40),
    "Claude OAuth token": "sk-" + "ant-" + "oat01-" + body(40),
    "Slack bot token": "xo" + "xb-" + "1234567890-" + body(20),
    "Slack webhook": "https://hooks.slack" + ".com/services/T0000" + "/B0000/" + body(24),
    "JWT bearer": "Authorization: Bearer ey" + "J" + body(20) + ".ey" + "J" + body(30)
    + "." + body(43),
    "INTERNAL_API_KEY with a value": "INTERNAL_API" + "_KEY=" + "9f2c" + body(28),
    "DATABASE_URL with a password": "DATABASE" + "_URL: postgres://bali:" + body(20)
    + "@db.internal:5432/bali",
    "SENTRY_DSN quoted": 'SENTRY' + '_DSN="https://' + body(32) + '@o1.ingest.sentry.io/2"',
    "CLAUDE_CODE_OAUTH_TOKEN with a value": "CLAUDE_CODE_OAUTH" + "_TOKEN = " + body(40),
}

CLEAN = {
    "an ordinary review": "Adds a sweep test.\n\n- WARN apps/api/src/x.ts:12 naming\n\nVERDICT: PASS",
    "the secret names alone": "INTERNAL_API_KEY and DATABASE_URL come from Railway's variables.",
    "a workflow's secret reference": "claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
    "an env reference": "INTERNAL_API_KEY=$INTERNAL_API_KEY",
    ".env.example's placeholders": "INTERNAL_API_KEY=change-me-to-a-long-random-secret\n"
    "DATABASE_URL=postgres://user:password@localhost:5432/bali\n"
    'APNS_KEY_P8="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----"\n'
    "AUTH_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXXXXX",
    "a key header in prose": "The .p8 starts with -----BEGIN PRIVATE KEY----- and is set in CI.",
    "a commit sha and a UUID": "Pinned to 86d88e619d8e6caf07b5c3944dd14f441c533718; "
    "event 01890a5d-ac96-774b-bcce-b302099a8057.",
    "words that start like tokens": "The ghost_value and sk-ant-short and xoxb-1 are fine.",
    "a short JWT-like dotted name": "eyJhbGci.eyJzdWIi.abc",
}


def run(text):
    """The scan's exit code and output on a file holding `text`."""
    tmp = Path(tempfile.mkdtemp())
    try:
        path = tmp / "claude-review.md"
        path.write_text(text)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = SCAN.main(["review-secrets.py", str(path)])
        return code, out.getvalue()
    finally:
        shutil.rmtree(tmp)


class ReviewSecrets(unittest.TestCase):
    def test_each_secret_is_refused_and_never_echoed(self):
        for name, secret in SECRETS.items():
            with self.subTest(name):
                code, out = run(f"Summary.\n\n- BLOCKER x.ts:1 leaked {secret} here\n\nVERDICT: FAIL\n")
                self.assertEqual(code, 1, out)
                self.assertIn("line 3", out)
                self.assertIn("was not posted", out)
                for line in secret.splitlines():
                    if len(line) >= 16:
                        self.assertNotIn(line, out)
                self.assertNotIn(FILLER[:16], out)

    def test_ordinary_text_passes(self):
        for name, text in CLEAN.items():
            with self.subTest(name):
                code, out = run(text)
                self.assertEqual(code, 0, out)

    def test_a_missing_file_is_an_error_not_a_pass(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = SCAN.main(["review-secrets.py", "/nonexistent/claude-review.md"])
        self.assertEqual(code, 2)
        self.assertIn("Can't read", out.getvalue())

    def test_no_argument_is_an_error(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(SCAN.main(["review-secrets.py"]), 2)


if __name__ == "__main__":
    unittest.main()
