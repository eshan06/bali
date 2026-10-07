import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  FeedEvent,
  ReportStudent,
  SessionReportResponse,
  SessionReportSummary,
} from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { sessionTimeline } from '../lib/recap';
import { lefts, Timeline } from './timeline';

/*
 * The session's timeline (the Recap & reports design), rendered: a legend of the marks it shows,
 * the axis, and a row per student, each moment a button at its time whose label says what, who,
 * when and, but in Present, an unlock's reason. Marks only, never a bar.
 */
const NY = { locale: 'en-US', timeZone: 'America/New_York' };
const SESSION: SessionReportSummary = {
  id: 's1',
  startedAt: '2026-10-06T13:05:00.000Z',
  endsAt: '2026-10-06T13:55:00.000Z',
  endedAt: '2026-10-06T13:55:00.000Z',
  ended: true,
  joinedCount: 2,
  focusMinutes: 90,
  averageFocusMinutes: 45,
  silentMinutes: 0,
  unlockCount: 1,
  protectionOffCount: 0,
};
const lucas: ReportStudent = { id: 'u1', displayName: 'Lucas Ferreira' };
const ana: ReportStudent = { id: 'u2', displayName: 'Ana Rodríguez' };
const AT = (minute: number) => `2026-10-06T13:${String(minute).padStart(2, '0')}:00.000Z`;
const REPORT: SessionReportResponse = {
  ended: true,
  joined: [ana, lucas],
  focusMinutes: 90,
  averageFocusMinutes: 45,
  silentMinutes: 0,
  unlocks: [
    { eventId: 'e3', student: lucas, occurredAt: AT(37), reason: 'nurse', recordedAs: null },
  ],
  protectionOffs: [],
};
const feed = (seq: number, type: FeedEvent['type'], userId: string, minute: number) => ({
  seq,
  eventId: `e${seq}`,
  type,
  userId,
  occurredAt: AT(minute),
  payload: {},
});
const EVENTS: FeedEvent[] = [
  feed(1, 'tap_in', ana.id, 5),
  feed(2, 'tap_in', lucas.id, 12),
  { ...feed(3, 'unlock', lucas.id, 37), payload: { reason: 'nurse' } },
];

