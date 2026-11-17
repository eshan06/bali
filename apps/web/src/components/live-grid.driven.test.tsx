// @vitest-environment jsdom
import {
  type FeedEvent,
  type SessionSnapshot,
  type SnapshotStudent,
  UNLOCK_REASONS,
  type UnlockReason,
} from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkError } from '@/lib/api-client';
import { CANT_REACH } from '@/lib/errors';
import { bareTime } from '@/lib/recap';

import { LiveGrid, LockChip } from './live-grid';

/*
 * The live grid as a teacher meets it (the owner's decision of 2026-10-22: the portal's tests drive
 * the page): on the class page while a session runs, and in Present, the projector the class can
 * see (ClassPresent). On the class page, the lock-only look since LO5 (ClassLive, LiveStates,
 * LiveTopStates, PhoneLive): the count of who is focused, Check on, then the room, every tile its
 * state and its name only, the times and the reason in the student's panel (the owner,
 * 2026-11-16). Present keeps v2's tiles until LO9: each student's state, but never what is the
 * teacher's alone, an unlock's reason (2026-10-06) and Clock off (the owner, 2026-10-28). Bali's
 * answer to the grid's read is a stand-in's, held until the test gives it, and no stream runs: the
 * grid is the snapshot it read.
 *
 * The grid's other tests, not converted yet, are in `live-grid.test.ts`; this file can't share its
 * name, since TypeScript drops a `.tsx` whose name a `.ts` beside it has (ESLint then says the
 * project service can't find it). The step that converts them merges the two.
 */

const bali = vi.hoisted(() => {
  /** Each read on its way (the grid's, a student panel's), its answer the test's to give. */
  const reads: { path: string; answer: (body: unknown) => void; fail: (e: unknown) => void }[] = [];
  const get = (path: string) =>
    new Promise((answer, fail) => {
      reads.push({ path, answer, fail });
    });
  // One client and one sign-out for every render, as the hooks' memos keep them: the grid reads
  // once as it opens.
  const signOut = () => undefined;
  /** What the grid asked of each stream it opened. */
  const streams: unknown[] = [];
  return { reads, api: { get }, signOut, streams };
});

vi.mock('@/lib/use-api', () => ({ useApi: () => bali.api, useSignOut: () => bali.signOut }));
// No stream: the grid is its snapshot. What it asked for is kept.
vi.mock('@/lib/sse-client', () => ({
  createSseClient: (options: unknown) => {
    bali.streams.push(options);
    return { close: () => undefined };
  },
}));

afterEach(() => {
  bali.reads.length = 0;
  bali.streams.length = 0;
  cleanup();
});

const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();

/** A student as Bali's read of the grid gives them: focused, heard from 10 s ago, unless told. */
function student(name: string, over: Partial<SnapshotStudent> = {}): SnapshotStudent {
  return {
    enrollmentId: `e-${name}`,
    studentId: `u-${name}`,
    displayName: name,
    state: 'focused',
    joinedAt: ago(1200),
    lastSeenAt: ago(10),
    endedAt: null,
    unlock: null,
    protectionOffAfterEnd: false,
    ...over,
  };
}

/** Their unlock a minute ago, with its reason. */
const unlock = (name: string, reason: UnlockReason) => ({
  eventId: `v-${name}`,
  reason,
  recordedAs: null,
  occurredAt: ago(60),
});

