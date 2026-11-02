// @vitest-environment jsdom
import { type FeedEvent, UNLOCK_REASONS, type UnlockReason } from '@bali/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useReducer } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Student, Students } from '../lib/grid-state';
import { bellTime } from '../lib/session-controls';
import { Tile } from './live-grid';
import {
  NO_POPUPS,
  type PopupAction,
  popupsAfter,
  type Unlock,
  unlockNews,
  UnlockPopups,
} from './unlock-popups';

/*
 * The unlock pop-ups (PV10; ClassUnlock, ClassUnlocks, placed as GA2's boards draw them): an unlock
 * the stream brings opens one, newest on top, beside its tile's pulse, and it stays until it is
 * closed; never on the projector. An unlock is the one event a teacher must never miss: no pop-up
 * swallows or hides another, and one already shown never opens again when the stream replays its
 * unlock. Driven here in a page (jsdom, Testing Library: the owner's decision of 2026-10-22); how
 * the class page places them, over the grid alone, is its own test (`app/classes/[id]/page.test.tsx`).
 */

afterEach(() => {
  // Focus off first, so nothing unmounted here hands focus on in the next test's page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
});

const AT = '2026-10-07T14:31:00.000Z';
const unlock = (eventId: string, over: Partial<Unlock> = {}): Unlock => ({
  eventId,
  studentId: 'u1-0000-aaaa',
  reason: 'nurse',
  at: AT,
  ...over,
});
/** The grid's students: one named, one with no name yet. */
const STUDENTS = {
  'u1-0000-aaaa': { displayName: 'Ethan Park' } as Student,
  'u2-0000-bbbb': { displayName: null } as Student,
} satisfies Students;
const opened = (u: Unlock): PopupAction => ({ kind: 'unlock', unlock: u });
const run = (...actions: PopupAction[]) => actions.reduce(popupsAfter, NO_POPUPS);
const ids = (actions: PopupAction[]) => run(...actions).open.map((u) => u.eventId);

describe('the pop-ups open (ClassUnlocks)', () => {
  it('opens one for each unlock, newest on top, each until it is closed', () => {
    expect(ids([opened(unlock('a')), opened(unlock('b')), opened(unlock('c'))])).toEqual([
      'c',
      'b',
      'a',
    ]);
    // Close shuts that one alone; the rest stay.
    expect(
      ids([
        opened(unlock('a')),
        opened(unlock('b')),
        opened(unlock('c')),
        { kind: 'close', eventId: 'b' },
      ]),
    ).toEqual(['c', 'a']);
  });

  it('keeps two of one student’s unlocks apart: each is its own', () => {
    expect(ids([opened(unlock('a')), opened(unlock('b'))])).toEqual(['b', 'a']);
  });

  it('never opens one twice: not while it is open, nor once it is closed', () => {
    expect(ids([opened(unlock('a')), opened(unlock('a'))])).toEqual(['a']);
    expect(
      ids([opened(unlock('a')), { kind: 'close', eventId: 'a' }, opened(unlock('a'))]),
    ).toEqual([]);
    // The same state back, so nothing redraws.
    const once = run(opened(unlock('a')));
    expect(popupsAfter(once, opened(unlock('a')))).toBe(once);
  });

  it('gives an open pop-up its unlock’s new reason, and opens none for a reason', () => {
    const changed = run(
      opened(unlock('a', { reason: null })),
      opened(unlock('b', { reason: null })),
      { kind: 'reason', eventId: 'a', reason: 'bathroom' },
    );
    expect(changed.open.map((u) => [u.eventId, u.reason])).toEqual([
      ['b', null],
      ['a', 'bathroom'],
    ]);
    // A reason for an unlock with no pop-up open (closed, or before the page) opens none.
    expect(
      ids([
        opened(unlock('a')),
        { kind: 'close', eventId: 'a' },
        { kind: 'reason', eventId: 'a', reason: 'other' },
        { kind: 'reason', eventId: 'z', reason: 'other' },
      ]),
    ).toEqual([]);
  });
});

