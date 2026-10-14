#!/usr/bin/env python3
"""Self-test for migration-guard.py: each kind it must catch, in drizzle's form and Postgres's
other spellings, and what it must let through: comments, index and constraint drops, additive
DDL, the migrations before it. The workflow runs it before the guard, so a pattern that stops
matching fails the check instead of passing every migration.

Run from the repository root: python3 .github/scripts/migration-guard.test.py
"""
import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent.parent
SPEC = importlib.util.spec_from_file_location("migration_guard", SCRIPTS / "migration-guard.py")
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)

# (case, SQL, [(line, kind)]): each one must be caught, and where.
CAUGHT = [
    ("drizzle's table drop", 'DROP TABLE "decks" CASCADE;', [(1, "DROP TABLE")]),
    ("in lower case", "drop table decks;", [(1, "DROP TABLE")]),
    ("drizzle's column drop", 'ALTER TABLE "decks" DROP COLUMN "title";', [(1, "DROP COLUMN")]),
    ("a column drop without COLUMN", "ALTER TABLE decks DROP title;", [(1, "DROP COLUMN")]),
    ("a column drop with IF EXISTS", "ALTER TABLE decks DROP IF EXISTS title;", [(1, "DROP COLUMN")]),
    ("a column drop after a comma", "ALTER TABLE decks\n  ADD COLUMN x int,\n  DROP title;",
     [(3, "DROP COLUMN")]),
    ("TRUNCATE", 'TRUNCATE "armed_taps";', [(1, "TRUNCATE")]),
    # The bare word, by the owner's rule: 0001's trigger forbidding TRUNCATE trips it too.
    ("a trigger naming TRUNCATE", "CREATE TRIGGER t BEFORE TRUNCATE ON events\n"
     "FOR EACH STATEMENT EXECUTE FUNCTION f();", [(1, "TRUNCATE")]),
    ("DELETE FROM", 'DELETE FROM "armed_taps" WHERE "consumed_at" IS NOT NULL;', [(1, "DELETE FROM")]),
    ("a backfill UPDATE", 'UPDATE "decks" SET "title" = \'\' WHERE "removed_at" IS NOT NULL;',
     [(1, "UPDATE ... SET")]),
    ("an UPDATE over lines, at its first", 'CREATE INDEX "i" ON "t" ("a");\nUPDATE "decks"\n'
     '  SET "title" = \'\';', [(2, "UPDATE ... SET")]),
    ("an UPDATE with ONLY, a schema and an alias", "UPDATE ONLY public.decks AS d SET title = '';",
     [(1, "UPDATE ... SET")]),
    ("an UPDATE with no spaces", 'UPDATE"decks"SET"title"=\'\';', [(1, "UPDATE ... SET")]),
    ("an upsert's UPDATE SET", 'INSERT INTO "t" ("a") VALUES (1)\n  ON CONFLICT ("a") DO UPDATE SET '
     '"b" = 2;', [(2, "UPDATE ... SET")]),
    ("a MERGE", "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE;", [(1, "MERGE")]),
    ("drizzle's type change", 'ALTER TABLE "decks" ALTER COLUMN "bytes" SET DATA TYPE bigint;',
     [(1, "a column type change")]),
    ("a type change with USING", "ALTER TABLE decks ALTER COLUMN bytes TYPE bigint USING "
     "bytes::bigint;", [(1, "a column type change")]),
    ("a type change without COLUMN", "ALTER TABLE decks ALTER bytes TYPE bigint;",
     [(1, "a column type change")]),
    ("a column named type, retyped", "ALTER TABLE t ALTER COLUMN type TYPE text;",
     [(1, "a column type change")]),
    ("drizzle's column rename", 'ALTER TABLE "decks" RENAME COLUMN "title" TO "name";',
     [(1, "RENAME")]),
    ("drizzle's table rename", 'ALTER TABLE "decks" RENAME TO "slides";', [(1, "RENAME")]),
    ("a type dropped with CASCADE", 'DROP TYPE "public"."mood" CASCADE;', [(1, "DROP ... CASCADE")]),
    ("a schema dropped with CASCADE", "DROP SCHEMA archive CASCADE;", [(1, "DROP ... CASCADE")]),
    ("DROP OWNED", "DROP OWNED BY CURRENT_USER;", [(1, "DROP OWNED")]),
    ("two kinds on a line", "ALTER TABLE t RENAME TO u; TRUNCATE u;", [(1, "TRUNCATE"), (1, "RENAME")]),
    # drizzle splits at its separator and sends what follows it to Postgres: never a comment.
    ("after drizzle's separators", 'CREATE INDEX "i" ON "t" ("a");--> statement-breakpoint\n'
     'ALTER TABLE "t" ADD COLUMN "c" integer;--> statement-breakpoint\n'
     'ALTER TABLE "t" DROP COLUMN "d";--> statement-breakpoint', [(3, "DROP COLUMN")]),
    ("on a separator's own line", 'ALTER TABLE "t" ADD COLUMN "c" integer;--> statement-breakpoint '
     'ALTER TABLE "t" DROP COLUMN "d";', [(1, "DROP COLUMN")]),
    # What only looks like a comment start, or ends one, is no place to hide a statement.
    ("after a string holding --", "ALTER TABLE t ADD COLUMN c text DEFAULT '--'; DROP TABLE x;",
     [(1, "DROP TABLE")]),
    ("after a quoted name holding --", 'ALTER TABLE "a--b" DROP COLUMN c;', [(1, "DROP COLUMN")]),
    ("after an E'' string with an escaped quote", "SELECT E'it\\'s -- not a comment'; DROP TABLE x;",
     [(1, "DROP TABLE")]),
    ("after a dollar-quoted body holding --", "CREATE FUNCTION f() RETURNS text LANGUAGE sql AS "
     "$body$ SELECT '--' $body$; DROP TABLE x;", [(1, "DROP TABLE")]),
    ("after a -- comment ended by a carriage return", "-- note\rDROP TABLE x;", [(1, "DROP TABLE")]),
    ("a comment between the words", "DROP/* x */TABLE t;", [(1, "DROP TABLE")]),
    ("after an unterminated /* comment", 'CREATE INDEX "i" ON "t" ("a");\n/* DROP TABLE x;',
     [(2, "DROP TABLE")]),
    # A function body or an EXECUTE runs: strings and dollar quotes are checked like code.
    ("in a function body", "CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$\n"
     "  DELETE FROM t\n$$;", [(2, "DELETE FROM")]),
    ("in an EXECUTE", "DO $$ BEGIN EXECUTE 'DROP TABLE t'; END $$;",
     [(1, "DROP TABLE"), (1, "EXECUTE of SQL built at run time")]),
    # An EXECUTE runs a string built at run time, which no pattern reads: it is a finding itself.
    ("an UPDATE built with format()", "DO $$ DECLARE t text; BEGIN\n"
     "  FOREACH t IN ARRAY ARRAY['decks', 'questions'] LOOP\n"
     "    EXECUTE format('UPDATE %I SET title = NULL', t);\n"
     "  END LOOP;\nEND $$;", [(3, "UPDATE ... SET"), (3, "EXECUTE of SQL built at run time")]),
    ("an UPDATE glued from strings", "EXECUTE 'UPDATE ' || quote_ident(t) || ' SET title = NULL';",
     [(1, "UPDATE ... SET"), (1, "EXECUTE of SQL built at run time")]),
    ("keywords split across strings", "EXECUTE 'ALTER TABLE users DR' || 'OP COLUMN email';",
     [(1, "EXECUTE of SQL built at run time")]),
    ("an EXECUTE of a variable named procedure", "DO $$ DECLARE procedure text := 'x';\n"
     "BEGIN EXECUTE procedure; END $$;", [(2, "EXECUTE of SQL built at run time")]),
    # A ; inside quotes ends no statement, and a string can't pass for a foreign key's action.
    ("an UPDATE of a quoted name holding ;", 'UPDATE "a;b" SET x = 1;', [(1, "UPDATE ... SET")]),
    ("an UPDATE with an alias holding ;", 'UPDATE users AS "u;" SET email = NULL;',
     [(1, "UPDATE ... SET")]),
    ("after a string that reads as a foreign key's action", "ALTER TABLE users ALTER COLUMN a SET "
     "DEFAULT 'ON DELETE SET NULL (', DROP COLUMN email, ALTER COLUMN b SET DEFAULT ')';",
     [(1, "DROP COLUMN")]),
    # Postgres's other spellings of a table and a name.
    ("UPDATE ONLY (name)", "UPDATE ONLY (users) SET email = NULL;", [(1, "UPDATE ... SET")]),
    ("an UPDATE with a comment inside", 'UPDATE "users" -- every row\n  SET "email" = NULL;',
     [(1, "UPDATE ... SET")]),
    ("an alias past ASCII", "UPDATE users AS u€ SET email = NULL;", [(1, "UPDATE ... SET")]),
    ("a column drop on ONLY (name)", "ALTER TABLE ONLY (users) DROP email;", [(1, "DROP COLUMN")]),
    ("a type change on ONLY (name)", "ALTER TABLE ONLY (users) ALTER name TYPE int USING 0;",
     [(1, "a column type change")]),
    ("a U& name with UESCAPE", "ALTER TABLE users ALTER COLUMN U&\"email\" UESCAPE '!' TYPE int "
     "USING 0;", [(1, "a column type change")]),
    ("after a dollar quote tagged past ASCII", "ALTER TABLE users ALTER COLUMN name SET DEFAULT "
     "$€$ -- $€$, DROP COLUMN email;", [(1, "DROP COLUMN")]),
    ("after a name holding $ past ASCII", "ALTER TABLE users ADD COLUMN x€$t$ text DEFAULT "
     "' $t$ -- ', DROP COLUMN email;", [(1, "DROP COLUMN")]),
]

