import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
 * Only the transition engine writes `participations` and `events` (CLAUDE.md's
 * first convention; ARCHITECTURE, data-model decision 1): both tables in one
 * transaction, always, so the live picture and the history never disagree. This
 * reads every file in each app's and package's `src` and `scripts` (the owner's
 * commands run against production), tests left out and the migrations outside
 * both, and fails a write to either table anywhere but
 * `packages/db/src/transitions.ts`.
 *
 * Syntax, not types, as O1b's scan of request reads (apps/api/test/openapi.test.ts):
 * a drizzle `insert(`, `update(` or `delete(` of either table, by its name, a
 * namespace's (`schema.events`) or an import's alias, in parentheses, `!`, `as` or
 * `satisfies` too; and raw SQL in a string or template that inserts into, updates,
 * deletes from, truncates or merges into either, by its name in any case or by an
 * interpolation naming it (`${events}`, `${sql.identifier('events')}`). Comments
 * are never read. Another object's `.delete(events)` would fail it loudly, never
 * pass; a write that hides the table's name (a variable holding it, SQL pieced
 * together from strings) is a dodge for review, not a mistake this catches.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ENGINE = 'packages/db/src/transitions.ts';
const TABLES = ['participations', 'events'];

/**
 * The one write outside the engine, and why it may: `backdateLastSeen`
 * (`@bali/db/testing`) moves a live participation's last check-in into the past
 * so the demo and tests reach a silence without idling 90 s, and refuses to run
 * unless NODE_ENV is test or development. The silence itself is still the
 * engine's, through the sweep.
 */
const OUTSIDE_THE_ENGINE = ['packages/db/src/testing.ts: update participations'];

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST = /\.(?:test|spec)\.[^.]+$/;

/** Raw SQL that writes: the verb, then the table, as an interpolation (`${…}`) or by name. */
const SQL_WRITE =
  /\b(insert\s+into|update|delete\s+from|truncate(?:\s+table)?|merge\s+into)\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?(?:\$\{([^}]*)\}|"?([\w$]+)"?(?![\w$]))/gi;

/** The source and script files of every app and package, as paths from the repository's root. */
async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const group of ['apps', 'packages']) {
    for (const name of await readdir(join(ROOT, group))) {
      for (const dir of ['src', 'scripts']) {
        const root = join(group, name, dir);
        if (!existsSync(join(ROOT, root))) continue;
        for (const f of await readdir(join(ROOT, root), { recursive: true })) {
          if (SOURCE.test(f) && !TEST.test(f)) files.push(join(root, f).split('\\').join('/'));
        }
      }
    }
  }
  return files.sort();
}

/**
 * Every write to `participations` or `events` in `source`, as `file: verb table`
 * (`insert`, `update`, `delete`, `truncate` or `merge`), in the order written.
 */
