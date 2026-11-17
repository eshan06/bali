// @vitest-environment jsdom
import type { EventType, FeedEvent } from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CANT_REACH } from '../lib/errors';
import type { Student } from '../lib/grid-state';
import { bareTime } from '../lib/recap';
import { bellTime } from '../lib/session-controls';
import type { LogRead } from '../lib/session-log';
import { StateChip } from './live-grid';
import { CLOCK_OFF, StudentPanel } from './student-panel';

/*
 * The student panel as a teacher meets it (LO6; ClassStudent, LiveListStates; the owner's decision
 * of 2026-10-22: the portal's tests drive the page): the name, which takes focus as it opens, over
 * their state as their tile has it, and Close; this session's moments from the session's log, each
 * with its time and an unlock its reason; when the phone last checked in once that's a while ago,
 * and Clock off. Its read under way, failed with Try again, or showing who hasn't tapped in. Never in
 * Present: the live grid's own tests (`live-grid.driven.test.tsx`) drive where it opens and closes.
 */
afterEach(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
});

/** 9:mm on the day of the lesson; "now" is 9:32, as ClassStudent draws it. */
const at = (minute: number) => new Date(Date.UTC(2026, 10, 17, 14, minute));
const NOW = at(32);
/** A moment's time as the log says it, in this computer's zone: "9:31". */
const t = (minute: number) => bareTime(at(minute).getTime());

function student(over: Partial<Student> = {}): Student {
  return {
    studentId: 'u1-0000-aaaa',
    displayName: 'Ethan Park',
    state: 'focused',
    joinedAt: at(6),
    lastSeenAt: at(31),
    endedAt: null,
    unlock: null,
    clockOff: false,
    ...over,
  };
}

let seq = 0;
/** One of the student's events, the next `seq`. */
function event(type: EventType, minute: number, payload: FeedEvent['payload'] = null): FeedEvent {
  seq += 1;
  return {
    seq,
    eventId: `e${seq}`,
    type,
    userId: 'u1-0000-aaaa',
    occurredAt: at(minute).toISOString(),
    payload,
  };
}
const ready = (...events: FeedEvent[]): LogRead => ({ kind: 'ready', events });

/** The panel for `s` with the log as given, as the live grid draws it. */
const element = (
  s: Student,
  log: LogRead,
  on: { close?: () => void; retry?: () => Promise<void> } = {},
) => (
  <StudentPanel
    id="g-panel"
    student={s}
    chip={<StateChip student={s} now={NOW} />}
    log={log}
    now={NOW}
    onClose={on.close ?? (() => undefined)}
    onRetry={on.retry ?? (() => Promise.resolve())}
  />
);
const panel = (...args: Parameters<typeof element>) => render(element(...args));

/** Each moment as the log reads it: its time, then what happened, then an unlock's reason. */
const moments = () =>
  Array.from(document.querySelectorAll('#g-panel ol > li'), (li) =>
    Array.from(li.children, (part) => part.textContent ?? '')
      .filter(Boolean)
      .join(' '),
  );
/** The lines under the moments. */
const notes = () =>
  Array.from(document.querySelectorAll('#g-panel p.text-meta'), (p) => p.textContent);
const classes = (el: Element | null | undefined) => Array.from(el?.classList ?? []);