# (case, SQL): each one must pass.
PASSED = [
    ("a comment that mentions DROP", "-- never DROP TABLE events: no TRUNCATE, DELETE FROM,\n"
     "-- UPDATE t SET or RENAME either (the owner's rule)\nCREATE INDEX \"i\" ON \"t\" (\"a\");"),
    ("a block comment that mentions DROP, nested", "/* DROP TABLE x; /* inner */ RENAME */\n"
     'CREATE INDEX "i" ON "t" ("a");'),
    ("an additive migration, as drizzle writes it", 'CREATE TABLE "decks" (\n'
     '\t"id" uuid PRIMARY KEY NOT NULL,\n'
     '\t"teacher_id" uuid NOT NULL,\n'
     '\t"updated_at" timestamp with time zone DEFAULT now() NOT NULL\n'
     ');\n--> statement-breakpoint\n'
     'ALTER TABLE "decks" ADD COLUMN "dropped_at" timestamp with time zone;--> statement-breakpoint\n'
     'ALTER TABLE "decks" ADD COLUMN "truncated" boolean DEFAULT false NOT NULL;--> statement-breakpoint\n'
     'ALTER TABLE "decks" ADD CONSTRAINT "decks_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") '
     'REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint\n'
     'CREATE INDEX "decks_teacher_idx" ON "decks" USING btree ("teacher_id");'),
    ("drizzle's index drop", 'DROP INDEX "events_user_seq_idx";--> statement-breakpoint\n'
     'CREATE INDEX "events_user_occurred_idx" ON "events" USING btree ("user_id","occurred_at");'),
    ("drizzle's constraint drop", 'ALTER TABLE "blocks" DROP CONSTRAINT "blocks_tag_id_unique";'),
    ("a column's default and nullability", "ALTER TABLE t ALTER COLUMN c DROP DEFAULT;\n"
     "ALTER TABLE t ALTER COLUMN c DROP NOT NULL;\nALTER TABLE t ALTER COLUMN c SET DEFAULT 1;"),
    ("a column named type, or a table", "ALTER TABLE t ALTER COLUMN type SET NOT NULL;\n"
     "ALTER TABLE type ALTER COLUMN c SET NOT NULL;"),
    ("a foreign key's actions", 'ALTER TABLE "a" ADD CONSTRAINT "f" FOREIGN KEY ("x") REFERENCES '
     '"b"("id") ON DELETE SET NULL ON UPDATE SET DEFAULT;'),
    ("a foreign key that cascades", 'ALTER TABLE "a" ADD CONSTRAINT "f" FOREIGN KEY ("x") REFERENCES '
     '"b"("id") ON DELETE cascade ON UPDATE cascade;'),
    ("a foreign key's actions, UPDATE first", 'ALTER TABLE "a" ADD CONSTRAINT "f" FOREIGN KEY ("x") '
     'REFERENCES "b"("id") ON UPDATE CASCADE ON DELETE SET NULL ("x");'),
    ("a column named type", 'ALTER TABLE "events" ALTER COLUMN "type" SET DEFAULT \'unlock\';'),
    ("triggers on UPDATE and DELETE", "CREATE TRIGGER t BEFORE UPDATE OR DELETE ON events\n"
     "FOR EACH ROW WHEN (OLD.redeemed_at IS NOT NULL) EXECUTE FUNCTION f();"),
    ("a trigger dropped", "DROP TRIGGER IF EXISTS teacher_invites_single_use ON teacher_invites;"),
    ("grants of EXECUTE", "GRANT EXECUTE ON FUNCTION f() TO app;\n"
     "REVOKE EXECUTE ON FUNCTION f() FROM PUBLIC;\n"
     "ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO app;"),
    # Each part between drizzle's separators runs on its own: no statement spans two.
    ("a part with no ; before an ALTER ... SET", "CREATE TRIGGER t BEFORE UPDATE ON x FOR EACH ROW "
     "EXECUTE FUNCTION f()--> statement-breakpoint\nALTER TABLE y ALTER COLUMN c SET DEFAULT 1;"),
    ("a grant, and a row lock", "GRANT UPDATE ON t TO r;\nSELECT 1 FROM t FOR UPDATE;"),
    ("a function testing TG_OP", "CREATE OR REPLACE FUNCTION f() RETURNS trigger LANGUAGE plpgsql "
     "AS $$\nBEGIN\n  IF TG_OP = 'UPDATE' THEN\n    RETURN NEW;\n  END IF;\nEND;\n$$;"),
    ("an empty file", ""),
]