/** The grid's read on its way now, answered: the snapshot, or no answer at all. */
async function answerRead(snapshot: SessionSnapshot | 'none') {
  await act(async () => {
    const read = bali.reads.find(({ path }) => path === '/v1/sessions/S');
    if (!read) throw new Error('no read of the grid on its way');
    bali.reads.splice(bali.reads.indexOf(read), 1);
    if (snapshot === 'none') read.fail(new NetworkError());
    else read.answer(snapshot);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const snapshotOf = (students: SnapshotStudent[], more: Partial<SessionSnapshot> = {}) => ({
  session: {
    id: 'S',
    classId: 'C',
    startedAt: ago(1500),
    endsAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  },
  ended: false,
  latestSeq: 12,
  students,
  ...more,
});

/** The grid on the class page while a session runs, or in Present, once Bali answers its read. */
async function open(
  present: boolean,
  students: SnapshotStudent[],
  more: Partial<SessionSnapshot> = {},
) {
  const view = render(<LiveGrid sessionId="S" livePage present={present} />);
  await answerRead(snapshotOf(students, more));
  return view;
}

/** A student's tile, found by their name in the room (the class page) or the grid (Present). */
function tile(name: string): HTMLElement {
  const room = screen.queryByRole('list', { name: 'Everyone in the class' });
  const found = (room ? within(room) : screen).getByText(name).closest('li');
  if (!found) throw new Error(`no tile for ${name}`);
  return found;
}

/** What a tile says, its parts read in order with no space between them, as the markup has them. */
const says = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');

/** A tile's words part by part, its name first: the name, the state and its line, if it has one. */
function parts(name: string): string[] {
  const words = within(tile(name)).getByText(name).parentElement;
  if (!words) throw new Error(`no words for ${name}`);
  return Array.from(words.children, (part) => (part.textContent ?? '').replace(/\s+/g, ' '));
}

/** Check on's rows, each its chip's words and the names in it, as a teacher reads them. */
function checks(): string[][] {
  const title = screen.queryByText(/^Check on \d+$/);
  const list = title?.nextElementSibling;
  if (!list) return [];
  return Array.from(list.children, (row) => {
    const [chip, people] = Array.from(row.children);
    return [
      (chip?.textContent ?? '').replace(/\s+/g, ' '),
      ...Array.from(people?.children ?? [], (name) => name.textContent ?? ''),
    ];
  });
}

describe('the room on the class page (LO5; ClassLive, LiveStates’ rare tiles)', () => {
  it('names everyone with their count, each tile its state and its name, nothing else', async () => {
    await open(false, [
      student('Ana Rodríguez'),
      student('Omar Siddiqui', { clockOff: true }),
      student('Ethan Park', { state: 'unlocked', unlock: unlock('Ethan Park', 'nurse') }),
      student('Tomás Herrera', { lastSeenAt: ago(330) }),
      student('Amara Okafor', { state: 'protection_off', lastSeenAt: ago(330) }),
      student('Caleb Washington', { endedAt: ago(60) }),
      student('Mateo Silva', {
        state: 'unlocked',
        unlock: unlock('Mateo Silva', 'other'),
        endedAt: ago(30),
      }),
      student('Zuri Mensah', { state: null }),
      student('Grace Kim', { state: 'mystery' as SnapshotStudent['state'] }),
    ]);
    const room = screen.getByRole('region', { name: 'Everyone' });
    expect(within(room).getByText('9')).toBeTruthy();
    expect(
      ['Ana Rodríguez', 'Omar Siddiqui', 'Ethan Park', 'Tomás Herrera', 'Amara Okafor'].map(parts),
    ).toEqual([
      ['Ana Rodríguez', 'Focused'],
      ['Omar Siddiqui', 'Focused'],
      ['Ethan Park', 'Unlocked'],
      ['Tomás Herrera', 'Silent · 5 min'],
      ['Amara Okafor', 'Protection off'],
    ]);
    expect(['Caleb Washington', 'Mateo Silva', 'Zuri Mensah', 'Grace Kim'].map(parts)).toEqual([
      ['Caleb Washington', 'Left'],
      ['Mateo Silva', 'Left · unlocked'],
      ['Zuri Mensah', 'Not here'],
      ['Grace Kim', 'Unknown · refresh'],
    ]);
    // No reason, no "last seen", no Clock off: the student's panel says those.
    expect(says(room)).not.toMatch(/nurse|other reason|last seen|clock/i);
  });

  it('draws each tile one size in its state’s tint, Silent’s and Unknown’s edge dashed, the whole name on hover', async () => {
    const long = 'Bartholomew Montgomery-Whitfield';
    await open(false, [
      student(long),
      student('Tomás Herrera', { lastSeenAt: ago(330) }),
      student('Mateo Silva', {
        state: 'unlocked',
        unlock: unlock('Mateo Silva', 'other'),
        endedAt: ago(30),
      }),
      student('Grace Kim', { state: 'mystery' as SnapshotStudent['state'] }),
    ]);
    const button = (name: string) => within(tile(name)).getByRole('button');
    const classes = (name: string) => Array.from(button(name).classList);
    // At least 60 px tall, 8 × 12 px in, 10 px corners, a 1.5 px edge; pressed, it scales.
    expect(classes(long)).toEqual(
      expect.arrayContaining([
        'min-h-15',
        'px-3',
        'py-2',
        'rounded-sm',
        'border-[1.5px]',
        'press',
        'bg-state-focused-bg',
        'border-transparent',
        'hover:border-border-strong',
      ]),
    );
    // Cut short, never wrapped, and whole on hover.
    const name = within(tile(long)).getByText(long);
    expect(Array.from(name.classList)).toEqual(
      expect.arrayContaining(['truncate', 'text-room-name', 'max-[760px]:text-room-name-phone']),
    );
    expect(name.getAttribute('title')).toBe(long);
    for (const dashed of ['Tomás Herrera', 'Grace Kim']) {
      expect(classes(dashed), dashed).toEqual(
        expect.arrayContaining([
          'border-dashed',
          'border-border-strong',
          'hover:border-border-input',
        ]),
      );
    }
    // A student who left while unlocked keeps the unlock's orange, the flag its icon, so it never
    // reads as a quiet Left.
    expect(classes('Mateo Silva')).toContain('bg-state-emergency-bg');
    const icons = button('Mateo Silva').querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0]?.getAttribute('class')).toMatch(/lucide-flag\b/);
    expect(icons[0]?.getAttribute('width')).toBe('18');
  });

  it('has no room for a class nobody has joined, Check on saying so under 0 of 0', async () => {
    await open(false, []);
    expect(screen.getAllByRole('heading', { level: 2 })[0]?.textContent).toBe('0 of 0 focused');
    expect(screen.getByText('No students yet.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Everyone' })).toBeNull();
  });
});

