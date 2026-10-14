import { STREAM_HEARTBEAT_MS, type UnlockReason } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { staleness, staleWords, type Student } from '../lib/grid-state';
import {
  COLUMNS,
  FIRST_CONNECT_MS,
  healthOf,
  PRESENT_COLUMNS,
  stateCounts,
  Tile,
} from './live-grid';

/*
 * A student's tile on the live grid (PV8; ClassStates' twelve, ClassLive, PhoneClassLive at 390 px
 * and ClassPresent's), rendered: tinted in its state, every one the same size, the state's icon,
 * the name, the state's words and one line: an unlock's reason (never in Present), "last seen" or
 * Clock off.
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
const unlocked = (reason: UnlockReason | null) => ({ eventId: 'v1', reason });

const render = (s: Student, present = false, pulse = false) =>
  renderToStaticMarkup(createElement(Tile, { student: s, now: NOW, present, pulse }));

/**
 * Markup as read: each tag read as a space (never removed outright, so no tag can form from what
 * is left), and each run of spaces, no-break ones included, as one.
 */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** A tile's one detail on a phone, its dot hidden from screen readers, hidden on a computer. */
const PHONE = /<span class="sm:hidden"><span aria-hidden="true">\u00a0· <\/span>([^<]*)<\/span>/;
/** The tile's parts: its classes, its words' three spans (name, state, line) and its icons' sizes. */
function parts(html: string) {
  const tile = /<li class="flex min-w-0"><div class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];
  const words = /<span class="flex min-w-0 flex-col[^"]*">([^]*)<\/span><\/div><\/li>$/.exec(
    html,
  )?.[1];
  const spans = [
    ...(words ?? '').matchAll(
      /<span class="(block truncate[^"]*)">([^]*?)<\/span>(?=<span class="block truncate|$)/g,
    ),
  ];
  const [name, state, line] = spans.map((m) => ({
    classes: m[1]?.split(' ') ?? [],
    html: m[2] ?? '',
    // The phone's one detail, hidden on a computer, left out of what a computer shows.
    words: text((m[2] ?? '').replace(PHONE, ' ')),
  }));
  const icons = [...html.matchAll(/<svg[^>]*\swidth="(\d+)"[^>]*class="([^"]*)"/g)].map((m) => ({
    size: Number(m[1]),
    classes: m[2]?.split(' ') ?? [],
  }));
  return { tile, name, state, line, icons };
}

