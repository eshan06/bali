import { STREAM_HEARTBEAT_MS, type UnlockReason } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { staleness, staleWords, type Student } from '../lib/grid-state';
import {
  FIRST_CONNECT_MS,
  type GridNow,
  healthOf,
  LiveGrid,
  PRESENT_COLUMNS,
  ROOM,
  stateCounts,
  Tile,
} from './live-grid';

// The grid's sign-out routes to /login; its first render needs no router beyond this.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

/*
 * A student's tile in Present (ClassPresent), v2's until LO9, rendered: tinted in its state, every
 * one the same size, the state's icon, the name, the state's words and one line, "last seen" or a
 * protection off's unlock, never the reason or Clock off. The room's tiles on the class page, the
 * lock-only look's since LO5, and that Present never says the reason or Clock off are driven in
 * `live-grid.driven.test.tsx`.
 */
const NOW = new Date('2026-10-07T14:30:00.000Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

function student(over: Partial<Student> = {}): Student {
  return {
    studentId: 'u1',
    displayName: 'Jaylen Brooks',
    state: 'focused',
    joinedAt: ago(1200),
    lastSeenAt: ago(10),
    endedAt: null,
    unlock: null,
    clockOff: false,
    ...over,
  };
}
const unlocked = (reason: UnlockReason | null) => ({ eventId: 'v1', reason, at: ago(60) });

const render = (s: Student, pulse = false) =>
  renderToStaticMarkup(createElement(Tile, { student: s, now: NOW, present: true, pulse }));
const source = readFileSync(fileURLToPath(new URL('./live-grid.tsx', import.meta.url)), 'utf8');

/**
 * Markup as read: each tag read as a space (never removed outright, so no tag can form from what
 * is left), and each run of spaces, no-break ones included, as one.
 */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** The tile's parts: its classes, its words' three spans (name, state, line) and its icons' sizes. */
function parts(html: string) {
  const tile = /<li class="flex min-w-0"><div class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];
  const words = /<span class="flex min-w-0 flex-col">([^]*)<\/span><\/div><\/li>$/.exec(html)?.[1];
  const spans = [
    ...(words ?? '').matchAll(
      /<span class="(block truncate[^"]*)">([^]*?)<\/span>(?=<span class="block truncate|$)/g,
    ),
  ];
  const [name, state, line] = spans.map((m) => ({
    classes: m[1]?.split(' ') ?? [],
    html: m[2] ?? '',
    words: text(m[2] ?? ''),
  }));
  const icons = [...html.matchAll(/<svg[^>]*\swidth="(\d+)"[^>]*class="([^"]*)"/g)].map((m) => ({
    size: Number(m[1]),
    classes: m[2]?.split(' ') ?? [],
  }));
  return { tile, name, state, line, icons };
}

describe('a tile in Present (ClassPresent), v2’s until LO9', () => {
  it('says the state and one line, "last seen" or a protection off’s unlock, never the reason or Clock off', () => {
    const tiles: [Partial<Student>, string, string | undefined][] = [
      [{}, 'Focused', undefined],
      [
        { state: 'unlocked', unlock: unlocked('bathroom'), lastSeenAt: ago(330) },
        'Unlocked',
        'last seen 5 min ago',
      ],
      [
        { state: 'protection_off', unlock: unlocked('nurse'), lastSeenAt: ago(330) },
        'Protection off',
        'Unlocked · last seen 5 min ago',
      ],
      [{ lastSeenAt: ago(330) }, 'Silent · 5 min', undefined],
      [{ endedAt: ago(60) }, 'Left', undefined],
      [
        { state: 'unlocked', unlock: unlocked('other'), endedAt: ago(60) },
        'Left · unlocked',
        undefined,
      ],
      [{ state: null }, 'Not here', undefined],
      [{ state: 'mystery' as Student['state'] }, 'Unknown · refresh', undefined],
      [{ clockOff: true }, 'Focused', undefined],
    ];
    for (const [over, state, line] of tiles) {
      const tile = parts(render(student(over)));
      expect(tile.name?.words, state).toBe('Jaylen Brooks');
      expect(tile.state?.words, state).toBe(state);
      expect(tile.line?.words, state).toBe(line);
    }
  });

  it('is one size up, as ClassPresent draws it: 100 px tall, 12 × 18 px in, a 24 px icon', () => {
    const tile = parts(
      render(student({ state: 'unlocked', unlock: unlocked('bathroom'), lastSeenAt: ago(330) })),
    );
    expect(tile.tile).toEqual(
      expect.arrayContaining([
        'grid',
        'h-25',
        'grid-cols-[24px_minmax(0,1fr)]',
        'gap-x-3',
        'px-4.5',
        'py-3',
        'rounded-md',
        'border-[1.5px]',
      ]),
    );
    expect(tile.icons).toEqual([
      { size: 24, classes: expect.arrayContaining(['mt-px']) as unknown },
    ]);
    expect(tile.name?.classes).toContain('text-present-tile-name');
    expect(tile.state?.classes).toContain('text-present-tile-state');
    expect(tile.line?.classes).toEqual(expect.arrayContaining(['text-body', 'font-medium']));
    // A Left state's flag at 16 px, before its words, the state's own icon at the side.
    const left = parts(render(student({ state: 'protection_off', endedAt: ago(60) })));
    expect(left.icons.map((icon) => icon.size)).toEqual([24, 16]);
    expect(left.state?.html).toMatch(/Left\u00a0· protection off$/);
  });

  it('pulses the whole tile (bali-softpulse) when the stream brings its unlock', () => {
    const html = (pulse: boolean) =>
      render(student({ state: 'unlocked', unlock: unlocked('nurse') }), pulse);
    expect(html(true)).toMatch(
      /^<li class="flex min-w-0"><div class="[^"]*\brelative\b[^"]*"><span aria-hidden="true" class="pointer-events-none absolute -inset-\[1\.5px\] animate-softpulse rounded-md"><\/span><svg/,
    );
    expect(html(false)).not.toContain('animate-softpulse');
  });
});

