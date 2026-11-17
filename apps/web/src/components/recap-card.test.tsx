// @vitest-environment jsdom
import type {
  EventType,
  FeedEvent,
  ReportStudent,
  RosterStudent,
  SessionReportResponse,
  SessionReportSummary,
} from '@bali/shared';
import { sessionReport } from '@bali/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { bareTime, type SessionWindow } from '@/lib/recap';

import { endedToday, Recap } from './recap-card';

/*
 * The recap after the bell (LO7; ClassEnded, ClassEndedOpen, PhonePages' After the bell, and the
 * in-between states drawn first on the canvas's ClassEndedStates), as a teacher meets it (the
 * portal's tests drive the page, the owner, 2026-10-22): the count and the figures, who wasn't
 * focused the whole time as a name and a track, the Key, everyone else in two lines with Show
 * names, and a student's record. Each report is R2's own `sessionReport` over the same events, and
 * times are said in this computer's own zone, as the page says them. Converted from the source text
 * and renders of v2's card (`recap-card.test.ts`, PV12b), which LO7 replaced.
 */

/** 9:05 to 9:55 on the board's day, a minute from its start being 2 % of the axis. */
const AT = (minute: number) => new Date(Date.UTC(2026, 9, 12, 14) + minute * 60_000).toISOString();
const SESSION: SessionWindow = { startedAt: AT(5), endsAt: AT(55), endedAt: AT(55) };

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
const enrolled = (id: string): RosterStudent => ({
  enrollmentId: `n-${id}`,
  studentId: id,
  displayName: id,
  joinedAt: AT(0),
});
const ROSTER = CLASS.map(enrolled);

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