describe('the panel’s head, as ClassStudent draws it', () => {
  it('heads it with the name, which takes focus as it opens, over their state, and Close named for whose panel it is', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    panel(
      student({ state: 'unlocked', unlock: { eventId: 'v', reason: 'nurse', at: at(31) } }),
      {
        kind: 'loading',
      },
      { close },
    );
    const name = screen.getByRole('heading', { level: 2, name: 'Ethan Park' });
    expect(name.id).toBe('g-panel-name');
    expect(name.getAttribute('tabindex')).toBe('-1');
    expect(classes(name)).toContain('text-panel-title');
    expect(screen.getByRole('complementary', { name: 'Ethan Park' }).id).toBe('g-panel');
    // Their state under the name, as their tile says it, in the lock-only look's chip.
    expect(name.nextElementSibling?.textContent).toBe('Unlocked');
    expect(classes(name.nextElementSibling)).toEqual(
      expect.arrayContaining(['rounded-full', 'bg-state-emergency-bg', 'text-state-emergency-fg']),
    );

    const closeIt = screen.getByRole('button', { name: "Close Ethan Park's panel" });
    expect(closeIt.getAttribute('type')).toBe('button');
    expect(closeIt.textContent).toBe('');
    expect(closeIt.querySelector('svg')?.classList).toContain('lucide-x');
    // lock.css's `.icon-btn`: 32 px, its hit area 44 px.
    expect(classes(closeIt)).toEqual(expect.arrayContaining(['size-8', 'rounded-item']));
    await user.click(closeIt);
    expect(close).toHaveBeenCalledOnce();
  });

  it('names a student with no name by their id’s start, as their tile does', () => {
    panel(student({ displayName: null }), { kind: 'loading' });
    expect(screen.getByRole('button', { name: "Close u1-0000-'s panel" })).toBeTruthy();
  });

  it('says Silent with its minutes in the chip, as the tile does', () => {
    panel(student({ lastSeenAt: at(27) }), ready(event('tap_in', 6)));
    expect(screen.getByRole('heading', { level: 2 }).nextElementSibling?.textContent).toBe(
      'Silent\u00a0· 5 min',
    );
  });

  it('draws Left · unlocked with the state’s own icon alone, where the tile draws the flag', () => {
    panel(
      student({
        state: 'unlocked',
        unlock: { eventId: 'v', reason: 'other', at: at(20) },
        endedAt: at(22),
      }),
      ready(event('tap_in', 7)),
    );
    const chip = screen.getByRole('heading', { level: 2 }).nextElementSibling;
    expect(chip?.textContent).toBe(`Left${String.fromCharCode(0xa0)}· unlocked`);
    expect(chip?.querySelectorAll('svg')).toHaveLength(1);
    expect(classes(chip?.querySelector('svg'))).toContain('lucide-lock-open');
  });

  it('closes on Escape from inside it', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    panel(student(), { kind: 'loading' }, { close });
    screen.getByRole('heading', { level: 2 }).focus();
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('its moments, as ClassStudent and LiveListStates draw them', () => {
  it('waits for the session’s log with the name and the state alone, a status a screen reader hears', () => {
    panel(student(), { kind: 'loading' });
    const section = screen.getByRole('region', { name: 'This session' });
    expect(within(section).getByRole('status').textContent).toBe('Loading this session…');
    expect(moments()).toEqual([]);
    expect(notes()).toEqual([]);
  });

  it('lands focus on This session once Try again’s read is in (ClassRetryStates)', async () => {
    const user = userEvent.setup();
    let answer = () => undefined as void;
    const retry = vi.fn(() => new Promise<void>((done) => (answer = done)));
    const view = panel(student(), { kind: 'error', message: CANT_REACH }, { retry });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    // Read: the moments in the failure's place, its Try again gone with it.
    await act(async () => {
      view.rerender(element(student(), ready(event('tap_in', 6)), { retry }));
      answer();
      await Promise.resolve();
    });
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 3, name: 'This session' }),
    );
  });

  it('says a log that didn’t load, with Try again, held until Bali answers', async () => {
    const user = userEvent.setup();
    let answer = () => undefined as void;
    const retry = vi.fn(() => new Promise<void>((done) => (answer = done)));
    panel(student(), { kind: 'error', message: CANT_REACH }, { retry });
    expect(screen.getByRole('alert').textContent).toBe(`Couldn't load this session. ${CANT_REACH}`);
    const again = screen.getByRole('button', { name: 'Try again' });
    await user.click(again);
    expect(retry).toHaveBeenCalledOnce();
    expect(again.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('alert')).toBeTruthy();
    await act(async () => {
      answer();
      await Promise.resolve();
    });
    expect(again.getAttribute('aria-busy')).toBe('false');
  });

  it('lists every moment of theirs, newest first as ClassStudent does, each unlock with its reason under it', () => {
    panel(
      student({ state: 'unlocked', unlock: { eventId: 'e-u2', reason: 'other', at: at(29) } }),
      ready(
        event('tap_in', 6),
        event('protection_off', 9),
        event('protection_on', 11),
        event('went_silent', 14),
        event('came_back', 15),
        event('unlock', 22),
        event('refocus', 24),
        { ...event('unlock', 29, { reason: 'bathroom' }), eventId: 'e-u2' },
        event('unlock_reason_changed', 30, { unlock_event_id: 'e-u2', reason: 'other' }),
      ),
    );
    expect(moments()).toEqual([
      // The reason now, its latest change's (A20).
      `${t(29)} Used Emergency UnlockOther reason`,
      `${t(24)} Back in focus`,
      `${t(22)} Used Emergency UnlockNo reason given`,
      `${t(15)} Checked in again`,
      `${t(14)} Went silent`,
      `${t(11)} Turned protection back on`,
      `${t(9)} Turned protection off`,
      `${t(6)} Tapped in and focused`,
    ]);
    // Each in its state's ink: focused green, an unlock orange, protection off red, the rest quiet.
    const inks = Array.from(document.querySelectorAll('#g-panel ol > li > svg'), (svg) =>
      classes(svg).find((c) => c.startsWith('text-')),
    );
    expect(inks).toEqual([
      'text-state-emergency-fg',
      'text-state-focused-fg',
      'text-state-emergency-fg',
      'text-state-ended-fg',
      'text-state-ended-fg',
      'text-state-ended-fg',
      'text-state-revoked-fg',
      'text-state-focused-fg',
    ]);
    // Each time on the record, machine-readable too.
    expect(document.querySelector('#g-panel time')?.getAttribute('datetime')).toBe(
      at(29).toISOString(),
    );
  });

  it('lists two moments at one instant the engine’s later first', () => {
    panel(student(), ready(event('tap_in', 6), event('came_back', 6)));
    expect(moments()).toEqual([`${t(6)} Checked in again`, `${t(6)} Tapped in and focused`]);
  });

  it('heads a student’s moments with Left when they left', () => {
    panel(
      student({ state: 'focused', endedAt: at(20) }),
      ready(event('tap_in', 7), event('enrollment_left', 20)),
    );
    expect(moments()).toEqual([`${t(20)} Left`, `${t(7)} Tapped in and focused`]);
    expect(screen.getByRole('heading', { level: 2 }).nextElementSibling?.textContent).toBe('Left');
  });

  it('says who hasn’t tapped in, with no moment and no check-in', () => {
    panel(
      student({ displayName: 'Zuri Mensah', state: null, joinedAt: null, lastSeenAt: null }),
      ready(),
    );
    expect(screen.getByText("Zuri Mensah hasn't tapped in this session.")).toBeTruthy();
    expect(notes()).toEqual([]);
  });
});