describe('the room’s columns', () => {
  it('fits as many tiles as the room holds, each at least 178 px, 8 px apart; two on a phone (LO5)', () => {
    expect(ROOM.split(' ')).toEqual([
      'grid-cols-[repeat(auto-fill,minmax(min(178px,100%),1fr))]',
      'gap-2',
      'max-[760px]:grid-cols-2',
    ]);
  });

  it('keeps Present’s four from a 56 rem grid, 12 px apart, so a 1024 px projector still shows four', () => {
    expect(PRESENT_COLUMNS.split(' ')).toEqual([
      'grid-cols-2',
      'gap-3',
      '@2xl:grid-cols-3',
      '@4xl:grid-cols-4',
    ]);
  });
});

describe('the stream’s first connect (PV7’s find; the owner, 2026-10-14)', () => {
  const at = Date.parse('2026-10-14T15:00:00.000Z');
  /** The grid's health `ms` after the stream's first connect began, nothing heard since. */
  const health = (status: Parameters<typeof healthOf>[0], ms: number) =>
    staleness({
      status: healthOf(status, ms),
      lastStreamActivityAt: at,
      lastGridActivityAt: at,
      now: at + ms,
      heartbeatMs: STREAM_HEARTBEAT_MS,
    });

  it('says nothing as the page loads, so no pill flashes up', () => {
    expect(health('connecting', 100)).toBeNull();
    expect(health('open', 100)).toBeNull();
  });

  it('says a first connect that takes 3 s as the pill, within seconds, and not a moment before', () => {
    expect(FIRST_CONNECT_MS).toBe(3000);
    expect(health('connecting', 2999)).toBeNull();
    expect(health('connecting', 3000)).toEqual({ reason: 'reconnecting', secondsAgo: 3 });
    expect(staleWords({ reason: 'reconnecting', secondsAgo: 3 })).toBe(
      'Reconnecting… last updated 3s ago',
    );
    // An open stream is judged by how long it has been quiet, never by its connect's time.
    expect(health('open', 3000)).toBeNull();
  });

  it('says a lost stream at once, as the pill', () => {
    expect(health('reconnecting', 0)).toEqual({ reason: 'reconnecting', secondsAgo: 0 });
  });

  it('is how the grid reads its stream’s health, timed from the stream’s own start', () => {
    const source = readFileSync(fileURLToPath(new URL('./live-grid.tsx', import.meta.url)), 'utf8');
    // Once the grid is read; none before, when there is nothing yet to call out of date.
    expect(source).toMatch(
      /const stale =\s*students === null\s*\? null\s*: staleness\(\{\s*status: healthOf\(status, now\.getTime\(\) - connectStart\.current\),/,
    );
    // Started as the stream is made, after the grid's own read: the read's time is no connect's.
    expect(source).toMatch(/connectStart\.current = Date\.now\(\);\s*sse = createSseClient\(\{/);
  });
});

describe('the grid handed to Home’s live card (PV17b)', () => {
  it('hands the card the grid as it stands, in place of all it draws: before its read, no students, no failure, no health', () => {
    const seen: GridNow[] = [];
    const html = renderToStaticMarkup(
      createElement(LiveGrid, {
        sessionId: 's1',
        card: (grid) => {
          seen.push(grid);
          return createElement('p', null, 'the card');
        },
      }),
    );
    expect(html).toBe('<p>the card</p>');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ students: null, error: null, stale: null });
    expect(seen[0]?.now).toBeInstanceOf(Date);
    expect(typeof seen[0]?.retry).toBe('function');
  });

  it('runs every hook first, so the snapshot, the stream and the 15 s read are the class page’s own', () => {
    const at = source.indexOf('if (card) return card(');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(source.indexOf('if (error) {'));
    expect(source.slice(at)).not.toMatch(/\buse[A-Z]\w*\(/);
    // A boot that failed is read again by the grid's own Try again, held while it reads; once
    // over, no health to say.
    expect(source).toMatch(
      /if \(card\) return card\(\{ students, now, error, retry, retrying, stale: over \? null : stale \}\);/,
    );
  });
});

describe('the grid counted for the class page (PV7)', () => {
  it('counts each tile once in its state, both Left tiles under Left, as ClassLive does', () => {
    const counted = stateCounts([
      'focused',
      'focused',
      'unlocked',
      'protection_off',
      'silent',
      'absent',
      'ended',
      'left_unprotected',
      'left_protection_off',
    ]);
    expect(counted).toEqual({
      total: 9,
      joined: 8,
      counts: { focused: 2, unlocked: 1, protection_off: 1, silent: 1, absent: 1, ended: 3 },
    });
  });

  it('counts Unknown in no state but as joined: it tapped in, and this tab can’t say more', () => {
    expect(stateCounts(['unknown', 'absent'])).toEqual({
      total: 2,
      joined: 1,
      counts: { focused: 0, unlocked: 0, protection_off: 0, silent: 0, absent: 1, ended: 0 },
    });
  });
});

// A lost stream's pill and a quiet one's line, said as a status (DR-05), are driven in
// `live-grid.driven.test.tsx`.
describe('the grid’s lines on the class page while a session runs (PV7)', () => {
  it('gives its tiles’ place to Present’s question, its stream and its own lines kept (L7, part 2)', () => {
    // Off, no tile and no loading line; a boot that failed still says so with Try again, and the
    // grid's health is said alone, so a lost stream is still the pill over the question.
    expect(source).toMatch(/tiles = true,/);
    expect(source).toMatch(
      /if \(!tiles\) return health;\s*const rows = Object\.values\(students\);/,
    );
    const error = source.indexOf('if (error) {');
    expect(error).toBeGreaterThan(-1);
    expect(error).toBeLessThan(source.indexOf('if (!tiles) return health;'));
    // Every hook runs before either return, so the stream and the counts go on underneath.
    expect(source.slice(source.indexOf('if (error) {'))).not.toMatch(/\buse[A-Z]\w*\(/);
  });

  it('draws no tile and no loading line while the question has its place, and both otherwise', () => {
    const before = (tiles: boolean, present = false) =>
      renderToStaticMarkup(createElement(LiveGrid, { sessionId: 's1', tiles, present }));
    expect(before(false, true)).toBe('');
    // The class page's room says its session is being read (LiveTopStates); Present, its grid.
    expect(before(true)).toBe(
      '<p role="status" class="text-body text-text-secondary">Loading this session…</p>',
    );
    expect(before(true, true)).toBe(
      '<p role="status" class="text-body text-text-secondary">Loading grid…</p>',
    );
  });

  // A grid that didn't load, said with Try again, is driven in live-grid.driven.test.tsx (LO5).

  it('keeps its failure said while Try again reads it again, Try again held, focus then on the page’s heading (ClassRetryStates)', () => {
    // Try again's boot: held until it answers, its failure never cleared as it starts, which
    // dropped focus to the page; read, focus on the class's name, the page's heading (`then` none).
    expect(source).toMatch(
      /const retry = \(\) => \{\s*setRetrying\(true\);\s*setAttempt\(\(n\) => n \+ 1\);\s*\};/,
    );
    const boot = source.slice(source.indexOf('// Boot from the snapshot, then stream.'));
    expect(boot).toMatch(
      /^\/\/ Boot from the snapshot, then stream\.\s*useEffect\(\(\) => \{\s*let sse: SseClient \| null = null;/,
    );
    expect(boot).toMatch(
      /if \(cancelled\) return;\s*setError\(null\);\s*setRetrying\(false\);\s*setStudents\(fromSnapshot\(snap\)\);/,
    );
    expect(boot).toMatch(
      /\} catch \(e\) \{\s*if \(cancelled\) return;\s*setError\(errText\(e\)\);\s*setRetrying\(false\);\s*\}/,
    );
    // Another session's grid starts unread: no failure of the last one's over it.
    expect(source).toMatch(
      /if \(booting !== sessionId\) \{\s*setBooting\(sessionId\);\s*setError\(null\);\s*setRetrying\(false\);\s*\}/,
    );
  });

  it('tells the page its counts only when one moves, not on every second’s tick', () => {
    // Never beside the grid's "didn't load" line, which a later refresh can fill under it.
    expect(source).toMatch(/useEffect\(\(\) => \{\s*if \(!students \|\| error\) return;/);
    expect(source).toMatch(/\}, \[students, now, sessionId, error\]\);/);
    expect(source).toMatch(
      /const key = JSON\.stringify\(counts\);\s*if \(key === told\.current\) return;\s*told\.current = key;\s*onCountsRef\.current\?\.\(sessionId, counts\);/,
    );
  });
});
