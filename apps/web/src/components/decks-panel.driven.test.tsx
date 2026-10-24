// @vitest-environment jsdom
import type { Deck } from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DecksPanel } from './decks-panel';

/*
 * Show slides' side panel as a teacher meets it (the owner's decision of 2026-10-22: the portal's
 * tests drive the page), opened from Show slides on a class page (LessonDecks): titled Show slides
 * over LessonDecks' whole line, back now that phones (M8, M8b) and the student web (W5) show the
 * slide, in every state LessonDecksStates draws. Bali's answer to the read of your slides is a
 * stand-in's, held until the test gives it.
 *
 * The panel's other tests, not converted yet, are in `decks-panel.test.ts`; this file can't share
 * its name, since TypeScript drops a `.tsx` whose name a `.ts` beside it has (ESLint then says the
 * project service can't find it). The step that converts them merges the two.
 */

const LINE =
  "Pick a deck. Every phone in this class shows the page you're on, and so does Present.";

const bali = vi.hoisted(() => {
  /** Each read of your slides on its way, its answer the test's to give. */
  const reads: { answer: (decks: unknown) => void; fail: (e: unknown) => void }[] = [];
  const get = () =>
    new Promise((answer, fail) => {
      reads.push({ answer, fail });
    });
  // One client for every render, as `useApi`'s memo keeps it: the panel reads once as it opens.
  return { reads, api: { get } };
});

vi.mock('@/lib/use-api', () => ({ useApi: () => bali.api }));

const deck = (n: number, title: string, over: Partial<Deck> = {}): Deck => ({
  id: `0199b000-0000-7000-8000-0000000000d${n}`,
  title,
  status: 'ready',
  bytes: 1_200_000,
  sha256: String(n).repeat(64),
  pageCount: 12,
  rejection: null,
  createdAt: '2026-10-06T15:00:00.000Z',
  ...over,
});

/** The panel as Show slides opens it, its read of your slides held. */
function open() {
  const onClose = vi.fn();
  render(
    <DecksPanel
      id="P"
      lesson={{ changing: null, said: null, show: vi.fn() }}
      onShown={vi.fn()}
      onClose={onClose}
    />,
  );
  const panel = screen.getByRole('complementary', { name: 'Show slides' });
  return { panel, onClose };
}

/** Bali answers the read on its way, or it fails; drawn before the next check. */
const settle = (how: (read: (typeof bali.reads)[number]) => void) =>
  act(async () => {
    const read = bali.reads.shift();
    if (read) how(read);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const answer = (decks: Deck[]) => settle((read) => read.answer({ decks }));

afterEach(() => {
  // Focus off first, so no Try again unmounted here hands focus on in the next test's page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  bali.reads.length = 0;
  cleanup();
});

describe('Show slides’ panel (LessonDecks)', () => {
  it('is v2’s side panel, 372 px from the right, titled Show slides over its whole line, then the decks', async () => {
    const { panel } = open();
    expect(panel.id).toBe('P');
    const look = panel.className.split(' ');
    expect(look).toEqual(expect.arrayContaining(['fixed', 'right-0', 'w-93', 'max-w-full']));
    expect(look).not.toContain('w-115');
    const title = within(panel).getByRole('heading', { level: 2, name: 'Show slides' });
    expect(title.className).toBe('text-h3');
    // Focus comes to its title as it opens.
    expect(document.activeElement).toBe(title);
    await answer([
      deck(1, 'Factoring quadratics'),
      deck(2, 'Graphing parabolas', { pageCount: 9, createdAt: '2026-10-02T15:00:00.000Z' }),
    ]);
    // Read in order: the title, its line, then the first deck.
    const start = `Show slides${LINE}Factoring quadratics`;
    expect(panel.textContent?.slice(0, start.length)).toBe(start);
  });

  it('says its whole line while Bali reads your slides', () => {
    const { panel } = open();
    expect(within(panel).getByRole('status').textContent).toBe('Loading…');
    expect(within(panel).getByText(LINE)).toBeTruthy();
  });

  it('says its whole line when your slides didn’t load', async () => {
    const { panel } = open();
    await settle((read) => read.fail(new Error('offline')));
    expect(within(panel).getByRole('alert').textContent).toBe("Bali couldn't load your slides.");
    expect(within(panel).getByText(LINE)).toBeTruthy();
  });

  it('says its whole line when none is ready', async () => {
    const { panel } = open();
    await answer([deck(3, 'Still being checked', { status: 'pending', pageCount: null })]);
    expect(within(panel).getByText('You have no slides ready yet.')).toBeTruthy();
    expect(within(panel).getByText(LINE)).toBeTruthy();
  });

  it('closes with its Close', async () => {
    const user = userEvent.setup();
    const { panel, onClose } = open();
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
