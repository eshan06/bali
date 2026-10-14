#!/usr/bin/env python3
"""The migration guard (.github/workflows/migration-guard.yml): a migration that destroys or
rewrites data never merges without the owner (docs/DECISIONS.md, 2026-10-14).

    python3 .github/scripts/migration-guard.py [--approved] FILE...

Each FILE is migration SQL, read as drizzle runs it: split at `--> statement-breakpoint`, each
part sent to Postgres on its own. Outside comments, in any case, it flags DROP TABLE, DROP
COLUMN, TRUNCATE, DELETE FROM, UPDATE ... SET, MERGE, a column type change, RENAME, and a
DROP ... CASCADE or DROP OWNED, in each spelling Postgres takes (COLUMN left out, an upsert's
UPDATE SET). Index and constraint drops and additive DDL pass. Strings, quoted names and
dollar-quoted bodies are checked like code, since a function body or an EXECUTE '...' runs:
only what is surely a comment is skipped, so a word in one never fails and nothing else hides.

Exit 0: nothing found, or found with --approved (the owner's label is on the PR): notices.
Exit 1: found, not approved: an error on each file and line. Exit 2: a file can't be read,
which never reads as clean.
"""
import re
import sys

LABEL = "owner-approved-migration"
SEPARATOR = "--> statement-breakpoint"  # where drizzle-orm's migrator splits each file

# A name, quoted or not. An unquoted one is taken whole, never tried in pieces: the \b around
# each keyword already keeps a piece from matching, and this keeps a long word from being slow.
NAME = r'(?:(?:U&)?"(?:[^"]|"")*"|[^\W\d][\w$]*(?![\w$]))'
QNAME = rf"{NAME}(?:\s*\.\s*{NAME})*"
# Where an ALTER TABLE action starts: after the table's name, or after a comma.
ACTION = rf"(?:\bALTER\s+TABLE\b(?:\s+IF\s+EXISTS\b)?(?:\s+ONLY\b)?\s*{QNAME}(?:\s*\*)?|,)\s*"
# Each kind as findings are reported, and the patterns that find it. A pattern's group `at` is
# where it is reported when that isn't where it starts.
RULES = [
    ("DROP TABLE", r"\bDROP\s+TABLE\b"),
    ("DROP COLUMN", r"\bDROP\s+COLUMN\b"),
    ("DROP COLUMN", rf"{ACTION}(?P<at>\bDROP\b)(?!\s*(?:COLUMN|CONSTRAINT)\b)"),  # COLUMN left out
    ("TRUNCATE", r"\bTRUNCATE\b"),
    ("DELETE FROM", r"\bDELETE\s+FROM\b"),
    ("UPDATE ... SET", rf"\bUPDATE\b\s*(?:\bONLY\b\s*)?{QNAME}(?:\s*\*)?(?:\s*(?:\bAS\b\s*)?{NAME})?\s*\bSET\b"),
    # An upsert's or a MERGE's. A foreign key's ON UPDATE SET NULL or SET DEFAULT changes no row now.
    ("UPDATE ... SET", r"\bUPDATE\s+SET\b(?!\s*(?:NULL|DEFAULT)\b)"),
    ("MERGE", r"\bMERGE\s+INTO\b"),
    ("a column type change", r"\bSET\s+DATA\s+TYPE\b"),
    ("a column type change", rf"\bALTER\s+COLUMN\b\s*{NAME}\s*\bTYPE\b"),
    ("a column type change", rf"{ACTION}(?P<at>\bALTER\b)\s*(?!COLUMN\b){NAME}\s*\bTYPE\b"),
    ("RENAME", r"\bRENAME\b"),
    # It drops what depends on what it drops, columns and tables included (DROP TABLE and DROP
    # COLUMN are their own kinds); an index's or a constraint's keeps the data.
    ("DROP ... CASCADE", r"(?P<at>\bDROP\b)(?!\s*(?:TABLE|COLUMN|INDEX|CONSTRAINT|DEFAULT|NOT"
     r"|EXPRESSION|IDENTITY)\b)[^;]*?\bCASCADE\b"),
    ("DROP OWNED", r"\bDROP\s+OWNED\b"),
]
KINDS = list(dict.fromkeys(kind for kind, _ in RULES))
RULES = [(kind, re.compile(pattern, re.I)) for kind, pattern in RULES]

SPECIAL = re.compile(r"""--|/\*|['"$]""")
LINE_END = re.compile(r"[\r\n]")  # Postgres ends a -- comment at either
BLOCK = re.compile(r"/\*|\*/")
DOLLAR = re.compile(r"\$(?:[^\W\d]\w*)?\$")
WORD = re.compile(r"[\w$]")


