import { type FeedEvent, UNLOCK_REASONS, type UnlockReason } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
 * The unlock pop-ups (PV10; ClassUnlock, ClassUnlocks): an unlock the stream brings opens one,
 * newest on top, beside its tile's pulse, and it stays until it is closed; never on the projector.
 * An unlock is the one event a teacher must never miss: no pop-up swallows or hides another, and
 * one already shown never opens again when the stream replays its unlock.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

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

describe('a pop-up, as ClassUnlock draws it', () => {
  const render = (unlocks: Unlock[], students: Students = STUDENTS) =>
    renderToStaticMarkup(
      createElement(UnlockPopups, {
        unlocks,
        students,
        onClose: () => undefined,
        onOpen: () => undefined,
      }),
    );
  /** Each pop-up's markup, top to bottom. */
  const popups = (html: string) =>
    html.match(/<div class="pointer-events-auto[^]*?aria-label="Close"[^]*?<\/button>/g) ?? [];
  /** Markup as read, each tag a space; the no-break spaces kept, as the dot's and the time's are. */
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/ +/g, ' ')
      .trim();
  const classes = (html: string, tag: RegExp) => tag.exec(html)?.[1]?.split(' ') ?? [];

  it('draws nothing with none open', () => {
    expect(render([])).toBe('');
  });

  it('says who used Emergency Unlock, their reason and when, as an alert a screen reader says', () => {
    const [popup = ''] = popups(render([unlock('e1')]));
    const words = /<div class="min-w-0"><div role="alert">([^]*?)<\/div>/.exec(popup)?.[1] ?? '';
    expect(text(words)).toBe(`Ethan Park used Emergency Unlock Nurse\u00a0· ${bellTime(AT)}`);
    // The title 15/20 semibold, the line 13/18 in the secondary ink, 2 px under it.
    expect(words).toMatch(/<p id="unlock-e1" class="text-tile-name wrap-break-word">/);
    expect(words).toMatch(/<p class="mt-0\.5 text-caption text-text-secondary">/);
  });

  it('names the student as their tile does now: no name, or not on the grid yet, by their id', () => {
    const named = (studentId: string, students: Students = STUDENTS) =>
      /<p id="unlock-e1"[^>]*>([^<]*) used Emergency Unlock<\/p>/.exec(
        render([unlock('e1', { studentId })], students),
      )?.[1];
    expect(named('u1-0000-aaaa')).toBe('Ethan Park');
    expect(named('u2-0000-bbbb')).toBe('u2-0000-');
    expect(named('u3-0000-cccc')).toBe('u3-0000-');
    // A joiner the grid learns of after their unlock: named once the grid's refresh names them.
    const later = { ...STUDENTS, 'u3-0000-cccc': { displayName: 'Zuri Mensah' } as Student };
    expect(named('u3-0000-cccc', later)).toBe('Zuri Mensah');
  });

  it('says each reason as the student’s tile does, and none as the recap does', () => {
    const line = (reason: UnlockReason | null) =>
      text(
        /<p class="mt-0\.5[^"]*">([^]*?)<\/p>/.exec(render([unlock('e1', { reason })]))?.[1] ?? '',
      );
    expect(line(null)).toBe(`No reason given\u00a0· ${bellTime(AT)}`);
    const tile = (reason: UnlockReason) =>
      renderToStaticMarkup(
        createElement(Tile, {
          student: {
            studentId: 'u1',
            displayName: 'Ethan Park',
            state: 'unlocked',
            joinedAt: new Date(AT),
            lastSeenAt: new Date(AT),
            endedAt: null,
            unlock: { eventId: 'e1', reason, at: new Date(AT) },
            clockOff: false,
          },
          now: new Date(AT),
          present: false,
          pulse: false,
        }),
      );
    for (const reason of UNLOCK_REASONS) {
      const said = /<span class="max-sm:hidden">([^<]*)<\/span>/.exec(tile(reason))?.[1];
      expect(line(reason), reason).toBe(`${said}\u00a0· ${bellTime(AT)}`);
    }
  });

  it('has Open student under its words and Close, each described by its words (PV11b)', () => {
    const [popup = ''] = popups(render([unlock('e1')]));
    expect(popup).toMatch(
      /<button type="button" aria-label="Close" aria-describedby="unlock-e1" class="[^"]*">[^]*?lucide-x[^]*?<\/button>$/,
    );
    // Out of the alert, so a screen reader says the unlock alone as it opens; v2.css's `.t-act`:
    // 13/18 semibold in orange-700, 8 px under the words.
    const [, open = ''] =
      /<\/div><button type="button" aria-describedby="unlock-e1" class="([^"]*)">Open student<\/button><\/div>/.exec(
        popup,
      ) ?? [];
    expect(open.split(' ')).toEqual(
      expect.arrayContaining(['mt-2', 'text-caption', 'font-semibold', 'text-unlock-link']),
    );
    expect(popup.match(/<button\b/g)).toHaveLength(2);
    expect(popup).not.toMatch(/<a\b/);
  });

  it('offers Open student once the student’s tile is on the grid, where their panel opens', () => {
    const [popup = ''] = popups(render([unlock('e1', { studentId: 'u3-0000-cccc' })]));
    expect(popup).not.toContain('Open student');
    expect(popup.match(/<button\b/g)).toHaveLength(1);
  });

  it('is v2.css’s `.toast`: white, a 3 px orange top edge, 14 px corners, shadow-3, the lock in its well', () => {
    const [popup = ''] = popups(render([unlock('e1')]));
    expect(classes(popup, /^<div class="([^"]*)"/)).toEqual(
      expect.arrayContaining([
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
    expect(popup).toMatch(
      /<span class="grid size-9 place-items-center rounded-sm bg-state-emergency-bg text-state-emergency-fg"><svg[^>]*width="18"[^>]*class="lucide lucide-lock-open/,
    );
    // Close 32 px, 6 px up, in the tertiary ink, grey on hover as the menu's Sign out.
    expect(classes(popup, /<button[^>]*aria-label="Close"[^>]*class="([^"]*)"/)).toEqual(
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

  it('stacks several, newest on top, 380 px wide, 96 px from the frame’s top and 18 from its right', () => {
    const html = render([
      unlock('c'),
      unlock('b', { studentId: 'u2-0000-bbbb', reason: null }),
      unlock('a', { reason: 'bathroom' }),
    ]);
    expect(popups(html).map((p) => /<p id="unlock-(\w)"/.exec(p)?.[1])).toEqual(['c', 'b', 'a']);
    // The layer over the frame (30/36 px in, 22/16 on a phone), taking no clicks but the pop-ups'.
    expect(classes(html, /^<div class="([^"]*)"/)).toEqual(
      expect.arrayContaining([
        'pointer-events-none',
        'absolute',
        '-inset-x-9',
        '-top-7.5',
        'bottom-0',
        'max-sm:-inset-x-4',
        'max-sm:-top-5.5',
      ]),
    );
    // In view as the page scrolls, 18 px from the top (v2.css's `.toast`).
    expect(classes(html, /^<div[^>]*><div class="([^"]*)"/)).toEqual(
      expect.arrayContaining([
        'sticky',
        'top-4.5',
        'mt-24',
        'mr-4.5',
        'ml-auto',
        'w-95',
        'max-w-[calc(100%-36px)]',
        'flex-col',
        'gap-2.5',
      ]),
    );
  });

  it('moves focus on a Close to the pop-up that takes its place, else the one above it', () => {
    const source = read('./unlock-popups.tsx');
    expect(source).toMatch(
      /const popup = e\.currentTarget\.parentElement;\s*const next = popup\?\.nextElementSibling \?\? popup\?\.previousElementSibling;\s*if \(document\.activeElement === e\.currentTarget\) \{\s*next\?\.querySelector<HTMLElement>\('button\[aria-label="Close"\]'\)\?\.focus\(\);\s*\}\s*onClose\(u\.eventId\);/,
    );
  });
});

