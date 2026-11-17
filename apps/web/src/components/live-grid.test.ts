import { STREAM_HEARTBEAT_MS } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { staleness, staleWords } from '../lib/grid-state';
import {
  FIRST_CONNECT_MS,
  type GridNow,
  healthOf,
  LiveGrid,
  PRESENT_ROOM,
  ROOM,
  stateCounts,
} from './live-grid';

// The grid's sign-out routes to /login; its first render needs no router beyond this.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

/*
 * The live grid's columns, its stream's health and what it hands Home's card, rendered or read from
 * its source. Its tiles, on the class page (LO5) and in Present (LO9), are driven in
 * `live-grid.driven.test.tsx`.
 */
const source = readFileSync(fileURLToPath(new URL('./live-grid.tsx', import.meta.url)), 'utf8');

describe('the room’s columns', () => {
  it('fits as many tiles as the room holds, each at least 178 px, 8 px apart; two on a phone (LO5)', () => {
    expect(ROOM.split(' ')).toEqual([
      'grid-cols-[repeat(auto-fill,minmax(min(178px,100%),1fr))]',
      'gap-2',
      'max-[760px]:grid-cols-2',
    ]);
  });

  it('fits fewer in Present as it narrows, never smaller type: each at least 200 px and 16 %, so six at most; two on a phone (LO9)', () => {
    expect(PRESENT_ROOM.split(' ')).toEqual([
      'grid-cols-[repeat(auto-fill,minmax(max(200px,16%),1fr))]',
      'gap-2',
      'max-[760px]:grid-cols-2',
    ]);
    // Six at 1,440 px, as Present draws it, and at 1,920; five at 1,280; four on a 1,024 px
    // projector: the page is 48 px in on each side, the tiles 8 px apart.
    const columns = (width: number) => {
      const room = width - 2 * 48;
      return Math.floor((room + 8) / (Math.max(200, 0.16 * room) + 8));
    };
    expect([1920, 1440, 1366, 1280, 1024].map(columns)).toEqual([6, 6, 6, 5, 4]);
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
    expect(at).toBeLessThan(source.indexOf('const waiting ='));
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
  it('says its session is being read until it is, on the class page and in Present', () => {
    const before = (present: boolean) =>
      renderToStaticMarkup(createElement(LiveGrid, { sessionId: 's1', present }));
    const loading =
      '<p role="status" class="text-body text-text-secondary">Loading this session…</p>';
    // The class page's room says so in the count's place (LiveTopStates); Present in the room's,
    // under its band, which holds its time (PresentStates).
    expect(before(false)).toBe(loading);
    expect(before(true)).toMatch(
      new RegExp(
        `^<div class="[^"]*\\bborder-b border-border-strong pb-6\\b[^"]*"></div>${loading}$`,
      ),
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