/** ClassEnded's class at the board's own times, and a few more moments of the rarer kinds. */
function board(): FeedEvent[] {
  return [
    event('session_started', null, 5),
    ...['Ana Rodríguez', 'Marcus Bell', 'Amara Okafor', 'Caleb Washington', 'Lucas Ferreira'].map(
      (id) => event('tap_in', id, 5),
    ),
    ...['Priya Natarajan', 'Jaylen Brooks', 'Diego Ramírez', 'Ethan Park'].map((id) =>
      event('tap_in', id, 6),
    ),
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

afterEach(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
});

/** The recap of these events, as the class page and a session's report draw it. */
function open(events = board(), roster = ROSTER, session = SESSION) {
  const user = userEvent.setup();
  render(
    <main>
      <Recap session={session} report={reportOf(events, session)} events={events} roster={roster} />
    </main>,
  );
  return user;
}
/** A time without AM or PM, as the tracks say it. */
const bare = (minute: number) => bareTime(Date.parse(AT(minute)));
/** The figures, each its words and its number. */
const figures = () =>
  screen
    .queryAllByRole('definition')
    .map((dd) => `${dd.previousElementSibling?.textContent}: ${dd.textContent}`);
/** Each row of Not focused the whole time: the name, then its track's words. */
const rows = () =>
  screen.getAllByRole('img').map((track) => {
    const name = track.parentElement?.querySelector('button')?.textContent;
    return `${name}: ${track.getAttribute('aria-label')}`;
  });

describe('the recap (ClassEnded)', () => {
  it('heads it with how many of who joined stayed focused the whole time, then the figures', () => {
    open();
    expect(screen.getByRole('heading', { level: 2, name: /stayed focused/ }).textContent).toBe(
      '5 of 13 stayed focused the whole time',
    );
    // A dt each, under its number: who joined, R2's unlocks and protection offs, the silences
    // before the bell, and who didn't join, the zeros too.
    expect(figures()).toEqual([
      'joined: 13',
      'emergency unlocks: 5',
      'protection off: 2',
      'went silent: 1',
      "didn't join: 2",
    ]);
    // No words under the big number (the owner, 2026-11-16).
    expect(screen.queryByText(/silent when it stops checking in/)).toBeNull();
  });

  it('lists who wasn’t focused the whole time, by when it first broke, each a name and a track in words', () => {
    open();
    const part = screen.getByRole('region', { name: 'Not focused the whole time' });
    expect(part.textContent).toContain('Not focused the whole time8');
    expect(rows()).toEqual([
      `Jaylen Brooks: Focused from ${bare(6)}, unlocked ${bare(18)} to ${bare(24)}, then focused to the bell`,
      `Amara Okafor: Focused from ${bare(5)}, protection off from ${bare(22)} to the bell`,
      `Tomás Herrera: Focused from ${bare(7)}, silent ${bare(26)} to ${bare(39)}, then focused to the bell`,
      `Caleb Washington: Focused from ${bare(5)} to ${bare(27)}`,
      `Diego Ramírez: Focused from ${bare(6)}, unlocked from ${bare(31)} to the bell`,
      `Ethan Park: Focused from ${bare(6)}, unlocked from ${bare(31)} to the bell`,
      `Lucas Ferreira: Focused from ${bare(5)}, unlocked ${bare(37)} to ${bare(41)}, then protection off to the bell`,
      `Mateo Silva: Focused from ${bare(7)}, unlocked from ${bare(44)} to the bell`,
    ]);
  });

  it('draws each track’s stretches where they fall, as ClassEnded draws Jaylen’s', () => {
    open();
    const jaylen = screen.getAllByRole('img')[0];
    const stretches = [...jaylen.children].map(
      (s) => `${(s as HTMLElement).style.left} ${(s as HTMLElement).style.width} ${s.className}`,
    );
    expect(stretches).toEqual([
      expect.stringMatching(/^2% 24% .*\bbg-track-focused\b/),
      expect.stringMatching(/^26% 12% .*\bbg-unlock-edge\b/),
      expect.stringMatching(/^38% 62% .*\bbg-track-focused\b/),
    ]);
    // A silence is the dashed line along the middle; a protection off red; leaving, the bare track.
    const [, amara, tomas, caleb] = screen.getAllByRole('img');
    expect(amara?.lastElementChild?.className).toMatch(/\bbg-mark-off\b/);
    expect(tomas?.children[1]?.className).toMatch(/\btrack-dashes\b/);
    expect((caleb?.lastElementChild as HTMLElement).style.width).toBe('44%');
  });

  it('labels its axis each 10 minutes, AM or PM at its ends, for the eye alone', () => {
    const { container } = render(
      <Recap session={SESSION} report={reportOf(board())} events={board()} roster={ROSTER} />,
    );
    const axis = container.querySelector('[aria-hidden="true"] .\\@container\\/axis');
    const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    expect([...(axis?.children ?? [])].map((t) => t.textContent)).toEqual([
      clock.format(Date.parse(AT(5))),
      bare(15),
      bare(25),
      bare(35),
      bare(45),
      clock.format(Date.parse(AT(55))),
    ]);
  });

  it('opens the Key on a tap, what each colour means, and closes it again', async () => {
    const user = open();
    const key = screen.getByRole('button', { name: 'Key' });
    expect(key.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'What the colors mean' })).toBeNull();
    await user.click(key);
    expect(key.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: 'What the colors mean' });
    expect(key.getAttribute('aria-controls')).toBe(list.id);
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual(['Focused', 'Unlocked', 'Protection off', 'Silent', 'Not here']);
    await user.click(key);
    expect(screen.queryByRole('list', { name: 'What the colors mean' })).toBeNull();
  });

  it('folds everyone else into two lines: who stayed focused, with Show names, and who didn’t join', async () => {
    const user = open();
    const rest = screen.getByRole('region', { name: 'Everyone else' });
    const lines = within(rest).getAllByRole('listitem');
    expect(lines.map((l) => l.textContent)).toEqual([
      '5 stayed focused the whole timeShow names',
      "Didn't join: Zuri Mensah, Hannah Levi",
    ]);
    const show = within(rest).getByRole('button', { name: 'Show names' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    await user.click(show);
    expect(show.textContent).toBe('Hide names');
    expect(show.getAttribute('aria-expanded')).toBe('true');
    // In the roster's order, Keisha's late tap-in among them.
    const names = document.getElementById(show.getAttribute('aria-controls') ?? '');
    expect(names?.textContent).toBe(
      'Ana Rodríguez, Marcus Bell, Priya Natarajan, Sofia Marchetti, Keisha Thompson',
    );
    await user.click(show);
    expect(show.textContent).toBe('Show names');
    expect(names?.isConnected).toBe(false);
  });

  it('opens a student’s record from their name, oldest first, an unlock’s reason under it; Close or Escape closes it, focus back on the name', async () => {
    const user = open();
    const ethan = screen.getByRole('button', { name: 'Ethan Park' });
    await user.click(ethan);
    const record = screen.getByRole('complementary', { name: 'Ethan Park' });
    expect(ethan.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(
      within(record).getByRole('heading', { name: 'Ethan Park' }),
    );
    expect(within(record).getByRole('heading', { name: 'This session' })).toBeTruthy();
    expect(
      within(record)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual([`${bare(6)}Tapped in and focused`, `${bare(31)}Used Emergency UnlockNurse`]);
    await user.click(within(record).getByRole('button', { name: "Close Ethan Park's record" }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(ethan);
    expect(ethan.getAttribute('aria-current')).toBeNull();

    // Another's, by Escape from inside; and a name pressed again closes its own.
    const tomas = screen.getByRole('button', { name: 'Tomás Herrera' });
    await user.click(tomas);
    const his = screen.getByRole('complementary', { name: 'Tomás Herrera' });
    expect(
      within(his)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual([
      `${bare(7)}Tapped in and focused`,
      `${bare(26)}Went silent`,
      `${bare(39)}Checked in again`,
    ]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(tomas);
    await user.click(screen.getByRole('button', { name: 'Diego Ramírez' }));
    expect(within(screen.getByRole('complementary')).getAllByRole('listitem')[1]?.textContent).toBe(
      `${bare(31)}Used Emergency UnlockNo reason given`,
    );
    await user.click(screen.getByRole('button', { name: 'Diego Ramírez' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('the recap’s rarer moments (ClassEndedStates, drawn first)', () => {
  it('shows no Not focused part and no Key when everyone stayed focused, the figures’ zeros kept', () => {
    const events = [event('tap_in', 'Ana Rodríguez', 5), event('tap_in', 'Marcus Bell', 6)];
    open(events, [enrolled('Ana Rodríguez'), enrolled('Marcus Bell')]);
    expect(screen.getByRole('heading', { level: 2, name: /stayed focused/ }).textContent).toBe(
      '2 of 2 stayed focused the whole time',
    );
    expect(screen.queryByRole('heading', { name: 'Not focused the whole time' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Key' })).toBeNull();
    expect(figures()).toEqual([
      'joined: 2',
      'emergency unlocks: 0',
      'protection off: 0',
      'went silent: 0',
      "didn't join: 0",
    ]);
    // Everyone joined: one line, no Didn't join.
    const rest = screen.getByRole('region', { name: 'Everyone else' });
    expect(
      within(rest)
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['2 stayed focused the whole timeShow names']);
  });

  it('says one emergency unlock, and leaves the first line out when nobody stayed focused', () => {
    open(
      [event('tap_in', 'Ana Rodríguez', 5), event('unlock', 'Ana Rodríguez', 20)],
      [enrolled('Ana Rodríguez'), enrolled('Zuri Mensah')],
    );
    expect(figures()).toContain('emergency unlock: 1');
    const rest = screen.getByRole('region', { name: 'Everyone else' });
    expect(
      within(rest)
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(["Didn't join: Zuri Mensah"]);
  });

  it('says nobody joined in the count’s place, who didn’t join under it, and no figures', () => {
    open([], [enrolled('Ana Rodríguez'), enrolled('Zuri Mensah')]);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Nobody joined this session.' }),
    ).toBeTruthy();
    expect(screen.queryByRole('term')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Not focused the whole time' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Everyone else' }).textContent).toBe(
      "Everyone elseDidn't join: Ana Rodríguez, Zuri Mensah",
    );
  });

  it('counts an unlock from someone who never joined in the figures, as the report counts it', () => {
    // A tap a later one of hers went ahead of (A14), and the unlock sent under it.
    const events = [
      event('tap_in', 'Zuri Mensah', 8, { recorded_as: 'superseded' }),
      event('unlock', 'Zuri Mensah', 9, { reason: 'nurse', recorded_as: 'no_live_participation' }),
    ];
    open(events, [enrolled('Zuri Mensah'), enrolled('Hannah Levi')]);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Nobody joined this session.',
      'Everyone else',
    ]);
    expect(figures()).toEqual(['emergency unlock: 1']);
    expect(screen.getByText("Didn't join: Zuri Mensah, Hannah Levi")).toBeTruthy();
  });

  it('ends a track at an early End, and draws an unlock from before the tap-in as nothing on it', () => {
    const session = { ...SESSION, endedAt: AT(20) };
    const events = [
      event('unlock', 'Ana Rodríguez', 9, { recorded_as: 'no_live_participation' }),
      event('tap_in', 'Ana Rodríguez', 12),
      event('session_ended', null, 20),
    ];
    open(events, [enrolled('Ana Rodríguez')], session);
    expect(rows()).toEqual([`Ana Rodríguez: Focused from ${bare(12)} to the bell`]);
  });
});

describe('the class page’s line after the bell', () => {
  const UTC = { locale: 'en-US', timeZone: 'UTC' };
  const SUMMARY: SessionReportSummary = {
    id: 's1',
    ...SESSION,
    ended: true,
    joinedCount: 0,
    focusMinutes: 0,
    averageFocusMinutes: null,
    silentMinutes: 0,
    unlockCount: 0,
    protectionOffCount: 0,
  };
  const plain = (s: string | null) => (s ?? '').replace(/\s/g, ' ');

  it('is the session’s end as the server marked it, when that was today', () => {
    expect(plain(endedToday(SUMMARY, new Date(AT(120)), UTC))).toBe('2:55 PM');
    // Ended early: its end, never its bell.
    const early = { ...SUMMARY, endedAt: AT(20) };
    expect(plain(endedToday(early, new Date(AT(120)), UTC))).toBe('2:20 PM');
  });

  it('is none for an older session, and none before one is found', () => {
    expect(endedToday(SUMMARY, new Date(AT(60 * 24)), UTC)).toBeNull();
    expect(endedToday(null, new Date(AT(60)), UTC)).toBeNull();
  });
});