describe('what the stream tells the pop-ups', () => {
  const event = (over: Partial<FeedEvent>): FeedEvent => ({
    seq: 12,
    eventId: 'e1',
    type: 'unlock',
    userId: 'u1-0000-aaaa',
    occurredAt: AT,
    payload: { reason: 'nurse' },
    ...over,
  });

  it('opens a pop-up for an unlock that landed live, as its tile pulses', () => {
    expect(unlockNews(event({}), true)).toEqual({
      kind: 'unlock',
      unlock: { eventId: 'e1', studentId: 'u1-0000-aaaa', reason: 'nurse', at: AT },
    });
    // One the boot snapshot already held, which the stream's first connect replays: none.
    expect(unlockNews(event({}), false)).toBeNull();
  });

  it('reads a reason it doesn’t know, or none, as none', () => {
    for (const payload of [{}, { reason: 'lunch' }, null, 'nurse']) {
      expect(unlockNews(event({ payload }), true), JSON.stringify(payload)).toMatchObject({
        unlock: { reason: null },
      });
    }
  });

  it('passes on a new reason for an unlock (A20), whichever it names', () => {
    const changed = event({
      type: 'unlock_reason_changed',
      payload: { unlock_event_id: 'e0', reason: 'bathroom' },
    });
    expect(unlockNews(changed, false)).toEqual({
      kind: 'reason',
      eventId: 'e0',
      reason: 'bathroom',
    });
    expect(unlockNews(event({ type: 'unlock_reason_changed', payload: {} }), false)).toBeNull();
  });

  it('says nothing of any other event', () => {
    for (const type of ['tap_in', 'refocus', 'protection_off', 'session_ended'] as const) {
      expect(unlockNews(event({ type }), true), type).toBeNull();
    }
  });
});

/** An element's classes. */
const classes = (el: Element | null | undefined) => [...(el?.classList ?? [])];
/** What an element says, each of its parts a line of its own; the no-break spaces kept. */
const says = (el: Element) =>
  el.children.length === 0
    ? (el.textContent ?? '')
    : Array.from(el.children, (part) => part.textContent ?? '').join('\n');

