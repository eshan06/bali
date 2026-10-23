// @vitest-environment jsdom
import type { ClassDetail } from '@bali/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useRef } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApiClient, createApiClient, SAVE_TIMEOUT_MS } from '@/lib/api-client';
import { ACCOUNT_DELETED, CANT_COPY, CANT_CREATE, CANT_REACH } from '@/lib/errors';
import { captureApiFailure } from '@/lib/monitoring';

import { DIALOG } from './join-code';
import { cardId, NewClass, type NewClassHandle } from './new-class';

/*
 * New class (PV16b) as a teacher meets it (the owner's decision of 2026-10-22: the portal's tests
 * drive the page): v2's dialog (ClassesNew), its states as ClassesStates draws them, and once Bali
 * makes the class, "<name> is ready" with its join code, Copy code and Done (ClassesCreated,
 * CopyStates). Bali's answers come from a stand-in `fetch` under the portal's own API client, so
 * a create's time limit and its `eventId` are the ones the page really sends (2026-10-23): one
 * create, one id, sent again by every press while no answer has come, a new one for the next.
 *
 * jsdom draws a `<dialog>` but has no `showModal` or `close`, nor the browser's Escape on a modal:
 * the stand-ins below do what the browser does, no more.
 */

const bali = vi.hoisted(() => {
  /** One request on its way: what was sent, and its answer, the test's to give. */
  interface Call {
    method: string;
    path: string;
    body: Record<string, unknown>;
    answer: (res: Response) => void;
  }
  const calls: Call[] = [];
  /** `fetch`, its answers held: each request waits until the test answers it, or its limit. */
  const fetch = (url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((answer, fail) => {
      init?.signal?.addEventListener('abort', () =>
        fail(new DOMException('The operation was aborted.', 'AbortError')),
      );
      calls.push({
        method: init?.method ?? 'GET',
        path: (url as string).replace('http://api', ''),
        body: JSON.parse((init?.body as string | undefined) ?? '{}') as Record<string, unknown>,
        answer,
      });
    });
  return { calls, fetch, client: null as ApiClient | null };
});

vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

const KLASS: ClassDetail = {
  id: '019a0000-0000-7000-8000-0000000000c1',
  name: 'Period 4 Biology',
  joinCode: 'Q5FU3U',
  createdAt: '2026-10-23T14:00:00.000Z',
  liveSessionId: null,
};

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Classes, as far as New class needs it: its New class, and the list's cards once read. */
function Page({ onAnswer, cards = [] }: { onAnswer: () => void; cards?: string[] }) {
  const dialog = useRef<NewClassHandle>(null);
  return (
    <main>
      <h1>Classes</h1>
      <button type="button" onClick={() => dialog.current?.open()}>
        New class
      </button>
      {cards.map((id) => (
        <a key={id} id={cardId(id)} href={`/classes/${id}`}>
          A class
        </a>
      ))}
      <NewClass ref={dialog} onAnswer={onAnswer} />
    </main>
  );
}

/** The browser's Escape on an open modal: `cancel`, then closed unless that was prevented. */
function escape(e: KeyboardEvent) {
  const open = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (e.key !== 'Escape' || !open) return;
  const cancel = new Event('cancel', { cancelable: true });
  open.dispatchEvent(cancel);
  if (!cancel.defaultPrevented) open.close();
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.addEventListener('keydown', escape);
});

afterAll(() => {
  document.removeEventListener('keydown', escape);
});

beforeEach(() => {
  bali.client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'tok',
    fetchImpl: bali.fetch,
  });
});

afterEach(() => {
  // Focus off first, so no Try again unmounted here hands focus on in the next test's page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  vi.useRealTimers();
  bali.calls.length = 0;
  vi.mocked(captureApiFailure).mockClear();
});

