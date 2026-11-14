#!/usr/bin/env python3
"""S12: no file git tracks holds a character its reader can't see (docs/DECISIONS.md, 2026-11-13).

    python3 .github/scripts/invisible-characters.py [DIR]

CI's "CI changes" runs it on every PR and every push to main, docs-only ones too, and the required
"Typecheck · lint · unit tests" fails with it. It reads every file git tracks in DIR's repository
(here, by default), whole, as UTF-8, but a binary one: bytes that aren't UTF-8 with a NUL in their
first 8,000, git's own test. It flags each character in FLAGGED, and the emoji selector outside an
emoji: drawn as nothing, turning text around, or passing for a plain space, a line break or nothing
at all. Claude Code's Write and Edit tools make one from a typed escape (docs/GOTCHAS.md); the
escape written as text (backslash, u, the code) passes. A file that must keep one goes in ALLOWED,
with why, by the owner's call: the only way past.

Exit 0: none found. Exit 1: found, an error on each with its line, column and name. Exit 2: git
can't list the files or lists none, or a file can't be read or isn't UTF-8, which never reads as
clean.
"""
import codecs
import os
import re
import subprocess
import sys
import unicodedata

# What it flags, as first and last code points (docs/DECISIONS.md says why each is in or out).
FLAGGED = [
    # Unicode's default-ignorable characters, drawn as nothing: the zero-width and joining ones, the
    # text-direction marks and controls, the byte-order mark anywhere, the soft hyphen, the Hangul
    # fillers, the variation selectors, the tags. All but U+FE0F, the emoji selector: below.
    (0x00AD, 0x00AD), (0x034F, 0x034F), (0x061C, 0x061C), (0x115F, 0x1160), (0x17B4, 0x17B5),
    (0x180B, 0x180F), (0x200B, 0x200F), (0x202A, 0x202E), (0x2060, 0x206F), (0x3164, 0x3164),
    (0xFE00, 0xFE0E), (0xFEFF, 0xFEFF), (0xFFA0, 0xFFA0), (0xFFF0, 0xFFF8), (0x1BCA0, 0x1BCA3),
    (0x1D173, 0x1D17A), (0xE0000, 0xE0FFF),
    # Every space but the plain one, and the line and paragraph separators.
    (0x00A0, 0x00A0), (0x1680, 0x1680), (0x2000, 0x200A), (0x202F, 0x202F), (0x205F, 0x205F),
    (0x3000, 0x3000), (0x2028, 0x2029),
    # The control characters but tab, line feed and carriage return.
    (0x0000, 0x0008), (0x000B, 0x000C), (0x000E, 0x001F), (0x007F, 0x009F),
]


def inside(spans):
    """A character class's inside: these first and last code points."""
    return "".join(f"{re.escape(chr(a))}-{re.escape(chr(b))}" for a, b in spans)


# U+FE0F, the emoji selector, passes where it shapes an emoji: after a character past ASCII that
# isn't a selector itself, or in a keycap (a digit, # or *, the selector, then U+20E3). Anywhere
# else it's flagged: after a letter it makes a name that looks like another, and a run of selectors
# can carry hidden text.
EMOJI, KEYCAP = re.escape(chr(0xFE0F)), re.escape(chr(0x20E3))
PATTERN = re.compile(f"[{inside(FLAGGED)}]"
                     f"|(?<![^{inside([(0x00, 0x7F), (0xFE00, 0xFE0F), (0xE0100, 0xE01EF)])}])"
                     f"(?!(?<=[0-9#*]){EMOJI}{KEYCAP}){EMOJI}")

# A file that keeps one on purpose: its path as git lists it, and why. Empty, and meant to stay so:
# an entry is the owner's call.
ALLOWED = {}

PROBE = 8000  # git's: a NUL in a file's first 8,000 bytes makes it binary
WIDE = (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE, codecs.BOM_UTF32_BE)  # UTF-32 LE's starts as 16's
BACKSLASH = chr(92)  # built, since Claude Code's tools turn a typed escape into its character
WHERE = ".github/scripts/invisible-characters.py"
ASK = f"A file that must keep one goes in ALLOWED in {WHERE}, with why, and only by the owner's call."


def name_of(char, at):
    """Its Unicode name in lower case; a byte-order mark where it opens the file."""
    if char == chr(0xFEFF) and at == 0:
        return "byte-order mark"
    return unicodedata.name(char, "control character" if char < chr(0xA0) else "unassigned character").lower()


