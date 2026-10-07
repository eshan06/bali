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
import { Timeline } from './timeline';

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
/** Each mark: its label and where it sits. */
const marks = (html: string) =>
  [...html.matchAll(/<button type="button" aria-label="([^"]*)" style="left:([\d.]+)%"/g)].map(
    (m) => `${m[1]} @${m[2]}`,
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
      'Lucas Ferreira, tapped in at 9:12 AM @14',
      'Lucas Ferreira, unlocked at 9:37 AM, Nurse @64',
    ]);
  });

  it('never says an unlock’s reason in Present, the projector the class can see', () => {
    const html = render(EVENTS, true);
    expect(marks(html)).toEqual([
      'Ana Rodríguez, tapped in at 9:05 AM @0',
      'Lucas Ferreira, tapped in at 9:12 AM @14',
      'Lucas Ferreira, unlocked at 9:37 AM @64',
    ]);
    expect(html).not.toMatch(/nurse/i);
  });

  it('says there were no unlocks under a legend of the one mark it shows', () => {
    const html = render(EVENTS.slice(0, 2), false, { ...REPORT, unlocks: [] });
    expect(text(html)).toMatch(/^\|Tapped in\|No unlocks\.\|Who joined\|/);
  });

  it('draws each row’s line from its first mark to the end, the same for everyone', () => {
    const lines = [...render().matchAll(/<span style="left:([\d.]+)%" class="[^"]*\bright-0\b/g)];
    expect(lines.map((m) => m[1])).toEqual(['0', '14']);
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