describe('a tile on the live grid (PV8)', () => {
  it('draws ClassStates’ twelve tiles in their words, each with at most one line', () => {
    const tiles: [Partial<Student>, string, string | undefined][] = [
      [{}, 'Focused', undefined],
      [
        { state: 'unlocked', unlock: unlocked('bathroom'), lastSeenAt: ago(330) },
        'Unlocked',
        'Bathroom · last seen 5 min ago',
      ],
      [{ state: 'protection_off' }, 'Protection off', undefined],
      [
        { state: 'protection_off', unlock: unlocked('nurse'), lastSeenAt: ago(330) },
        'Protection off',
        'Unlocked · nurse · last seen 5 min ago',
      ],
      [{ lastSeenAt: ago(330) }, 'Silent · 5 min', undefined],
      [{ endedAt: ago(60) }, 'Left', undefined],
      [
        { state: 'unlocked', unlock: unlocked('other'), endedAt: ago(60) },
        'Left · unlocked',
        'Other reason',
      ],
      [{ state: 'protection_off', endedAt: ago(60) }, 'Left · protection off', undefined],
      [{ state: null }, 'Not here', undefined],
      [{ state: 'mystery' as Student['state'] }, 'Unknown · refresh', undefined],
      [{ clockOff: true }, 'Focused', 'Clock off'],
      [{ state: 'unlocked', unlock: unlocked('nurse') }, 'Unlocked', 'Nurse'],
    ];
    for (const [over, state, line] of tiles) {
      const tile = parts(render(student(over)));
      expect(tile.name?.words, state).toBe('Jaylen Brooks');
      expect(tile.state?.words, state).toBe(state);
      expect(tile.line?.words, state).toBe(line);
    }
  });

  it('never shows an unlock’s reason in Present, the projector the class can see', () => {
    /** Nowhere in a Present tile's markup: not its words, nor a tooltip or a label on any tag. */
    const noReason = (html: string) => expect(html).not.toMatch(/bathroom|nurse|other reason/i);
    for (const reason of ['bathroom', 'nurse', 'other'] as const) {
      const offHtml = render(
        student({ state: 'protection_off', unlock: unlocked(reason), lastSeenAt: ago(330) }),
        true,
      );
      const off = parts(offHtml);
      expect(off.state?.words).toBe('Protection off');
      expect(off.line?.words).toBe('Unlocked · last seen 5 min ago');
      noReason(offHtml);
      const html = render(student({ state: 'unlocked', unlock: unlocked(reason) }), true);
      expect(parts(html).state?.words).toBe('Unlocked');
      expect(parts(html).line).toBeUndefined();
      noReason(html);
      // Both Left tiles that carry an unlock.
      for (const state of ['unlocked', 'protection_off'] as const) {
        noReason(render(student({ state, unlock: unlocked(reason), endedAt: ago(60) }), true));
      }
      // The teacher's own view says it.
      expect(render(student({ state: 'unlocked', unlock: unlocked(reason) }))).toMatch(
        /bathroom|nurse|other reason/i,
      );
    }
    // ClassPresent's: "last seen" alone, a Left tile with no line, and Clock off.
    const seen = student({ state: 'unlocked', unlock: unlocked('bathroom'), lastSeenAt: ago(330) });
    expect(parts(render(seen, true)).line?.words).toBe('last seen 5 min ago');
    const left = student({ state: 'unlocked', unlock: unlocked('other'), endedAt: ago(60) });
    expect(parts(render(left, true)).line).toBeUndefined();
    expect(parts(render(student({ clockOff: true }), true)).line?.words).toBe('Clock off');
  });

  it('says Clock off with its tooltip, after the reason and "last seen"', () => {
    const html = render(
      student({
        state: 'unlocked',
        unlock: unlocked('nurse'),
        lastSeenAt: ago(130),
        clockOff: true,
      }),
    );
    expect(parts(html).line?.words).toBe('Nurse · last seen 2 min ago · Clock off');
    expect(html).toContain(
      '<span title="This phone&#x27;s clock is set ahead. Bali records the time by its own clock.">Clock off</span>',
    );
  });

  it('draws no line for a phone heard from in the last minute', () => {
    expect(parts(render(student())).line).toBeUndefined();
    expect(
      parts(render(student({ state: 'unlocked', unlock: unlocked(null) }))).line,
    ).toBeUndefined();
  });

  it('fills each tile with its state’s tint, Silent’s and Unknown’s edge dashed (Q3 A)', () => {
    const tone = (over: Partial<Student>) => parts(render(student(over))).tile;
    const cases: [Partial<Student>, string, boolean][] = [
      [{}, 'bg-state-focused-bg', false],
      [{ state: 'unlocked', unlock: unlocked(null) }, 'bg-state-emergency-bg', false],
      [{ state: 'protection_off' }, 'bg-state-revoked-bg', false],
      [{ lastSeenAt: ago(330) }, 'bg-state-ended-bg', true],
      [{ endedAt: ago(60) }, 'bg-state-ended-bg', false],
      // Left while unlocked: orange, as ClassLive draws it (the owner, 2026-10-14).
      [
        { state: 'unlocked', unlock: unlocked(null), endedAt: ago(60) },
        'bg-state-emergency-bg',
        false,
      ],
      [{ state: 'protection_off', endedAt: ago(60) }, 'bg-state-revoked-bg', false],
      [{ state: null }, 'bg-state-notjoined-bg', false],
      [{ state: 'mystery' as Student['state'] }, 'bg-state-nodevice-bg', true],
    ];
    for (const [over, fill, dashed] of cases) {
      const classes = tone(over);
      expect(classes, fill).toContain(fill);
      expect(classes.includes('border-dashed'), fill).toBe(dashed);
      expect(classes, fill).toContain(dashed ? 'border-border-strong' : 'border-transparent');
    }
  });

  it('is one size, as ClassStates draws it: 84 px tall, 12 × 14 px in, a 20 px icon, 14 px corners', () => {
    const tile = parts(render(student({ state: 'unlocked', unlock: unlocked('nurse') })));
    expect(tile.tile).toEqual(
      expect.arrayContaining([
        'grid',
        'h-21',
        'grid-cols-[20px_minmax(0,1fr)]',
        'gap-x-2.5',
        'px-3.5',
        'py-3',
        'items-start',
        'rounded-md',
        'border-[1.5px]',
      ]),
    );
    expect(tile.icons[0]).toEqual({
      size: 20,
      classes: expect.arrayContaining(['mt-px']) as unknown,
    });
    // The name 15/20, the state 13/18 semibold, the line 12.5/17 medium: each cut short, never
    // wrapped, so no tile grows.
    expect(tile.name?.classes).toEqual(expect.arrayContaining(['truncate', 'text-tile-name']));
    expect(tile.state?.classes).toEqual(
      expect.arrayContaining(['truncate', 'text-caption', 'font-semibold']),
    );
    // In sentence case, as PV4 drew the chip: no capitals by a class.
    expect(tile.state?.classes).not.toContain('uppercase');
    expect(tile.line?.classes).toEqual(expect.arrayContaining(['truncate', 'text-tile-line']));
  });

  it('draws a Left state’s flag before its words, the state’s own icon at the side', () => {
    const html = render(student({ state: 'unlocked', unlock: unlocked(null), endedAt: ago(60) }));
    const tile = parts(html);
    // The lock at the side (20 px), then the flag (13 px) and, on a phone only, the lock again.
    expect(tile.icons.map((icon) => icon.size)).toEqual([20, 13, 13]);
    expect(html).toMatch(/<svg[^>]*width="20"[^>]*class="lucide lucide-lock-open/);
    expect(tile.state?.html).toMatch(/^<svg[^>]*class="lucide lucide-flag[^"]*"/);
    expect(tile.icons[1]?.classes).not.toContain('sm:hidden');
    expect(tile.icons[2]?.classes).toContain('sm:hidden');
    // A plain Left: its flag at the side, none before its words but the phone's.
    const left = parts(render(student({ endedAt: ago(60) })));
    expect(left.icons.map((icon) => icon.size)).toEqual([20, 13]);
    expect(left.icons[1]?.classes).toContain('sm:hidden');
  });

  it('is short on a phone, as PhoneClassLive draws it: no icon at the side, the line after the state', () => {
    const html = render(student({ state: 'unlocked', unlock: unlocked('bathroom') }));
    const tile = parts(html);
    expect(tile.tile).toEqual(
      expect.arrayContaining(['max-sm:block', 'max-sm:h-auto', 'max-sm:px-3', 'max-sm:py-2.5']),
    );
    expect(tile.icons[0]?.classes).toContain('max-sm:hidden');
    // The state's icon before its words, and its one detail run on after them, nothing cut; the
    // computer's line hidden there.
    expect(tile.icons[1]?.classes).toContain('sm:hidden');
    expect(tile.state?.classes).toEqual(
      expect.arrayContaining(['max-sm:inline', 'max-sm:whitespace-normal']),
    );
    expect(tile.line?.classes).toEqual(
      expect.arrayContaining(['max-sm:inline', 'max-sm:whitespace-normal']),
    );
    expect(PHONE.exec(tile.line?.html ?? '')?.[1]).toBe('Bathroom');
    expect(tile.line?.html.replace(PHONE, '')).toBe('<span class="max-sm:hidden">Bathroom</span>');
    expect(tile.name?.classes).toContain('max-sm:whitespace-normal');
  });

  it('says one detail at most on a phone, as PhoneClassLive draws it (the owner, 2026-10-14)', () => {
    // An Unlocked tile's reason and a Focused tile's Clock off; "last seen", protection off's
    // unlock and a Left tile's reason stay on a computer, for the student's panel (PV11).
    const phone = (over: Partial<Student>) => PHONE.exec(render(student(over)))?.[1];
    const cases: [Partial<Student>, string | undefined][] = [
      [{ state: 'unlocked', unlock: unlocked('bathroom'), lastSeenAt: ago(330) }, 'Bathroom'],
      [{ state: 'unlocked', unlock: unlocked('nurse'), clockOff: true }, 'Nurse'],
      [{ state: 'unlocked', unlock: unlocked('other') }, 'Other reason'],
      [{ clockOff: true }, 'Clock off'],
      [{ state: 'unlocked', unlock: unlocked(null), lastSeenAt: ago(330) }, undefined],
      [{ state: 'protection_off', unlock: unlocked('nurse'), lastSeenAt: ago(330) }, undefined],
      [{ state: 'unlocked', unlock: unlocked('other'), endedAt: ago(60) }, undefined],
      [{ lastSeenAt: ago(330), clockOff: true }, undefined],
      [{ state: 'protection_off', clockOff: true }, undefined],
    ];
    for (const [over, detail] of cases) expect(phone(over), JSON.stringify(over)).toBe(detail);
    // The computer's whole line is still there, hidden on a phone alone.
    const html = render(
      student({ state: 'unlocked', unlock: unlocked(null), lastSeenAt: ago(330) }),
    );
    expect(parts(html).line?.html).toBe('<span class="max-sm:hidden">last seen 5 min ago</span>');
    // Present has no phone layout: its line is the same at every width.
    expect(render(student({ clockOff: true }), true)).not.toMatch(/sm:hidden/);
  });

  it('is one size up in Present, as ClassPresent draws it: 100 px tall, 12 × 18 px in, a 24 px icon', () => {
    const tile = parts(render(student({ clockOff: true }), true));
    expect(tile.tile).toEqual(
      expect.arrayContaining([
        'grid',
        'h-25',
        'grid-cols-[24px_minmax(0,1fr)]',
        'gap-x-3',
        'px-4.5',
        'py-3',
      ]),
    );
    expect(tile.tile.some((c) => c.startsWith('max-sm:'))).toBe(false);
    expect(tile.icons).toEqual([
      { size: 24, classes: expect.arrayContaining(['mt-px']) as unknown },
    ]);
    expect(tile.name?.classes).toContain('text-present-tile-name');
    expect(tile.state?.classes).toContain('text-present-tile-state');
    expect(tile.state?.classes).not.toContain('uppercase');
    expect(tile.line?.classes).toEqual(expect.arrayContaining(['text-body', 'font-medium']));
    // A Left state's flag at 16 px.
    const left = parts(render(student({ state: 'protection_off', endedAt: ago(60) }), true));
    expect(left.icons.map((icon) => icon.size)).toEqual([24, 16]);
  });

  it('breaks a long state after its dot on a phone, never before it (the owner’s ruling)', () => {
    const html = render(student({ state: 'protection_off', endedAt: ago(60) }));
    expect(parts(html).state?.html).toMatch(/Left\u00a0· protection off$/);
  });

  it('pulses the whole tile (bali-softpulse) when the stream brings its unlock', () => {
    const tile = (pulse: boolean) =>
      parts(render(student({ state: 'unlocked', unlock: unlocked('nurse') }), false, pulse)).tile;
    expect(tile(true)).toContain('animate-softpulse');
    expect(tile(false)).not.toContain('animate-softpulse');
  });
});

describe('the grid’s columns', () => {
  const classes = COLUMNS.split(' ');

  it('fits four at the desktop width, beside the side menu, 10 px apart', () => {
    // The class page's column at 1440 px: 1440 less the menu's 216 px and the page's two 36 px
    // gutters, the tiles 10 px apart, each at least 250 px (ClassLive).
    const min = Number(/minmax\(min\((\d+)px/.exec(COLUMNS)?.[1]);
    expect(min).toBe(250);
    expect(classes).toContain('gap-2.5');
    expect(Math.floor((1440 - 216 - 2 * 36 + 10) / (min + 10))).toBe(4);
  });

  it('is two columns on a phone, 8 px apart, every tile as tall as the tallest', () => {
    expect(classes).toEqual(
      expect.arrayContaining(['max-sm:grid-cols-2', 'max-sm:auto-rows-fr', 'max-sm:gap-2']),
    );
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
    expect(source).toMatch(
      /const stale = staleness\(\{\s*status: healthOf\(status, now\.getTime\(\) - connectStart\.current\),/,
    );
    // Started as the stream is made, after the grid's own read: the read's time is no connect's.
    expect(source).toMatch(/connectStart\.current = Date\.now\(\);\s*sse = createSseClient\(\{/);
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

describe('the grid’s lines on the class page while a session runs (PV7)', () => {
  const source = readFileSync(fileURLToPath(new URL('./live-grid.tsx', import.meta.url)), 'utf8');
  /** A constant's class list, by its name. */
  const classes = (name: string) =>
    (new RegExp(`const ${name} =\\s*'([^']*)'`).exec(source)?.[1] ?? '').split(' ');

  it('says a lost stream in the floating pill, and a quiet one in the stone line over the grid', () => {
    expect(source).toMatch(
      /\{stale && !over \? \(\s*livePage && stale\.reason === 'reconnecting' \? \(\s*<div className=\{PILL_LAYER\}>\s*<p className=\{PILL\}>\s*<span aria-hidden="true" className="size-1\.75 shrink-0 rounded-full bg-pip" \/>\s*\{staleWords\(stale\)\}[^]*?\) : \(\s*<p className="rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary tabular-nums">/,
    );
  });

  it('floats the pill as ClassStale draws it, 14 px from the page’s top, in view as it scrolls', () => {
    // White, a strong edge, shadow-2, 13/18 medium in the secondary ink, 6 × 14 px (DESIGN.md §4).
    expect(classes('PILL')).toEqual(
      expect.arrayContaining([
        'sticky',
        'top-3.5',
        'mx-auto',
        'w-fit',
        'rounded-full',
        'border',
        'border-border-strong',
        'bg-surface-card',
        'shadow-2',
        'px-3.5',
        'py-1.5',
        'text-caption',
        'font-medium',
        'text-text-secondary',
      ]),
    );
    // Its layer over the page's whole height, taking no room or clicks: 30 px less 16 is 14 px
    // from the frame's top (22 less 8 on a phone).
    expect(classes('PILL_LAYER')).toEqual(
      expect.arrayContaining([
        'pointer-events-none',
        'absolute',
        'inset-x-0',
        '-top-4',
        'bottom-0',
        'max-sm:-top-2',
      ]),
    );
  });

  it('asks a grid that didn’t load to try again with a small button there, as ClassStates does', () => {
    expect(source).toMatch(
      /size=\{livePage \? 'sm' : 'md'\}\s*onClick=\{\(\) => setAttempt\(\(n\) => n \+ 1\)\}/,
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
