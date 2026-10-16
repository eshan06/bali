import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  createApiClient,
  NetworkError,
  POLL_TIMEOUT_MS,
  UnauthorizedError,
} from './api-client';
import { captureApiFailure } from './monitoring';

vi.mock('./monitoring', () => ({ captureApiFailure: vi.fn() }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A request the network swallows (a half-open connection): no answer ever, until its signal gives
 * up on it, as the browser's fetch does.
 */
function swallowed(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    );
  });
}

describe('api-client', () => {
  it('returns parsed JSON on 2xx and sends the bearer token', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        captured = init;
        return Promise.resolve(jsonResponse({ ok: 1 }));
      },
    );
    const api = createApiClient({ baseUrl: 'http://api', getToken: () => 'tok', fetchImpl });

    expect(await api.get('/x')).toEqual({ ok: 1 });
    expect((captured?.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('sends a PUT’s body, and a DELETE’s when it has one (a saved question’s, L7b), as JSON', async () => {
    const sent: { url: string; method?: string; body?: unknown; type?: string }[] = [];
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      sent.push({
        url: url as string,
        method: init?.method,
        body: init?.body,
        type: headers['content-type'],
      });
      return Promise.resolve(jsonResponse({ ok: 1 }));
    });
    const api = createApiClient({ baseUrl: 'http://api', getToken: () => 'tok', fetchImpl });
    expect(await api.put('/v1/saved-questions/q1', { eventId: 'e1' })).toEqual({ ok: 1 });
    expect(await api.del('/v1/saved-questions/q1', { eventId: 'e2' })).toEqual({ ok: 1 });
    expect(await api.del('/v1/enrollments/n1')).toEqual({ ok: 1 });
    expect(sent).toEqual([
      {
        url: 'http://api/v1/saved-questions/q1',
        method: 'PUT',
        body: '{"eventId":"e1"}',
        type: 'application/json',
      },
      {
        url: 'http://api/v1/saved-questions/q1',
        method: 'DELETE',
        body: '{"eventId":"e2"}',
        type: 'application/json',
      },
      { url: 'http://api/v1/enrollments/n1', method: 'DELETE', body: undefined, type: undefined },
    ]);
  });

  it('throws NetworkError — never a sign-out — when fetch rejects', async () => {
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized,
      fetchImpl: () => Promise.reject(new Error('down')),
    });

    await expect(api.get('/x')).rejects.toBeInstanceOf(NetworkError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('signs out only on a definitive 401', async () => {
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized,
      fetchImpl: () => Promise.resolve(new Response('', { status: 401 })),
    });

    await expect(api.get('/x')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('surfaces a non-401 error in the API shape without signing out', async () => {
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized,
      fetchImpl: () =>
        Promise.resolve(jsonResponse({ error: { code: 'conflict', message: 'nope' } }, 409)),
    });

    await expect(api.get('/x')).rejects.toMatchObject({ status: 409, code: 'conflict' });
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('carries the error’s reason, where the status alone doesn’t say which refusal it was', async () => {
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () =>
        Promise.resolve(
          jsonResponse(
            {
              error: {
                code: 'bad_input',
                reason: 'unknown_cursor',
                message: 'before is not a session of this class',
              },
            },
            400,
          ),
        ),
    });

    await expect(api.get('/x')).rejects.toMatchObject({ status: 400, reason: 'unknown_cursor' });
    const plain = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () =>
        Promise.resolve(jsonResponse({ error: { code: 'conflict', message: 'nope' } }, 409)),
    });
    const err = await plain.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).reason).toBeUndefined();
    expect((err as ApiError).details).toBeUndefined();
  });

  it('keeps the error’s details as sent, for the page to read (a deck in use names its classes, M5a)', async () => {
    const details = { classes: [{ id: 'c1', name: 'Biology, period 3' }] };
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () =>
        Promise.resolve(
          jsonResponse(
            {
              error: {
                code: 'conflict',
                reason: 'deck_in_use',
                message: 'a running session shows the deck',
                details,
              },
            },
            409,
          ),
        ),
    });
    await expect(api.del('/v1/decks/d1', { eventId: 'e1' })).rejects.toMatchObject({
      status: 409,
      reason: 'deck_in_use',
      details,
    });
  });

  it('never signs out on a 5xx — a server hiccup is transient, not a bad token', async () => {
    // The honesty rule: only a 401 ends a session. A 500/502/503 is the server
    // failing, so the client keeps its session and retries (shared errors.ts
    // singles out `unavailable`/503 as transient). Pin the whole 5xx range so a
    // refactor can't quietly eject a teacher mid-class on a blip.
    for (const status of [500, 502, 503]) {
      const onUnauthorized = vi.fn();
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        onUnauthorized,
        fetchImpl: () =>
          Promise.resolve(
            jsonResponse({ error: { code: 'unavailable', message: 'down' } }, status),
          ),
      });

      await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
      await expect(api.get('/x')).rejects.toMatchObject({ status });
      expect(onUnauthorized, `status ${status} must not sign out`).not.toHaveBeenCalled();
    }
  });

  it('reads under an ETag: If-None-Match only with a kept tag, the body with its tag, null for a 304', async () => {
    const sent: (string | undefined)[] = [];
    const replies = [
      new Response(JSON.stringify({ answered: 1 }), { status: 200, headers: { etag: '"a"' } }),
      new Response(null, { status: 304, headers: { etag: '"a"' } }),
      new Response(JSON.stringify({ answered: 2 }), { status: 200 }),
    ];
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: (_url, init) => {
        sent.push((init?.headers as Record<string, string>)['if-none-match']);
        return Promise.resolve(replies.shift()!);
      },
    });

    expect(await api.getTagged('/x', null)).toEqual({ body: { answered: 1 }, etag: '"a"' });
    expect(await api.getTagged('/x', '"a"')).toBeNull();
    // An answer the browser shows no tag of (one CORS doesn't expose) is kept, with none.
    expect(await api.getTagged('/x', '"a"')).toEqual({ body: { answered: 2 }, etag: null });
    expect(sent).toEqual([undefined, '"a"', '"a"']);
  });

  it('fails a tagged read as any read: a 401 signs out, a 5xx and no answer throw', async () => {
    const onUnauthorized = vi.fn();
    const answering = (status: number) =>
      createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        onUnauthorized,
        fetchImpl: () =>
          Promise.resolve(jsonResponse({ error: { code: 'x', message: 'no' } }, status)),
      });

    await expect(answering(401).getTagged('/x', '"a"')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    await expect(answering(503).getTagged('/x', '"a"')).rejects.toMatchObject({ status: 503 });
    const offline = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () => Promise.reject(new Error('down')),
    });
    await expect(offline.getTagged('/x', null)).rejects.toBeInstanceOf(NetworkError);
    // A 304 no tag asked for is no answer to keep: a plain read never sends one.
    const stray = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () => Promise.resolve(new Response(null, { status: 304 })),
    });
    await expect(stray.getTagged('/x', null)).rejects.toMatchObject({ status: 304 });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  describe('a tagged read with no answer (#334)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.mocked(captureApiFailure).mockClear();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('fails as unreached once POLL_TIMEOUT_MS is up, never a sign-out, leaving no timer', async () => {
      const onUnauthorized = vi.fn();
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        onUnauthorized,
        fetchImpl: (_url, init) => swallowed(init),
      });
      const read = api.getTagged('/x', '"a"');
      const settled = vi.fn();
      read.then(settled, settled);
      await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(read).rejects.toBeInstanceOf(NetworkError);
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(vi.mocked(captureApiFailure).mock.calls).toEqual([['GET', '/x', 'network']]);
    });

    it('fails a body that stops on its way the same way: the limit is on the whole answer', async () => {
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        fetchImpl: (_url, init) => {
          const body = new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('{"answered":'));
              init?.signal?.addEventListener('abort', () =>
                stream.error(new DOMException('aborted', 'AbortError')),
              );
            },
          });
          return Promise.resolve(new Response(body, { status: 200 }));
        },
      });
      const read = api.getTagged('/x', null);
      const settled = vi.fn();
      read.then(settled, settled);
      await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(read).rejects.toBeInstanceOf(NetworkError);
      expect(vi.getTimerCount()).toBe(0);
      expect(vi.mocked(captureApiFailure).mock.calls).toEqual([['GET', '/x', 'network']]);
    });

    it('clears its timer once answered: a body, a 304, a refusal, a 401, no network, not JSON', async () => {
      const replies: (() => Promise<Response>)[] = [
        () => Promise.resolve(new Response('{"answered":1}', { headers: { etag: '"a"' } })),
        () => Promise.resolve(new Response(null, { status: 304 })),
        () => Promise.resolve(jsonResponse({ error: { code: 'x', message: 'no' } }, 503)),
        () => Promise.resolve(new Response('', { status: 401 })),
        () => Promise.reject(new TypeError('Failed to fetch')),
        // A proxy's page: a body that came whole, so its own error, never the limit's no answer.
        () => Promise.resolve(new Response('<html>', { status: 200 })),
      ];
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        fetchImpl: () => replies.shift()!(),
      });
      const answers: unknown[] = [];
      for (let i = 0; i < 6; i += 1) {
        answers.push(await api.getTagged('/x', '"a"').catch((e: unknown) => e));
        expect(vi.getTimerCount(), `after answer ${i + 1}`).toBe(0);
      }
      expect(answers[0]).toEqual({ body: { answered: 1 }, etag: '"a"' });
      expect(answers[1]).toBeNull();
      expect(answers.slice(2).map((e) => (e as Error).name)).toEqual([
        'ApiError',
        'UnauthorizedError',
        'NetworkError',
        'SyntaxError',
      ]);
      expect(vi.mocked(captureApiFailure).mock.calls).toEqual([
        ['GET', '/x', 503],
        ['GET', '/x', 'network'],
      ]);
    });

    it('puts no limit on any other call: a deck’s check can take longer than a poll waits', async () => {
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        fetchImpl: (_url, init) =>
          Promise.race([
            swallowed(init),
            new Promise<Response>((answer) => {
              setTimeout(() => answer(jsonResponse({ ok: 1 })), 4 * POLL_TIMEOUT_MS);
            }),
          ]),
      });
      const calls = [
        api.get('/v1/decks'),
        api.post('/v1/decks/d1/complete', { eventId: 'e1' }),
        api.put('/v1/saved-questions/q1', { eventId: 'e2' }),
        api.patch('/v1/me', { eventId: 'e3' }),
        api.del('/v1/decks/d1', { eventId: 'e4' }),
      ];
      await vi.advanceTimersByTimeAsync(4 * POLL_TIMEOUT_MS);
      expect(await Promise.all(calls)).toEqual(calls.map(() => ({ ok: 1 })));
    });
  });

  describe('a call given a time limit: an answer’s send (#407’s review)', () => {
    const LIMIT = 10_000;
    const PATH = '/v1/questions/q1/answers';
    beforeEach(() => {
      vi.useFakeTimers();
      vi.mocked(captureApiFailure).mockClear();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('fails as unreached once its limit is up, never a sign-out, leaving no timer', async () => {
      const onUnauthorized = vi.fn();
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        onUnauthorized,
        fetchImpl: (_url, init) => swallowed(init),
      });
      const sent = api.post(PATH, { eventId: 'e1', option: 1 }, LIMIT);
      const settled = vi.fn();
      sent.then(settled, settled);
      await vi.advanceTimersByTimeAsync(LIMIT - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledOnce();
      await expect(sent).rejects.toBeInstanceOf(NetworkError);
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(vi.mocked(captureApiFailure).mock.calls).toEqual([['POST', PATH, 'network']]);
    });

    it('fails a body that stops on its way the same way: the limit is on the whole answer', async () => {
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        fetchImpl: (_url, init) => {
          const body = new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('{"outcome":'));
              init?.signal?.addEventListener('abort', () =>
                stream.error(new DOMException('aborted', 'AbortError')),
              );
            },
          });
          return Promise.resolve(new Response(body, { status: 200 }));
        },
      });
      const sent = api.post(PATH, { eventId: 'e1', option: 1 }, LIMIT);
      const settled = vi.fn();
      sent.then(settled, settled);
      await vi.advanceTimersByTimeAsync(LIMIT - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledOnce();
      await expect(sent).rejects.toBeInstanceOf(NetworkError);
      expect(vi.getTimerCount()).toBe(0);
      expect(vi.mocked(captureApiFailure).mock.calls).toEqual([['POST', PATH, 'network']]);
    });

    it('clears its timer once answered: a body, a refusal, a 401, no network, not JSON', async () => {
      const replies: (() => Promise<Response>)[] = [
        () => Promise.resolve(jsonResponse({ outcome: 'answered' })),
        () => Promise.resolve(jsonResponse({ error: { code: 'conflict', message: 'no' } }, 409)),
        () => Promise.resolve(new Response('', { status: 401 })),
        () => Promise.reject(new TypeError('Failed to fetch')),
        // A proxy's page: a body that came whole, so its own error, never the limit's no answer.
        () => Promise.resolve(new Response('<html>', { status: 200 })),
      ];
      const api = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        fetchImpl: () => replies.shift()!(),
      });
      const answers: unknown[] = [];
      for (let i = 0; i < 5; i += 1) {
        answers.push(await api.post(PATH, { eventId: 'e1' }, LIMIT).catch((e: unknown) => e));
        expect(vi.getTimerCount(), `after answer ${i + 1}`).toBe(0);
      }
      expect(answers[0]).toEqual({ outcome: 'answered' });
      expect(answers.slice(1).map((e) => (e as Error).name)).toEqual([
        'ApiError',
        'UnauthorizedError',
        'NetworkError',
        'SyntaxError',
      ]);
    });
  });

  it('surfaces a clean ApiError (not a TypeError) on a non-conforming error body', async () => {
    // A valid-JSON body lacking our `{ error: { code, message } }` shape — e.g. an
    // ALB/API-Gateway `{ message }` — must still throw ApiError with the fallback
    // code, never a raw TypeError from reaching into an absent `error`.
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized,
      fetchImpl: () => Promise.resolve(jsonResponse({ message: 'gateway boom' }, 400)),
    });

    const err = await api.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(TypeError);
    expect(err).toMatchObject({ status: 400, code: 'error' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
