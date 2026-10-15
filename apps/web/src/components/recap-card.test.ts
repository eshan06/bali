import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  EventType,
  FeedEvent,
  ReportStudent,
  RosterStudent,
  SessionReportResponse,
  SessionReportSummary,
} from '@bali/shared';
import { sessionReport } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type RecapState, sessionTimes } from '../lib/recap';
import { endedToday, RecapShown } from './recap-card';

/*
 * The recap card on the class page after the bell, as ClassEnded draws it (PV12b), rendered in each
 * state: loading, couldn't load (its own read or the roster's), nobody joined, no unlocks, and the
 * session as its figures and three groups, who wasn't focused the whole time with their lines and
 * their moments in words, who was, who didn't join; and the two states no board draws. Each report
 * is R2's own `sessionReport` over the same events. The card says times in the viewer's own zone,
 * so these do too. And an opened report (R5), which keeps PB5's timeline until PV13 and PV14.
 */

/** 9:05 to 9:55 on the board's day, a minute from its start being 2 % of the axis. */
const AT = (minute: number) => new Date(Date.UTC(2026, 9, 12, 14) + minute * 60_000).toISOString();
const SESSION: SessionReportSummary = {
  id: 's1',
  startedAt: AT(5),
  endsAt: AT(55),
  endedAt: AT(55),
  ended: true,
  joinedCount: 0,
  focusMinutes: 0,
  averageFocusMinutes: null,
  silentMinutes: 0,
  unlockCount: 0,
  protectionOffCount: 0,
};

/** ClassEnded's class, in the order its students joined it, each named by their id. */
const CLASS = [
  'Ana Rodríguez',
  'Marcus Bell',
  'Priya Natarajan',
  'Jaylen Brooks',
  'Sofia Marchetti',
  'Tomás Herrera',
  'Keisha Thompson',
  'Amara Okafor',
  'Diego Ramírez',
  'Ethan Park',
  'Zuri Mensah',
  'Caleb Washington',
  'Mateo Silva',
  'Hannah Levi',
  'Lucas Ferreira',
];
const enrolled = (id: string, minute = 0): RosterStudent => ({
  enrollmentId: `n-${id}`,
  studentId: id,
  displayName: id,
  joinedAt: AT(minute),
});
const ROSTER = CLASS.map((id) => enrolled(id));

let seq = 0;
function event(
  type: EventType,
  userId: string | null,
  minute: number,
  payload: Record<string, unknown> | null = null,
): FeedEvent {
  seq += 1;
  return { seq, eventId: `e${seq}`, type, userId, occurredAt: AT(minute), payload };
}

/** R2's report on the session, as its route answers it. */
function reportOf(events: readonly FeedEvent[], session = SESSION): SessionReportResponse {
  const r = sessionReport(
    {
      startedAt: new Date(session.startedAt),
      endsAt: new Date(session.endsAt),
      endedAt: session.endedAt === null ? null : new Date(session.endedAt),
    },
    events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) })),
    new Date(AT(70)),
  );
  const named = (id: string): ReportStudent => ({ id, displayName: id });
  return {
    ended: true,
    joined: r.joined.map(named),
    focusMinutes: Math.round(r.focusMinutes),
    averageFocusMinutes: r.averageFocusMinutes === null ? null : Math.round(r.averageFocusMinutes),
    silentMinutes: Math.round(r.silentMinutes),
    unlocks: r.unlocks.map(({ eventId, studentId, occurredAt, reason, recordedAs }) => ({
      eventId,
      student: named(studentId),
      occurredAt: occurredAt.toISOString(),
      reason,
      recordedAs,
    })),
    protectionOffs: r.protectionOffs.map(({ eventId, studentId, occurredAt, recordedAs }) => ({
      eventId,
      student: named(studentId),
      occurredAt: occurredAt.toISOString(),
      recordedAs,
    })),
  };
}

