import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  readMayReconcile,
  type ReconcileStamp,
  STATE_CHANGE_OUTCOMES,
  stateChangeDisposition,
  type StateChangeDisposition,
  TAP_OUTCOMES,
  tapDisposition,
  type TapDisposition,
} from './outbox-contract.js';
import {
  UNLOCK_RECORDED_OUTCOMES,
  unlockDisposition,
  type UnlockDisposition,
} from './unlock-contract.js';

/*
 * The outbox contract on inputs the API does not send today, as golden files
 * (B1b): `contracts/outbox/`, one per table and one for the reconcile rule,
 * every answer in them computed here by the TypeScript itself. The contract
 * fixtures carry each table's answer to the API's real answers (A5); these
 * reach the rest — every status class, 408 and 429, outcomes a build does not
 * know, no body at all — and BaliCore's port must agree on every one, so a
 * change to a table here goes red in its tests until the port follows.
 *
 * As with the fixtures, `npm test` fails when a file drifts from what the
 * functions answer; `npm run fixtures` rewrites them (UPDATE_FIXTURES=1), and
 * CI runs that too and fails on any diff.
 */

const UPDATE = process.env.UPDATE_FIXTURES === '1';

/** Where the cases live: the repo's top-level `contracts/outbox/`. */
const DIR = fileURLToPath(new URL('../../../contracts/outbox/', import.meta.url));

/** No answer at all, then statuses at each class's edges, the ones the tables name, and the API's. */
const RESULTS = [
  'network_error',
  ...[100, 199, 200, 201, 204, 299, 300, 304, 399, 400, 401, 403, 404, 408, 409, 413, 415, 429],
  ...[499, 500, 502, 503, 504, 599],
] as const;
type Result = (typeof RESULTS)[number];

const SESSION = { id: 's', classId: 'c', endsAt: '2026-09-24T09:50:00.000Z' };

/**
 * Every outcome an outbox table knows — each one some other table does not —
 * then outcomes none knows, among them the prototype keys a naive lookup
 * would mistake for one.
 */
const OUTCOMES = [
  ...new Set<string>([...TAP_OUTCOMES, ...STATE_CHANGE_OUTCOMES, ...UNLOCK_RECORDED_OUTCOMES]),
  ...['weird', '', 'toString', '__proto__', 'constructor'],
];

/** What a table reads of an answer's body. */
interface Body {
  outcome: string;
  session?: typeof SESSION | null;
}

/**
 * The answers every table's cases are sent: no body, then each outcome with a
 * session, with a null one, and with the key left out. The same for every
 * table — that an unlock never reads the session is among what its cases show.
 */
const BODIES: (Body | undefined)[] = [
  undefined,
  ...OUTCOMES.flatMap((outcome) => [
    { outcome, session: SESSION },
    { outcome, session: null },
    { outcome },
  ]),
];

/** A table: its function, and every disposition its union holds — typed, so none is missed. */
interface Table {
  name: string;
  answer: (result: Result, body?: Body) => string;
  every: Record<string, true>;
}

/** Each table, by the file its cases are written to. */
const TABLES: Record<string, Table> = {
  'unlock.json': {
    name: 'unlockDisposition',
    answer: unlockDisposition,
    every: {
      recorded: true,
      retry: true,
      reauth: true,
      retry_and_surface: true,
    } satisfies Record<UnlockDisposition, true>,
  },
  'tap.json': {
    name: 'tapDisposition',
    answer: tapDisposition,
    every: {
      apply_session: true,
      wait_for_start: true,
      reread: true,
      retry: true,
      reauth: true,
      retry_and_surface: true,
    } satisfies Record<TapDisposition, true>,
  },
  'state-change.json': {
    name: 'stateChangeDisposition',
    answer: stateChangeDisposition,
    every: {
      apply_session: true,
      reread: true,
      drop: true,
      retry: true,
      reauth: true,
    } satisfies Record<StateChangeDisposition, true>,
  },
};

/** For each body, the results each disposition answers: every result under exactly one. */
function casesOf({ answer }: Table) {
  return BODIES.map((body) => {
    const dispositions = new Map<string, Result[]>();
    for (const result of RESULTS) {
      const disposition = answer(result, body);
      dispositions.set(disposition, [...(dispositions.get(disposition) ?? []), result]);
    }
    return { body, dispositions };
  });
}

