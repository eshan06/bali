import type { UnlockReason } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Student } from '../lib/grid-state';
import { Cell, COLUMNS, PRESENT_COLUMNS, stateCounts } from './live-grid';

/*
 * A student's cell on the live grid (the Class page design), rendered: the chip says the state
 * alone, the same words on the teacher's screen and the projector, and the line under it says the
 * unlock's reason, never in Present, and how long since the phone was heard from.
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

const render = (s: Student, present = false) =>
  renderToStaticMarkup(createElement(Cell, { student: s, now: NOW, present, pulse: false }));
/** The chip's words, its no-break spaces read as spaces. */
const chip = (html: string) =>
  /<span class="min-w-0">([^<]*)<\/span>/.exec(html)?.[1]?.replace(/\u00a0/g, ' ');
/** The line under the chip, its tags dropped; null when there is none. */
const line = (html: string) =>
  /<p class="[^"]*\btext-caption\b[^"]*">(.*?)<\/p>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '|') ??
  null;

describe('a cell on the live grid', () => {
  it('says the state alone on its chip; the reason and "last seen" sit on the line under it', () => {
    const html = render(
      student({ state: 'unlocked', unlock: unlocked('bathroom'), lastSeenAt: ago(330) }),
    );
    expect(chip(html)).toBe('Unlocked');
    expect(line(html)).toBe('|bathroom||last seen 5 min ago|');
    // The reason starts the line, capitalised; the dot before "last seen" goes when it wraps.
    expect(html).toMatch(/<span class="[^"]*\bfirst-letter:uppercase\b[^"]*">bathroom</);
    expect(html).toMatch(/<span class="[^"]*before:content-\[&#x27;·&#x27;\][^"]*">last seen/);
  });

  it('never shows an unlock’s reason in Present, the projector the class can see', () => {
    for (const reason of ['bathroom', 'nurse', 'other'] as const) {
      const off = render(
        student({ state: 'protection_off', unlock: unlocked(reason), lastSeenAt: ago(330) }),
        true,
      );
      expect(chip(off)).toBe('Protection off');
      expect(line(off)).toBe('|unlocked||last seen 5 min ago|');
      const html = render(student({ state: 'unlocked', unlock: unlocked(reason) }), true);
      expect(chip(html)).toBe('Unlocked');
      expect(html).not.toContain(reason === 'other' ? 'other reason' : reason);
      expect(line(html)).toBeNull();
    }
    // The teacher's own view keeps it, under a protection-off chip too.
    const off = render(student({ state: 'protection_off', unlock: unlocked('nurse') }));
    expect(line(off)).toBe('|unlocked · nurse|');
  });

  it('keeps Silent’s minutes in its label, with no line under it', () => {
    const html = render(student({ lastSeenAt: ago(330) }));
    expect(chip(html)).toBe('Silent · 5 min');
    expect(line(html)).toBeNull();
  });

  it('breaks a long label after its dot, never before it (the owner’s ruling)', () => {
    const html = render(student({ state: 'protection_off', endedAt: ago(60) }));
    expect(/<span class="min-w-0">([^<]*)<\/span>/.exec(html)?.[1]).toBe(
      'Left\u00a0· protection off',
    );
    const pill = /<span class="(inline-flex[^"]*)">/.exec(html)?.[1] ?? '';
    expect(pill.split(' ')).toEqual(expect.arrayContaining(['rounded-lg', 'text-balance']));
  });

  it('draws the chip in v2’s look: sentence case at 13/18, 3 × 10 px, a 1.5 px edge (PV4)', () => {
    /** The chip's classes, and its icons' sizes. */
    const look = (s: Student, present = false) => {
      const html = render(s, present);
      const classes = /<span class="(inline-flex[^"]*)">/.exec(html)?.[1]?.split(' ') ?? [];
      const icons = [...html.matchAll(/<svg[^>]*\swidth="(\d+)"/g)].map((m) => Number(m[1]));
      return { classes, icons };
    };
    const focused = look(student());
    expect(focused.classes).toEqual(
      expect.arrayContaining([
        'text-caption',
        'font-medium',
        'px-2.5',
        'py-0.75',
        'border-[1.5px]',
      ]),
    );
    expect(focused.classes).not.toContain('uppercase');
    expect(focused.icons).toEqual([13]);
    // The edge is on every chip, so each is one size; Silent's and Unknown's is dashed.
    expect(focused.classes).toContain('border-transparent');
    for (const dashed of [
      look(student({ lastSeenAt: ago(330) })),
      look(student({ state: 'mystery' as Student['state'] })),
    ]) {
      expect(dashed.classes).toEqual(
        expect.arrayContaining(['border-dashed', 'border-border-strong']),
      );
    }
    // In Present, the projector's size, still in sentence case.
    const present = look(student(), true);
    expect(present.classes).toContain('text-present-label');
    expect(present.classes).not.toContain('uppercase');
    expect(present.icons).toEqual([16]);
  });

  it('draws no line for a phone heard from in the last minute', () => {
    expect(line(render(student()))).toBeNull();
  });
});

describe('the grid’s columns', () => {
  it('fits five at the desktop width, beside the side menu', () => {
    // The class page's column at 1440 px since the side menu (PV5): 1440 less the menu's 216 px
    // and the page's two 36 px gutters, the cells 8 px apart. It held six in 1400 px less two 40 px
    // gutters until then; v2's tiles (PV8) make it four.
    const min = Number(/minmax\(min\((\d+)px/.exec(COLUMNS)?.[1]);
    expect(Math.floor((1440 - 216 - 2 * 36 + 8) / (min + 8))).toBe(5);
  });

  it('keeps Present’s four from a 56 rem grid, so a 1024 px projector still shows four', () => {
    expect(PRESENT_COLUMNS.split(' ')).toEqual([
      'grid-cols-2',
      '@2xl:grid-cols-3',
      '@4xl:grid-cols-4',
    ]);
  });

  it('sets the chip beside the name only on the standard grid’s one column', () => {
    // Under 432 px the standard grid is one column; Present still has two there, too narrow for
    // a name beside its chip (it broke the names letter by letter).
    const cell = (present: boolean) => /<li class="([^"]*)"/.exec(render(student(), present))?.[1];
    expect(cell(false)).toContain('@max-[432px]:grid');
    expect(cell(true)).not.toContain('@max-[432px]');
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
    expect(source).toMatch(
      /const key = JSON\.stringify\(counts\);\s*if \(key === told\.current\) return;\s*told\.current = key;\s*onCountsRef\.current\?\.\(sessionId, counts\);/,
    );
  });
});