/** ClassEnded's class at the board's own times. */
function board(): FeedEvent[] {
  return [
    event('session_started', null, 5),
    ...['Ana Rodríguez', 'Marcus Bell', 'Amara Okafor', 'Ethan Park', 'Caleb Washington'].map(
      (id) => event('tap_in', id, 5),
    ),
    event('tap_in', 'Lucas Ferreira', 5),
    ...['Priya Natarajan', 'Jaylen Brooks', 'Diego Ramírez'].map((id) => event('tap_in', id, 6)),
    ...['Sofia Marchetti', 'Tomás Herrera', 'Mateo Silva'].map((id) => event('tap_in', id, 7)),
    event('unlock', 'Jaylen Brooks', 18, { reason: 'bathroom' }),
    event('protection_off', 'Amara Okafor', 22),
    event('refocus', 'Jaylen Brooks', 24),
    event('went_silent', 'Tomás Herrera', 26),
    event('left_for_other_session', 'Caleb Washington', 27),
    event('unlock', 'Diego Ramírez', 31),
    event('unlock', 'Ethan Park', 31, { reason: 'nurse' }),
    event('unlock', 'Lucas Ferreira', 37, { reason: 'nurse' }),
    event('came_back', 'Tomás Herrera', 39),
    // A late tap-in still counts.
    event('tap_in', 'Keisha Thompson', 40),
    event('protection_off', 'Lucas Ferreira', 41),
    event('unlock', 'Mateo Silva', 44, { reason: 'other' }),
    event('session_expired', null, 55),
  ];
}
type Ready = Extract<RecapState, { kind: 'ready' }>;
const ready = (events: FeedEvent[], session = SESSION): Ready => ({
  kind: 'ready',
  session,
  report: reportOf(events, session),
  events,
});

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
type Over = {
  present?: boolean;
  session?: SessionReportSummary;
  roster?: RosterStudent[] | null;
  rosterError?: string | null;
};
const render = (state: Shown, over: Over = {}) =>
  plain(
    renderToStaticMarkup(
      createElement(RecapShown, { state, onRetry: () => undefined, roster: ROSTER, ...over }),
    ),
  );
/** The text of the page, its tags dropped. */
const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
/** Each row: its name and its words, in the page's order. */
const rows = (html: string) =>
  [
    ...html.matchAll(
      /<span class="text-tile-name[^"]*">([^<]*)<\/span>[^]*?<span class="text-data[^"]*">([^<]*)<\/span>/g,
    ),
  ].map((m) => `${m[1]}: ${m[2]}`);
/** Each name in a pill, in the page's order. */
const pills = (html: string) =>
  [...html.matchAll(/<li class="rounded-full bg-surface-sunken[^"]*">([^<]*)<\/li>/g)].map(
    (m) => m[1],
  );
const NOTE = "A phone is silent when it stops checking in. Silent time doesn't count as focus.";
const WHOLE =
  'From their own tap-in to the end of the session, they never unlocked, turned protection off, went silent or left. A late tap-in still counts.';

