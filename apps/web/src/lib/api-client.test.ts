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