describe('a pop-up, as ClassUnlock draws it', () => {
  const show = (
    unlocks: Unlock[],
    students: Students = STUDENTS,
    on: { close?: (id: string) => void; open?: (u: Unlock) => void } = {},
  ) =>
    render(
      <UnlockPopups
        unlocks={unlocks}
        students={students}
        tileOf={(studentId) => `tile-${studentId}`}
        onClose={on.close ?? (() => undefined)}
        onOpen={on.open ?? (() => undefined)}
      />,
    );
  /** Each pop-up's box, top to bottom: the parent of its alert's words' column. */
  const popups = () =>
    screen.getAllByRole('alert').map((alert) => {
      const box = alert.parentElement?.parentElement;
      if (!box) throw new Error('a pop-up with no box');
      return box;
    });

  it('draws nothing with none open', () => {
    const { container } = show([]);
    expect(container.innerHTML).toBe('');
  });

  it('says who used Emergency Unlock, their reason and when, as an alert a screen reader says', () => {
    show([unlock('e1')]);
    const alert = screen.getByRole('alert');
    expect(says(alert)).toBe(`Ethan Park used Emergency Unlock\nNurse\u00a0· ${bellTime(AT)}`);
    // The title 15/20 semibold, the line 13/18 in the secondary ink, 2 px under it.
    const [title, line] = Array.from(alert.children);
    expect(title?.id).toBe('unlock-e1');
    expect(classes(title)).toEqual(['text-tile-name', 'wrap-break-word']);
    expect(classes(line)).toEqual(['mt-0.5', 'text-caption', 'text-text-secondary']);
  });

  it('names the student as their tile does now: no name, or not on the grid yet, by their id', () => {
    const named = (studentId: string, students: Students = STUDENTS) => {
      show([unlock('e1', { studentId })], students);
      const said = document.getElementById('unlock-e1')?.textContent;
      cleanup();
      return said;
    };
    expect(named('u1-0000-aaaa')).toBe('Ethan Park used Emergency Unlock');
    expect(named('u2-0000-bbbb')).toBe('u2-0000- used Emergency Unlock');
    expect(named('u3-0000-cccc')).toBe('u3-0000- used Emergency Unlock');
    // A joiner the grid learns of after their unlock: named once the grid's refresh names them.
    const later = { ...STUDENTS, 'u3-0000-cccc': { displayName: 'Zuri Mensah' } as Student };
    expect(named('u3-0000-cccc', later)).toBe('Zuri Mensah used Emergency Unlock');
  });

  it('says each reason as the student’s tile does, and none as the recap does', () => {
    const line = (reason: UnlockReason | null) => {
      show([unlock('e1', { reason })]);
      const [, said = ''] = says(screen.getByRole('alert')).split('\n');
      cleanup();
      return said;
    };
    expect(line(null)).toBe(`No reason given\u00a0· ${bellTime(AT)}`);
    for (const reason of UNLOCK_REASONS) {
      render(
        <ul>
          <Tile
            student={{
              studentId: 'u1',
              displayName: 'Ethan Park',
              state: 'unlocked',
              joinedAt: new Date(AT),
              lastSeenAt: new Date(AT),
              endedAt: null,
              unlock: { eventId: 'e1', reason, at: new Date(AT) },
              clockOff: false,
            }}
            now={new Date(AT)}
            present={false}
            pulse={false}
          />
        </ul>,
      );
      // The tile's line on a computer (its phone detail is the same words, hidden there).
      const tiles = document.querySelector('li span.max-sm\\:hidden');
      const said = tiles?.textContent;
      cleanup();
      expect(line(reason), reason).toBe(`${said}\u00a0· ${bellTime(AT)}`);
    }
  });

  it('has Open student under its words and Close last, each described by its words (PV11b)', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const open = vi.fn();
    show([unlock('e1')], STUDENTS, { close, open });
    const words = 'Ethan Park used Emergency Unlock';
    const openStudent = screen.getByRole('button', { name: 'Open student', description: words });
    // Named for whose pop-up it closes, as several stack (the audit's C02).
    const closeIt = screen.getByRole('button', {
      name: "Close Ethan Park's pop-up",
      description: words,
    });
    const [popup] = popups();
    if (!popup) throw new Error('no pop-up');
    // Two buttons and no link: Open student out of the alert, so a screen reader says the unlock
    // alone as it opens, then Close at the end.
    expect(within(popup).getAllByRole('button')).toEqual([openStudent, closeIt]);
    expect(popup.querySelector('a')).toBeNull();
    expect([openStudent.getAttribute('type'), closeIt.getAttribute('type')]).toEqual([
      'button',
      'button',
    ]);
    // In the words' column, right after the alert, and out of it.
    const alert = screen.getByRole('alert');
    expect(alert.contains(openStudent)).toBe(false);
    expect(alert.nextElementSibling).toBe(openStudent);
    expect(classes(alert.parentElement)).toEqual(['min-w-0']);
    // Close: the X, its icon alone.
    expect(classes(closeIt.querySelector('svg'))).toContain('lucide-x');
    expect(closeIt.textContent).toBe('');
    // v2.css's `.t-act`: 13/18 semibold in orange-700, 8 px under the words.
    expect(classes(openStudent)).toEqual(
      expect.arrayContaining(['mt-2', 'text-caption', 'font-semibold', 'text-unlock-link']),
    );

    await user.click(openStudent);
    expect(open).toHaveBeenCalledWith(unlock('e1'));
    await user.click(closeIt);
    expect(close).toHaveBeenCalledWith('e1');
  });

  it('offers Open student once the student’s tile is on the grid, where their panel opens', () => {
    show([unlock('e1', { studentId: 'u3-0000-cccc' })]);
    expect(screen.queryByRole('button', { name: 'Open student' })).toBeNull();
    // Its Close named by the student's id, as its words name them until the grid has them.
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      "Close u3-0000-'s pop-up",
    ]);
  });

  it('is v2.css’s `.toast`: white, a 3 px orange top edge, 14 px corners, shadow-3, the lock in its well', () => {
    show([unlock('e1')]);
    const [popup] = popups();
    expect(classes(popup)).toEqual(
      expect.arrayContaining([
        'pointer-events-auto',
        'grid',
        'grid-cols-[36px_minmax(0,1fr)_auto]',
        'items-start',
        'gap-3',
        'rounded-md',
        'border',
        'border-border-default',
        'border-t-3',
        'border-t-unlock-edge',
        'bg-surface-card',
        'shadow-3',
        'pt-3.5',
        'pr-2.5',
        'pb-3.5',
        'pl-4',
      ]),
    );
    const well = popup?.firstElementChild;
    expect(classes(well)).toEqual([
      'grid',
      'size-9',
      'place-items-center',
      'rounded-sm',
      'bg-state-emergency-bg',
      'text-state-emergency-fg',
    ]);
    expect(classes(well?.querySelector('svg'))).toContain('lucide-lock-open');
    expect(well?.querySelector('svg')?.getAttribute('width')).toBe('18');
    // Close 32 px, 6 px up, in the tertiary ink, grey on hover as the menu's Sign out.
    expect(classes(screen.getByRole('button', { name: /^Close / }))).toEqual(
      expect.arrayContaining([
        'size-8',
        '-mt-1.5',
        'rounded-item',
        'text-text-tertiary',
        'hover:bg-surface-sunken',
        'hover:text-text-primary',
      ]),
    );
  });

  it('stacks several, newest on top, over the grid’s top right, in view as it scrolls (GA2)', () => {
    show([
      unlock('c'),
      unlock('b', { studentId: 'u2-0000-bbbb', reason: null }),
      unlock('a', { reason: 'bathroom' }),
    ]);
    const boxes = popups();
    expect(boxes.map((p) => p.querySelector('p')?.id)).toEqual([
      'unlock-c',
      'unlock-b',
      'unlock-a',
    ]);
    const stack = boxes[0]?.parentElement;
    const layer = stack?.parentElement;
    // The layer over the tiles' own box, out to the frame (36 px, 16 on a phone), from its top to
    // its bottom: it takes no clicks but the pop-ups'.
    expect(classes(layer).sort()).toEqual(
      [
        'pointer-events-none',
        'absolute',
        '-inset-x-9',
        'inset-y-0',
        'z-20',
        'max-sm:-inset-x-4',
      ].sort(),
    );
    // At the grid's top, no margin over it, 18 px from the frame's right, 380 px wide at most, 10 px
    // apart; 18 px from the window's top once the grid scrolls (v2.css's `.toast`).
    expect(classes(stack).sort()).toEqual(
      [
        'sticky',
        'top-4.5',
        'mr-4.5',
        'ml-auto',
        'flex',
        'w-95',
        'max-w-[calc(100%-36px)]',
        'flex-col',
        'gap-2.5',
      ].sort(),
    );
  });
});

