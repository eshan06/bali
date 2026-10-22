// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handOff, TryAgain } from './try-again';

/*
 * Try again, one for every read in the portal (the owner's follow-up of 2026-10-16): one button
 * throughout, held as Loading… while its read runs, so focus stays on it; its line said again at
 * each failure; and once the read lands and its failure goes, focus lands in the region, never on
 * the body. Driven here in a page (jsdom, Testing Library: the owner's decision of 2026-10-22), as
 * a keyboard user presses it and a screen reader is told of it, Bali's answers held until a test
 * gives them.
 */

afterEach(() => {
  // Focus off first, so no Try again unmounted here hands focus on in the next test's page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
});

/** Bali, its answers held: each `read` is on its way until the test answers it. */
function bali() {
  const onTheirWay: {
    give: (loaded: boolean) => void;
    fail: (e: Error) => void;
    read: Promise<boolean>;
  }[] = [];
  const read = vi.fn(() => {
    let give!: (loaded: boolean) => void;
    let fail!: (e: Error) => void;
    const promise = new Promise<boolean>((resolve, reject) => {
      give = resolve;
      fail = reject;
    });
    onTheirWay.push({ give, fail, read: promise });
    return promise;
  });
  const next = () => {
    const first = onTheirWay.shift();
    if (!first) throw new Error('no read on its way');
    return first;
  };
  return {
    read,
    /** The read on its way answered: its data in (`true`), or failed again. */
    answer: async (loaded: boolean) => {
      const first = next();
      await act(async () => {
        first.give(loaded);
        await first.read;
      });
    },
    /** The read on its way thrown, as a request with no answer is. */
    refuse: async () => {
      const first = next();
      await act(async () => {
        first.fail(new Error('no answer'));
        await first.read.catch(() => undefined);
      });
    },
  };
}

/** The next frame, by which Try again has handed focus on: it asked for its frame first. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** What a screen reader is told of a button: its words, and whether it is held, busy or disabled. */
const told = (button: HTMLElement) => ({
  words: button.textContent,
  'aria-disabled': button.getAttribute('aria-disabled'),
  'aria-busy': button.getAttribute('aria-busy'),
  disabled: (button as HTMLButtonElement).disabled,
});

const AT_REST = { 'aria-disabled': 'false', 'aria-busy': 'false', disabled: false };
const HELD = { 'aria-disabled': 'true', 'aria-busy': 'false', disabled: false };
const BUSY = { 'aria-disabled': 'true', 'aria-busy': 'true', disabled: false };

const LINE = <p role="alert">Couldn’t load your blocks.</p>;

type Props = Parameters<typeof TryAgain>[0];
const tryAgain = (props: Partial<Props> = {}) =>
  render(<TryAgain onRetry={() => undefined} then={[]} children={LINE} {...props} />);

/** A region whose read failed, as a page draws one: its line and Try again until a read is in. */
function Failing({
  read,
  then,
  children,
}: {
  read: () => Promise<boolean>;
  then: readonly string[];
  children: ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  if (loaded) return children;
  return (
    <TryAgain onRetry={async () => setLoaded(await read())} then={then}>
      {LINE}
    </TryAgain>
  );
}

describe('Try again, as drawn', () => {
  it('is one small secondary button saying Try again, after its failure’s own line', () => {
    const { container } = tryAgain();
    expect([...container.children]).toEqual([
      screen.getByRole('alert'),
      screen.getByRole('button', { name: 'Try again' }),
    ]);
    const button = screen.getByRole('button');
    expect(told(button)).toEqual({ words: 'Try again', ...AT_REST });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.classList).toContain('h-8.5');
    expect(button.classList).toContain('border-border-strong');
  });

  it('holds as Loading… while the page says its read is on its way (`held`): focusable, never disabled, a press sending nothing', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    tryAgain({ held: true, onRetry });
    const button = screen.getByRole('button', { name: 'Loading…' });
    expect(told(button)).toEqual({ words: 'Loading…', ...BUSY });
    // Dimmed by its aria-disabled, as `disabled` would dim it, which would drop focus to the body.
    expect(button.classList).toContain('aria-disabled:opacity-55');
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('comes full size where its failure is a card’s, in its place', () => {
    tryAgain({ size: 'md', className: 'mt-3.5' });
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button.classList).toContain('h-10');
    expect(button.classList).toContain('mt-3.5');
    expect(button.classList).not.toContain('h-8.5');
  });

  it('is described by what it is about where its line doesn’t say it (a deck in Show slides)', () => {
    render(
      <>
        <span id="deck-name">Cells, unit 3</span>
        <TryAgain onRetry={() => undefined} then={[]} describedBy="deck-name" />
      </>,
    );
    expect(
      screen.getByRole('button', { name: 'Try again', description: 'Cells, unit 3' }),
    ).toBeDefined();
  });

  it('holds at rest in its own words while another control’s send is on its way (`blocked`: a stopped upload’s Cancel)', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = tryAgain({ blocked: true, onRetry });
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(told(button)).toEqual({ words: 'Try again', ...HELD });
    expect(button.classList).toContain('aria-disabled:opacity-55');
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onRetry).not.toHaveBeenCalled();
    // Its own read on its way says so, whatever else holds it.
    rerender(<TryAgain onRetry={onRetry} then={[]} blocked held children={LINE} />);
    expect(told(button)).toEqual({ words: 'Loading…', ...BUSY });
    expect(document.activeElement).toBe(button);
  });
});

