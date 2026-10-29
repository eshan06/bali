// @vitest-environment jsdom
import {
  type SessionSnapshot,
  type SnapshotStudent,
  UNLOCK_REASONS,
  type UnlockReason,
} from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  return { reads, api: { get }, signOut };
});

vi.mock('@/lib/use-api', () => ({ useApi: () => bali.api, useSignOut: () => bali.signOut }));
// No stream: the grid is its snapshot.
vi.mock('@/lib/sse-client', () => ({ createSseClient: () => ({ close: () => undefined }) }));

afterEach(() => {
  bali.reads.length = 0;
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
async function open(present: boolean, students: SnapshotStudent[]) {
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

describe('the live grid on the class page and in Present (ClassPresent)', () => {
  const omar = student('Omar Siddiqui', { clockOff: true });

  it('says Clock off on the class page, with its tooltip, a button that opens the student’s panel', async () => {
    await open(false, [omar]);
    const button = screen.getByRole('button', { name: /^Omar Siddiqui/ });
    expect(button.closest('li')).toBe(tile('Omar Siddiqui'));
    expect(within(button).getByTitle(CLOCK_OFF).textContent).toBe('Clock off');
  });

  it('never says Clock off in Present, the projector the class can see (the owner, 2026-10-28)', async () => {
    await open(true, [omar]);
    const omarsTile = tile('Omar Siddiqui');
    // The state alone, as for any focused student: no line, no tooltip, nothing for a screen reader.
    expect(says(omarsTile)).toBe(['Omar Siddiqui', 'Focused'].join(''));
    expect(within(omarsTile).queryByTitle(CLOCK_OFF)).toBeNull();
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
      for (const name of ['Jaylen Brooks', 'Lucas Ferreira', 'Mateo Silva', 'Priya Natarajan']) {
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
      expect(says(tile('Jaylen Brooks'))).toBe(
        ['Jaylen Brooks', 'Unlocked', 'last seen 5 min ago'].join(''),
      );
      expect(says(tile('Lucas Ferreira'))).toBe(
        ['Lucas Ferreira', 'Protection off', 'Unlocked · last seen 5 min ago'].join(''),
      );
      expect(says(tile('Mateo Silva'))).toBe(['Mateo Silva', 'Left · unlocked'].join(''));
      expect(says(tile('Priya Natarajan'))).toBe(
        ['Priya Natarajan', 'Left · protection off', 'Unlocked'].join(''),
      );
      expect(says(tile('Omar Siddiqui'))).toBe(['Omar Siddiqui', 'Focused'].join(''));
      cleanup();
    }
  });
});