const render = (events = EVENTS, present = false, report = REPORT) =>
  renderToStaticMarkup(
    createElement(Timeline, {
      view: sessionTimeline(SESSION, report, events, NY, present),
      label: 'Timeline, Tue, Oct 6, 9:05 AM to 9:55 AM',
    }),
  )
    .replace(/\s/g, ' ')
    .replace(/&#x27;/g, "'");
/** The text of the page, its tags dropped. */
const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
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
/** Each mark: its label and where its centre sits on a 1000 px axis. */
const marks = (html: string, width = 1000) =>
  [...html.matchAll(/<button type="button" aria-label="([^"]*)" style="left:([^"]+)"/g)].map(
    (m) => `${m[1]} @${Math.round(px(m[2] ?? '', width) * 100) / 100}`,
  );

describe('the session’s timeline', () => {
  it('names itself, and says what its marks mean, only the ones it shows', () => {
    const html = render();
    expect(html).toMatch(/^<section aria-label="Timeline, Tue, Oct 6, 9:05 AM to 9:55 AM"/);
    expect(html).toMatch(/<ul aria-label="What the marks mean"[^>]*>/);
    expect(text(html)).toMatch(/^\|Tapped in\|Unlocked\|Who joined\|9:05 AM\|/);
    expect(html).not.toContain('No unlocks.');
  });

  it('marks each moment as a button at its time that says what, who, when and why', () => {
    expect(marks(render())).toEqual([
      'Ana Rodríguez, tapped in at 9:05 AM @0',
      'Lucas Ferreira, tapped in at 9:12 AM @140',
      'Lucas Ferreira, unlocked at 9:37 AM, Nurse @640',
    ]);
  });

  it('never says an unlock’s reason in Present, the projector the class can see', () => {
    const html = render(EVENTS, true);
    expect(marks(html)).toEqual([
      'Ana Rodríguez, tapped in at 9:05 AM @0',
      'Lucas Ferreira, tapped in at 9:12 AM @140',
      'Lucas Ferreira, unlocked at 9:37 AM @640',
    ]);
    expect(html).not.toMatch(/nurse/i);
  });

  it('says there were no unlocks under a legend of the one mark it shows', () => {
    const html = render(EVENTS.slice(0, 2), false, { ...REPORT, unlocks: [] });
    expect(text(html)).toMatch(/^\|Tapped in\|No unlocks\.\|Who joined\|/);
  });

  it('draws each row’s line from its first mark to the end, the same for everyone', () => {
    const lines = [...render().matchAll(/<span style="left:([^"]+)" class="[^"]*\bright-0\b/g)];
    expect(lines.map((m) => px(m[1] ?? '', 1000))).toEqual([0, 140]);
  });

  it('labels its axis at the ends with AM or PM, every other time between hidden when narrow', () => {
    const ticks = [
      ...render().matchAll(
        /<span style="left:([\d.]+)%" class="([^"]*\btext-caption\b[^"]*)">([^<]*)</g,
      ),
    ];
    expect(ticks.map((m) => m[3])).toEqual([
      '9:05 AM',
      '9:10',
      '9:15',
      '9:20',
      '9:25',
      '9:30',
      '9:35',
      '9:40',
      '9:45',
      '9:50',
      '9:55 AM',
    ]);
    const hidden = ticks.filter((m) => m[2]?.includes('@max-[64rem]:hidden')).map((m) => m[3]);
    expect(hidden).toEqual(['9:10', '9:20', '9:30', '9:40', '9:50']);
  });

  it('opens no card until a mark is hovered or focused', () => {
    expect(render()).not.toContain('shadow-2');
  });
});

describe('who joined, and who didn’t (PB5’s review)', () => {
  // Ines unlocked without tapping in: R2 lists her unlock, and not her among who joined.
  const ines: ReportStudent = { id: 'u3', displayName: 'Ines Moreau' };
  const unjoined = {
    ...REPORT,
    unlocks: [
      ...REPORT.unlocks,
      {
        eventId: 'e4',
        student: ines,
        occurredAt: AT(41),
        reason: 'nurse' as const,
        recordedAs: 'no_live_participation' as const,
      },
    ],
  };
  const events = [
    ...EVENTS,
    {
      ...feed(4, 'unlock', ines.id, 41),
      payload: { reason: 'nurse', recorded_as: 'no_live_participation' },
    },
  ];
  /** Each list of rows: the words that name it (its `aria-labelledby`), then its students. */
  const lists = (html: string) =>
    [...html.matchAll(/<ul aria-labelledby="([^"]+)"[^>]*>(.*?)<\/ul>/g)].map((m) => [
      html.split(`id="${m[1]}"`)[1]?.match(/^[^>]*>([^<]*)</)?.[1],
      ...[...(m[2] ?? '').matchAll(/<span class="[^"]*\bbreak-words\b[^"]*">([^<]*)</g)].map(
        (n) => n[1],
      ),
    ]);

  it('lists under Who joined only who joined, and one who unlocked without joining apart', () => {
    const html = render(events, false, unjoined);
    expect(lists(html)).toEqual([
      ['Who joined', 'Ana Rodríguez', 'Lucas Ferreira'],
      ["Didn't join", 'Ines Moreau'],
    ]);
    // Her unlock is on the timeline all the same, at its time.
    expect(marks(html)).toContain('Ines Moreau, unlocked at 9:41 AM, Nurse @720');
  });

  it('never says Who joined over a session nobody joined', () => {
    const nobody = { ...unjoined, joined: [], unlocks: unjoined.unlocks.slice(1) };
    const html = render(events.slice(3), false, nobody);
    expect(lists(html)).toEqual([["Didn't join", 'Ines Moreau']]);
    expect(html).not.toContain('Who joined');
  });

  it('draws one list, under Who joined, when everyone with a mark joined', () => {
    expect(lists(render())).toEqual([['Who joined', 'Ana Rodríguez', 'Lucas Ferreira']]);
    expect(render()).not.toContain('Didn');
  });
});

