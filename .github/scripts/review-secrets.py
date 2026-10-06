#!/usr/bin/env python3
"""Refuse a Claude review that looks like it carries a credential (Phase 6, S6).

claude-review.yml runs this on claude-review.md before posting it as a PR
comment. A finding names the kind of secret and its line, never the text, so
the run's log doesn't leak what the comment would have.

    python3 .github/scripts/review-secrets.py claude-review.md

Exit 0: nothing found. 1: a likely secret (not posted). 2: the file can't be read.
"""
import re
import sys

# A few high-signal shapes; a false alarm costs a re-run, a miss costs a rotation.
PATTERNS = [
    # AWS's documented sample ids end in EXAMPLE.
    ("an AWS access key id", re.compile(r"\b(?:AKIA|ASIA)(?![0-9A-Z]{9}EXAMPLE\b)[0-9A-Z]{16}\b")),
    # The header alone is how docs show where a key goes; a body after it is a key.
    (
        "a private key block",
        re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----(?:\\n|\s)*[A-Za-z0-9+/=]{20,}"),
    ),
    ("a GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("a GitHub fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}")),
    ("an Anthropic key or token", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}")),
    ("a Slack token", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}")),
    ("a Slack webhook", re.compile(r"hooks\.slack\.com/services/T[A-Za-z0-9_/]{20,}")),
    (
        "a JWT",
        re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}"),
    ),
]

# This repository's secrets by name (.env.example, the workflows' secrets),
# caught when one is written with a value.
SECRET_NAMES = (
    "DATABASE_URL",
    "INTERNAL_API_KEY",
    "SENTRY_DSN",
    "APNS_KEY_P8",
    "APP_STORE_CONNECT_KEY_P8",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
)
NAMED = re.compile(
    r"\b(" + "|".join(SECRET_NAMES) + r")\b[\"']?[ \t]*[:=][ \t]*[\"']?([^\s\"'`]{16,})"
)
# What .env.example and the docs write in a secret's place.
PLACEHOLDER = re.compile(
    r"^(\$|<|\*)|change-me|example|XXXX|localhost|your-|\.\.\.|user:password@", re.I
)


def findings(text):
    """(line number, kind) for each likely secret in `text`."""
    found = []
    for kind, pattern in PATTERNS:
        for match in pattern.finditer(text):
            found.append((text.count("\n", 0, match.start()) + 1, kind))
    for match in NAMED.finditer(text):
        if not PLACEHOLDER.search(match.group(2)):
            line = text.count("\n", 0, match.start()) + 1
            found.append((line, f"a value for {match.group(1)}"))
    return sorted(found)


def main(argv):
    if len(argv) != 2:
        print("usage: review-secrets.py <file>", file=sys.stderr)
        return 2
    try:
        with open(argv[1], encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError as error:
        print(f"::error::Can't read {argv[1]} to check it for secrets: {error.strerror}.")
        return 2
    found = findings(text)
    for number, kind in found:
        print(f"::error::{argv[1]} line {number} looks like it contains {kind}.")
    if found:
        print(
            f"::error::{argv[1]} was not posted: it may contain a secret (not shown here)."
            " Check the PR's diff for a leaked credential and rotate it if it's real,"
            " then push or re-run the review."
        )
        return 1
    print(f"{argv[1]}: no secrets found.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
