import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient, NetworkError, UnauthorizedError } from './api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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
