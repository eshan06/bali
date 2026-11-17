// @vitest-environment jsdom
import type { ClassDetail } from '@bali/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DIALOG_LOCK } from '@/components/card';
import { type ApiClient, createApiClient } from '@/lib/api-client';
import { CANT_COPY, CANT_REACH, NEW_CODE_MADE } from '@/lib/errors';

import { JoinCode } from './join-code';

/*
 * The join code before a session (LO4; ClassPage, ClassStates' Add students), as a teacher meets
 * it (the portal's tests drive the page, the owner, 2026-10-22): the code in its well, its line,
 * Copy code and New code; Copy code's answer (CopyStates); New code's confirm, a dialog (ClassFlows'
 * New code), and the new code in the old one's place. Converted from `join-code.test.ts`'s source
 * text. Bali's answers come from a stand-in `fetch`, each held for the test to give; jsdom has no
 * `showModal` or `close`, nor the browser's Escape on a modal: the stand-ins below do what the
 * browser does, no more.
 */

const bali = vi.hoisted(() => {
  /** One request on its way: what was sent, and its answer, the test's to give. */
  interface Call {
    key: string;
    answer: (res: Response) => void;
    fail: () => void;
  }
  const calls: Call[] = [];
  const fetch = (url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((answer, reject) => {
      const fail = () => reject(new TypeError('Failed to fetch'));
      init?.signal?.addEventListener('abort', fail);
      calls.push({
        key: `${init?.method ?? 'GET'} ${(url as string).replace('http://api', '')}`,
        answer,
        fail,
      });
    });
  return { calls, fetch, client: null as ApiClient | null };
});

vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

const KLASS: ClassDetail = {
  id: '019a0000-0000-7000-8000-0000000000c1',
  name: 'Biology, period 3',
  joinCode: 'VMAF7E',
  createdAt: '2026-09-01T14:00:00.000Z',
  liveSessionId: null,
};

/** The class page, as far as the join code needs it: the class, its code as Bali last gave it. */
function Page() {
  const [klass, setKlass] = useState(KLASS);
  return (
    <main>
      <JoinCode classId={klass.id} code={klass.joinCode} onClass={setKlass} />
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
const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.addEventListener('keydown', escape);
});
afterAll(() => {
  document.removeEventListener('keydown', escape);
  for (const [name, was] of [
    ['showModal', showModal],
    ['close', close],
  ] as const) {
    if (was) Object.defineProperty(HTMLDialogElement.prototype, name, was);
    else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>)[name];
  }
});

beforeEach(() => {
  bali.client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'token',
    fetchImpl: bali.fetch,
  });
});
afterEach(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  bali.calls.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const button = (name: string) => screen.getByRole('button', { name });
/** The code as it shows in its well, never the dialog's line naming it. */
const code = () => screen.getByText(/^[A-Z0-9]{6}$/, { ignore: 'dialog *' });
const confirm = () => screen.getByRole('dialog', { name: 'Make a new code?' });
const inConfirm = (name: string) => within(confirm()).getByRole('button', { name });
/** The request on its way now, answered with `body` (or no answer at all), what it set off drawn. */
async function answer(key: string, body: unknown) {
  const call = bali.calls.find((c) => c.key === key);
  if (!call) throw new Error(`no ${key} on its way`);
  bali.calls.splice(bali.calls.indexOf(call), 1);
  await act(async () => {
    if (body === null) call.fail();
    else call.answer(Response.json(body));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const MINT = `PATCH /v1/classes/${KLASS.id}`;
const READ = `GET /v1/classes/${KLASS.id}`;

describe('the join code before a session (ClassPage, ClassStates)', () => {
  it('shows the code in its well, selectable whole, its line, then Copy code and New code', () => {
    render(<Page />);
    expect(code().textContent).toBe('VMAF7E');
    expect(code().getAttribute('translate')).toBe('no');
    expect(code().className).toMatch(/\bselect-all\b/);
    expect(code().className).toMatch(/\btext-code-well\b/);
    expect(
      screen.getByText('New students type it in the Bali app to join this class.'),
    ).toBeDefined();
    expect(button('Copy code').querySelector('.lucide-copy')).not.toBeNull();
    expect(button('New code').getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByRole('alert')).toBeNull();
    // New code's confirm is there closed: only showModal opens it, so the page behind is inert.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says Copied for a few seconds, a screen reader told too; refused, how to copy it by hand', async () => {
    // userEvent's clipboard stand-in, then this computer's clock, the test's to move.
    userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    vi.useFakeTimers();
    render(<Page />);
    fireEvent.click(button('Copy code'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(write).toHaveBeenCalledWith('VMAF7E');
    expect(button('Copied').querySelector('.lucide-check')).not.toBeNull();
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain('Copied');
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(button('Copy code')).toBeDefined();

    write.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(button('Copy code'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('alert').textContent).toBe(CANT_COPY);
    // The code is still there to select.
    expect(code().textContent).toBe('VMAF7E');
  });
});

describe('New code’s confirm, a dialog (ClassFlows)', () => {
  it('asks first, Cancel focused, naming the code it ends; Cancel and Escape close it, focus back on New code', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(button('New code'));
    expect(confirm().className).toBe(DIALOG_LOCK);
    expect(screen.getByRole('dialog', { description: 'VMAF7E stops working right away.' })).toBe(
      confirm(),
    );
    expect(within(confirm()).getByRole('heading', { name: 'Make a new code?' }).className).toBe(
      'text-panel-title',
    );
    expect(confirm().textContent).toBe(
      'Make a new code?VMAF7E stops working right away.CancelMake new code',
    );
    expect(document.activeElement).toBe(inConfirm('Cancel'));

    await user.click(inConfirm('Cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button('New code'));
    await user.click(button('New code'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button('New code'));
    expect(bali.calls).toEqual([]);
  });

  it('makes the new code: Making…, Cancel and Escape held; then the code in its place, said, focus on New code', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(button('New code'));
    await user.click(inConfirm('Make new code'));
    const making = inConfirm('Making…');
    expect(making.getAttribute('aria-busy')).toBe('true');
    expect(inConfirm('Cancel').getAttribute('aria-disabled')).toBe('true');
    await user.keyboard('{Escape}');
    expect(confirm()).toBeDefined();

    await answer(MINT, { ...KLASS, joinCode: 'K7M2PQ' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(code().textContent).toBe('K7M2PQ');
    expect(screen.getByText(NEW_CODE_MADE).getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(button('New code'));
  });

  it('says a mint with no answer in the dialog, Try again sending it again; cancelled, the class read once more', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(button('New code'));
    await user.click(inConfirm('Make new code'));
    // No answer: the class is read again, its code unmoved, so the failure is said.
    await answer(MINT, null);
    await answer(READ, KLASS);
    expect(within(confirm()).getByRole('alert').textContent).toBe(CANT_REACH);
    await user.click(inConfirm('Try again'));
    expect(bali.calls.map((c) => c.key)).toEqual([MINT]);
    await answer(MINT, null);
    await answer(READ, KLASS);

    // Cancelled now: a mint may yet land after the read, so the class is read once more; one that
    // did is shown, said.
    await user.click(inConfirm('Cancel'));
    expect(document.activeElement).toBe(button('New code'));
    await answer(READ, { ...KLASS, joinCode: 'Q5FU3U' });
    expect(code().textContent).toBe('Q5FU3U');
    expect(screen.getByText(NEW_CODE_MADE)).toBeDefined();
  });
});
