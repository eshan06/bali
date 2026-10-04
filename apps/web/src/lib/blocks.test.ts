import type { BlockDetail } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient, NetworkError } from './api-client';
import { blockIdOf, loadProblem, registerBlock } from './blocks';
import {
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
    const bad = api(400, { error: { code: 'bad_input', message: 'invalid request' } });
    expect(await registerBlock(bad.client, 'T7XK2M9QPF', [])).toEqual({
      kind: 'refused',
      message: NOT_A_BLOCK_ID,
    });
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