describe('Try again as a send’s own button (Register block, Make new code)', () => {
  const send = (failed: boolean) => ({ words: 'Make new code', sending: 'Making…', failed });

  it('says its send’s words until one fails, and Try again once one did, its line drawn apart', () => {
    const { container, rerender } = render(
      <TryAgain onRetry={() => undefined} then={[]} send={send(false)} />,
    );
    const button = screen.getByRole('button', { name: 'Make new code' });
    expect([...container.children]).toEqual([button]);
    expect(told(button)).toEqual({ words: 'Make new code', ...AT_REST });
    rerender(<TryAgain onRetry={() => undefined} then={[]} send={send(true)} />);
    expect(told(button)).toEqual({ words: 'Try again', ...AT_REST });
  });

  it('says its own sending word while one is on its way, a resend too, held and never disabled', async () => {
    const user = userEvent.setup();
    const { read, answer } = bali();
    const { rerender } = render(<TryAgain onRetry={read} then={[]} send={send(false)} />);
    const button = screen.getByRole('button', { name: 'Make new code' });
    await user.tab();
    await user.keyboard('{Enter}');
    expect(told(button)).toEqual({ words: 'Making…', ...BUSY });
    await answer(false);
    // The page says its send failed; pressed again, its resend holds the same way.
    rerender(<TryAgain onRetry={read} then={[]} send={send(true)} />);
    expect(told(button)).toEqual({ words: 'Try again', ...AT_REST });
    await user.keyboard('{Enter}');
    expect(told(button)).toEqual({ words: 'Making…', ...BUSY });
    expect(document.activeElement).toBe(button);
    await answer(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('says it as well while the page says its send is on its way (`held`), failed before or not', () => {
    const { rerender } = render(
      <TryAgain onRetry={() => undefined} held then={[]} send={send(false)} />,
    );
    const button = screen.getByRole('button');
    expect(told(button)).toEqual({ words: 'Making…', ...BUSY });
    rerender(<TryAgain onRetry={() => undefined} held then={[]} send={send(true)} />);
    expect(told(button)).toEqual({ words: 'Making…', ...BUSY });
  });

  it('is its form’s submit, in its form’s look: Enter in the field presses it', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          Block ID <input />
        </label>
        <TryAgain
          type="submit"
          variant="primary"
          size="md"
          onRetry={onRetry}
          then={[]}
          send={{ words: 'Register block', sending: 'Registering…', failed: false }}
        />
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Register block' });
    expect(told(button)).toEqual({ words: 'Register block', ...AT_REST });
    expect(button.getAttribute('type')).toBe('submit');
    expect(button.classList).toContain('h-10');
    expect(button.classList).toContain('bg-action-primary-bg');
    await user.type(screen.getByRole('textbox', { name: 'Block ID' }), 'BALI7Q2M4X{Enter}');
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('holds in its own words with nothing to send yet (Create class before a name is typed)', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const create = (blocked: boolean, failed = false) => (
      <form onSubmit={(e) => e.preventDefault()}>
        <label>
          New class name <input />
        </label>
        <TryAgain
          type="submit"
          variant="primary"
          size="md"
          blocked={blocked}
          onRetry={onRetry}
          then={[]}
          send={{ words: 'Create class', sending: 'Creating…', failed }}
        />
      </form>
    );
    const { rerender } = render(create(true));
    const button = screen.getByRole('button');
    expect(told(button)).toEqual({ words: 'Create class', ...HELD });
    expect(button.getAttribute('type')).toBe('submit');
    await user.type(screen.getByRole('textbox', { name: 'New class name' }), '{Enter}');
    expect(onRetry).not.toHaveBeenCalled();
    rerender(create(true, true));
    expect(told(button)).toEqual({ words: 'Try again', ...HELD });
    rerender(create(false));
    expect(told(button)).toEqual({ words: 'Create class', ...AT_REST });
  });
});

describe('Try again, pressed', () => {
  it('reads again once, held as Loading… with focus kept while the read’s promise runs, never twice at once', async () => {
    const user = userEvent.setup();
    const { read, answer } = bali();
    render(<TryAgain onRetry={read} then={[]} children={LINE} />);
    const button = screen.getByRole('button', { name: 'Try again' });
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(read).toHaveBeenCalledOnce();
    expect(told(button)).toEqual({ words: 'Loading…', ...BUSY });
    expect(document.activeElement).toBe(button);
    // Pressed again while held, by Enter, Space or a click: nothing more is sent.
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    await user.click(button);
    expect(read).toHaveBeenCalledOnce();
    await answer(false);
    expect(told(button)).toEqual({ words: 'Try again', ...AT_REST });
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('lets go as well when the read throws, its line said again', async () => {
    const user = userEvent.setup();
    const { read, refuse } = bali();
    render(<TryAgain onRetry={read} then={[]} children={LINE} />);
    const line = screen.getByRole('alert');
    await user.tab();
    await user.keyboard('{Enter}');
    await refuse();
    expect(told(screen.getByRole('button'))).toEqual({ words: 'Try again', ...AT_REST });
    expect(screen.getByRole('alert')).not.toBe(line);
  });

  it('holds nothing of its own when its press gives no promise: the page says (`held`)', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    tryAgain({ onRetry });
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledOnce();
    expect(told(screen.getByRole('button'))).toEqual({ words: 'Try again', ...AT_REST });
  });

  it('says its line again at each answer that leaves the failure standing, a new element each time', async () => {
    const user = userEvent.setup();
    const { read, answer } = bali();
    const { rerender } = render(<TryAgain onRetry={read} then={[]} children={LINE} />);
    const first = screen.getByRole('alert');
    await user.tab();
    await user.keyboard('{Enter}');
    // Its line stays said, as it is, until Bali answers.
    expect(screen.getByRole('alert')).toBe(first);
    await answer(false);
    const second = screen.getByRole('alert');
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(second.textContent).toBe('Couldn’t load your blocks.');
    // The page's own read again (`held`): the same, focus on Try again throughout.
    const button = screen.getByRole('button');
    rerender(<TryAgain onRetry={read} held then={[]} children={LINE} />);
    expect(screen.getByRole('alert')).toBe(second);
    expect(told(button)).toEqual({ words: 'Loading…', ...BUSY });
    rerender(<TryAgain onRetry={read} then={[]} children={LINE} />);
    expect(screen.getByRole('alert')).not.toBe(second);
    expect(document.activeElement).toBe(button);
  });
});

describe('focus, once the read is in and Try again goes with its failure', () => {
  /** Try again pressed with the keyboard, then its read answered: in. */
  async function readIn(answer: (loaded: boolean) => Promise<void>, tabs = 1) {
    const user = userEvent.setup();
    for (let i = 0; i < tabs; i++) await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }));
    await user.keyboard('{Enter}');
    await answer(true);
    await nextFrame();
  }

  it('lands on the first of `then` the page has, a heading given tabindex -1 to take it', async () => {
    const { read, answer } = bali();
    render(
      <main>
        <h1 id="greeting">Good morning</h1>
        <h2 id="block">Your block</h2>
        <Failing read={read} then={['gone', 'block', 'greeting']}>
          <p>No block registered yet.</p>
        </Failing>
      </main>,
    );
    await readIn(answer);
    const heading = screen.getByRole('heading', { name: 'Your block' });
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    // The later one there, the page's own heading too, is left as it is.
    expect(screen.getByRole('heading', { name: 'Good morning' }).hasAttribute('tabindex')).toBe(
      false,
    );
  });

  it('takes a control there as it is, no tabindex given', async () => {
    const { read, answer } = bali();
    render(
      <main>
        <h1>Reports</h1>
        <Failing read={read} then={['earlier']}>
          <button id="earlier">Show earlier</button>
        </Failing>
      </main>,
    );
    await readIn(answer);
    const button = screen.getByRole('button', { name: 'Show earlier' });
    expect(document.activeElement).toBe(button);
    expect(button.hasAttribute('tabindex')).toBe(false);
  });

  it('with none of `then` there, lands on the page’s own heading (`main h1`), given tabindex -1', async () => {
    const { read, answer } = bali();
    render(
      <main>
        <h1>Classes</h1>
        <Failing read={read} then={['gone']}>
          <a href="/classes/new">New class</a>
        </Failing>
      </main>,
    );
    await readIn(answer);
    const heading = screen.getByRole('heading', { name: 'Classes' });
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('keeps a heading’s own tabindex, which takes focus as it is', async () => {
    const { read, answer } = bali();
    render(
      <main>
        <h1 tabIndex={0}>Classes</h1>
        <Failing read={read} then={[]}>
          <p>No classes yet.</p>
        </Failing>
      </main>,
    );
    await readIn(answer, 2);
    const heading = screen.getByRole('heading', { name: 'Classes' });
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('0');
  });

  it('with no heading, on the page’s first control; with nothing, nowhere, never a throw', async () => {
    const controls = bali();
    const { unmount } = render(
      <main>
        <Failing read={controls.read} then={['gone']}>
          <p>No classes yet.</p>
        </Failing>
        <a href="/classes/new">New class</a>
      </main>,
    );
    await readIn(controls.answer);
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'New class' }));
    unmount();
    const bare = bali();
    render(
      <main>
        <Failing read={bare.read} then={['gone']}>
          <p>No classes yet.</p>
        </Failing>
      </main>,
    );
    await readIn(bare.answer);
    expect(document.activeElement).toBe(document.body);
  });

  it('follows `then` as the page changes it: the page’s latest word', async () => {
    const { read, answer } = bali();
    const page = (then: readonly string[]) => (
      <main>
        <h2 id="first">Your classes</h2>
        <h2 id="second">Recent activity</h2>
        <Failing read={read} then={then}>
          <p>Nothing yet.</p>
        </Failing>
      </main>
    );
    const { rerender } = render(page(['first']));
    rerender(page(['second']));
    await readIn(answer);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Recent activity' }));
  });

  it('leaves the page as it is when focus wasn’t on Try again as it went: a click that didn’t focus it (Safari, Firefox on a Mac)', async () => {
    const { read, answer } = bali();
    render(
      <main>
        <h1>Home</h1>
        <h2 id="block">Your block</h2>
        <Failing read={read} then={['block']}>
          <p>No block registered yet.</p>
        </Failing>
      </main>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(read).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.body);
    await answer(true);
    await nextFrame();
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByRole('heading', { name: 'Your block' }).hasAttribute('tabindex')).toBe(
      false,
    );
  });

  it('leaves focus be when it was elsewhere as Try again went: a keyboard user who moved on', async () => {
    const user = userEvent.setup();
    const { read, answer } = bali();
    render(
      <main>
        <h2 id="block">Your block</h2>
        <Failing read={read} then={['block']}>
          <p>No block registered yet.</p>
        </Failing>
        <a href="/help">Help</a>
      </main>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();
    await answer(true);
    await nextFrame();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Help' }));
    expect(screen.getByRole('heading', { name: 'Your block' }).hasAttribute('tabindex')).toBe(
      false,
    );
  });

  it('never takes focus from where the page moved it itself meanwhile', async () => {
    const { read, answer } = bali();
    /** A panel opening as the read lands, its title taking focus. */
    function Panel() {
      const title = useRef<HTMLHeadingElement>(null);
      useEffect(() => title.current?.focus(), []);
      return (
        <h2 ref={title} tabIndex={-1}>
          Ask a question
        </h2>
      );
    }
    render(
      <main>
        <h2 id="block">Your block</h2>
        <Failing read={read} then={['block']}>
          <Panel />
        </Failing>
      </main>,
    );
    await readIn(answer);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Ask a question' }));
  });
});