def escape(code):
    """It written as text: TypeScript's and Kotlin's escape, then Swift's. Past U+FFFF, the braces
    TypeScript and Swift take (Kotlin writes its two surrogate halves)."""
    if code > 0xFFFF:
        return f"{BACKSLASH}u{{{code:X}}}"
    return f"{BACKSLASH}u{code:04X}, or {BACKSLASH}u{{{code:X}}} in Swift"


def findings(text):
    """(line, column, code point, name) of each flagged character in `text`, in order, counted as
    git and GitHub count them: lines by line feed, columns by character, from 1."""
    found, line, start, seen = [], 1, 0, 0
    for match in PATTERN.finditer(text):
        at = match.start()
        breaks = text.count("\n", seen, at)
        if breaks:
            line += breaks
            start = text.rindex("\n", seen, at) + 1
        seen = at
        found.append((line, at - start + 1, ord(match.group()), name_of(match.group(), at)))
    return found


def git(where, *args):
    return subprocess.run(["git", "-C", where, *args], capture_output=True, check=True).stdout.decode(
        "utf-8", "surrogateescape")


def tracked(root):
    """The top of `root`'s repository and every path git tracks there; or None, and why not."""
    try:
        top = git(root, "rev-parse", "--show-toplevel").rstrip("\n")
        return top, list(dict.fromkeys(path for path in git(top, "ls-files", "-z").split("\0") if path))
    except subprocess.CalledProcessError as error:
        return None, error.stderr.decode("utf-8", "replace").strip() or f"exit {error.returncode}"
    except OSError as error:
        return None, error.strerror


def prop(value):
    """A workflow command's property, escaped."""
    for raw, escaped in (("%", "%25"), ("\r", "%0D"), ("\n", "%0A"), (":", "%3A"), (",", "%2C")):
        value = value.replace(raw, escaped)
    return value


def data(value):
    """A workflow command's message, escaped."""
    for raw, escaped in (("%", "%25"), ("\r", "%0D"), ("\n", "%0A")):
        value = value.replace(raw, escaped)
    return value


def main(args):
    top, paths = tracked(args[0] if args else ".")
    if top is None:
        why = f"git couldn't list the files to scan ({paths}), so nothing was scanned."
        print(f"::error::{data(why)}")
        return 2
    if not paths:
        print("::error::git lists no file here, so nothing was scanned.")
        return 2
    hits = unread = scanned = binary = 0
    for path in paths:
        if path in ALLOWED:
            print(f"Not scanned, allowed: {path} ({ALLOWED[path]})")
            continue
        try:
            with open(os.path.join(top, path), "rb") as file:
                content = file.read()
        except OSError as error:
            unread += 1
            why = f"Can't read {path} ({error.strerror}), so it wasn't scanned."
            print(f"::error file={prop(path)}::{data(why)}")
            continue
        if content.startswith(WIDE):
            unread += 1
            why = (f"{path} is UTF-16 or UTF-32 by its byte-order mark, so the scan can't read its "
                   "characters. Save it as UTF-8.")
            print(f"::error file={prop(path)},line=1,col=1::{data(why)}")
            continue
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError as error:
            # Binary only where it isn't UTF-8 either: a NUL in UTF-8 text is a character to flag.
            if b"\0" in content[:PROBE]:
                binary += 1
                continue
            unread += 1
            before = content[:error.start].decode("utf-8")
            line, column = before.count("\n") + 1, len(before) - before.rfind("\n")
            why = (f"{path} isn't UTF-8 from here, so the scan can't read its characters. Save it as "
                   f"UTF-8. {ASK}")
            print(f"::error file={prop(path)},line={line},col={column}::{data(why)}")
            continue
        scanned += 1
        for line, column, code, name in findings(text):
            hits += 1
            why = (f"U+{code:04X} {name}, a character its reader can't see. Where it's meant, write its "
                   f"escape as text ({escape(code)}); where it isn't, delete it.")
            print(f"::error file={prop(path)},line={line},col={column}::{data(why)}")
    if hits:
        print(f"::error::{hits} character(s) above that a reader can't see. Write each as its escape in "
              "text, or delete it: Claude Code's Write and Edit tools turn a typed escape into its "
              f"character (docs/GOTCHAS.md says how to write one). {ASK}")
    if unread:
        print(f"::error::{unread} file(s) above couldn't be read as UTF-8 text, so the scan fails closed.")
        return 2
    if hits:
        return 1
    print(f"Scanned {scanned} tracked text file(s), {binary} binary file(s) skipped: no invisible or "
          "text-direction character.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