describe('the recap card on the class page, after the bell (ClassEnded)', () => {
  it('says the last session is loading, under its times', () => {
    const html = render({ kind: 'loading', session: SESSION });
    expect(html).toMatch(/<section aria-labelledby="[^"]*" aria-busy="true"/);
    expect(text(html)).toBe(`|Last session|${TIMES}|Loading the last session…|`);
    expect(html).toMatch(/<p role="status"[^>]*>Loading the last session…<\/p>/);
    // "Last session" in v2's section label over its times, semibold (ClassEnded).
    expect(html).toMatch(
      /<h2 id="[^"]*" class="text-section-label text-text-tertiary uppercase">Last session<\/h2><p class="text-body font-semibold">/,
    );
  });

  it('says why it couldn’t load, with Try again, and no times it doesn’t have', () => {
    const html = render({ kind: 'error', message: "Couldn't reach Bali." });
    expect(text(html)).toBe(
      "|Last session|Couldn't load the last session.|Couldn't reach Bali.|Try again|",
    );
    expect(html).toMatch(/<div role="alert"[^>]*><p class="font-semibold">Couldn't load the last/);
  });

  it('waits for the roster, who didn’t join being read from it, and says its failure', () => {
    const state = ready(board());
    expect(text(render(state, { roster: null }))).toBe(
      `|Last session|${TIMES}|Loading the last session…|`,
    );
    const failed = render(state, { roster: null, rosterError: "Couldn't reach Bali." });
    expect(text(failed)).toBe(
      "|Last session|Couldn't load the last session.|Couldn't reach Bali.|Try again|",
    );
  });

  it('gives the class’s figures, then the three groups, as ClassEnded draws them', () => {
    const events = board();
    const html = render(ready(events));
    const r = reportOf(events);
    const n = new Intl.NumberFormat();
    expect(text(html)).toContain(
      `|Last session|${TIMES}|Joined|13|Class focus time|${n.format(r.focusMinutes)} min|Average per student|${r.averageFocusMinutes} min|Silent|${r.silentMinutes} min|${NOTE}|Focused part of the time · 8|`,
    );
    // By when each one's focus first broke; an unlock's reason after its time, as the board words it.
    expect(rows(html)).toEqual([
      `Jaylen Brooks: Unlocked at ${clock(18)}, Bathroom. Back in focus at ${clock(24)}.`,
      `Amara Okafor: Protection off at ${clock(22)}.`,
      `Tomás Herrera: Silent at ${clock(26)}. Checked in again at ${clock(39)}.`,
      `Caleb Washington: Left at ${clock(27)}.`,
      `Diego Ramírez: Unlocked at ${clock(31)}, no reason given.`,
      `Ethan Park: Unlocked at ${clock(31)}, Nurse.`,
      `Lucas Ferreira: Unlocked at ${clock(37)}, Nurse. Protection off at ${clock(41)}.`,
      `Mateo Silva: Unlocked at ${clock(44)}, Other reason.`,
    ]);
    expect(text(html)).toContain(`|Focused the whole time · 5|${WHOLE}|`);
    expect(text(html)).toContain("|Didn't join · 2|Zuri Mensah|Hannah Levi|");
    // Names in the roster's order, Keisha's late tap-in among them.
    expect(pills(html)).toEqual([
      'Ana Rodríguez',
      'Marcus Bell',
      'Priya Natarajan',
      'Sofia Marchetti',
      'Keisha Thompson',
      'Zuri Mensah',
      'Hannah Levi',
    ]);
    // No "No unlocks." where there were some, and no How it ended's grid or Present here.
    expect(html).not.toMatch(/No unlocks|How it ended|aria-pressed/);
  });

  it('draws each line from the tap-in and each mark at its moment, a tap-in drawing none', () => {
    const html = render(ready(board()));
    const jaylen = html.slice(html.indexOf('>Jaylen Brooks<'), html.indexOf('>Amara Okafor<'));
    // The line from his tap-in at 9:06 to the end, hidden from screen readers: the words say it.
    expect(jaylen).toMatch(
      /<span aria-hidden="true" class="relative block h-5\.5"><span style="left:2%;width:98%" class="absolute top-2\.5 h-0\.5 rounded-full bg-border-strong"><\/span>/,
    );
    // Two marks, an unlock's ring orange and a return's stone, side by side where they'd overlap.
    const rings = [...jaylen.matchAll(/<span style="left:([^"]*)" class="([^"]*)"><svg/g)];
    expect(rings.map((m) => m[2]?.match(/border-(?:unlock-edge|mark(?:-off)?)/)?.[0])).toEqual([
      'border-unlock-edge',
      'border-mark',
    ]);
    expect(rings[0]?.[1]).toMatch(/^min\(26%, /);
    // Every icon at v2.css's 2.25 stroke by a class (the 1.75 rule would win over the prop), 10 px.
    const icons = [...html.matchAll(/<svg[^>]*class="lucide[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(icons.length).toBeGreaterThan(8);
    for (const icon of icons) {
      expect(icon).toMatch(/\bwidth="10"/);
      expect(icon).toMatch(/class="lucide [^"]*\bstroke-\[2\.25\]/);
    }
    // Caleb's line ends where he left; Amara's protection off is red, Tomás's silence dashed.
    expect(html).toMatch(/>Caleb Washington<[^]*?style="left:0%;width:44%"/);
    expect(html).toMatch(/border-mark-off text-state-revoked-fg/);
    expect(html).toMatch(/border-dashed border-mark/);
  });

  it('labels its axis each 10 minutes, AM or PM at its ends (ClassEnded)', () => {
    const html = render(ready(board()));
    const axis =
      /<span class="@container\/axis relative h-4">([^]*?)<\/span><span class="@max/.exec(
        html,
      )?.[1];
    const ticks = [...(axis ?? '').matchAll(/style="left:([^"]*)"[^>]*>([^<]*)</g)].map(
      (m) => `${m[2]} @${m[1]}`,
    );
    expect(ticks).toEqual([
      `${clock(5)} @0%`,
      `${clock(15).replace(/ [AP]M$/, '')} @20%`,
      `${clock(25).replace(/ [AP]M$/, '')} @40%`,
      `${clock(35).replace(/ [AP]M$/, '')} @60%`,
      `${clock(45).replace(/ [AP]M$/, '')} @80%`,
      `${clock(55)} @100%`,
    ]);
  });

  it('never says an unlock’s reason in Present, the projector the class can see', () => {
    const html = render(ready(board()), { present: true });
    expect(rows(html)).toContain(`Ethan Park: Unlocked at ${clock(31)}.`);
    expect(html).not.toMatch(/Nurse|Bathroom|Other reason|no reason given/);
  });

  it('says there were no unlocks', () => {
    const events = [event('tap_in', 'Ana Rodríguez', 5), event('went_silent', 'Ana Rodríguez', 20)];
    expect(text(render(ready(events)))).toContain(
      `|${NOTE}|No unlocks.|Focused part of the time · 1|`,
    );
  });

  it('says nobody joined, with no figures and no groups', () => {
    const html = render(ready([]));
    expect(text(html)).toBe(`|Last session|${TIMES}|Nobody joined this session.|`);
  });
});