describe('the hand-off itself (`handOff`)', () => {
  /** The page as a browser that names the gone button, or nothing, as focused tells it. */
  const naming = (focused: () => Element | null) => ({
    get activeElement() {
      return focused();
    },
    body: document.body,
    getElementById: document.getElementById.bind(document),
    querySelector: document.querySelector.bind(document),
  });

  it('lands it as well where the browser still names the button gone, or nothing', async () => {
    for (const after of ['the button', 'nothing'] as const) {
      const { unmount } = render(<h2 id="block">Your block</h2>);
      const button = document.createElement('button');
      let focused: Element | null = button;
      handOff(
        button,
        () => ['block'],
        naming(() => focused),
      );
      focused = after === 'nothing' ? null : button;
      await nextFrame();
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your block' }));
      unmount();
    }
  });

  it('reads `then` as the frame comes, not as Try again goes', async () => {
    render(
      <>
        <h2 id="first">Your classes</h2>
        <h2 id="second">Recent activity</h2>
      </>,
    );
    const button = document.body.appendChild(document.createElement('button'));
    button.focus();
    let then = ['first'];
    handOff(button, () => then);
    then = ['second'];
    button.remove();
    await nextFrame();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Recent activity' }));
  });

  it('does nothing for a button never drawn', () => {
    const frame = vi.fn();
    handOff(null, () => ['block'], document, frame);
    expect(frame).not.toHaveBeenCalled();
  });
});

