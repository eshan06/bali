// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Student } from '../lib/grid-state';
import { StateChip } from './live-grid';
import { PanelView } from './student-panel';

/*
 * The student panel's head (PV11b; ClassStudent) as a teacher meets it (the owner's decision of
 * 2026-10-22: the portal's tests drive the page): the name, which takes focus as the panel opens,
 * and Close, named for whose panel it closes (the audit's C02), as the unlock pop-ups' Close is.
 * The panel's other tests, not converted yet, are in `student-panel.test.ts` (this file can't
 * share its name).
 */
afterEach(cleanup);

const NOW = new Date('2026-10-14T14:32:00.000Z');
const ETHAN: Student = {
  studentId: 'u1-0000-aaaa',
  displayName: 'Ethan Park',
  state: 'focused',
  joinedAt: new Date('2026-10-14T14:05:00.000Z'),
  lastSeenAt: new Date('2026-10-14T14:31:00.000Z'),
  endedAt: null,
  unlock: null,
  clockOff: false,
};

function panel(student: Student, onClose = vi.fn()) {
  render(
    <PanelView
      id="g-panel"
      student={student}
      chip={<StateChip student={student} now={NOW} />}
      read={{ kind: 'loading' }}
      now={NOW}
      onClose={onClose}
      onRetry={() => undefined}
    />,
  );
  return onClose;
}

describe('the panel’s head, as ClassStudent draws it', () => {
  it('heads it with the name, which takes focus as it opens, and Close, named for whose panel it is', async () => {
    const user = userEvent.setup();
    const onClose = panel(ETHAN);
    const name = screen.getByRole('heading', { level: 2, name: 'Ethan Park' });
    expect(name.id).toBe('g-panel-name');
    expect(name.getAttribute('tabindex')).toBe('-1');
    expect(name.className).toBe('text-h3 wrap-anywhere');
    expect(screen.getByRole('complementary', { name: 'Ethan Park' }).id).toBe('g-panel');

    const close = screen.getByRole('button', { name: "Close Ethan Park's panel" });
    expect(close.getAttribute('type')).toBe('button');
    expect(close.textContent).toBe('');
    expect(close.querySelector('svg')?.classList).toContain('lucide-x');
    // The name, the chip and Close in one row, its hairline under it, 20/14/16/20 px in.
    expect(Array.from(close.parentElement?.classList ?? [])).toEqual(
      expect.arrayContaining(['gap-3', 'border-b', 'pt-5', 'pr-3.5', 'pb-4', 'pl-5']),
    );
    await user.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('names Close by the student’s id until their name is known, as their tile does', () => {
    panel({ ...ETHAN, displayName: null });
    expect(screen.getByRole('button', { name: "Close u1-0000-'s panel" })).toBeDefined();
  });
});
