// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Students } from '../lib/grid-state';
import { LiveCardView } from './home';
import type { GridNow } from './live-grid';

/*
 * Home's live card (PV17b; Main, HomeLiveStates) as a teacher meets it (the owner's decision of
 * 2026-10-22: the portal's tests drive the page). The class page's grid, handed to it as it stands:
 * a lost or quiet live feed is said under the counts in the class page's own line, a status a
 * screen reader hears as it comes (the audit's DR-05), but not at each second's tick of its age.
 * Home's other tests, not converted yet, are in `home.test.ts` (this file can't share its name).
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

afterEach(cleanup);

const NOW = Date.now();
const STUDENTS: Students = {
  u1: {
    studentId: 'u1',
    displayName: 'Ethan Park',
    state: 'focused',
    joinedAt: new Date(NOW - 20 * 60_000),
    lastSeenAt: new Date(NOW - 10_000),
    endedAt: null,
    unlock: null,
    clockOff: false,
  },
};

/** The card, the grid read and its feed's health as given. */
function card(stale: GridNow['stale']) {
  render(
    <LiveCardView
      classId="c1"
      name="Biology, period 3"
      grid={{
        students: STUDENTS,
        now: new Date(NOW),
        error: null,
        retry: () => undefined,
        retrying: false,
        stale,
      }}
      startedAt={new Date(NOW - 30 * 60_000).toISOString()}
      endsAt={new Date(NOW + 20 * 60_000).toISOString()}
    />,
  );
}

describe('the live card’s line for its feed (HomeLiveStates; DR-05)', () => {
  it('says a lost or quiet live feed under the counts in the class page’s own line, a status', () => {
    card({ reason: 'reconnecting', secondsAgo: 40 });
    const lost = screen.getByRole('status');
    expect(lost.textContent).toBe('Reconnecting… last updated 40s ago');
    // Its age, which ticks each second, never said as it changes.
    expect(lost.querySelector('[aria-live="off"]')?.textContent).toBe('40s ago');
    expect(Array.from(lost.classList)).toEqual(
      expect.arrayContaining([
        'rounded-sm',
        'border',
        'border-border-default',
        'bg-surface-sunken',
        'px-4',
        'py-3',
        'text-body',
        'text-text-primary',
        'tabular-nums',
      ]),
    );
    // Under the counts, over Open the class: the counts kept.
    const counts = lost.previousElementSibling;
    expect(counts?.tagName).toBe('UL');
    expect(lost.nextElementSibling?.textContent).toMatch(/^Open the class/);
    cleanup();

    card({ reason: 'stale', secondsAgo: 120 });
    const quiet = screen.getByRole('status');
    expect(quiet.textContent).toBe('Live feed has gone quiet. Last updated 2 min ago.');
    expect(quiet.querySelector('[aria-live="off"]')?.textContent).toBe('2 min ago.');
    cleanup();

    card(null);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Reconnecting|gone quiet/);
  });
});
