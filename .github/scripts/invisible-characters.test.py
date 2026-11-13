#!/usr/bin/env python3
"""Self-test for invisible-characters.py (S12), each case in a repository made for it: every
character the scan must flag fails, named, at its line and column, a byte-order mark at a file's
start too; the escape written as text, the characters it leaves alone, a binary file, a clean tree
and an allowed file pass; a file it can't read, one that isn't UTF-8 and a folder git can't list
fail. CI runs it before the scan, so a scan that stops finding fails instead of passing.

    python3 .github/scripts/invisible-characters.test.py

Every character it plants is made at run time from its code point, by chr(): one typed into this
file would be the very thing the scan is for.
"""
import contextlib
import importlib.util
import io
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("invisible_characters", SCRIPTS / "invisible-characters.py")
invisible = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(invisible)

BACKSLASH = chr(92)

# What the scan must flag (docs/DECISIONS.md, 2026-11-13), as first and last code points: typed
# here on their own, never read from the script, so a range it drops fails this test.
MUST_FLAG = [
    # Unicode's default-ignorable characters, drawn as nothing, but the variation selectors.
    (0x00AD, 0x00AD), (0x034F, 0x034F), (0x061C, 0x061C), (0x115F, 0x1160), (0x17B4, 0x17B5),
    (0x180B, 0x180F), (0x200B, 0x200F), (0x202A, 0x202E), (0x2060, 0x206F), (0x3164, 0x3164),
    (0xFEFF, 0xFEFF), (0xFFA0, 0xFFA0), (0xFFF0, 0xFFF8), (0x1BCA0, 0x1BCA3), (0x1D173, 0x1D17A),
    (0xE0000, 0xE00FF), (0xE01F0, 0xE0FFF),
    # Every space but the plain one, and the line and paragraph separators.
    (0x00A0, 0x00A0), (0x1680, 0x1680), (0x2000, 0x200A), (0x202F, 0x202F), (0x205F, 0x205F),
    (0x3000, 0x3000), (0x2028, 0x2029),
    # The control characters but tab, line feed and carriage return.
    (0x0000, 0x0008), (0x000B, 0x000C), (0x000E, 0x001F), (0x007F, 0x009F),
]
FLAGS = {code for first, last in MUST_FLAG for code in range(first, last + 1)}

# One error the scan prints: where, the code point and its name.
ANNOTATION = re.compile(r"^::error file=(?P<file>[^,]+),line=(?P<line>\d+),col=(?P<col>\d+)"
                        r"::U\+(?P<code>[0-9A-F]{4,6}) (?P<name>[^,]+),", re.M)


def flagged(out):
    """{"path:line:column U+code": name} for each character the scan's output flags."""
    return {f"{m['file']}:{m['line']}:{m['col']} U+{m['code']}": m["name"] for m in ANNOTATION.finditer(out)}


def said(out):
    """What the scan printed, for a failure's message: cut short, and indented, so CI's log runs
    none of its workflow commands."""
    return "\n" + "\n".join("    " + line for line in out[:4000].splitlines())


