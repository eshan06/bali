// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { QuestionDraft } from '../lib/live-question';
import { type Form, type QuestionsActions, QuestionsView } from './saved-questions';

/*
 * Your questions' Write and Edit (L7b, part 1; QuestionsEdit) as a teacher meets them (the owner's
 * decision of 2026-10-22: the portal's tests drive the page): each answer's Mark correct is named
 * by its answer's letter, as its Remove is, so a screen reader tells the four apart (the audit's
 * D01), and described by its answer. The page's other tests, not converted yet, are in
 * `saved-questions.test.ts` (this file can't share its name).
 */
afterEach(cleanup);

const actions = (): QuestionsActions => ({
  write: vi.fn(),
  edit: vi.fn(),
  change: vi.fn(),
  addAnswer: vi.fn(),
  removeAnswer: vi.fn(),
  save: vi.fn(),
  cancel: vi.fn(),
  ask: vi.fn(),
  remove: vi.fn(),
  keep: vi.fn(),
  read: vi.fn(),
});

/** Four answers, B marked correct, as an Edit opens them. */
const FOUR: QuestionDraft = {
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  correctOption: 1,
};

function writing(words: QuestionDraft, over: Partial<Form> = {}) {
  const on = actions();
  render(
    <QuestionsView
      drafts={[]}
      form={{ draft: null, words, tried: false, busy: false, problem: null, tries: 0, ...over }}
      removals={{}}
      on={on}
    />,
  );
  return on;
}

const marks = () =>
  screen.getAllByRole('button', { name: /^(Mark correct|Correct), answer [A-F]$/ });

describe('each answer’s Mark correct (QuestionsEdit; D01)', () => {
  it('is named by its answer’s letter, after the words it shows, as Remove is, and described by its answer', async () => {
    const user = userEvent.setup();
    const on = writing(FOUR);
    expect(marks().map((b) => [b.getAttribute('aria-label'), b.textContent])).toEqual([
      ['Mark correct, answer A', 'Mark correct'],
      ['Correct, answer B', 'Correct'],
      ['Mark correct, answer C', 'Mark correct'],
      ['Mark correct, answer D', 'Mark correct'],
    ]);
    expect(marks().map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    // The correct one's check, beside its word; the rest have none.
    expect(marks().map((b) => b.querySelector('svg.lucide-check') !== null)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    ['A', 'B', 'C', 'D'].forEach((letter, i) => {
      const answer = screen.getByRole('textbox', { name: `Answer ${letter}` });
      expect(marks()[i]?.getAttribute('aria-describedby')).toBe(answer.id);
      expect(screen.getByRole('button', { name: `Remove answer ${letter}` })).toBeDefined();
    });

    // Each press hands the page its change: C marked, B's mark taken back.
    await user.click(screen.getByRole('button', { name: 'Mark correct, answer C' }));
    expect(on.change).toHaveBeenLastCalledWith({ ...FOUR, correctOption: 2 });
    screen.getByRole('button', { name: 'Correct, answer B' }).focus();
    await user.keyboard('{Enter}');
    expect(on.change).toHaveBeenLastCalledWith({ ...FOUR, correctOption: null });
  });

  it('starts with the two answers a question needs, neither marked', () => {
    writing({ prompt: '', options: ['', ''], correctOption: null });
    expect(
      marks().map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')]),
    ).toEqual([
      ['Mark correct, answer A', 'false'],
      ['Mark correct, answer B', 'false'],
    ]);
  });
});