describe('marks under a minute apart (PB5’s review)', () => {
  // Ana taps in and unlocks 20 s later, at the start, and turns protection off, back on and leaves
  // in the last 20 s; Lucas goes silent, checks in again and unlocks within 30 s, mid-lesson.
  const at = (minute: number, second = 0) =>
    `2026-10-06T13:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;
  const moment = (
    seq: number,
    type: FeedEvent['type'],
    who: ReportStudent,
    occurredAt: string,
  ) => ({
    seq,
    eventId: `c${seq}`,
    type,
    userId: who.id,
    occurredAt,
    payload: type === 'unlock' ? { reason: 'bathroom' } : {},
  });
  const events: FeedEvent[] = [
    moment(1, 'tap_in', ana, at(5)),
    moment(2, 'unlock', ana, at(5, 20)),
    moment(3, 'tap_in', lucas, at(12)),
    moment(4, 'went_silent', lucas, at(40)),
    moment(5, 'came_back', lucas, at(40, 15)),
    moment(6, 'unlock', lucas, at(40, 30)),
    moment(7, 'protection_off', ana, at(54, 40)),
    moment(8, 'protection_on', ana, at(54, 50)),
    moment(9, 'left_for_other_session', ana, at(55)),
  ];
  const report: SessionReportResponse = {
    ...REPORT,
    unlocks: [
      { eventId: 'c2', student: ana, occurredAt: at(5, 20), reason: 'bathroom', recordedAs: null },
      {
        eventId: 'c6',
        student: lucas,
        occurredAt: at(40, 30),
        reason: 'bathroom',
        recordedAs: null,
      },
    ],
    protectionOffs: [{ eventId: 'c7', student: ana, occurredAt: at(54, 40), recordedAs: null }],
  };
  const html = render(events, false, report);
  /** Each row's marks: where each centre sits on a `width` px axis, and how wide it is drawn. */
  const rows = (width: number) =>
    html
      .split('<li class="items-center')
      .slice(1)
      .map((row) =>
        [
          ...row.matchAll(
            /<button type="button" aria-label="[^"]*" style="left:([^"]+)" class="([^"]*)"/g,
          ),
        ].map((m) => ({
          centre: px(m[1] ?? '', width),
          size: /\bsize-3\b/.test(m[2] ?? '') ? 12 : 20,
        })),
      );

  it('sits them side by side, none over another and each inside the axis, at any width', () => {
    // The class page at 1440, a 1024 px window, and a phone.
    for (const width of [1046, 700, 300]) {
      const placed = rows(width);
      expect(placed.map((row) => row.length)).toEqual([5, 4]);
      for (const row of placed) {
        row.forEach((mark, i) => {
          expect(mark.centre, String(width)).toBeGreaterThanOrEqual(0);
          expect(mark.centre, String(width)).toBeLessThanOrEqual(width);
          const before = row[i - 1];
          if (before) {
            expect(mark.centre - before.centre, `${width}, mark ${i}`).toBeGreaterThanOrEqual(
              (before.size + mark.size) / 2,
            );
          }
        });
      }
    }
    // At 1046 px: Ana's unlock right after her tap, and her last three packed against the end.
    expect(rows(1046)[0]?.map((m) => Math.round(m.centre))).toEqual([0, 16, 1006, 1026, 1046]);
  });

  it('moves a mark no further than it must: with the room, each sits at its time', () => {
    const wide = 100_000;
    const times = [0, 0.67, 99.33, 99.67, 100, 14, 70, 70.5, 71].map((x) => (x / 100) * wide);
    const placed = rows(wide).flatMap((row) => row.map((m) => m.centre));
    expect(placed.map(Math.round)).toEqual(times.map(Math.round));
  });

  it('draws a row’s line from its first mark as placed', () => {
    const line = /<span style="left:([^"]+)" class="[^"]*\bright-0\b/.exec(html)?.[1] ?? '';
    expect(px(line, 300)).toBe(rows(300)[0]?.[0]?.centre);
  });

  it('keeps every mark of a row too full for its axis on the axis, its first ones at its start', () => {
    // A phone that keeps dropping out: a tap and 19 silent and back marks in two minutes, on a
    // phone's 300 px axis, where 20 marks need 392 px.
    const crowded = [
      { moment: 'in' as const, x: 50 },
      ...Array.from({ length: 19 }, (_, i) => ({
        moment: i % 2 ? ('back' as const) : ('silent' as const),
        x: 50 + i * 0.2,
      })),
    ];
    const centres = lefts(crowded).map((left) => px(left, 300));
    expect(Math.min(...centres)).toBe(0);
    expect(Math.max(...centres)).toBe(300);
    // In order, and side by side from the end back as far as the axis holds them.
    centres.forEach((c, i) => expect(c).toBeGreaterThanOrEqual(centres[i - 1] ?? 0));
    expect(centres.slice(-3)).toEqual([260, 280, 300]);
  });

  it('opens a moved mark’s card toward the middle from where the mark sits, not its time', () => {
    // So a mark `lefts` moved past the middle never opens its card past the axis's end. Read from
    // the source: where the mark sits takes a browser to know.
    const source = readFileSync(fileURLToPath(new URL('./timeline.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('const at = placedAt[m.key] ?? m.x;');
    expect(source).toContain("${at > 70 ? FLIP : at > 50 ? FLIP_NARROW : ''}");
    expect(source.match(/opening\(m\.key, e\.currentTarget\);/g)).toHaveLength(2);
  });
});
