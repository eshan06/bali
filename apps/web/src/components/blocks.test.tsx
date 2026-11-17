// @vitest-environment jsdom
import type { BlockDetail } from '@bali/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApiClient, createApiClient } from '@/lib/api-client';
import { BLOCK_TAKEN, CANT_REACH, NOT_A_BLOCK_ID } from '@/lib/errors';

import { Blocks } from './blocks';
import { CountContext } from './count';

/*
 * Your block (LO3; Main, HomeIdle, ClassFlows' "Your block, none yet", its other moments on
 * HomeMoments), as a teacher meets it (the owner's decision of 2026-10-22: the portal's tests drive
 * the page). Bali's answers come from a stand-in `fetch` under the portal's own client, each held
 * until the test gives it.
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
    expect(screen.getByRole('status').textContent).toBe('QW4N8HJR2D is registered to you.');
    expect(screen.getByText('QW4N8HJR2D').getAttribute('translate')).toBe('no');
    expect(screen.queryByText('No block registered yet.')).toBeNull();
    expect(field()).toHaveProperty('value', '');
    expect(button('Register another block').getAttribute('aria-expanded')).toBe('true');
    expect(count).toHaveBeenCalledWith('portal_block_registered');
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
    expect(screen.getByRole('status').textContent).toBe('QW4N8HJR2D is registered to you.');
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
    expect(screen.getByRole('status').textContent).toBe(
      'T7XK2M9QPF was already registered to you.',
    );
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