class Findings(unittest.TestCase):
    def test_each_kind_is_caught(self):
        for case, sql, expected in CAUGHT:
            with self.subTest(case):
                self.assertEqual(guard.findings(sql), expected)

    def test_what_keeps_data_passes(self):
        for case, sql in PASSED:
            with self.subTest(case):
                self.assertEqual(guard.findings(sql), [])

    def test_the_migrations_before_the_guard(self):
        """0000-0027, drizzle's and hand-written: only 0001 trips, its trigger forbidding TRUNCATE
        on events naming the word. None holds a backfill UPDATE."""
        changed = "0000-0027 are applied migrations: a PR that changes them updates this test too"
        paths = [p for p in sorted((ROOT / "packages/db/migrations").glob("*.sql")) if p.name < "0028"]
        self.assertEqual(len(paths), 28, changed)
        tripped = {p.name: guard.findings(p.read_text(encoding="utf-8")) for p in paths}
        tripped = {name: hits for name, hits in tripped.items() if hits}
        self.assertEqual(tripped, {"0001_events_append_only.sql": [(20, "TRUNCATE")]}, changed)

    def test_the_workflow_uses_the_same_label(self):
        workflow = (ROOT / ".github/workflows/migration-guard.yml").read_text(encoding="utf-8")
        self.assertIn(f"LABEL: {guard.LABEL}\n", workflow)