describe('the count and Check on (LO5; ClassLive, LiveStates, LiveTopStates)', () => {
  it('counts who is focused of everyone, then lists everyone else by state, the unlocks first', async () => {
    await open(false, [
      student('Zuri Mensah', { state: null }),
      student('Ana Rodríguez'),
      student('Wei Zhang', { lastSeenAt: ago(150) }),
      student('Tomás Herrera', { lastSeenAt: ago(330) }),
      student('Noor Haddad', { lastSeenAt: ago(150) }),
      student('Grace Kim', { state: 'mystery' as SnapshotStudent['state'] }),
      student('Caleb Washington', { endedAt: ago(60) }),
      student('Amara Okafor', { state: 'protection_off', lastSeenAt: ago(10) }),
      student('Mateo Silva', {
        state: 'unlocked',
        unlock: unlock('Mateo Silva', 'other'),
        endedAt: ago(30),
      }),
      student('Ethan Park', { state: 'unlocked', unlock: unlock('Ethan Park', 'nurse') }),
      student('Hannah Levi', { state: null }),
    ]);
    const count = screen.getByRole('region', { name: '1 of 11 focused' });
    expect(within(count).getByText('Check on 10')).toBeTruthy();
    // A row per state in its tile's words, two silent for different times a row each; each row's
    // names in the grid's order. The state and the name, nothing else.
    expect(checks()).toEqual([
      ['Unlocked', 'Ethan Park'],
      ['Left · unlocked', 'Mateo Silva'],
      ['Protection off', 'Amara Okafor'],
      ['Silent · 2 min', 'Wei Zhang', 'Noor Haddad'],
      ['Silent · 5 min', 'Tomás Herrera'],
      ['Not here', 'Zuri Mensah', 'Hannah Levi'],
      ['Left', 'Caleb Washington'],
      ['Unknown · refresh', 'Grace Kim'],
    ]);
    expect(says(count)).not.toMatch(/nurse|other reason|last seen/i);
    // Open at the end of a row of one, named for whom, hidden on a phone; none for a row of
    // several, whose names are their own buttons.
    const opens = within(count).getAllByRole('button', { name: /^Open / });
    expect(opens.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Open Ethan Park',
      'Open Mateo Silva',
      'Open Amara Okafor',
      'Open Tomás Herrera',
      'Open Caleb Washington',
      'Open Grace Kim',
    ]);
    for (const button of opens) expect(button.classList).toContain('max-[760px]:hidden');
    expect(within(count).getByRole('button', { name: 'Wei Zhang' })).toBeTruthy();
  });

  it('keeps a Silent row, and the name focused in it, as its minutes turn over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await open(false, [
        student('Tomás Herrera', { lastSeenAt: ago(330) }),
        student('Ana Rodríguez'),
      ]);
      await act(async () => {
        (bali.streams[0] as { onStatus: (s: string) => void }).onStatus('open');
        await Promise.resolve();
      });
      const region = screen.getByRole('region', { name: '1 of 2 focused' });
      const name = within(region).getByRole('button', { name: 'Tomás Herrera' });
      name.focus();
      expect(checks()).toEqual([['Silent · 5 min', 'Tomás Herrera']]);
      await act(() => vi.advanceTimersByTimeAsync(50_000));
      expect(checks()).toEqual([['Silent · 6 min', 'Tomás Herrera']]);
      expect(document.activeElement).toBe(name);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says everyone is focused in one line, and nothing to check', async () => {
    await open(false, [student('Ana Rodríguez'), student('Marcus Bell')]);
    const count = screen.getByRole('region', { name: '2 of 2 focused' });
    expect(within(count).getByText('Everyone’s focused.'.replace('’', "'"))).toBeTruthy();
    expect(screen.queryByText(/^Check on/)).toBeNull();
  });

  it('opens a student’s panel from their name, focus into it, and back on the name as it closes', async () => {
    const user = userEvent.setup();
    await open(false, [
      student('Ethan Park', { state: 'unlocked', unlock: unlock('Ethan Park', 'nurse') }),
      student('Ana Rodríguez'),
    ]);
    const count = screen.getByRole('region', { name: '1 of 2 focused' });
    const name = within(count).getByRole('button', { name: 'Ethan Park' });
    await user.click(name);
    const panel = screen.getByRole('complementary', { name: 'Ethan Park' });
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Ethan Park' }));
    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(name.getAttribute('aria-controls')).toBe(panel.id);
    await user.click(within(panel).getByRole('button', { name: "Close Ethan Park's panel" }));
    expect(screen.queryByRole('complementary', { name: 'Ethan Park' })).toBeNull();
    expect(document.activeElement).toBe(name);

    // Its Open the same, focus back on Open; a tile's own back on the tile.
    const openIt = within(count).getByRole('button', { name: 'Open Ethan Park' });
    await user.click(openIt);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(openIt);
    const anasTile = within(tile('Ana Rodríguez')).getByRole('button');
    await user.click(anasTile);
    expect(anasTile.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(anasTile);
  });

  it('never opens a panel in Present, and closes one as Present turns on', async () => {
    const user = userEvent.setup();
    const view = await open(false, [student('Ana Rodríguez')]);
    await user.click(within(tile('Ana Rodríguez')).getByRole('button'));
    expect(screen.getByRole('complementary', { name: 'Ana Rodríguez' })).toBeTruthy();
    view.rerender(<LiveGrid sessionId="S" livePage present />);
    // No panel, and no session list either: Present keeps v2's room until LO9.
    expect(screen.queryByRole('complementary')).toBeNull();
    // A tile alone there, never a button; no Check on, which the page draws.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/ of \d+ focused$/)).toBeNull();
  });

  it('says a session that didn’t load in the count’s place, Try again reading it again', async () => {
    const user = userEvent.setup();
    render(<LiveGrid sessionId="S" livePage />);
    expect(screen.getByRole('status').textContent).toBe('Loading this session…');
    await answerRead('none');
    const line = screen.getByRole('alert');
    expect(line.textContent).toBe(`Couldn't load this session. ${CANT_REACH}`);
    const again = screen.getByRole('button', { name: 'Try again' });
    await user.click(again);
    // Held while it reads, its line kept; read, the count in its place.
    expect(again.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe(line.textContent);
    await answerRead(snapshotOf([student('Ana Rodríguez')]));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('region', { name: '1 of 1 focused' })).toBeTruthy();
  });
});