describe('when the phone last checked in, and Clock off (LiveListStates)', () => {
  it('says when it last checked in once that’s a minute or more ago, as the tile said before LO5', () => {
    panel(
      student({
        state: 'unlocked',
        unlock: { eventId: 'v', reason: null, at: at(22) },
        lastSeenAt: at(30),
      }),
      ready(event('tap_in', 6), event('unlock', 22)),
    );
    expect(notes()).toEqual([`The phone last checked in at ${bellTime(at(30).toISOString())}.`]);
  });

  it('says it of a focused phone from a minute on, until it reads Silent, whose chip says its minutes', () => {
    const heard = (secondsAgo: number) =>
      student({ lastSeenAt: new Date(NOW.getTime() - secondsAgo * 1000) });
    panel(heard(30), ready(event('tap_in', 6)));
    expect(notes()).toEqual([]);
    cleanup();
    panel(heard(75), ready(event('tap_in', 6)));
    expect(notes()).toEqual([
      `The phone last checked in at ${bellTime(new Date(NOW.getTime() - 75_000).toISOString())}.`,
    ]);
    cleanup();
    panel(heard(300), ready(event('tap_in', 6)));
    expect(notes()).toEqual([]);
  });

  it('says Clock off once its moments are read, after the last check-in', () => {
    const late = student({
      state: 'unlocked',
      unlock: { eventId: 'v', reason: null, at: at(22) },
      clockOff: true,
      lastSeenAt: at(30),
    });
    panel(late, { kind: 'loading' });
    expect(notes()).toEqual([]);
    cleanup();
    panel(late, ready(event('tap_in', 6), event('unlock', 22)));
    expect(notes()).toEqual([
      `The phone last checked in at ${bellTime(at(30).toISOString())}.`,
      CLOCK_OFF,
    ]);
  });
});

describe('the panel, as lock.css’s `.panel` draws it', () => {
  it('is 372 px from the right, white, shadow-3, sliding in, its head kept as its moments scroll', () => {
    panel(student(), ready(event('tap_in', 6)));
    const aside = screen.getByRole('complementary');
    expect(classes(aside)).toEqual(
      expect.arrayContaining([
        'fixed',
        'inset-y-0',
        'right-0',
        'z-5',
        'w-93',
        'max-w-full',
        'flex-col',
        'bg-surface-card',
        'shadow-3',
        'drawer-in',
      ]),
    );
    expect(classes(aside)).not.toContain('overflow-y-auto');
    const [head, body] = Array.from(aside.children);
    expect(classes(head)).toEqual(
      expect.arrayContaining(['border-b', 'px-6', 'pt-6', 'pb-5', 'gap-3']),
    );
    expect(classes(body)).toEqual(
      expect.arrayContaining(['overflow-y-auto', 'overscroll-contain', 'p-6', 'gap-6']),
    );
    // This session's title, 14/20 semibold, 24 px over its log.
    const title = screen.getByRole('heading', { level: 3, name: 'This session' });
    expect(classes(title)).toEqual(['mb-2', 'text-data', 'font-semibold']);
  });
});