class Scan(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.repo = Path(folder.name)
        # No machine's git config reaches these repositories, and git never looks above one.
        env = mock.patch.dict(os.environ, {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                                           "GIT_CEILING_DIRECTORIES": str(self.repo.parent)})
        env.start()
        self.addCleanup(env.stop)
        self.git("init", "-q")

    def git(self, *args):
        subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True)

    def track(self, name, content):
        """`content`, bytes or text written as UTF-8, in a file git tracks."""
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))
        self.git("add", "--", name)
        return path

    def run_scan(self, allowed=(), root=None):
        """The scan's exit code and what it printed, run on `root` (this repository by default)."""
        out = io.StringIO()
        with mock.patch.dict(invisible.ALLOWED, dict(allowed)), contextlib.redirect_stdout(out):
            code = invisible.main([str(root or self.repo)])
        return code, out.getvalue()

    def test_each_character_fails_named_at_its_line_and_column(self):
        codes = sorted(FLAGS)
        # Plain lines first: a NUL in a file's first 8,000 bytes makes it binary, as git reads it.
        lines = ["a plain line of text"] * 500 + [f"{'ab'[:i % 3]}{chr(code)}." for i, code in enumerate(codes)]
        self.track("docs/planted.md", "\n".join(lines) + "\n")
        code, out = self.run_scan()
        self.assertEqual(code, 1, said(out))
        found = flagged(out)
        self.assertEqual(set(found), {f"docs/planted.md:{501 + i}:{1 + i % 3} U+{code:04X}"
                                      for i, code in enumerate(codes)})
        names = {found[place] for place in found}
        for name in ("zero width space", "zero width joiner", "right-to-left override",
                     "left-to-right isolate", "arabic letter mark", "zero width no-break space",
                     "soft hyphen", "hangul filler", "no-break space", "narrow no-break space",
                     "line separator", "tag latin capital letter a", "cancel tag",
                     "control character", "unassigned character"):
            self.assertIn(name, names)
        # How to fix it, said with each: its escape as text, Swift's too, or delete it.
        self.assertIn(f"U+200B zero width space, a character its reader can't see. Where it's meant, "
                      f"write its escape as text ({BACKSLASH}u200B, or {BACKSLASH}u{{200B}} in Swift); "
                      "where it isn't, delete it.", out)
        self.assertIn(f"({BACKSLASH}u{{E0041}})", out)
        self.assertRegex(out, rf"(?m)^::error::{len(codes)} character\(s\) above that a reader can't see")

    def test_a_byte_order_mark_at_a_files_start_fails(self):
        self.track("app.ts", chr(0xFEFF) + "export const x = 1;\n")
        code, out = self.run_scan()
        self.assertEqual(code, 1, said(out))
        self.assertEqual(flagged(out), {"app.ts:1:1 U+FEFF": "byte-order mark"})

    def test_the_escape_written_as_text_passes(self):
        self.track("a.ts", f"export const s = '{BACKSLASH}u200B{BACKSLASH}u{{202E}}{BACKSLASH}u00a0';\n")
        self.track("B.kt", f'val bom = "{BACKSLASH}uFEFF{BACKSLASH}u001B"\n')
        self.track("c.swift", f'let nbsp = "{BACKSLASH}u{{A0}}"\n')
        self.track("d.md", f"Write U+200B as `{BACKSLASH}u200B`, or the entity `&nbsp;`.\n")
        code, out = self.run_scan()
        self.assertEqual(code, 0, said(out))
        self.assertIn("Scanned 4 tracked text file(s), 0 binary file(s) skipped", out)

    def test_what_it_leaves_alone_passes(self):
        # Each flagged range's neighbours, the variation selectors emoji need, and two symbols
        # drawn blank that main's display-name rules use on purpose (the braille blank, the null
        # notehead).
        beside = {first - 1 for first, _ in MUST_FLAG} | {last + 1 for _, last in MUST_FLAG}
        left = sorted(beside - FLAGS - {-1, 0x0A}) + [0xFE00, 0xFE0E, 0xFE0F, 0xE0100, 0xE01EF, 0x2800, 0x1D159]
        self.assertIn(0x0D, left)
        text = "".join(f"a{chr(code)}b\n" for code in left)
        # Emoji the docs use, a keycap digit, letters past ASCII, a tab and Windows' line ends.
        text += (f"{chr(0x2696)}{chr(0xFE0F)} {chr(0x2705)} 1{chr(0xFE0F)}{chr(0x20E3)}\r\n"
                 f"caf{chr(0xE9)}\t{chr(0x645)}{chr(0x6CC)}\r\n")
        self.track("fine.md", text)
        code, out = self.run_scan()
        self.assertEqual(code, 0, said(out))
        self.assertNotIn("::error", out)

    def test_a_binary_file_passes(self):
        planted = "".join(chr(code) for code in (0x200B, 0x202E, 0xFEFF, 0x00A0, 0x001B)).encode("utf-8")
        self.track("icon.png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR" + planted)
        code, out = self.run_scan()
        self.assertEqual(code, 0, said(out))
        self.assertIn("Scanned 0 tracked text file(s), 1 binary file(s) skipped", out)

    def test_binary_is_a_nul_in_the_first_8000_bytes_as_git_reads_it(self):
        self.track("last.bin", b"a" * 7999 + b"\x00" + chr(0x200B).encode("utf-8"))
        self.track("past.txt", b"a" * 8000 + b"\x00\n")
        code, out = self.run_scan()
        self.assertEqual(code, 1, said(out))
        self.assertEqual(flagged(out), {"past.txt:1:8001 U+0000": "control character"})

    def test_a_clean_tree_passes(self):
        self.track("README.md", f"# A repo\n\nPlain words, caf{chr(0xE9)}, and a phone {chr(0x1F4F1)}.\n")
        self.track("src/app.ts", "export const answer = 42;\r\n")
        self.track("empty.txt", b"")
        code, out = self.run_scan()
        self.assertEqual(code, 0, said(out))
        self.assertIn("Scanned 3 tracked text file(s), 0 binary file(s) skipped: no invisible or "
                      "text-direction character.", out)
        self.assertNotIn("::error", out)

    def test_an_allowed_file_passes_and_the_same_character_elsewhere_fails(self):
        self.track("kept.txt", f"a{chr(0x200B)}b\n")
        allowed = {"kept.txt": "a test's reason"}
        code, out = self.run_scan(allowed)
        self.assertEqual(code, 0, said(out))
        self.assertIn("Not scanned, allowed: kept.txt (a test's reason)", out)
        self.track("other.txt", f"a{chr(0x200B)}b\n")
        code, out = self.run_scan(allowed)
        self.assertEqual(code, 1, said(out))
        self.assertEqual(flagged(out), {"other.txt:1:2 U+200B": "zero width space"})

    def test_a_file_it_cant_read_fails(self):
        self.track("fine.txt", "fine\n")
        self.track("gone.txt", "here\n").unlink()  # still tracked, no longer there
        code, out = self.run_scan()
        self.assertEqual(code, 2, said(out))
        self.assertRegex(out, r"(?m)^::error file=gone\.txt::Can't read gone\.txt \(.+\), so it wasn't scanned\.$")
        self.assertRegex(out, r"(?m)^::error::1 file\(s\) above couldn't be read as UTF-8 text")

    def test_a_file_that_isnt_utf8_fails(self):
        self.track("latin1.txt", b"ok\ncaf\xe9 au lait\n")
        code, out = self.run_scan()
        self.assertEqual(code, 2, said(out))
        self.assertRegex(out, r"(?m)^::error file=latin1\.txt,line=2,col=4::latin1\.txt isn't UTF-8 from here")

    def test_a_folder_git_cant_list_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            code, out = self.run_scan(root=folder)
        self.assertEqual(code, 2, said(out))
        self.assertRegex(out, r"(?m)^::error::git couldn't list the files to scan \(.+\), so nothing was scanned\.$")

    def test_run_from_a_folder_it_scans_the_whole_repository(self):
        self.track("top.txt", f"a{chr(0x202E)}\n")
        self.track("sub/deep.txt", f"{chr(0x200B)}\n")
        code, out = self.run_scan(root=self.repo / "sub")
        self.assertEqual(code, 1, said(out))
        self.assertEqual(set(flagged(out)), {"top.txt:1:2 U+202E", "sub/deep.txt:1:1 U+200B"})


if __name__ == "__main__":
    unittest.main()
