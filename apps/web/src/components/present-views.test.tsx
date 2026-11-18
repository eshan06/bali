// @vitest-environment jsdom
import type { QuestionResults, SavedQuestion, Slide, TeacherQuestion } from '@bali/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SlideLesson } from '../lib/use-slide';
import { PresentQuestion } from './present-question';
import { PresentSlide } from './present-slide';
import type { LiveQuestion } from './question-card';

/*
 * Present's question and slide views never read the panel of the teacher's questions, which names
 * each one's correct answer (the owner, 2026-10-15): Present is the projector the class can see.
 * No page mounts either view since LO9 (ARCHITECTURE, Web portal, decision 8), but their code stays
 * behind the lessons switch with its tests, so the guard stays with them (LO13; `present.test.ts`
 * held it as a read of their source until LO9). Driven: each view drawn as the class page drew it,
 * every request it makes recorded, the panel's saved questions and decks waiting at Bali's address.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

/** A saved question of the teacher's, its correct answer on the panel's list. */
const SAVED: SavedQuestion = {
  id: '0199e0a0-0000-7000-8000-0000000000aa',
  prompt: 'Which organelle makes most of a cell’s ATP?',
  options: ['Nucleus', 'Mitochondrion', 'Ribosome'],
  correctOption: 1,
  eventId: '0199e0a0-0000-7000-8000-0000000000ab',
  createdAt: '2026-10-15T14:00:00.000Z',
  updatedAt: '2026-10-15T14:00:00.000Z',
};

/** Every request a view makes, by its address; Bali answers each with the panel's list. */
const sent: string[] = [];
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      sent.push(String(input instanceof Request ? input.url : input));
      return Promise.resolve(Response.json({ savedQuestions: [SAVED], decks: [] }));
    }),
  );
  // jsdom has none; the slide's frame watches its own size.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sent.length = 0;
});

/** Bali's answers, if any were asked for, and what they set off, drawn. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

const question = (over: Partial<TeacherQuestion> = {}): TeacherQuestion => ({
  id: '0199e0a0-0000-7000-8000-000000000001',
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  correctOption: 1,
  revealed: false,
  open: true,
  ...over,
});
const totals = (over: Partial<QuestionResults> = {}): QuestionResults => ({
  answered: 18,
  eligible: 28,
  open: true,
  correctOption: 1,
  revealed: false,
  counts: [2, 12, 1, 3],
  ...over,
});
/** The class page's live question, as `useLiveQuestion` held it. */
const live = (over: Partial<TeacherQuestion> = {}, read = totals()): LiveQuestion => ({
  question: question(over),
  results: { results: read, final: true, problem: null, at: 0 },
  closing: false,
  closeFailed: null,
  close: vi.fn(),
  done: vi.fn(),
});

const slide: Slide = {
  deckId: '0199b000-0000-7000-8000-0000000000d1',
  sha256: 'a'.repeat(64),
  page: 4,
  pageCount: 12,
};
const shown: SlideLesson = {
  slide,
  title: 'Factoring quadratics',
  deck: { kind: 'loading' },
  changing: null,
  said: null,
  turn: vi.fn(),
  show: vi.fn(() => Promise.resolve(true)),
  stop: vi.fn(() => Promise.resolve(true)),
  again: vi.fn(),
  reload: vi.fn(),
};

/** What the panel would put on the projector: its title, a saved question, its correct answer. */
function noPanel() {
  expect(screen.queryByText(/Your questions|Saved questions/)).toBeNull();
  expect(screen.queryByText(SAVED.prompt)).toBeNull();
  expect(screen.queryByText('Mitochondrion')).toBeNull();
}

describe('Present’s views never read the questions panel (the owner, 2026-10-15)', () => {
  it('draws a question open, closed and with its answer shown, and reads nothing: no saved question, no deck', async () => {
    const view = render(<PresentQuestion id="P" lesson={live()} />);
    await settle();
    expect(screen.getByText(question().prompt)).toBeTruthy();
    noPanel();
    view.rerender(
      <PresentQuestion
        id="P"
        lesson={live(
          { open: false, revealed: true },
          totals({ answered: 21, open: false, revealed: true }),
        )}
      />,
    );
    await settle();
    noPanel();
    expect(sent).toEqual([]);
  });

  it('draws a slide being read, and reads nothing of the panel or the decks', async () => {
    render(<PresentSlide id="P" lesson={shown} slide={slide} />);
    await settle();
    expect(screen.getByText(/Factoring quadratics/)).toBeTruthy();
    noPanel();
    expect(sent.filter((url) => /saved-questions|\/v1\/decks/.test(url))).toEqual([]);
  });
});