function writesIn(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const tableOf = (name: string) => (TABLES.includes(name) ? name : undefined);
  // Each name a table goes by in this file: its own, and an import's alias.
  const aliases = new Map(TABLES.map((t) => [t, t]));
  const named = (node: ts.Node): string | undefined => {
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node)
    ) {
      node = node.expression;
    }
    if (ts.isIdentifier(node)) return aliases.get(node.text);
    if (ts.isPropertyAccessExpression(node)) return tableOf(node.name.text);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      return tableOf(node.argumentExpression.text);
    }
    return undefined;
  };
  // A string's text, or a template's with each `${…}` as written.
  const textOf = (node: ts.Node): string | undefined => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (!ts.isTemplateExpression(node)) return undefined;
    const spans = node.templateSpans.map(
      (s) => `\${${s.expression.getText(tree)}}${s.literal.text}`,
    );
    return node.head.text + spans.join('');
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportSpecifier(node)) {
      const table = tableOf((node.propertyName ?? node.name).text);
      if (table) aliases.set(node.name.text, table);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['insert', 'update', 'delete'].includes(node.expression.name.text) &&
      node.arguments[0]
    ) {
      const table = named(node.arguments[0]);
      if (table) found.push(`${file}: ${node.expression.name.text} ${table}`);
    }
    for (const [, verb, interpolated, plain] of (textOf(node) ?? '').matchAll(SQL_WRITE)) {
      // SQL folds an unquoted name's case; an interpolation names a table by its last word
      // (`${schema.events}`, `${sql.identifier('events')}`), never `${events.length}`.
      const table =
        plain !== undefined
          ? tableOf(plain.toLowerCase())
          : aliases.get(interpolated?.match(/[\w$]+/g)?.at(-1) ?? '');
      if (table) found.push(`${file}: ${verb!.split(/\s/)[0]!.toLowerCase()} ${table}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe('only the transition engine writes participations and events', () => {
  it('holds in every source and script file of the apps and packages', async () => {
    const files = await sourceFiles();
    expect(files).toContain(ENGINE);
    expect(files).toContain('apps/api/src/routes/taps.ts');
    expect(files).toContain('apps/api/scripts/school.ts');
    const writes = (
      await Promise.all(files.map(async (f) => writesIn(f, await readFile(join(ROOT, f), 'utf8'))))
    ).flat();
    // The scan sees the engine's own writes, so a scan that reads nothing never passes for one.
    expect(writes).toEqual(
      expect.arrayContaining([`${ENGINE}: insert events`, `${ENGINE}: update participations`]),
    );
    expect(
      writes.filter((w) => !w.startsWith(`${ENGINE}:`)),
      'write participations and events only through the transition engine (packages/db/src/transitions.ts)',
    ).toEqual(OUTSIDE_THE_ENGINE);
  });

  it('finds a write in each form one can be written, and nothing else', () => {
    const writes = `
      import { events as history } from './schema.js';
      import * as schema from './schema.js';
      await db.insert(events).values(row);
      await tx.update(participations).set({ state: 'focused' });
      await tx
        .delete(
          schema.events,
        )
        .where(match);
      await tx.update(schema['participations']).set(change);
      await db.insert(history).values(row);
      await tx.update((participations as typeof participations)!).set(change);
      await tx.delete(events satisfies Table).where(match);
      await tx.insert(<Table>participations).values(row);
      await db.execute(sql\`insert into events (id) values (\${id})\`);
      await db.execute(sql\`UPDATE "participations" SET state = \${state}\`);
      await db.execute(sql\`UPDATE PARTICIPATIONS SET state = \${state}\`);
      await db.execute(sql\`delete from \${schema.events} where seq = \${seq}\`);
      await db.execute(sql\`insert into \${history} (id) values (\${id})\`);
      await db.execute(sql\`update \${sql.identifier('participations')} set state = \${state}\`);
      await db.execute(sql.raw('DELETE FROM public.participations'));
      await client.query(\`truncate table events\`);
    `;
    expect(writesIn('w.ts', writes)).toEqual([
      'w.ts: insert events',
      'w.ts: update participations',
      'w.ts: delete events',
      'w.ts: update participations',
      'w.ts: insert events',
      'w.ts: update participations',
      'w.ts: delete events',
      'w.ts: insert participations',
      'w.ts: insert events',
      'w.ts: update participations',
      'w.ts: update participations',
      'w.ts: delete events',
      'w.ts: insert events',
      'w.ts: update participations',
      'w.ts: delete participations',
      'w.ts: truncate events',
    ]);
    // Reads, locks, other tables, other objects' methods, and words in comments.
    const reads = `
      // update events here, then delete from participations
      const rows = await db.select().from(events).where(eq(events.seq, 1));
      await tx.select().from(participations).for('update');
      await db.execute(sql\`select 1 from events where seq = \${seq} for update\`);
      await db.update(sessions).set({ endedAt });
      await db.execute(sql\`insert into events_archive select * from events\`);
      await db.execute(sql\`update \${sessions} set ends_at = now()\`);
      log.info(\`update \${events.length} rows\`);
      const etag = createHash('sha256').update(json).digest('hex');
      seen.delete(eventId);
    `;
    expect(writesIn('r.ts', reads)).toEqual([]);
  });
});