describe('closing a pop-up', () => {
  /**
   * The pop-ups as the grid keeps them, a Close shutting its own, in a page with its heading and,
   * unless told, each student's tile.
   */
  function Kept({ unlocks, tiles = true }: { unlocks: Unlock[]; tiles?: boolean }) {
    const [popups, tell] = useReducer(
      popupsAfter,
      unlocks.reduceRight((state, u) => popupsAfter(state, opened(u)), NO_POPUPS),
    );
    return (
      <main>
        <h1>Biology, period 3</h1>
        {tiles
          ? Object.entries(STUDENTS).map(([id, s]) => (
              <button key={id} type="button" id={`tile-${id}`}>
                {s.displayName ?? id}
              </button>
            ))
          : null}
        <UnlockPopups
          unlocks={popups.open}
          students={STUDENTS}
          tileOf={(studentId) => `tile-${studentId}`}
          onClose={(eventId) => tell({ kind: 'close', eventId })}
          onOpen={() => undefined}
        />
      </main>
    );
  }
  /** A pop-up's Close, by its unlock: named for whose pop-up it is, described by its words. */
  const closeOf = (id: string) => {
    const words = document.getElementById(`unlock-${id}`)?.textContent ?? '';
    return screen
      .getAllByRole('button', { name: "Close Ethan Park's pop-up", description: words })
      .find((b) => b.getAttribute('aria-describedby') === `unlock-${id}`) as HTMLElement;
  };
  const tileOf = (name: string) => screen.getByRole('button', { name });

  it('names each Close for whose pop-up it closes (the audit’s C02)', () => {
    render(<Kept unlocks={[unlock('c', { studentId: 'u2-0000-bbbb' }), unlock('a')]} />);
    expect(
      screen.getAllByRole('button', { name: /^Close / }).map((b) => b.getAttribute('aria-label')),
    ).toEqual(["Close u2-0000-'s pop-up", "Close Ethan Park's pop-up"]);
  });

  it('moves focus to the Close of the pop-up that takes its place, else the one above it, by click and by keyboard', async () => {
    const user = userEvent.setup();
    render(<Kept unlocks={[unlock('c'), unlock('b'), unlock('a')]} />);
    expect(screen.getAllByRole('alert').map((a) => a.firstElementChild?.id)).toEqual([
      'unlock-c',
      'unlock-b',
      'unlock-a',
    ]);
    await user.click(closeOf('b'));
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(document.activeElement).toBe(closeOf('a'));
    // The last one closed: focus on the one above it.
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(document.activeElement).toBe(closeOf('c'));
  });

  it('moves focus to its student’s tile as the last one closes, never the page (GA4), by keyboard and by click', async () => {
    const user = userEvent.setup();
    render(<Kept unlocks={[unlock('a')]} />);
    closeOf('a').focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(tileOf('Ethan Park'));
    cleanup();

    render(<Kept unlocks={[unlock('a')]} />);
    await user.click(closeOf('a'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(tileOf('Ethan Park'));
  });

  it('moves focus to the class’s name as the last one closes, its student’s tile not on the grid', async () => {
    const user = userEvent.setup();
    render(<Kept unlocks={[unlock('a')]} tiles={false} />);
    await user.click(closeOf('a'));
    const name = screen.getByRole('heading', { name: 'Biology, period 3' });
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus on from a Close pressed while the page’s body held it, as a click does in Safari', async () => {
    render(<Kept unlocks={[unlock('a')]} />);
    expect(document.activeElement).toBe(document.body);
    closeOf('a').click();
    await Promise.resolve();
    expect(document.activeElement).toBe(tileOf('Ethan Park'));
  });

  it('leaves focus alone when the Close pressed didn’t hold it', async () => {
    render(<Kept unlocks={[unlock('c'), unlock('b')]} />);
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    closeOf('c').click();
    await Promise.resolve();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});
