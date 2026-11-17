// @vitest-environment jsdom
import type { BlockDetail } from '@bali/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApiClient, createApiClient } from '@/lib/api-client';
import {
  BLOCK_NOT_REMOVED,
  BLOCK_TAKEN,
  CANT_REACH,
  CANT_REMOVE_BLOCK,
  NOT_A_BLOCK_ID,
} from '@/lib/errors';

import { Blocks } from './blocks';
import { DIALOG_LOCK } from './card';
import { CountContext } from './count';

/*
 * Your block (LO3; Main, HomeIdle, ClassFlows' "Your block, none yet", its other moments on
 * HomeMoments), and since LO11 a lost block's Remove (ClassFlows' "Remove a lost block", its
 * in-between states on RemoveBlockStates), as a teacher meets it (the owner's decision of
 * 2026-10-22: the portal's tests drive the page). Bali's answers come from a stand-in `fetch` under
 * the portal's own client, each held until the test gives it; jsdom has no `showModal` or `close`,
 * nor the browser's Escape on a modal: the stand-ins below do what the browser does, no more.
 */

const bali = vi.hoisted(() => {
  interface Call {
    key: string;
    body: unknown;
    answer: (res: Response) => void;
    fail: (e: Error) => void;
  }
  const calls: Call[] = [];
  const fetch = (url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((answer, fail) => {
      calls.push({
        key: `${init?.method ?? 'GET'} ${(url as string).replace('http://api', '')}`,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
        answer,
        fail,
      });
    });
  return { calls, fetch, client: null as ApiClient | null };
});

vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

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
    getToken: () => 'tok',
    fetchImpl: bali.fetch,
  });
});

afterEach(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  bali.calls.length = 0;
});

const BLOCK: BlockDetail = {
  id: 'b1',
  tagId: 'T7XK2M9QPF',
  createdAt: '2026-10-04T15:00:00.000Z',
};
const NEW_BLOCK: BlockDetail = {
  id: 'b2',
  tagId: 'QW4N8HJR2D',
  createdAt: '2026-11-17T15:00:00.000Z',
};