describe('every read’s Try again in the portal is this one', () => {
  // Not `new URL('../', import.meta.url)`: in jsdom, Vite resolves that against the page's address.
  const src = join(import.meta.dirname, '..');
  /** The portal's own source files under src/, tests left out. */
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
    });
  /** A button of its own saying Try again (JSX's text), or one that says it among its words. */
  const DRAWN = />\s*Try again\s*</;
  const SAID = /'Try again'/;

  it('draws no Try again of its own in a file this step moved onto it', () => {
    for (const file of MOVED) {
      const text = readFileSync(join(src, file), 'utf8');
      expect(text, file).not.toMatch(DRAWN);
      expect(text, file).toMatch(/<TryAgain\b/);
    }
    expect(readFileSync(join(src, 'components/shell.tsx'), 'utf8')).not.toMatch(SAID);
  });

  it('adds none of its own anywhere: none is left', () => {
    const left = sources(src)
      .filter((file) => !file.endsWith(`${sep}try-again.tsx`))
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return DRAWN.test(text) || SAID.test(text);
      })
      .map((file) => relative(src, file).split(sep).join('/'))
      .sort();
    expect(left).toEqual(LEFT);
  });
});

/**
 * Home and Classes whole (the account's card, your classes, the live card, Recent activity, Last
 * session, your block and Register block), the live grid's own line (the class page's and
 * Present's), and the student's home; then the class page's own lines (its class and roster, an
 * extend's), the recap, the student panel, New code's Make new code, Reports, a session's report
 * and its Questions; then a close (the class page's and Present's) and the slides (the slide's line,
 * the card's, Present's and a student's, and a slide change's, Show slides' too); then the rest:
 * the side panel's two lists and an ask (one of your questions, or one written), Your questions (its
 * list and a save) and Your slides (its list and a stopped upload), New class's Create class, the
 * invite code's own button, and a student's lesson.
 */
const MOVED = [
  'app/classes/[id]/page.tsx',
  'components/ask-panel.tsx',
  'components/blocks.tsx',
  'components/classes.tsx',
  'components/decks-panel.tsx',
  'components/home.tsx',
  'components/invite-code.tsx',
  'components/join-code.tsx',
  'components/live-grid.tsx',
  'components/new-class.tsx',
  'components/question-card.tsx',
  'components/recap-card.tsx',
  'components/report-questions.tsx',
  'components/reports-list.tsx',
  'components/saved-questions.tsx',
  'components/session-report.tsx',
  'components/shell.tsx',
  'components/slide-card.tsx',
  'components/slides.tsx',
  'components/student-home.tsx',
  'components/student-lesson.tsx',
  'components/student-panel.tsx',
];

/**
 * The Try agains `TryAgain` doesn't draw: none since the owner's follow-up's part 3 (2026-10-22), so
 * a Try again drawn by hand anywhere in the portal fails the test above.
 */
const LEFT: readonly string[] = [];
