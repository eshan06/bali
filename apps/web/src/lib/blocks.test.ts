import type { BlockDetail } from '@bali/shared';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient, NetworkError, SAVE_TIMEOUT_MS } from './api-client';
import { blockIdOf, loadProblem, registerBlock } from './blocks';
import {
  ACCOUNT_DELETED,
  BLOCK_TAKEN,
  CANT_REACH,
  CANT_REGISTER,
  NOT_A_BLOCK_ID,
  TOO_MANY_TRIES,
  TOO_MANY_TRIES_MINUTE,
} from './errors';

describe('blockIdOf', () => {
  it('takes the ten letters and digits written on a block, in any case and spacing, upper case', () => {
    for (const typed of ['T7XK2M9QPF', 't7xk2m9qpf', '  T7XK2 M9QPF\n', 'T7XK2\tM9QPF']) {
      expect(blockIdOf(typed), typed).toBe('T7XK2M9QPF');
    }
  });

  it('refuses anything else, as the phone refuses a tag that holds no ID', () => {
    for (const typed of [
      '',
      '   ',
      'T7XK2M9QP',
      'T7XK2M9QPFX',
      'T7XK2-M9QPF',
      'T7XK2M9QPÉ',
      'DEVICE-CHECK-1',
    ]) {
      expect(blockIdOf(typed), typed).toBeNull();
    }
  });
});

describe('registerBlock', () => {
  const block: BlockDetail = {
    id: 'b1',
    tagId: 'T7XK2M9QPF',
    createdAt: '2026-10-04T08:00:00.000Z',
  };

  function api(status: number, body: unknown, headers: Record<string, string> = {}) {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: (url, init) => {
        sent.push({ url: url as string, init });
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json', ...headers },
          }),
        );
      },
    });
    return { client, sent };
  }

  it('sends the ID and answers with the block, new or the teacher’s already', async () => {
    const { client, sent } = api(200, block);
    expect(await registerBlock(client, 'T7XK2M9QPF', [])).toEqual({
      kind: 'registered',
      block,
      already: false,
    });
    expect(sent[0]?.url).toBe('http://api/v1/blocks');
    expect(sent[0]?.init?.method).toBe('POST');
    expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({ tagId: 'T7XK2M9QPF' });
    // A re-type of their own block, or the retry of a lost answer: the same block back.
    expect(await registerBlock(client, 'T7XK2M9QPF', [block])).toEqual({
      kind: 'registered',
      block,
      already: true,
    });
  });

  it('says another teacher’s block and an ID the API refuses in their words, never its log line', async () => {
    const taken = api(409, {
      error: { code: 'conflict', message: 'that tag is already registered' },
    });
    expect(await registerBlock(taken.client, 'T7XK2M9QPF', [])).toEqual({
      kind: 'refused',
      message: BLOCK_TAKEN,
    });
    // An account deleted on its way: the ID is fine, so it is no refusal of the ID (PB3's review),
    // and final, so nothing offers to send it again (PB5's review).
    const gone = api(409, {
      error: { code: 'conflict', reason: 'account_deleted', message: 'this account was deleted' },
    });
    expect(await registerBlock(gone.client, 'T7XK2M9QPF', [])).toEqual({
      kind: 'final',
      message: ACCOUNT_DELETED,
    });
    const bad = api(400, { error: { code: 'bad_input', message: 'invalid request' } });
    expect(await registerBlock(bad.client, 'T7XK2M9QPF', [])).toEqual({
      kind: 'refused',
      message: NOT_A_BLOCK_ID,
    });
  });

  it('sends a teacher whose ID is taken back to the ID itself, the Classes home design’s words (PB3)', () => {
    // Nothing moves a block between teachers today, so no one can be asked to move it.
    expect(BLOCK_TAKEN).toBe(
      'That block is registered to another teacher. Check the ID against the one written on your block.',
    );
    expect(BLOCK_TAKEN).not.toMatch(/[—–!]|move it/);
  });

  it('keeps an answer that never came, a timeout, a server error or the budget’s 429, to try again', async () => {
    const unreachable = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () => Promise.reject(new Error('offline')),
    });
    expect(await registerBlock(unreachable, 'T7XK2M9QPF', [])).toEqual({
      kind: 'failed',
      message: CANT_REACH,
    });
    const busy = api(429, { error: { code: 'rate_limited', message: 'too many requests' } });
    expect(await registerBlock(busy.client, 'T7XK2M9QPF', [])).toEqual({
      kind: 'failed',
      message: TOO_MANY_TRIES,
    });
    const spent = api(
      429,
      { error: { code: 'rate_limited', message: 'too many requests' } },
      { 'retry-after': '60' },
    );
    expect(await registerBlock(spent.client, 'T7XK2M9QPF', [])).toEqual({
      kind: 'failed',
      message: TOO_MANY_TRIES_MINUTE,
    });
    for (const status of [500, 503, 408]) {
      const broken = api(status, { error: { code: 'internal', message: 'internal error' } });
      expect(await registerBlock(broken.client, 'T7XK2M9QPF', []), String(status)).toEqual({
        kind: 'failed',
        message: CANT_REGISTER,
      });
    }
  });

  it('answers whatever is thrown, so the form never sticks on Registering… (PR #203 review)', async () => {
    // A 200 whose body isn't JSON (a proxy's HTML page): `res.json()` throws a SyntaxError,
    // neither a NetworkError nor an ApiError. It must still come back as an answer to retry.
    const html = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () => Promise.resolve(new Response('<html>gateway</html>', { status: 200 })),
    });
    expect(await registerBlock(html, 'T7XK2M9QPF', [])).toEqual({
      kind: 'failed',
      message: CANT_REGISTER,
    });
    // Any other refusal says nothing written for a log either.
    const other = api(403, { error: { code: 'forbidden', message: 'teacher access required' } });
    expect(await registerBlock(other.client, 'T7XK2M9QPF', [])).toEqual({
      kind: 'failed',
      message: CANT_REGISTER,
    });
  });

  it('fails a register the network swallows at SAVE_TIMEOUT_MS; Try again sends the same tag, the same block back (the owner, 2026-10-16)', async () => {
    // The route takes no `eventId`: it is idempotent on the tag, so a resend is never a second block.
    vi.useFakeTimers();
    try {
      const sent: unknown[] = [];
      const client = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        fetchImpl: (_url, init) => {
          sent.push(JSON.parse(init?.body as string));
          if (sent.length > 1) return Promise.resolve(Response.json(block));
          return new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          });
        },
      });
      const first = registerBlock(client, 'T7XK2M9QPF', []);
      const settled = vi.fn();
      void first.then(settled);
      await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await first).toEqual({ kind: 'failed', message: CANT_REACH });
      expect(await registerBlock(client, 'T7XK2M9QPF', [])).toEqual({
        kind: 'registered',
        block,
        already: false,
      });
      expect(sent).toEqual([{ tagId: 'T7XK2M9QPF' }, { tagId: 'T7XK2M9QPF' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('loadProblem', () => {
  it('says the connection and the wait in their words, and no log line', () => {
    expect(loadProblem(new NetworkError())).toBe(CANT_REACH);
    expect(loadProblem(new ApiError(429, 'rate_limited', 'too many requests'))).toBe(
      TOO_MANY_TRIES,
    );
    expect(loadProblem(new ApiError(500, 'internal', 'internal error'))).toBeNull();
    expect(loadProblem(new ApiError(403, 'forbidden', 'teacher access required'))).toBeNull();
  });
});