describe('the pop-ups on the class page', () => {
  const grid = read('./live-grid.tsx');
  const page = read('../app/classes/[id]/page.tsx');

  it('opens one for each unlock the live grid’s stream brings, as its tile pulses', () => {
    expect(grid).toMatch(/const \[popups, tell\] = useReducer\(popupsAfter, NO_POPUPS\);/);
    expect(grid).toMatch(
      /const live = landsLive\(e, snap\.latestSeq\);\s*if \(live\) setLiveUnlocks\(\(prev\) => new Set\(prev\)\.add\(e\.eventId\)\);\s*const news = unlockNews\(e, live\);\s*if \(news\) tell\(news\);/,
    );
  });

  it('draws them on the class page’s live grid alone, after it, and never on the projector', () => {
    // Held by the grid, so they go with the session's live page, as ClassUnlock draws them; kept
    // while Present is on, and shown again once it is off.
    expect(grid).toMatch(/const selects = livePage && !present;/);
    // Open student closes its pop-up and opens the student's panel (PV11b), as ClassStudent draws
    // the panel with no pop-up over it.
    expect(grid).toMatch(
      /\{selects \? \(\s*<UnlockPopups\s+unlocks=\{popups\.open\}\s+students=\{students\}\s+onClose=\{\(eventId\) => tell\(\{ kind: 'close', eventId \}\)\}\s+onOpen=\{\(u\) => \{\s*tell\(\{ kind: 'close', eventId: u\.eventId \}\);\s*open\(u\.studentId\);\s*\}\}\s*\/>\s*\) : null\}\s*<\/div>\s*\);\s*\}\s*$/,
    );
    // The page's one grid is the live page's, which takes `livePage` (How it ended's, which never
    // streamed, went with it in PV12b).
    const grids = page.match(/<LiveGrid\b[^]*?\/>/g) ?? [];
    expect(grids).toHaveLength(1);
    expect(grids[0]).toMatch(/\blivePage\b/);
    // Placed against the live page's `<main>`, as the reconnect pill is.
    expect(page).toMatch(/: 'relative flex flex-col gap-5\.5'\}>/);
  });
});
