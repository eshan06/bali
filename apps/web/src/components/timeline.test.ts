import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RecapGroups, RecapStudent } from '../lib/recap';
import { lefts, RecapLists } from './timeline';

/*
 * The recap's rows (ClassEnded, PV12b), rendered: each student's moments as marks on their thin
 * line, side by side where they would overlap (`lefts`), and the axis's ticks. PB5's timeline,
 * which the reports' opened row drew, went with that row (PV14).
 */
const AT = (minute: number) => `2026-10-06T13:${String(minute).padStart(2, '0')}:00.000Z`;
/**
 * A `left` as the browser works it out on a `width` px axis: `min()`, `max()`, `calc(a ± b)`, a
 * percentage of the axis and px, all `lefts` writes.
 */
function px(css: string, width: number): number {
  const call = /^(min|max)\((.*)\)$/.exec(css.trim());
  if (call) {
    // Its arguments, split at the commas outside any brackets.
    const args: string[] = [''];
    let depth = 0;
    for (const c of call[2] ?? '') {
      depth += c === '(' ? 1 : c === ')' ? -1 : 0;
      if (c === ',' && depth === 0) args.push('');
      else args[args.length - 1] += c;
    }
    const values = args.map((a) => px(a, width));
    return call[1] === 'min' ? Math.min(...values) : Math.max(...values);
  }
  const calc = /^calc\((\S+) ([+-]) (\S+)\)$/.exec(css.trim());
  if (calc) return px(calc[1] ?? '', width) + (calc[2] === '+' ? 1 : -1) * px(calc[3] ?? '', width);
  if (css.trim().endsWith('%')) return (parseFloat(css) / 100) * width;
  if (css.trim().endsWith('px')) return parseFloat(css);
  throw new Error(`not a left lefts writes: ${css}`);
}
describe('marks under a minute apart (PB5’s review; the recap’s 18 px marks)', () => {
  /** Each mark's centre on a `width` px axis, as the browser works out its `left`. */
  const centres = (xs: number[], width: number) =>
    lefts(
      xs.map((x) => ({ x })),
      18,
    ).map((left) => px(left, width));
  // A row's moments: two at its start, three in its last 20 s, the axis 9:05 to 9:55.
  const ROW = [0, 0.67, 99.33, 99.67, 100];

  it('sits them side by side, none over another and each inside the axis, at any width', () => {
    // The class page at 1440, a 1024 px window, and a phone.
    for (const width of [1046, 700, 300]) {
      const placed = centres(ROW, width);
      placed.forEach((centre, i) => {
        expect(centre, String(width)).toBeGreaterThanOrEqual(0);
        expect(centre, String(width)).toBeLessThanOrEqual(width);
        const before = placed[i - 1];
        if (before !== undefined) {
          expect(centre - before, `${width}, mark ${i}`).toBeGreaterThanOrEqual(18);
        }
      });
    }
    // At 1046 px: the second right after the first, and the last three packed against the end.
    expect(centres(ROW, 1046).map(Math.round)).toEqual([0, 18, 1010, 1028, 1046]);
  });

  it('moves a mark no further than it must: with the room, each sits at its time', () => {
    const wide = 100_000;
    expect(centres(ROW, wide).map(Math.round)).toEqual(
      ROW.map((x) => Math.round((x / 100) * wide)),
    );
  });

  it('keeps every mark of a row too full for its axis on the axis, its first ones at its start', () => {
    // A phone that keeps dropping out: 20 marks in two minutes, on a phone's 300 px axis, where
    // 20 marks need 360 px.
    const placed = centres(
      Array.from({ length: 20 }, (_, i) => 50 + i * 0.2),
      300,
    );
    expect(Math.min(...placed)).toBe(0);
    expect(Math.max(...placed)).toBe(300);
    // In order, and side by side from the end back as far as the axis holds them.
    placed.forEach((c, i) => expect(c).toBeGreaterThanOrEqual(placed[i - 1] ?? 0));
    expect(placed.slice(-3)).toEqual([264, 282, 300]);
  });

  it('puts a lone mark at its time', () => {
    expect(lefts([{ x: 40 }], 18)).toEqual(['40%']);
  });
});

describe('the recap’s lists (PV12b; ClassEnded)', () => {
  /** A student focused part of the time, their moments at these places on the axis. */
  const student = (key: string, xs: [RecapStudent['moments'][number]['moment'], number][]) => ({
    key,
    name: key,
    spans: [{ from: 0, to: 100 }],
    moments: xs.map(([moment, x], i) => ({
      key: `${key}-${i}`,
      moment,
      at: new Date(Date.parse(AT(5)) + x * 36_000),
      reason: null,
      x,
    })),
  });
  const tick = (x: number, label: string) => ({ x, label });
  /** A 60-minute session's axis: a tick each 10 minutes, a sixth of it apart. */
  const GROUPS: RecapGroups = {
    partTime: [
      student('Ana', [
        ['in', 0],
        ['silent', 40],
        ['back', 40.5],
        ['unlock', 41],
      ]),
    ],
    wholeTime: [],
    notJoined: [],
    ticks: [
      tick(0, '9:05 AM'),
      ...[1, 2, 3, 4, 5].map((i) => tick((i * 100) / 6, `9:${i}5`)),
      tick(100, '10:05 AM'),
    ],
    step: 100 / 6,
  };
  const html = renderToStaticMarkup(createElement(RecapLists, { groups: GROUPS, present: false }));

  it('sets the marks of moments under a minute apart side by side, 18 px each, a tap-in none', () => {
    const centres = [...html.matchAll(/<span style="left:([^"]+)" class="absolute top-0\.5/g)].map(
      (m) => px(m[1] ?? '', 300),
    );
    // At its time, then right after the one before it: 18 px apart, centre to centre.
    expect(centres.map(Math.round)).toEqual([120, 138, 156]);
    const packed = lefts([{ x: 0 }, { x: 0 }], 18);
    expect(packed.map((l) => px(l, 300))).toEqual([0, 18]);
  });

  it('hides the axis’s ticks between its ends on a narrow axis, those beside an end first', () => {
    const ticks = [...html.matchAll(/class="absolute top-0 text-axis([^"]*)">([^<]*)</g)].map(
      (m) => `${m[2]}:${/@max-\[(\d+)rem\]\/axis:hidden/.exec(m[1] ?? '')?.[1] ?? 'always'}`,
    );
    // A sixth apart: under 30 rem beside an end, whose label carries AM or PM; under 15 between.
    expect(ticks).toEqual([
      '9:05 AM:always',
      '9:15:30',
      '9:25:15',
      '9:35:15',
      '9:45:15',
      '9:55:30',
      '10:05 AM:always',
    ]);
  });
});