def blank(text):
    """Every character but a newline as a space, so offsets and line numbers hold."""
    return re.sub(r"[^\n]", " ", text)


def quoted_end(sql, start):
    """Where the string or quoted name at `start` ends. A doubled quote stays inside, and in an
    E'...' string so does a backslash's next character. Unterminated, it runs to the end."""
    quote = sql[start]
    escapes = (quote == "'" and start > 0 and sql[start - 1] in "eE"
               and not (start > 1 and WORD.match(sql[start - 2])))
    at = start + 1
    while at < len(sql):
        if escapes and sql[at] == "\\":
            at += 2
        elif sql[at] != quote:
            at += 1
        elif sql.startswith(quote, at + 1):
            at += 2
        else:
            return at + 1
    return len(sql)


def block_end(sql, start):
    """Where the /* comment at `start` ends (they nest), or None if it never does."""
    depth = 0
    for mark in BLOCK.finditer(sql, start):
        depth += 1 if mark.group() == "/*" else -1
        if depth == 0:
            return mark.end()
    return None


def uncommented(sql):
    """One statement part as Postgres lexes it, its comments blanked out."""
    out, at = [], 0
    while True:
        found = SPECIAL.search(sql, at)
        if not found:
            out.append(sql[at:])
            return "".join(out)
        start, token = found.start(), found.group()
        out.append(sql[at:start])
        if token == "--":
            stop = LINE_END.search(sql, start)
            at = stop.start() if stop else len(sql)
            out.append(blank(sql[start:at]))
        elif token == "/*":
            at = block_end(sql, start)
            if at is None:  # Postgres refuses it; checked like code all the same
                out.append(sql[start:])
                return "".join(out)
            out.append(blank(sql[start:at]))
        elif token == "$":
            tag = DOLLAR.match(sql, start)
            if tag and not (start and WORD.match(sql[start - 1])):
                close = sql.find(tag.group(), tag.end())
                at = len(sql) if close < 0 else close + len(tag.group())
            else:
                at = start + 1
            out.append(sql[start:at])
        else:
            at = quoted_end(sql, start)
            out.append(sql[start:at])


def code_of(sql):
    """`sql` with its comments blanked out, each part between drizzle's separators lexed on its
    own, as Postgres receives it; the separators blanked too. Offsets and lines are unchanged."""
    return (" " * len(SEPARATOR)).join(uncommented(part) for part in sql.split(SEPARATOR))


def findings(sql):
    """[(line, kind)] for each place in `sql` that destroys or rewrites data, in line order."""
    code = code_of(sql)
    found = set()
    for kind, rule in RULES:
        for match in rule.finditer(code):
            at = match.start("at") if "at" in rule.groupindex else match.start()
            found.add((code.count("\n", 0, at) + 1, kind))
    return sorted(found, key=lambda hit: (hit[0], KINDS.index(hit[1])))


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
    approved = args[:1] == ["--approved"]
    files = args[1:] if approved else args
    if not files:
        print("usage: migration-guard.py [--approved] FILE...", file=sys.stderr)
        return 2
    total = unreadable = 0
    for path in files:
        try:
            # As drizzle reads it: UTF-8, line endings untouched.
            with open(path, encoding="utf-8", errors="replace", newline="") as file:
                sql = file.read()
        except OSError as error:
            unreadable += 1
            message = f"Can't read {path} ({error.strerror}), so it can't be checked."
            print(f"::error file={prop(path)}::{data(message)}")
            continue
        for line, kind in findings(sql):
            total += 1
            if approved:
                message = f"{kind}: approved by the owner ({LABEL})."
            else:
                message = f"{kind}: this destroys or rewrites data, so the owner must approve it."
            print(f"::{'notice' if approved else 'error'} file={prop(path)},line={line}::{data(message)}")
    if unreadable:
        print(f"::error::{unreadable} migration file(s) couldn't be read: the guard fails closed.")
        return 2
    if total and not approved:
        print(f"::error::{total} place(s) above destroy or rewrite data. The owner must approve "
              f"this migration: they add the label {LABEL} to this PR. A new push removes it, so "
              "each version of the PR needs its own approval.")
        return 1
    if total:
        print(f"{total} place(s) destroy or rewrite data; the owner approved them ({LABEL}).")
    else:
        print(f"Nothing in {len(files)} migration file(s) destroys or rewrites data.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