describe('two states no board draws (PV12b; the owner’s to look at)', () => {
  it('lists who never joined with an unlock under Didn’t join, a row with its moment', () => {
    // A tap a later one of hers went ahead of (A14), and the unlock sent under it.
    const events = [
      event('tap_in', 'Ana Rodríguez', 5),
      event('tap_in', 'Zuri Mensah', 8, { recorded_as: 'superseded' }),
      event('unlock', 'Zuri Mensah', 9, { reason: 'nurse', recorded_as: 'no_live_participation' }),
    ];
    const roster = [enrolled('Ana Rodríguez'), enrolled('Zuri Mensah'), enrolled('Hannah Levi')];
    const html = render(ready(events), { roster });
    expect(text(html)).toContain("|Didn't join · 2|Hannah Levi|");
    expect(pills(html)).toEqual(['Ana Rodríguez', 'Hannah Levi']);
    expect(rows(html)).toEqual([`Zuri Mensah: Unlocked at ${clock(9)}, Nurse.`]);
    // No line, and its mark where it was.
    const zuri = html.slice(html.indexOf('>Zuri Mensah<'));
    expect(zuri).not.toMatch(/bg-border-strong/);
    expect(zuri).toMatch(/<span style="left:8%" class="[^"]*border-unlock-edge/);
  });

  it('still shows that row when nobody joined, under Didn’t join with everyone else', () => {
    const events = [event('unlock', 'Zuri Mensah', 9, { recorded_as: 'no_live_participation' })];
    const roster = [enrolled('Zuri Mensah'), enrolled('Hannah Levi')];
    const html = render(ready(events), { roster });
    expect(text(html)).toMatch(
      /^\|Last session\|[^|]*\|Nobody joined this session\.\|Didn't join · 2\|Hannah Levi\|/,
    );
    expect(rows(html)).toEqual([`Zuri Mensah: Unlocked at ${clock(9)}, no reason given.`]);
  });

  it('lists an unlock after an early End under part of the time, its mark past the line', () => {
    const session = { ...SESSION, endedAt: AT(20) };
    const events = [
      event('tap_in', 'Ana Rodríguez', 5),
      event('session_ended', null, 20),
      event('unlock', 'Ana Rodríguez', 21, { recorded_as: 'after_session_end' }),
    ];
    const html = render(ready(events, session));
    expect(rows(html)).toEqual([`Ana Rodríguez: Unlocked at ${clock(21)}, no reason given.`]);
    expect(html).toMatch(
      /style="left:0%;width:93\.75%"[^]*?<span style="left:100%" class="[^"]*border-unlock-edge/,
    );
  });

  it('lists an unlock before the student’s own tap-in under part of the time, its mark before the line', () => {
    const events = [
      event('unlock', 'Ana Rodríguez', 9, { recorded_as: 'no_live_participation' }),
      event('tap_in', 'Ana Rodríguez', 12),
    ];
    const html = render(ready(events));
    expect(rows(html)).toEqual([`Ana Rodríguez: Unlocked at ${clock(9)}, no reason given.`]);
    expect(html).toMatch(
      /style="left:14%;width:86%"[^]*?<span style="left:8%" class="[^"]*border-unlock-edge/,
    );
  });
});

