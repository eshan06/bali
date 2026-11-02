// @vitest-environment jsdom
import {
  type SessionSnapshot,
  type SnapshotStudent,
  UNLOCK_REASONS,
  type UnlockReason,
} from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveGrid } from './live-grid';
import { CLOCK_OFF } from './student-panel';

/*
 * The live grid as a teacher meets it (the owner's decision of 2026-10-22: the portal's tests drive
 * the page): on the class page while a session runs, and in Present, the projector the class can
 * see (ClassPresent). Present shows the room each student's state, but never what is the teacher's
 * alone: an unlock's reason (2026-10-06) and Clock off (the owner, 2026-10-28). The class page's
 * own grid says both. Bali's answer to the grid's read is a stand-in's, held until the test gives
 * it, and no stream runs: the grid is the snapshot it read.
 *
 * The grid's other tests, not converted yet, are in `live-grid.test.ts`; this file can't share its
 * name, since TypeScript drops a `.tsx` whose name a `.ts` beside it has (ESLint then says the
 * project service can't find it). The step that converts them merges the two.
 */

const bali = vi.hoisted(() => {
  /** Each read of the grid on its way, its answer the test's to give. */
  const reads: ((snapshot: unknown) => void)[] = [];
  const get = () =>
    new Promise((answer) => {
      reads.push(answer);
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

/** The grid on the class page while a session runs, or in Present, once Bali answers its read. */
async function open(
  present: boolean,
  students: SnapshotStudent[],
  more: Partial<SessionSnapshot> = {},
) {
  render(<LiveGrid sessionId="S" livePage present={present} />);
  const snapshot: SessionSnapshot = {
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
  };
  await act(async () => {
    const read = bali.reads.shift();
    if (!read) throw new Error('no read of the grid on its way');
    read(snapshot);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** A student's tile, found by their name. */
function tile(name: string): HTMLElement {
  const found = screen.getByText(name).closest('li');
  if (!found) throw new Error(`no tile for ${name}`);
  return found;
}

/** What a tile says, its parts read in order with no space between them, as the markup has them. */
const says = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');

/** A tile's words part by part, its name first: the name, the state and its line, if it has one. */
function parts(name: string): string[] {
  const words = screen.getByText(name).parentElement;
  if (!words) throw new Error(`no words for ${name}`);
  return Array.from(words.children, (part) => (part.textContent ?? '').replace(/\s+/g, ' '));
}

describe('the live grid on the class page and in Present (ClassPresent)', () => {
  const omar = student('Omar Siddiqui', { clockOff: true });

  it('says Clock off on the class page, with its tooltip, a button that opens the student’s panel', async () => {
    await open(false, [omar]);
    const button = screen.getByRole('button', { name: /^Omar Siddiqui/ });
    expect(button.closest('li')).toBe(tile('Omar Siddiqui'));
    expect(within(button).getByTitle(CLOCK_OFF).textContent).toBe('Clock off');
  });

  it('never says Clock off in Present, the projector the class can see (the owner, 2026-10-28)', async () => {
    // And a phone heard from 70 s ago, whose line says "last seen" and whose one detail on a phone
    // would be Clock off on the class page.
    await open(true, [omar, student('Wei Zhang', { clockOff: true, lastSeenAt: ago(70) })]);
    const omarsTile = tile('Omar Siddiqui');
    // The state alone, as for any focused student: no line, no tooltip, nothing for a screen reader.
    expect(parts('Omar Siddiqui')).toEqual(['Omar Siddiqui', 'Focused']);
    expect(says(omarsTile)).toBe(['Omar Siddiqui', 'Focused'].join(''));
    expect(within(omarsTile).queryByTitle(CLOCK_OFF)).toBeNull();
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

  it('says each unlock’s reason on the class page', async () => {
    for (const reason of UNLOCK_REASONS) {
      await open(false, carrying(reason));
      for (const name of [
        'Ethan Park',
        'Jaylen Brooks',
        'Lucas Ferreira',
        'Mateo Silva',
        'Priya Natarajan',
      ]) {
        expect(says(tile(name)), `${name}, ${reason}`).toMatch(WORDS[reason]);
      }
      cleanup();
    }
  });

  it('never says an unlock’s reason in Present, "last seen" kept, every tile its state', async () => {
    for (const reason of UNLOCK_REASONS) {
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
 * The grid's health (ClassStale; ARCHITECTURE, Web portal, decision 4): a lost stream said as the
 * floating pill, a quiet one in the stone line over the tiles, each a status a screen reader hears
 * as it comes (the audit's DR-05; CLAUDE.md: no silent failures), as a student hears "Can't reach
 * Bali", but never at each second's tick of its age (`aria-live="off"`, as YourPhone's minutes).
 */
describe('the grid’s health, said (ClassStale; DR-05)', () => {
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

  for (const present of [false, true]) {
    it(`says a lost stream as the floating pill over the tiles, a status${present ? ', in Present' : ''}`, async () => {
      await open(present, [student('Omar Siddiqui')]);
      expect(screen.queryByRole('status')).toBeNull();
      await status('reconnecting');

      const pill = screen.getByRole('status');
      expect(said(pill)).toEqual({ words: 'Reconnecting… last updated 0s ago', age: '0s ago' });
      // Its stone dot, then the words as one piece of the pill's row.
      expect(pill.children).toHaveLength(2);
      expect(pill.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
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
  }

  it('says a quiet stream in the stone line over the tiles, a status', async () => {
    await open(false, [student('Omar Siddiqui')]);
    await status('open');
    // Three heartbeats missed with no sign of life: a minute.
    await act(() => vi.advanceTimersByTimeAsync(59_000));
    expect(screen.queryByRole('status')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2000));

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
