import type { UnlockReason } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Student } from '../lib/grid-state';
import { Cell, COLUMNS, PRESENT_COLUMNS } from './live-grid';

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

  it('draws no line for a phone heard from in the last minute', () => {
    expect(line(render(student()))).toBeNull();
  });
});

describe('the grid’s columns', () => {
  // The class page's column at the desktop width: 1400 px less its two 40 px gutters, the cells
  // 8 px apart. The canvas's 216 px fitted five there, where its notes and DESIGN.md §5 say six.
  const fit = (columns: string, width: number) => {
    const min = Number(/minmax\(min\((\d+)px/.exec(columns)?.[1]);
    return Math.floor((width + 8) / (min + 8));
  };

  it('fits six at the desktop width, and four in Present', () => {
    expect(fit(COLUMNS, 1320)).toBe(6);
    expect(fit(PRESENT_COLUMNS, 1320)).toBe(4);
  });
});