/** The request on its way now, answered: its JSON with `status`, what it set off drawn. */
async function answer(status: number, body: unknown) {
  const call = bali.calls.at(-1);
  if (!call) throw new Error('no request on its way');
  await act(async () => {
    call.answer(Response.json(body, { status }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** A refusal in the API's one error shape. */
const refusal = (code: string, reason?: string) => ({
  error: { code, message: 'written for a log', ...(reason && { reason }) },
});

const dialog = () => document.querySelector('dialog')!;
const field = () => screen.getByRole('textbox', { name: 'Class name' });
const button = (name: string) => screen.getByRole('button', { name });
const sent = () => bali.calls.map((c) => c.body);

/** Classes open, New class pressed and `name` typed. */
async function opened(name = '', onAnswer = vi.fn(), cards: string[] = []) {
  const user = userEvent.setup();
  const page = render(<Page onAnswer={onAnswer} cards={cards} />);
  await user.click(button('New class'));
  if (name) await user.type(field(), name);
  return { user, onAnswer, page };
}

describe('New class, the dialog (ClassesNew)', () => {
  it('opens as the class page’s dialog, titled New class, the name focused and its help under it', async () => {
    const user = userEvent.setup();
    render(<Page onAnswer={vi.fn()} />);
    // Drawn closed, as the page holds it, until New class opens it as a modal.
    expect(dialog().open).toBe(false);
    await user.click(button('New class'));
    expect(dialog().open).toBe(true);
    expect(screen.getByRole('dialog', { name: 'New class' })).toBe(dialog());
    // v2's dialog, the class page's New code's own: 460 px, 120 px down, over the warm backdrop.
    expect(dialog().className).toBe(DIALOG);
    expect(document.activeElement).toBe(field());
    expect(field()).toHaveProperty('maxLength', 120);
    expect(
      screen.getByRole('textbox', { description: 'Your students see this name in the Bali app.' }),
    ).toBe(field());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('holds Create class until a name is typed: Enter, or the button, sends nothing', async () => {
    const { user } = await opened();
    expect(button('Create class').getAttribute('aria-disabled')).toBe('true');
    await user.keyboard('{Enter}');
    await user.type(field(), '   {Enter}');
    expect(bali.calls).toEqual([]);
    await user.type(field(), 'P');
    expect(button('Create class').getAttribute('aria-disabled')).toBe('false');
  });

  it('sends the name under one eventId and holds the name, Cancel and Escape while Creating…', async () => {
    const { user, onAnswer } = await opened('Period 4 Biology ');
    await user.keyboard('{Enter}');
    expect(bali.calls).toHaveLength(1);
    expect(bali.calls[0]).toMatchObject({ method: 'POST', path: '/v1/classes' });
    expect(sent()[0]).toEqual({
      name: 'Period 4 Biology',
      eventId: expect.stringMatching(UUID_V7) as string,
    });
    const creating = button('Creating…');
    expect(creating.getAttribute('aria-busy')).toBe('true');
    expect(field()).toHaveProperty('readOnly', true);
    // A second press, Cancel and Escape: nothing sent, the dialog kept.
    await user.click(creating);
    await user.click(button('Cancel'));
    await user.keyboard('{Escape}');
    expect(button('Cancel').getAttribute('aria-disabled')).toBe('true');
    expect(dialog().open).toBe(true);
    expect(bali.calls).toHaveLength(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe('a class made: "<name> is ready" (ClassesCreated, CopyStates)', () => {
  it('turns the dialog into its join code with Copy code and Done, its title focused, the list read again', async () => {
    const { user, onAnswer } = await opened('Period 4 Biology');
    await user.keyboard('{Enter}');
    await answer(200, KLASS);
    const title = screen.getByRole('heading', { name: 'Period 4 Biology is ready' });
    expect(document.activeElement).toBe(title);
    expect(screen.getByRole('dialog', { name: 'Period 4 Biology is ready' })).toBe(dialog());
    expect(
      screen.getByRole('dialog', {
        description: 'Put this join code on the board. Students join with it in the Bali app.',
      }),
    ).toBe(dialog());
    expect(screen.getByText('Q5FU3U').getAttribute('translate')).toBe('no');
    expect(button('Copy code')).toBeDefined();
    expect(button('Done')).toBeDefined();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('copies the code, saying Copied, or, with no clipboard, how to copy it by hand', async () => {
    const { user } = await opened('Period 4 Biology');
    await user.keyboard('{Enter}');
    await answer(200, KLASS);
    await user.click(button('Copy code'));
    expect(await navigator.clipboard.readText()).toBe('Q5FU3U');
    expect(button('Copied')).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('Copied');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await user.click(button('Copied'));
    expect(screen.getByRole('alert').textContent).toBe(CANT_COPY);
  });

  it('closes with Done, focus on the class’s card, and the next New class starts afresh under a new eventId', async () => {
    const { user } = await opened('Period 4 Biology', vi.fn(), [KLASS.id]);
    await user.keyboard('{Enter}');
    await answer(200, KLASS);
    await user.click(button('Done'));
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(document.getElementById(cardId(KLASS.id)));
    await user.click(button('New class'));
    expect(field()).toHaveProperty('value', '');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(field(), 'Period 5{Enter}');
    const [first, next] = sent();
    expect(next).toEqual({ name: 'Period 5', eventId: expect.stringMatching(UUID_V7) as string });
    expect(next?.eventId).not.toBe(first?.eventId);
  });
});

describe('a create with no answer, or refused (ClassesStates)', () => {
  it('says Couldn’t reach Bali once a save’s 10 s pass with no answer; Try again sends it again under its eventId, focus kept on it, and is answered with the class', async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    render(<Page onAnswer={onAnswer} />);
    fireEvent.click(button('New class'));
    fireEvent.change(field(), { target: { value: 'Period 4 Biology' } });
    const create = button('Create class');
    create.focus();
    fireEvent.click(create);
    await act(() => vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS - 1));
    expect(button('Creating…')).toBe(create);
    expect(screen.queryByRole('alert')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1));
    // Under the help, the field described by it, as ClassesStates draws "No answer at all".
    expect(screen.getByRole('alert').textContent).toBe(CANT_REACH);
    expect(
      screen.getByRole('textbox', {
        description: `Your students see this name in the Bali app. ${CANT_REACH}`,
      }),
    ).toBe(field());
    expect(button('Try again')).toBe(create);
    expect(document.activeElement).toBe(create);
    expect(captureApiFailure).toHaveBeenCalledWith('POST', '/v1/classes', 'network');
    expect(onAnswer).toHaveBeenCalledTimes(1);

    fireEvent.click(create);
    expect(button('Creating…')).toBe(create);
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toEqual(sent()[0]);
    await act(async () => {
      bali.calls[1]?.answer(Response.json(KLASS));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Period 4 Biology is ready' }),
    );
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('says a 5xx in its own words with Try again; a name changed since still goes under that eventId, so a create that landed is answered with its class, never a second', async () => {
    const { user } = await opened('Period 4 Biology');
    await user.keyboard('{Enter}');
    await answer(503, refusal('unavailable'));
    expect(screen.getByRole('alert').textContent).toBe(CANT_CREATE);
    expect(button('Try again')).toBeDefined();
    // Typing again takes the line away, and the button says Create class again.
    await user.clear(field());
    await user.type(field(), 'Period 4 Bio');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(button('Create class'));
    expect(sent()[1]).toEqual({ name: 'Period 4 Bio', eventId: sent()[0]?.eventId });
    // The first had landed: its resend is answered with that class, as Bali holds it.
    await answer(200, KLASS);
    expect(screen.getByRole('heading', { name: 'Period 4 Biology is ready' })).toBeDefined();
  });

  it('says a refusal with no Try again, and the next press is a new create, under a new eventId', async () => {
    const { user } = await opened('Period 4 Biology');
    await user.keyboard('{Enter}');
    await answer(409, refusal('conflict', 'account_deleted'));
    expect(screen.getByRole('alert').textContent).toBe(ACCOUNT_DELETED);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    await user.click(button('Create class'));
    expect(sent()).toHaveLength(2);
    expect(sent()[1]?.eventId).toMatch(UUID_V7);
    expect(sent()[1]?.eventId).not.toBe(sent()[0]?.eventId);
  });

  it('closed after no answer, the next New class goes under a new eventId', async () => {
    const { user } = await opened('Period 4 Biology');
    await user.keyboard('{Enter}');
    await answer(500, refusal('internal'));
    await user.click(button('Cancel'));
    expect(dialog().open).toBe(false);
    await user.click(button('New class'));
    expect(field()).toHaveProperty('value', '');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(field(), 'Period 4 Biology{Enter}');
    expect(sent()[1]?.eventId).not.toBe(sent()[0]?.eventId);
  });

  it('opens again to say its answer when the browser closed it during the create (a second Escape)', async () => {
    const { user } = await opened('Period 4 Biology');
    await user.keyboard('{Enter}');
    // Chrome lets a second Escape close a modal whose cancel was prevented.
    act(() => dialog().close());
    expect(dialog().open).toBe(false);
    await answer(200, KLASS);
    expect(dialog().open).toBe(true);
    expect(screen.getByRole('heading', { name: 'Period 4 Biology is ready' })).toBeDefined();
  });
});