/** An event of the session as Bali records it, `seconds` ago: Ana's, someone's, or the session's. */
function feed(
  seq: number,
  type: FeedEvent['type'],
  userId: string | null,
  seconds: number,
  payload: unknown = null,
): FeedEvent {
  return { seq, eventId: `ev-${seq}`, type, userId, occurredAt: ago(seconds), payload };
}

/** The session's log read on its way (`/events`), answered page by page, or with no answer. */
async function answerLog(events: FeedEvent[] | 'none') {
  await act(async () => {
    const take = (path: string) => {
      const read = bali.reads.find((r) => r.path === path);
      if (!read) throw new Error(`no read of ${path} on its way`);
      bali.reads.splice(bali.reads.indexOf(read), 1);
      return read;
    };
    const first = take('/v1/sessions/S/events?after=0');
    if (events === 'none') first.fail(new NetworkError());
    else first.answer({ events, nextAfter: events.at(-1)?.seq ?? 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const last = events === 'none' ? 0 : (events.at(-1)?.seq ?? 0);
    if (last > 0)
      take(`/v1/sessions/S/events?after=${last}`).answer({ events: [], nextAfter: last });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The stream's event, brought as the stream would bring it. */
async function bring(e: FeedEvent) {
  const stream = bali.streams[0] as { onEvent: (e: FeedEvent) => void } | undefined;
  if (!stream) throw new Error('no stream');
  await act(async () => {
    stream.onEvent(e);
    await Promise.resolve();
  });
}

/** The session list's lines, as a teacher reads them: the time, then what happened. */
const lines = () => {
  const list = screen.getByRole('complementary', { name: 'This session' });
  return Array.from(list.querySelectorAll('ol > li'), (li) =>
    Array.from(li.children, (part) => part.textContent ?? '')
      .filter(Boolean)
      .join(' '),
  );
};
const time = (seconds: number) => bareTime(Date.parse(ago(seconds)));

describe('the session list (LO6; ClassLive, PhoneLive, LiveListStates)', () => {
  const class3 = [
    student('Ethan Park', { state: 'unlocked', unlock: unlock('Ethan Park', 'nurse') }),
    student('Tomás Herrera', { lastSeenAt: ago(330) }),
    student('Ana Rodríguez'),
  ];

  it('reads the session’s log once the grid is, and lists a line per moment, newest first', async () => {
    render(<LiveGrid sessionId="S" livePage />);
    // Nothing of the log before the grid's own read answers.
    expect(bali.reads.map((r) => r.path)).toEqual(['/v1/sessions/S']);
    await answerRead(snapshotOf(class3));
    const list = screen.getByRole('complementary', { name: 'This session' });
    expect(within(list).getByRole('heading', { level: 2 }).textContent).toBe('This session');
    expect(within(list).getByText('Loading this session…')).toBeTruthy();
    await answerLog([
      feed(1, 'session_started', null, 1500),
      feed(2, 'tap_in', 'u-Ethan Park', 1440),
      feed(3, 'tap_in', 'u-Tomás Herrera', 1430),
      feed(4, 'went_silent', 'u-Tomás Herrera', 240),
      feed(5, 'unlock', 'u-Ethan Park', 60, { reason: 'nurse' }),
    ]);
    // Each student named as their tile names them; no tap-in, and no reason: the panel has it.
    expect(lines()).toEqual([
      `${time(60)} Ethan Park used Emergency Unlock`,
      `${time(240)} Tomás Herrera went silent`,
      `${time(1500)} Session started`,
    ]);
    // Its own column beside the count and the room, 340 px and 48 px off; under them under 1024 px,
    // 40 px down, where the room would narrow to a tile or two a row, and on a phone 32 px down.
    const grid = list.parentElement;
    expect(Array.from(grid?.classList ?? [])).toEqual(
      expect.arrayContaining([
        'grid',
        'grid-cols-[minmax(0,1fr)_340px]',
        'gap-12',
        'max-lg:grid-cols-1',
        'max-[760px]:gap-8',
        'min-[760px]:max-lg:gap-10',
      ]),
    );
    expect(
      grid?.firstElementChild?.contains(screen.getByRole('region', { name: 'Everyone' })),
    ).toBe(true);
  });

  it('adds what the stream brings as it lands, the unlock on top, and keeps it once they are back', async () => {
    await open(false, class3);
    await answerLog([feed(1, 'session_started', null, 1500)]);
    await bring(feed(13, 'unlock', 'u-Ana Rodríguez', 20, { reason: 'bathroom' }));
    expect(lines()[0]).toBe(`${time(20)} Ana Rodríguez used Emergency Unlock`);
    await bring(feed(14, 'refocus', 'u-Ana Rodríguez', 5));
    expect(lines()).toEqual([
      `${time(5)} Ana Rodríguez was back in focus`,
      `${time(20)} Ana Rodríguez used Emergency Unlock`,
      `${time(1500)} Session started`,
    ]);
    // An event the read and the stream both bring is one line.
    await bring(feed(1, 'session_started', null, 1500));
    expect(lines()).toHaveLength(3);
  });

  it('says a log that didn’t load, with Try again, which reads it again, focus then on the list’s title', async () => {
    const user = userEvent.setup();
    await open(false, class3);
    await answerLog('none');
    const list = screen.getByRole('complementary', { name: 'This session' });
    expect(within(list).getByRole('alert').textContent).toBe(
      `Couldn't load this session. ${CANT_REACH}`,
    );
    const again = within(list).getByRole('button', { name: 'Try again' });
    await user.click(again);
    // Held while it reads, its line kept.
    expect(again.getAttribute('aria-busy')).toBe('true');
    expect(within(list).getByRole('alert')).toBeTruthy();
    await answerLog([feed(1, 'session_started', null, 1500)]);
    expect(within(list).queryByRole('alert')).toBeNull();
    expect(lines()).toEqual([`${time(1500)} Session started`]);
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(document.activeElement).toBe(within(list).getByRole('heading', { level: 2 }));
  });

  it('reads no log for Home’s card, which shows no list', async () => {
    render(
      <LiveGrid
        sessionId="S"
        card={(grid) => <p>{grid.students === null ? 'unread' : 'read'}</p>}
      />,
    );
    await answerRead(snapshotOf(class3));
    expect(screen.getByText('read')).toBeTruthy();
    expect(bali.reads.map((r) => r.path)).not.toContain('/v1/sessions/S/events?after=0');
  });
});

describe('the student panel from the session’s log (LO6; ClassStudent)', () => {
  it('reads no more than the list’s log: every panel waits for it, then says its student’s moments', async () => {
    const user = userEvent.setup();
    await open(false, [
      student('Ethan Park', { state: 'unlocked', unlock: unlock('Ethan Park', 'nurse') }),
      student('Ana Rodríguez'),
    ]);
    await user.click(within(tile('Ethan Park')).getByRole('button'));
    const panel = screen.getByRole('complementary', { name: 'Ethan Park' });
    expect(within(panel).getByText('Loading this session…')).toBeTruthy();
    await answerLog([
      feed(1, 'session_started', null, 1500),
      feed(2, 'tap_in', 'u-Ethan Park', 1440),
      feed(3, 'unlock', 'u-Ethan Park', 60, { reason: 'nurse' }),
    ]);
    expect(within(panel).getByText('Tapped in and focused')).toBeTruthy();
    expect(within(panel).getByText('Used Emergency Unlock').textContent).toBe(
      'Used Emergency UnlockNurse',
    );
    // Another student's panel reads nothing more.
    await user.click(within(tile('Ana Rodríguez')).getByRole('button'));
    expect(screen.getByRole('complementary', { name: 'Ana Rodríguez' })).toBeTruthy();
    expect(bali.reads).toEqual([]);
  });

  it('marks the open student’s tile with a solid edge in the primary ink, never a ring', async () => {
    const user = userEvent.setup();
    await open(false, [student('Tomás Herrera', { lastSeenAt: ago(330) })]);
    const button = within(tile('Tomás Herrera')).getByRole('button');
    expect(Array.from(button.classList)).toEqual(
      expect.arrayContaining(['aria-expanded:border-solid', 'aria-expanded:border-text-primary']),
    );
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(Array.from(tile('Tomás Herrera').classList)).toEqual(['flex', 'min-w-0']);
  });

  it('opens the student Home’s Check on named once the grid is read, once, and never in Present', async () => {
    const view = render(<LiveGrid sessionId="S" livePage opening="u-Ana Rodríguez" />);
    await answerRead(snapshotOf([student('Ana Rodríguez'), student('Omar Siddiqui')]));
    const panel = screen.getByRole('complementary', { name: 'Ana Rodríguez' });
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { level: 2 }));
    view.unmount();

    for (const opening of ['u-nobody', '__proto__', 'constructor']) {
      render(<LiveGrid sessionId="S" livePage opening={opening} />);
      await answerRead(snapshotOf([student('Ana Rodríguez')]));
      expect(screen.queryByRole('complementary', { name: /Ana|nobody/ }), opening).toBeNull();
      cleanup();
      bali.reads.length = 0;
    }

    render(<LiveGrid sessionId="S" livePage present opening="u-Ana Rodríguez" />);
    await answerRead(snapshotOf([student('Ana Rodríguez')]));
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('Check on as an unlock lands (LO6; LiveStates’ An unlock lands)', () => {
  it('glows the unlock’s row twice with its tile, then holds it still', async () => {
    await open(false, [student('Ana Rodríguez'), student('Omar Siddiqui')]);
    await bring(feed(13, 'unlock', 'u-Ana Rodríguez', 1, { reason: 'nurse' }));
    const row = screen.getByText('Check on 1').nextElementSibling?.firstElementChild;
    const glow = row?.querySelector('.animate-softpulse');
    expect(glow?.getAttribute('aria-hidden')).toBe('true');
    expect(Array.from(glow?.classList ?? [])).toEqual(
      expect.arrayContaining(['absolute', 'inset-0', 'rounded-sm', 'pointer-events-none']),
    );
    // Its tile's glow ends: so does the row's, from the same unlock.
    const tileGlow = tile('Ana Rodríguez').querySelector('.animate-softpulse');
    act(() => {
      tileGlow?.dispatchEvent(new Event('webkitAnimationEnd', { bubbles: true }));
    });
    expect(row?.querySelector('.animate-softpulse')).toBeNull();
    // An unlock the read already held, replayed by the stream's first connect, glows nothing.
    cleanup();
    bali.streams.length = 0;
    await open(false, [
      student('Ana Rodríguez', { state: 'unlocked', unlock: unlock('Ana Rodríguez', 'nurse') }),
    ]);
    await bring(feed(12, 'unlock', 'u-Ana Rodríguez', 60, { reason: 'nurse' }));
    expect(document.querySelector('.animate-softpulse')).toBeNull();
  });
});

describe('the live grid in Present (ClassPresent), v2’s until LO9', () => {
  const omar = student('Omar Siddiqui', { clockOff: true });

  it('never says Clock off in Present, the projector the class can see (the owner, 2026-10-28)', async () => {
    // And a phone heard from 70 s ago, whose line says "last seen".
    await open(true, [omar, student('Wei Zhang', { clockOff: true, lastSeenAt: ago(70) })]);
    const omarsTile = tile('Omar Siddiqui');
    // The state alone, as for any focused student: no line, no tooltip, nothing for a screen reader.
    expect(parts('Omar Siddiqui')).toEqual(['Omar Siddiqui', 'Focused']);
    expect(says(omarsTile)).toBe(['Omar Siddiqui', 'Focused'].join(''));
    expect(parts('Wei Zhang')).toEqual(['Wei Zhang', 'Focused', 'last seen 1 min ago']);
    expect(document.body.innerHTML).not.toMatch(/clock/i);
    // A tile alone there, never a button.
    expect(screen.queryByRole('button')).toBeNull();
  });

  const WORDS: Record<UnlockReason, RegExp> = {
    bathroom: /bathroom/i,
    nurse: /nurse/i,
    other: /other reason/i,
  };
  /** Every tile that carries an unlock, each with this reason, and the phone with its clock off. */
  const carrying = (reason: UnlockReason) => [
    student('Ethan Park', { state: 'unlocked', unlock: unlock('Ethan Park', reason) }),
    student('Jaylen Brooks', {
      state: 'unlocked',
      unlock: unlock('Jaylen Brooks', reason),
      lastSeenAt: ago(330),
    }),
    student('Lucas Ferreira', {
      state: 'protection_off',
      unlock: unlock('Lucas Ferreira', reason),
      lastSeenAt: ago(330),
    }),
    student('Mateo Silva', {
      state: 'unlocked',
      unlock: unlock('Mateo Silva', reason),
      endedAt: ago(30),
    }),
    student('Priya Natarajan', {
      state: 'protection_off',
      unlock: unlock('Priya Natarajan', reason),
      endedAt: ago(30),
    }),
    omar,
  ];

  it('never says an unlock’s reason, on the class page or in Present, every tile its state', async () => {
    for (const reason of UNLOCK_REASONS) {
      await open(false, carrying(reason));
      // The class page: the reason is the student panel's, never the room's or Check on's.
      expect(document.body.innerHTML, reason).not.toMatch(WORDS[reason]);
      cleanup();
      await open(true, carrying(reason));
      // Nowhere in the grid: not a tile's words, nor a tooltip or a label on any tag.
      expect(document.body.innerHTML, reason).not.toMatch(WORDS[reason]);
      expect(document.body.innerHTML, reason).not.toMatch(/clock/i);
      // An Unlocked tile whose line was its reason alone, and a Left one, have no line at all.
      expect(parts('Ethan Park')).toEqual(['Ethan Park', 'Unlocked']);
      expect(parts('Jaylen Brooks')).toEqual(['Jaylen Brooks', 'Unlocked', 'last seen 5 min ago']);
      expect(parts('Lucas Ferreira')).toEqual([
        'Lucas Ferreira',
        'Protection off',
        'Unlocked · last seen 5 min ago',
      ]);
      expect(parts('Mateo Silva')).toEqual(['Mateo Silva', 'Left · unlocked']);
      expect(parts('Priya Natarajan')).toEqual([
        'Priya Natarajan',
        'Left · protection off',
        'Unlocked',
      ]);
      expect(parts('Omar Siddiqui')).toEqual(['Omar Siddiqui', 'Focused']);
      cleanup();
    }
  });
});

/*
 * The grid's health (ARCHITECTURE, Web portal, decision 4), each a status a screen reader hears as
 * it comes (the audit's DR-05; CLAUDE.md: no silent failures), as a student hears "Can't reach
 * Bali", but never at each second's tick of its age (`aria-live="off"`, as YourPhone's minutes). On
 * the class page (LiveStates, LiveTopStates): over the count, the count and Check on faded and the
 * names plain, as they were at the last update. In Present (ClassStale), v2's: a lost stream as the
 * floating pill, a quiet one in the stone line over the tiles.
 */
describe('the grid’s health, said (LiveStates, LiveTopStates, ClassStale; DR-05)', () => {
  // The grid's clock on a fake one that also runs as time does, so its read's answer still lands.
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());
  /** The stream's state, as the stream tells the grid. */
  const status = async (to: 'open' | 'reconnecting') => {
    const stream = bali.streams[0] as { onStatus: (s: string) => void } | undefined;
    if (!stream) throw new Error('no stream');
    await act(async () => {
      stream.onStatus(to);
      await Promise.resolve();
    });
  };
  /** A status's words, and its ticking age, which is never said as it changes. */
  const said = (line: HTMLElement) => ({
    words: line.textContent,
    age: line.querySelector('[aria-live="off"]')?.textContent ?? null,
  });
  const classes = (el: Element | null | undefined) => Array.from(el?.classList ?? []);
  const quiet = async () => {
    await status('open');
    // Three heartbeats missed with no sign of life: a minute.
    await act(() => vi.advanceTimersByTimeAsync(59_000));
    expect(screen.queryByRole('status')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2000));
  };
  const class28 = [
    student('Ethan Park', { state: 'unlocked', unlock: unlock('Ethan Park', 'nurse') }),
    student('Ana Rodríguez'),
  ];

  it('says a lost stream over the count on the class page, the count and Check on faded, names plain', async () => {
    await open(false, class28);
    expect(screen.queryByRole('status')).toBeNull();
    await status('reconnecting');

    const line = screen.getByRole('status');
    expect(said(line)).toEqual({ words: 'Reconnecting… last updated 0s ago', age: '0s ago' });
    // A white pill, a strong edge, shadow-2, its dot still: nothing loops (DESIGN.md §7).
    expect(classes(line)).toEqual(
      expect.arrayContaining([
        'rounded-full',
        'border-border-strong',
        'bg-surface-card',
        'shadow-2',
        'text-meta',
      ]),
    );
    expect(classes(line.firstElementChild)).toEqual([
      'size-1.75',
      'shrink-0',
      'rounded-full',
      'bg-pip',
    ]);
    expect(line.innerHTML).not.toMatch(/animate-/);
    // In the count's section, before the count; the count and the rows faded, the names plain.
    const count = screen.getByRole('heading', { level: 2, name: '1 of 2 focused' });
    expect(line.compareDocumentPosition(count)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(classes(count)).toContain('opacity-60');
    const row = screen.getByText('Check on 1').nextElementSibling?.firstElementChild;
    expect(classes(row)).toContain('opacity-60');
    const region = screen.getByRole('region', { name: '1 of 2 focused' });
    expect(within(region).queryByRole('button')).toBeNull();
    expect(within(region).getByText('Ethan Park').tagName).toBe('SPAN');
    // The room unchanged: its tiles still open a student.
    expect(within(tile('Ethan Park')).getByRole('button')).toBeTruthy();

    // Seconds on, the same status: its age moves where it isn't said.
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByRole('status')).toBe(line);
    expect(said(line)).toEqual({ words: 'Reconnecting… last updated 5s ago', age: '5s ago' });

    // Back, and nothing is said; the names open a student again.
    await status('open');
    expect(screen.queryByRole('status')).toBeNull();
    expect(within(region).getByRole('button', { name: 'Ethan Park' })).toBeTruthy();
  });

  it('says a quiet stream the same way on the class page, in today’s words', async () => {
    await open(false, class28);
    await quiet();
    const line = screen.getByRole('status');
    expect(said(line)).toEqual({
      words: 'Live feed has gone quiet. Last updated 1 min ago.',
      age: '1 min ago.',
    });
    expect(classes(line)).toContain('rounded-full');
    expect(classes(screen.getByRole('heading', { level: 2, name: '1 of 2 focused' }))).toContain(
      'opacity-60',
    );
  });

  it('says a lost stream as the floating pill over the tiles in Present, a status', async () => {
    await open(true, [student('Omar Siddiqui')]);
    expect(screen.queryByRole('status')).toBeNull();
    await status('reconnecting');

    const pill = screen.getByRole('status');
    expect(said(pill)).toEqual({ words: 'Reconnecting… last updated 0s ago', age: '0s ago' });
    // Its stone dot, 7 px and round, then the words as one piece of the pill's row.
    expect(pill.children).toHaveLength(2);
    expect(pill.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(classes(pill.firstElementChild)).toEqual([
      'size-1.75',
      'shrink-0',
      'rounded-full',
      'bg-pip',
    ]);
    // White, a strong edge, shadow-2, 13/18 medium in the secondary ink, 6 × 14 px (DESIGN.md §4),
    // 14 px from the page's top and in view as it scrolls.
    expect(classes(pill)).toEqual(
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
    // from the frame's top (22 less 8 on a phone). Before the tiles.
    expect(classes(pill.parentElement)).toEqual(
      expect.arrayContaining([
        'pointer-events-none',
        'absolute',
        'inset-x-0',
        '-top-4',
        'bottom-0',
        'max-sm:-top-2',
      ]),
    );
    expect(pill.compareDocumentPosition(tile('Omar Siddiqui'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    // Seconds on, the same status: its age moves where it isn't said, the words said as they were.
    const words = pill.lastElementChild?.firstChild;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByRole('status')).toBe(pill);
    expect(said(pill)).toEqual({ words: 'Reconnecting… last updated 5s ago', age: '5s ago' });
    expect(pill.lastElementChild?.firstChild).toBe(words);
    expect(words?.textContent).toBe('Reconnecting… last updated ');

    // Back, and nothing is said over the grid.
    await status('open');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says a quiet stream in the stone line over the tiles in Present, a status', async () => {
    await open(true, [student('Omar Siddiqui')]);
    await quiet();
    const line = screen.getByRole('status');
    expect(said(line)).toEqual({
      words: 'Live feed has gone quiet. Last updated 1 min ago.',
      age: '1 min ago.',
    });
    expect(classes(line)).toEqual([
      'rounded-sm',
      'border',
      'border-border-default',
      'bg-surface-sunken',
      'px-4',
      'py-3',
      'text-body',
      'text-text-primary',
      'tabular-nums',
    ]);
    // In the page's flow, over the tiles: no layer.
    expect(classes(line.parentElement)).toEqual(['flex', 'flex-col', 'gap-3']);
    expect(line.compareDocumentPosition(tile('Omar Siddiqui'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe('the live grid’s stream', () => {
  it('goes live from its read: its latest seq, and the settled point its stream resumes below', async () => {
    // ARCHITECTURE, Live updates: an event committing late under a seq below the read's newest is
    // still brought, as the stream resumes below the settled point the read names.
    await open(false, [student('Omar Siddiqui')], { latestSeq: 12, settledSeq: 7 });
    expect(bali.streams).toHaveLength(1);
    const asked = bali.streams[0] as { url: string; after: number; settled?: number };
    expect(asked.url).toMatch(/\/v1\/sessions\/S\/stream$/);
    expect(asked).toMatchObject({ after: 12, settled: 7 });
  });
});

describe('a state’s chip in the lock-only look (LockChip; LO2)', () => {
  it('says its state in words beside its icon, never by colour alone, its label or the words given', () => {
    render(
      <ul>
        <li>
          <LockChip display="unlocked" />
        </li>
        <li>
          <LockChip display="silent" words="Silent · 5 min" />
        </li>
        <li>
          <LockChip display="left_unprotected" />
        </li>
      </ul>,
    );
    const chips = screen.getAllByRole('listitem').map((item) => item.firstElementChild);
    // Its words, a line never starting with a dot (a no-break space before each).
    expect(chips.map((chip) => chip?.textContent)).toEqual([
      'Unlocked',
      'Silent\u00a0· 5 min',
      'Left\u00a0· unlocked',
    ]);
    // Its icon hidden from a screen reader, which hears the words; its tint and its edge its
    // state's, Silent's dashed (DESIGN.md §2).
    for (const chip of chips) {
      expect(chip?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(chips[0]?.className).toMatch(/\bbg-state-emergency-bg\b.*\btext-state-emergency-fg\b/);
    expect(chips[1]?.className).toMatch(/\bborder-dashed\b/);
    expect(chips[2]?.className).toMatch(/\bbg-state-emergency-bg\b/);
  });
});