class Command(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.dir = Path(folder.name)

    def file(self, name, sql):
        path = self.dir / name
        path.write_text(sql, encoding="utf-8")
        return str(path)

    def run_guard(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = guard.main(list(args))
        return code, out.getvalue()

    def test_a_clean_migration_passes(self):
        code, out = self.run_guard(self.file("0028_add.sql", 'CREATE INDEX "i" ON "t" ("a");'))
        self.assertEqual(code, 0, out)
        self.assertNotIn("::error", out)

    def test_a_finding_fails_naming_its_file_and_line_and_the_owner(self):
        clean = self.file("0028_add.sql", 'CREATE INDEX "i" ON "t" ("a");')
        bad = self.file("0029_drop.sql", 'CREATE INDEX "j" ON "t" ("b");\nALTER TABLE "t" DROP COLUMN "d";')
        code, out = self.run_guard(clean, bad)
        self.assertEqual(code, 1, out)
        self.assertIn(f"::error file={bad},line=2::DROP COLUMN: ", out)
        self.assertNotIn(clean, out)
        self.assertRegex(out, rf"::error::.*owner must approve.*label {guard.LABEL}")

    def test_approved_passes_with_notices(self):
        bad = self.file("0029_drop.sql", 'ALTER TABLE "t" DROP COLUMN "d";')
        code, out = self.run_guard("--approved", bad)
        self.assertEqual(code, 0, out)
        self.assertIn(f"::notice file={bad},line=1::DROP COLUMN: approved by the owner", out)
        self.assertNotIn("::error", out)

    def test_an_unreadable_file_never_reads_as_clean(self):
        missing = str(self.dir / "0030_missing.sql")
        for args in ([missing], ["--approved", missing]):
            with self.subTest(args):
                code, out = self.run_guard(*args)
                self.assertEqual(code, 2, out)
                self.assertIn(f"::error file={missing}::", out)

    def test_no_file_is_an_error(self):
        self.assertEqual(self.run_guard()[0], 2)
        self.assertEqual(self.run_guard("--approved")[0], 2)


if __name__ == "__main__":
    unittest.main()
