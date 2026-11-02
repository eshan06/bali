// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { QuestionDraft } from '../lib/live-question';
import { AskPanel, NEW_DRAFT } from './ask-panel';

/*
 * Writing a new question in the class page's side panel (L7b, part 2; LessonWrite) as a teacher
 * meets it (the owner's decision of 2026-10-22: the portal's tests drive the page): each answer's
 * Mark correct is named by its answer's letter, as its Remove is, so a screen reader tells the
 * four apart (the audit's D01). The panel's other tests, not converted yet, are in
 * `ask-panel.test.ts` (this file can't share its name).
 */
afterEach(() => {
  // Focus off first: the panel takes it as it opens.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
});

const IDLE = { busy: false, failure: null, from: null };

/** The panel as the class page keeps it: its words its own to change. */
function Writing({ start }: { start: QuestionDraft }) {
  const [draft, setDraft] = useState(start);
  return (
    <AskPanel
      id="P"
      draft={draft}
      onDraft={setDraft}
      openNow={false}
      opening={IDLE}
      onAsk={vi.fn()}
      onAsked={vi.fn()}
      onCancel={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

const marks = () =>
  screen.getAllByRole('button', { name: /^(Mark correct|Correct), answer [A-F]$/ });
const named = () => marks().map((b) => [b.getAttribute('aria-label'), b.textContent]);

describe('each answer’s Mark correct (LessonWrite; D01)', () => {
  it('is named by its answer’s letter, after the words it shows, as Remove is', async () => {
    const user = userEvent.setup();
    render(<Writing start={{ ...NEW_DRAFT, options: ['4', '5', '6', '7'] }} />);
    expect(named()).toEqual([
      ['Mark correct, answer A', 'Mark correct'],
      ['Mark correct, answer B', 'Mark correct'],
      ['Mark correct, answer C', 'Mark correct'],
      ['Mark correct, answer D', 'Mark correct'],
    ]);
    expect(marks().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'false',
    ]);
    // Each beside its answer and its Remove, all three named by one letter.
    for (const letter of ['A', 'B', 'C', 'D']) {
      expect(screen.getByRole('textbox', { name: `Answer ${letter}` })).toBeDefined();
      expect(screen.getByRole('button', { name: `Remove answer ${letter}` })).toBeDefined();
    }

    // Pressed, it says Correct, pressed, named by the same letter; the others stay as they were.
    await user.click(screen.getByRole('button', { name: 'Mark correct, answer B' }));
    const b = screen.getByRole('button', { name: 'Correct, answer B' });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.textContent).toBe('Correct');
    expect(named()).toEqual([
      ['Mark correct, answer A', 'Mark correct'],
      ['Correct, answer B', 'Correct'],
      ['Mark correct, answer C', 'Mark correct'],
      ['Mark correct, answer D', 'Mark correct'],
    ]);
    // Another, by keyboard: it takes the mark, and B lets it go.
    screen.getByRole('button', { name: 'Mark correct, answer D' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Correct, answer D' })).toBe(document.activeElement);
    expect(screen.getByRole('button', { name: 'Mark correct, answer B' })).toBe(b);
    // Pressed again, the mark goes: none is correct, which is allowed.
    await user.keyboard('{Enter}');
    expect(marks().map((m) => m.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('starts with the two answers a question needs, each its own', () => {
    render(<Writing start={NEW_DRAFT} />);
    expect(named()).toEqual([
      ['Mark correct, answer A', 'Mark correct'],
      ['Mark correct, answer B', 'Mark correct'],
    ]);
  });
});
