import type {
  FeedEvent,
  ReportStudent,
  SessionReportResponse,
  SessionReportSummary,
} from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type RecapState, sessionTimes } from '../lib/recap';
import { RecapShown } from './recap-card';

/*
 * The recap card in each state the Recap & reports canvas draws, rendered: loading, couldn't load,
 * nobody joined, no unlocks, and the session as a timeline, its marks buttons that say what, who,
 * when and, but in Present, an unlock's reason; and the same inside an opened report, with no
 * figures of its own. The card says times in the viewer's own zone, so these do too.
 */
const SESSION: SessionReportSummary = {
  id: 's1',
  startedAt: '2026-10-06T14:05:00.000Z',
  endsAt: '2026-10-06T14:55:00.000Z',
  endedAt: '2026-10-06T14:55:00.000Z',
  ended: true,
  joinedCount: 2,
  focusMinutes: 1214,
  averageFocusMinutes: 45,
  silentMinutes: 23,
  unlockCount: 1,
  protectionOffCount: 0,
};
const lucas: ReportStudent = { id: 'u1', displayName: 'Lucas Ferreira' };
const ana: ReportStudent = { id: 'u2', displayName: 'Ana Rodríguez' };
const AT = (minute: number) => `2026-10-06T14:${String(minute).padStart(2, '0')}:00.000Z`;
const REPORT: SessionReportResponse = {
  ended: true,
  joined: [ana, lucas],
  focusMinutes: 1214,
  averageFocusMinutes: 45,
  silentMinutes: 23,
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
const READY: RecapState = { kind: 'ready', session: SESSION, report: REPORT, events: EVENTS };

/** Every space read as one, as Intl's narrow no-break space before AM and PM. */
const plain = (s: string) => s.replace(/\s/g, ' ').replace(/&#x27;/g, "'");
const clock = (minute: number) =>
  plain(
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(AT(minute)),
    ),
  );
const TIMES = plain(sessionTimes(SESSION));

type Shown = Exclude<RecapState, { kind: 'finding' | 'none' }>;
const render = (state: Shown, over: { present?: boolean; session?: SessionReportSummary } = {}) =>
  plain(
    renderToStaticMarkup(createElement(RecapShown, { state, onRetry: () => undefined, ...over })),
  );
/** The text of the page, its tags dropped. */
const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
/** Each mark's label, in the page's order. */
const marks = (html: string) =>
  [...html.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]);
const NOTE = "A phone is silent when it stops checking in. Silent time doesn't count as focus.";

describe('the recap card on the class page, after the bell', () => {
  it('says the last session is loading, under its times', () => {
    const html = render({ kind: 'loading', session: SESSION });
    expect(html).toMatch(/<section aria-labelledby="[^"]*" aria-busy="true"/);
    expect(text(html)).toBe(`|Last session|${TIMES}|Loading the last session…|`);
    expect(html).toMatch(/<p role="status"[^>]*>Loading the last session…<\/p>/);
  });

  it('says why it couldn’t load, with Try again, and no times it doesn’t have', () => {
    const html = render({ kind: 'error', message: "Couldn't reach Bali." });
    expect(text(html)).toBe(
      "|Last session|Couldn't load the last session.|Couldn't reach Bali.|Try again|",
    );
    expect(html).toMatch(/<div role="alert"[^>]*><p class="font-semibold">Couldn't load the last/);
  });

  it('says nobody joined, with no figures and no timeline', () => {
    const nobody = { ...REPORT, joined: [], unlocks: [], averageFocusMinutes: null };
    const html = render({ ...READY, report: nobody, events: [] });
    expect(text(html)).toBe(`|Last session|${TIMES}|Nobody joined this session.|`);
  });

  it('gives the class’s figures, then the session as a timeline of marks', () => {
    const html = render(READY);
    expect(text(html)).toContain(
      `|Joined|2|Class focus time|1,214|min|Average per student|45|min|Silent|23|min|${NOTE}|`,
    );
    expect(html).toContain(`<section aria-label="Timeline, ${TIMES}"`);
    // The legend says only the marks it shows; "No unlocks." only when there are none.
    expect(text(html)).toContain(`|Tapped in|Unlocked|Who joined|${clock(5)}|`);
    expect(html).not.toContain('No unlocks.');
    expect(marks(html)).toEqual([
      `Ana Rodríguez, tapped in at ${clock(5)}`,
      `Lucas Ferreira, tapped in at ${clock(12)}`,
      `Lucas Ferreira, unlocked at ${clock(37)}, Nurse`,
    ]);
    // Each at its time, as a share of the session: 9:37 is 64 % of 9:05 to 9:55.
    expect(html).toMatch(/aria-label="Lucas Ferreira, unlocked[^"]*" style="left:64%"/);
  });

  it('never says an unlock’s reason in Present, the projector the class can see', () => {
    const html = render(READY, { present: true });
    expect(marks(html)).toEqual([
      `Ana Rodríguez, tapped in at ${clock(5)}`,
      `Lucas Ferreira, tapped in at ${clock(12)}`,
      `Lucas Ferreira, unlocked at ${clock(37)}`,
    ]);
    expect(html).not.toMatch(/nurse/i);
  });

  it('says there were no unlocks, under a legend of the one mark it shows', () => {
    const html = render({
      ...READY,
      report: { ...REPORT, unlocks: [] },
      events: EVENTS.slice(0, 2),
    });
    expect(text(html)).toContain('|Tapped in|No unlocks.|Who joined|');
  });
});

describe('an opened report', () => {
  it('shows its timeline with no figures of its own, the row saying them', () => {
    const html = render(READY, { session: SESSION });
    expect(html).toMatch(new RegExp(`<h2 id="[^"]*" class="sr-only">${TIMES}</h2>`));
    expect(html).not.toContain('Class focus time');
    expect(text(html)).toContain(`|${NOTE}|Tapped in|`);
    expect(marks(html)).toContain(`Lucas Ferreira, unlocked at ${clock(37)}, Nurse`);
  });

  it('says it is loading, or why it couldn’t load, in the session’s words', () => {
    expect(render({ kind: 'loading', session: SESSION }, { session: SESSION })).toMatch(
      /<p role="status"[^>]*>Loading this session…<\/p>/,
    );
    const failed = render({ kind: 'error', message: 'x' }, { session: SESSION });
    expect(text(failed)).toContain("|Couldn't load this session.|x|Try again|");
  });
});