/** Every stamp with counts up to 2, so each side of the rule's two comparisons is reached. */
const STAMPS: ReconcileStamp[] = [0, 1, 2].flatMap((changes) =>
  [0, 1, 2].map((awaiting) => ({ changes, awaiting })),
);

/** `value` as JSON on one line. */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const fields = Object.entries(value).map(
    ([key, field]) => `${JSON.stringify(key)}: ${inline(field)}`,
  );
  return `{ ${fields.join(', ')} }`;
}

/** A file's lines around its cases, one case to an entry of `cases`. */
const file = (head: string[], cases: string[]) =>
  ['{', ...head, '  "cases": [', cases.join(',\n'), '  ]', '}', ''].join('\n');

/**
 * Every file, by name, as it is written: each body and each list of results
 * on one line, and the reconcile rule one case a line, so a diff names the
 * case that changed.
 */
function files(): Map<string, string> {
  const all = new Map<string, string>();
  for (const [name, table] of Object.entries(TABLES)) {
    const cases = casesOf(table).map(({ body, dispositions }) =>
      [
        '    {',
        `      "body": ${inline(body ?? null)},`,
        '      "dispositions": {',
        [...dispositions.keys()]
          .sort()
          .map((key) => `        ${JSON.stringify(key)}: ${inline(dispositions.get(key))}`)
          .join(',\n'),
        '      }',
        '    }',
      ].join('\n'),
    );
    const head = [
      `  "function": ${JSON.stringify(table.name)},`,
      `  "results": ${inline(RESULTS)},`,
    ];
    all.set(name, file(head, cases));
  }
  const pairs = STAMPS.flatMap((sent) =>
    STAMPS.map((now) => `    ${inline({ sent, now, mayReconcile: readMayReconcile(sent, now) })}`),
  );
  all.set('reconcile.json', file(['  "function": "readMayReconcile",'], pairs));
  return all;
}

/** Every `.json` in the directory — what the drift check reconciles — or none when it is missing. */
async function committed(): Promise<string[]> {
  const found = await readdir(DIR).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  return found.filter((name) => name.endsWith('.json')).sort();
}

describe('the outbox cases (contracts/outbox)', () => {
  it('are what the TypeScript answers today', async () => {
    const want = files();
    if (UPDATE) {
      // Clear only what the check reconciles, so a file kept beside them stays.
      for (const name of await committed()) await rm(join(DIR, name));
      await mkdir(DIR, { recursive: true });
      for (const [name, text] of want) await writeFile(join(DIR, name), text);
      return;
    }
    // Only what is written here: a stale file is a case of nothing.
    expect(await committed(), 'run npm run fixtures').toEqual([...want.keys()].sort());
    for (const [name, text] of want) {
      const onDisk = await readFile(join(DIR, name), 'utf8');
      expect(onDisk, `${name} drifted: run npm run fixtures`).toBe(text);
    }
  });

  it('read back as JSON: every result once for each body, every disposition of each union', () => {
    const written = files();
    for (const [name, table] of Object.entries(TABLES)) {
      const parsed = JSON.parse(written.get(name)!) as {
        function: string;
        results: Result[];
        cases: { body: Body | null; dispositions: Record<string, Result[]> }[];
      };
      expect(parsed.function).toBe(table.name);
      expect(parsed.results).toEqual(RESULTS);
      expect(parsed.cases.map((c) => c.body)).toEqual(BODIES.map((body) => body ?? null));
      for (const { dispositions } of parsed.cases) {
        const answered = Object.values(dispositions).flat();
        expect(answered, name).toHaveLength(RESULTS.length);
        expect(new Set(answered), name).toEqual(new Set(RESULTS));
      }
      // A disposition no case reaches could never be checked against the port.
      const reached = new Set(parsed.cases.flatMap((c) => Object.keys(c.dispositions)));
      expect(reached, name).toEqual(new Set(Object.keys(table.every)));
    }
    const reconcile = JSON.parse(written.get('reconcile.json')!) as {
      cases: { mayReconcile: boolean }[];
    };
    expect(reconcile.cases).toHaveLength(STAMPS.length ** 2);
    expect(new Set(reconcile.cases.map((c) => c.mayReconcile))).toEqual(new Set([true, false]));
  });
});