/** The request on its way now, answered: its JSON with `status`, or no answer at all. */
async function answer(status: number | 'none', body?: unknown) {
  const call = bali.calls.shift();
  if (!call) throw new Error('no request on its way');
  await act(async () => {
    if (status === 'none') call.fail(new TypeError('Failed to fetch'));
    else call.answer(Response.json(body, { status }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return call;
}

/** The request `key` on its way, answered as `answer` answers the next one. */
async function answerTo(key: string, status: number | 'none', body?: unknown) {
  const at = bali.calls.findIndex((c) => c.key === key);
  if (at === -1) throw new Error(`no ${key} on its way`);
  bali.calls.unshift(...bali.calls.splice(at, 1));
  return answer(status, body);
}

/** The line a status says it in, found by its words. */
const statusSaying = (words: string) =>
  screen.getAllByRole('status').find((s) => s.textContent === words);

/** Your block on its page, its list read with `blocks`, the count it sends kept. */
async function opened(blocks: BlockDetail[]) {
  const user = userEvent.setup();
  const count = vi.fn();
  render(
    <CountContext value={count}>
      <main>
        <Blocks />
      </main>
    </CountContext>,
  );
  expect(screen.getByRole('status').textContent).toBe('Loading…');
  await answer(200, { blocks });
  return { user, count };
}

const field = () => screen.getByRole('textbox', { name: 'Block code' });
const button = (name: string) => screen.getByRole('button', { name });

describe('Your block, none yet (ClassFlows)', () => {
  it('says there is none, and offers the field with its help and Register block beside it', async () => {
    await opened([]);
    expect(screen.getByRole('heading', { name: 'Your block' })).toBeDefined();
    expect(
      screen.getByText('Students tap your block with their phone to join your session.'),
    ).toBeDefined();
    expect(screen.getByText('No block registered yet.')).toBeDefined();
    expect(
      screen.getByRole('textbox', { description: '10 letters and digits, written on your block.' }),
    ).toBe(field());
    expect(field().classList).toContain('font-mono');
    const register = button('Register block');
    expect(register.getAttribute('type')).toBe('submit');
    expect(register.classList).toContain('bg-action-primary-bg');
    expect(screen.queryByRole('button', { name: 'Register another block' })).toBeNull();
  });

  it('checks the code before sending it: one that can’t be a block’s is said under the help, focus back in the field', async () => {
    const { user } = await opened([]);
    await user.type(field(), 'QW4N8HJ{Enter}');
    expect(screen.getByRole('alert').textContent).toBe(NOT_A_BLOCK_ID);
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field());
    expect(bali.calls).toEqual([]);
    // Typing again takes the line away.
    await user.type(field(), 'R');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('registers a code, Registering… meanwhile, then says so and lists it, the field kept for another', async () => {
    const { user, count } = await opened([]);
    await user.type(field(), ' qw4n 8hjr2d {Enter}');
    expect(button('Registering…').getAttribute('aria-busy')).toBe('true');
    expect(field()).toHaveProperty('readOnly', true);
    const sent = await answer(201, NEW_BLOCK);
    expect(sent).toMatchObject({ key: 'POST /v1/blocks', body: { tagId: 'QW4N8HJR2D' } });
    expect(statusSaying('QW4N8HJR2D is registered to you.')).toBeDefined();
    expect(screen.getByText('QW4N8HJR2D').getAttribute('translate')).toBe('no');
    expect(screen.queryByText('No block registered yet.')).toBeNull();
    expect(field()).toHaveProperty('value', '');
    expect(button('Register another block').getAttribute('aria-expanded')).toBe('true');
    expect(count).toHaveBeenCalledWith('portal_block_registered');
  });

  it('sends a code once however often it is pressed while Bali hasn’t answered', async () => {
    const { user } = await opened([]);
    await user.type(field(), 'QW4N8HJR2D{Enter}{Enter}');
    await user.click(button('Registering…'));
    expect(bali.calls.map((c) => c.key)).toEqual(['POST /v1/blocks']);
  });

  it('says a code another teacher holds under the help, with the way on', async () => {
    const { user } = await opened([]);
    await user.type(field(), 'QW4N8HJR2D{Enter}');
    await answer(409, { error: { code: 'conflict', message: 'taken' } });
    expect(screen.getByRole('alert').textContent).toBe(BLOCK_TAKEN);
    expect(button('Register block')).toBeDefined();
    expect(document.activeElement).toBe(field());
  });

  it('says an answer that never came, and its Try again sends the same code again', async () => {
    const { user } = await opened([]);
    await user.type(field(), 'QW4N8HJR2D{Enter}');
    await answer('none');
    expect(screen.getByRole('alert').textContent).toBe(CANT_REACH);
    await user.click(button('Try again'));
    const again = await answer(201, NEW_BLOCK);
    expect(again.body).toEqual({ tagId: 'QW4N8HJR2D' });
    expect(statusSaying('QW4N8HJR2D is registered to you.')).toBeDefined();
  });
});

describe('Your block, with one (Main, HomeIdle; HomeMoments)', () => {
  it('lists it with the day it was registered, and Register another block, closed', async () => {
    await opened([BLOCK]);
    const row = screen.getByText('T7XK2M9QPF').closest('li');
    expect(row?.textContent).toMatch(/^T7XK2M9QPFRegistered /);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(button('Register another block').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the field under the list with Register another block, focus in it, and closes it again', async () => {
    const { user } = await opened([BLOCK]);
    const another = button('Register another block');
    await user.click(another);
    expect(another.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field());
    await user.type(field(), 'QW4N');
    await user.click(another);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(another.getAttribute('aria-expanded')).toBe('false');
    // Opened again, it starts afresh.
    await user.click(another);
    expect(field()).toHaveProperty('value', '');
  });

  it('titles the list Your blocks once there are two', async () => {
    const { user } = await opened([BLOCK]);
    await user.click(button('Register another block'));
    await user.type(field(), 'QW4N8HJR2D{Enter}');
    await answer(201, NEW_BLOCK);
    expect(screen.getByRole('heading', { name: 'Your blocks' })).toBeDefined();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('says one already its own as already registered, listed once', async () => {
    const { user } = await opened([BLOCK]);
    await user.click(button('Register another block'));
    await user.type(field(), 'T7XK2M9QPF{Enter}');
    await answer(201, BLOCK);
    expect(statusSaying('T7XK2M9QPF was already registered to you.')).toBeDefined();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('Your block, its list not read (HomeMoments)', () => {
  it('says why with Try again, which reads it again, focus then on its title', async () => {
    const user = userEvent.setup();
    render(
      <main>
        <Blocks />
      </main>,
    );
    await answer('none');
    expect(screen.getByRole('alert').textContent).toBe(`Couldn't load your blocks. ${CANT_REACH}`);
    await user.click(button('Try again'));
    expect(button('Loading…')).toBeDefined();
    await answer(200, { blocks: [BLOCK] });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('T7XK2M9QPF')).toBeDefined();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your block' }));
  });
});

describe('Remove a lost block (LO11; ClassFlows, RemoveBlockStates)', () => {
  const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const confirm = () => screen.getByRole('dialog');
  const inConfirm = (name: string) => within(confirm()).getByRole('button', { name });
  const remove = (tagId: string) => button(`Remove block ${tagId}`);
  /** The removal on its way, answered `outcome` with the block it removed. */
  const removed = (block: BlockDetail, outcome: 'removed' | 'replay' = 'removed') =>
    answerTo(`DELETE /v1/blocks/${block.id}`, 200, { outcome, block });
  /** The line under the list, said once a block is removed: mounted while empty, never the form's. */
  const goneLine = () => screen.getAllByRole('status').find((s) => s.closest('form') === null);
  /** Chrome's second Escape with no click between: a `cancel` that can't be held, then closed. */
  const chromeCloses = () =>
    act(async () => {
      const dialog = confirm() as HTMLDialogElement;
      dialog.dispatchEvent(new Event('cancel'));
      dialog.close();
      await Promise.resolve();
    });

  it('ends each block’s row on Remove, named for its block, with one block as with two', async () => {
    await opened([BLOCK]);
    const row = screen.getByRole('listitem');
    expect(row.textContent).toMatch(/^T7XK2M9QPFRegistered .*Remove$/);
    expect(remove('T7XK2M9QPF').textContent).toBe('Remove');
    expect(remove('T7XK2M9QPF').getAttribute('aria-haspopup')).toBe('dialog');
    expect(within(row).getByRole('button')).toBe(remove('T7XK2M9QPF'));
    // The confirm is there closed: only showModal opens it, so the page behind is inert.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(goneLine()?.textContent).toBe('');
    cleanup();
    bali.calls.length = 0;
    await opened([BLOCK, NEW_BLOCK]);
    expect(remove('T7XK2M9QPF')).toBeDefined();
    expect(remove('QW4N8HJR2D')).toBeDefined();
  });

  it('asks first, naming the block, Cancel focused; Cancel and Escape close it, focus back on its Remove, nothing sent', async () => {
    const { user } = await opened([BLOCK, NEW_BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    expect(confirm().className).toBe(DIALOG_LOCK);
    expect(screen.getByRole('dialog', { name: 'Remove block T7XK2M9QPF?' })).toBe(confirm());
    expect(
      screen.getByRole('dialog', { description: "Students can't tap in with it after this." }),
    ).toBe(confirm());
    expect(within(confirm()).getByRole('heading').className).toBe('text-panel-title');
    expect(confirm().textContent).toBe(
      "Remove block T7XK2M9QPF?Students can't tap in with it after this.CancelRemove block",
    );
    expect(within(confirm()).getByText('T7XK2M9QPF').getAttribute('translate')).toBe('no');
    expect(document.activeElement).toBe(inConfirm('Cancel'));

    await user.click(inConfirm('Cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(remove('T7XK2M9QPF'));
    await user.click(remove('QW4N8HJR2D'));
    expect(screen.getByRole('dialog', { name: 'Remove block QW4N8HJR2D?' })).toBeDefined();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(remove('QW4N8HJR2D'));
    expect(bali.calls).toEqual([]);
  });

  it('removes it: Removing…, Cancel and Escape held; then the row goes, said under the list, focus on the next block’s Remove', async () => {
    const { user, count } = await opened([BLOCK, NEW_BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    expect(inConfirm('Removing…').getAttribute('aria-busy')).toBe('true');
    expect(inConfirm('Cancel').getAttribute('aria-disabled')).toBe('true');
    await user.click(inConfirm('Cancel'));
    await user.keyboard('{Escape}');
    expect(confirm()).toBeDefined();

    const sent = await removed(BLOCK);
    expect(sent.body).toEqual({ eventId: expect.stringMatching(UUID_V7) as string });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('T7XK2M9QPF')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Your block' })).toBeDefined();
    expect(goneLine()?.textContent).toBe('T7XK2M9QPF is no longer registered to you.');
    expect(document.activeElement).toBe(remove('QW4N8HJR2D'));
    // Nothing else sent: no read again, and no count (PORTAL_EVENTS names no removal).
    expect(bali.calls).toEqual([]);
    expect(count).not.toHaveBeenCalled();
  });

  it('removes the last one: none yet with the field, the line under it, focus on the title', async () => {
    const { user } = await opened([BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    await removed(BLOCK);
    expect(screen.getByText('No block registered yet.')).toBeDefined();
    expect(goneLine()?.textContent).toBe('T7XK2M9QPF is no longer registered to you.');
    expect(field()).toHaveProperty('value', '');
    expect(screen.queryByRole('button', { name: 'Register another block' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Your block' }));
  });

  it('says one removed already, from another tab, the same way, focus on the block before when the last row goes', async () => {
    const { user } = await opened([BLOCK, NEW_BLOCK]);
    await user.click(remove('QW4N8HJR2D'));
    await user.click(inConfirm('Remove block'));
    await removed(NEW_BLOCK, 'replay');
    expect(screen.queryByText('QW4N8HJR2D')).toBeNull();
    expect(goneLine()?.textContent).toBe('QW4N8HJR2D is no longer registered to you.');
    expect(document.activeElement).toBe(remove('T7XK2M9QPF'));
  });

  it('sends a removal once however often it is pressed while Bali hasn’t answered', async () => {
    const { user } = await opened([BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    await user.click(inConfirm('Removing…'));
    await user.keyboard('{Enter}');
    expect(bali.calls.map((c) => c.key)).toEqual(['DELETE /v1/blocks/b1']);
  });

  it('says an answer that never came in the dialog; Try again sends the same removal again, under its id', async () => {
    const { user } = await opened([BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    const first = await answer('none');
    expect(within(confirm()).getByRole('alert').textContent).toBe(CANT_REACH);
    expect(screen.getByText('T7XK2M9QPF', { ignore: 'dialog *' })).toBeDefined();
    await user.click(inConfirm('Try again'));
    expect(inConfirm('Removing…')).toBeDefined();
    expect(within(confirm()).queryByRole('alert')).toBeNull();
    // Bali's own failure, said the same way.
    const second = await answer(500, { error: { code: 'internal', message: 'internal error' } });
    expect(within(confirm()).getByRole('alert').textContent).toBe(CANT_REMOVE_BLOCK);
    await user.click(inConfirm('Try again'));
    const third = await removed(BLOCK, 'replay');
    expect([second.body, third.body]).toEqual([first.body, first.body]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(goneLine()?.textContent).toBe('T7XK2M9QPF is no longer registered to you.');
  });

  it('says a refusal in the dialog, Remove block kept, which sends it anew under a fresh id', async () => {
    const { user } = await opened([BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    const first = await answer(403, { error: { code: 'forbidden', message: 'not your block' } });
    expect(within(confirm()).getByRole('alert').textContent).toBe(BLOCK_NOT_REMOVED);
    expect(within(confirm()).queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByText('T7XK2M9QPF', { ignore: 'dialog *' })).toBeDefined();
    await user.click(inConfirm('Remove block'));
    const second = await removed(BLOCK);
    expect(second.body).not.toEqual(first.body);
    expect(screen.queryByText('T7XK2M9QPF')).toBeNull();
  });

  it('closed on an answer that never came, reads the blocks again: one removed after all leaves the list, said', async () => {
    const { user } = await opened([BLOCK, NEW_BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    await answer('none');
    await user.click(inConfirm('Cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(remove('T7XK2M9QPF'));
    expect(bali.calls.map((c) => c.key)).toEqual(['GET /v1/blocks']);
    await answer(200, { blocks: [NEW_BLOCK] });
    expect(screen.queryByText('T7XK2M9QPF')).toBeNull();
    expect(goneLine()?.textContent).toBe('T7XK2M9QPF is no longer registered to you.');
    expect(document.activeElement).toBe(remove('QW4N8HJR2D'));
  });

  it('closed on an answer that never came, keeps a block Bali still holds, and its next Remove goes under the lost id', async () => {
    const { user } = await opened([BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    const lost = await answer('none');
    await user.keyboard('{Escape}');
    await answer(200, { blocks: [BLOCK] });
    expect(screen.getByText('T7XK2M9QPF')).toBeDefined();
    expect(goneLine()?.textContent).toBe('');
    expect(document.activeElement).toBe(remove('T7XK2M9QPF'));
    await user.click(remove('T7XK2M9QPF'));
    expect(within(confirm()).queryByRole('alert')).toBeNull();
    await user.click(inConfirm('Remove block'));
    const again = await removed(BLOCK, 'replay');
    expect(again.body).toEqual(lost.body);
  });

  it('closed by Chrome’s second Escape while Removing…, opens again to say a failure', async () => {
    const { user } = await opened([BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    await chromeCloses();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(remove('T7XK2M9QPF'));
    // Held until Bali answers: another confirm can't open over this removal.
    expect(remove('T7XK2M9QPF').getAttribute('aria-disabled')).toBe('true');
    await user.click(remove('T7XK2M9QPF'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await answer('none');
    expect(within(confirm()).getByRole('alert').textContent).toBe(CANT_REACH);
    expect(inConfirm('Try again')).toBeDefined();
    expect(remove('T7XK2M9QPF').getAttribute('aria-disabled')).toBe('false');
  });

  it('closed by Chrome’s second Escape while Removing…, a removal that lands takes the row, focus on the next', async () => {
    const { user } = await opened([BLOCK, NEW_BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    await chromeCloses();
    await removed(BLOCK);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('T7XK2M9QPF')).toBeNull();
    expect(goneLine()?.textContent).toBe('T7XK2M9QPF is no longer registered to you.');
    expect(document.activeElement).toBe(remove('QW4N8HJR2D'));
  });

  it('never brings a removed block back with a register answered after the removal', async () => {
    const { user } = await opened([BLOCK]);
    await user.click(button('Register another block'));
    await user.type(field(), 'QW4N8HJR2D{Enter}');
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    await removed(BLOCK);
    await answerTo('POST /v1/blocks', 201, NEW_BLOCK);
    expect(screen.queryByText('T7XK2M9QPF')).toBeNull();
    expect(screen.getAllByRole('listitem').map((li) => li.firstChild?.textContent)).toEqual([
      'QW4N8HJR2D',
    ]);
  });

  it('takes back a line saying a block is registered once that block is removed, and keeps another’s', async () => {
    const { user } = await opened([BLOCK]);
    await user.click(button('Register another block'));
    await user.type(field(), 'QW4N8HJR2D{Enter}');
    await answer(201, NEW_BLOCK);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    await removed(BLOCK);
    expect(statusSaying('QW4N8HJR2D is registered to you.')).toBeDefined();
    await user.click(remove('QW4N8HJR2D'));
    await user.click(inConfirm('Remove block'));
    await removed(NEW_BLOCK);
    expect(screen.queryByText('QW4N8HJR2D is registered to you.')).toBeNull();
    expect(goneLine()?.textContent).toBe('QW4N8HJR2D is no longer registered to you.');
  });

  it('keeps the line under the list until the section’s next action', async () => {
    const { user } = await opened([BLOCK, NEW_BLOCK]);
    await user.click(remove('T7XK2M9QPF'));
    await user.click(inConfirm('Remove block'));
    await removed(BLOCK);
    expect(goneLine()?.textContent).toBe('T7XK2M9QPF is no longer registered to you.');
    await user.click(button('Register another block'));
    expect(goneLine()?.textContent).toBe('');
  });
});