describe('the class page’s line after the bell', () => {
  const UTC = { locale: 'en-US', timeZone: 'UTC' };
  it('is the session’s end as the server marked it, when that was today', () => {
    expect(plain(endedToday(SESSION, new Date(AT(120)), UTC) ?? '')).toBe('2:55 PM');
    // Ended early: its end, never its bell.
    const early = { ...SESSION, endedAt: AT(20) };
    expect(plain(endedToday(early, new Date(AT(120)), UTC) ?? '')).toBe('2:20 PM');
  });

  it('is none for an older session, whose card says its day, and none before one is found', () => {
    expect(endedToday(SESSION, new Date(AT(60 * 24)), UTC)).toBeNull();
    expect(endedToday(null, new Date(AT(60)), UTC)).toBeNull();
  });
});

describe('the card’s reads', () => {
  const source = readFileSync(fileURLToPath(new URL('./recap-card.tsx', import.meta.url)), 'utf8');

  it('reads the roster again with Try again when it failed, and its own read unless it is in', () => {
    expect(source).toMatch(
      /onRetry=\{\(\) => \{\s*if \(state\.kind !== 'ready'\) \{\s*setState\(\{ kind: 'loading', session: null \}\);\s*setAttempt\(\(n\) => n \+ 1\);\s*\}\s*if \(rosterError\) onRetryRoster\?\.\(\);/,
    );
  });

  it('tells the page the session it found, none until it does, and keeps it through a retry', () => {
    expect(source).toMatch(
      /const found = state\.kind === 'ready' \|\| state\.kind === 'loading' \? state\.session : null;\s*useEffect\(\(\) => \{[^]*?if \(state\.kind === 'loading' && found === null\) return;\s*onFound\?\.\(found\);/,
    );
  });
});

/* An opened report (R5) keeps PB5's timeline until PV13 and PV14 redraw Reports. */
const lucas: ReportStudent = { id: 'u1', displayName: 'Lucas Ferreira' };
const ana: ReportStudent = { id: 'u2', displayName: 'Ana Rodríguez' };
const OPENED: SessionReportSummary = { ...SESSION, joinedCount: 2, focusMinutes: 1214 };
const REPORT: SessionReportResponse = {
  ended: true,
  joined: [ana, lucas],
  focusMinutes: 1214,
  averageFocusMinutes: 45,
  silentMinutes: 23,
  unlocks: [
    { eventId: 'o3', student: lucas, occurredAt: AT(37), reason: 'nurse', recordedAs: null },
  ],
  protectionOffs: [],
};
const feed = (n: number, type: FeedEvent['type'], userId: string, minute: number) => ({
  seq: n,
  eventId: `o${n}`,
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
const OPENED_READY: Ready = { kind: 'ready', session: OPENED, report: REPORT, events: EVENTS };
const marks = (html: string) =>
  [...html.matchAll(/<button[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]);

describe('an opened report', () => {
  it('shows its timeline with no figures of its own, the row saying them', () => {
    const html = render(OPENED_READY, { session: OPENED, roster: null });
    expect(html).toMatch(new RegExp(`<h2 id="[^"]*" class="sr-only">${TIMES}</h2>`));
    expect(html).not.toContain('Class focus time');
    expect(text(html)).toContain(`|${NOTE}|Tapped in|`);
    expect(marks(html)).toContain(`Lucas Ferreira, unlocked at ${clock(37)}, Nurse`);
  });

  it('says it is loading, or why it couldn’t load, in the session’s words', () => {
    expect(render({ kind: 'loading', session: OPENED }, { session: OPENED })).toMatch(
      /<p role="status"[^>]*>Loading this session…<\/p>/,
    );
    const failed = render({ kind: 'error', message: 'x' }, { session: OPENED });
    expect(text(failed)).toContain("|Couldn't load this session.|x|Try again|");
  });

  it('says nobody joined, still marking an unlock from a student who never joined', () => {
    const nobody = { ...REPORT, joined: [], averageFocusMinutes: null };
    const html = render(
      { ...OPENED_READY, report: nobody, events: EVENTS.slice(2) },
      { session: OPENED },
    );
    expect(text(html)).toMatch(/^\|[^|]*\|Nobody joined this session\.\|Unlocked\|/);
    expect(marks(html)).toEqual([`Lucas Ferreira, unlocked at ${clock(37)}, Nurse`]);
  });
});
