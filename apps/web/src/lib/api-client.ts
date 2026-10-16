import type { ApiErrorBody } from '@bali/shared';

import { captureApiFailure } from './monitoring';

/**
 * The API client, built around the one auth-honesty rule the portal must never
 * break: **only a definitive 401 signs a user out.** A `fetch` that throws is a
 * network failure — we couldn't reach the server, which is NOT proof the session
 * is invalid — so it becomes a retryable NetworkError, never a sign-out. A 401 is
 * the server rejecting the token, and only that calls `onUnauthorized`.
 */

/** A non-2xx response other than 401 (the server answered, with an error shape). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Which refusal it was, where the status doesn't say (`API_ERROR_REASONS`): key on this. */
    readonly reason?: string,
    /** A 429's `Retry-After`, in whole seconds, when the server sent one. */
    readonly retryAfter?: number,
    /**
     * The refusal's `details`, as sent and unchecked: a reader checks its shape (a deck in use
     * names its classes, M5a's `DeckInUseDetails`).
     */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Couldn't reach the server. Retryable; must never sign the user out. Its message is for a log: a
 * page says `errText`'s words for it, `CANT_REACH` (errors.ts).
 */
export class NetworkError extends Error {
  constructor(message = "couldn't reach the server") {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The token was rejected (a definitive 401) — the one thing that ends a session. */
export class UnauthorizedError extends ApiError {
  constructor(message = 'session expired') {
    super(401, 'unauthorized', message);
    this.name = 'UnauthorizedError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** The current access token, or null when signed out. */
  getToken: () => string | null;
  /** Called on a definitive 401 — the only sign-out trigger. */
  onUnauthorized?: () => void;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ApiClient {
  /**
   * `limitMs`, as `post`'s: the student home's 30 s read of the account takes a poll's
   * (`POLL_TIMEOUT_MS`), so a read the network swallows never holds the next for minutes.
   */
  get<T>(path: string, limitMs?: number): Promise<T>;
  /**
   * A polled read under an ETag (L3r): `If-None-Match` with `etag` when one is kept, answered with
   * the body and its tag, or null for a `304`, the body unchanged. Every `/v1` answer is
   * `no-store`, so the browser keeps no copy and the poller keeps the tag itself. An answer not
   * whole within `POLL_TIMEOUT_MS` fails as no answer, for the poll to read again (#334).
   */
  getTagged<T>(path: string, etag: string | null): Promise<{ body: T; etag: string | null } | null>;
  /**
   * `limitMs`: an answer not whole within it fails as no answer, as a poll's does (an answer's send,
   * #407's review). No other write is given one: a deck's check (`POST /v1/decks/{id}/complete`) can
   * take longer than a poll waits.
   */
  post<T>(path: string, body?: unknown, limitMs?: number): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  /** A removal may carry its `eventId` in its body (a saved question's, L3b2). */
  del<T>(path: string, body?: unknown): Promise<T>;
}

/**
 * How long a polled read (`getTagged`) waits for its whole answer before it fails as unreached
 * (#334): a half-open connection never fails by itself, and the browser gives up only after
 * minutes. The polls alone: a deck's check (`POST /v1/decks/{id}/complete`) can take longer.
 */
export const POLL_TIMEOUT_MS = 10_000;

/** `Retry-After` as the API sends it, whole seconds; anything else (a date, none) is unknown. */
function retryAfterSeconds(header: string | null): number | undefined {
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header) : undefined;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const doFetch = opts.fetchImpl ?? fetch;

  async function send(
    method: string,
    path: string,
    body?: unknown,
    etag: string | null = null,
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = opts.getToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (etag !== null) headers['if-none-match'] = etag;

    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch {
      // fetch rejects only on a network-level failure, never on an HTTP error
      // status — so this is "can't reach the server", not "not allowed".
      captureApiFailure(method, path, 'network');
      throw new NetworkError();
    }

    if (res.status === 401) {
      opts.onUnauthorized?.();
      throw new UnauthorizedError();
    }
    // A `304` answers only an `If-None-Match`: the kept body still stands.
    if (!res.ok && !(res.status === 304 && etag !== null)) {
      // A 5xx is the server failing; a 4xx is a refusal the screen explains.
      if (res.status >= 500) captureApiFailure(method, path, res.status);
      const parsed = (await res.json().catch(() => null)) as ApiErrorBody | null;
      // Guard `parsed.error` too, not just `parsed`: a non-2xx body that is valid
      // JSON without our `{ error: { code, message } }` shape (an ALB/API-Gateway
      // `{ message }`, say) must still surface a clean ApiError, never a TypeError.
      throw new ApiError(
        res.status,
        parsed?.error?.code ?? 'error',
        parsed?.error?.message ?? `request failed (${res.status})`,
        parsed?.error?.reason,
        retryAfterSeconds(res.headers.get('retry-after')),
        parsed?.error?.details,
      );
    }
    return res;
  }

  /**
   * `run` with a signal that aborts once `limitMs` is up, and no timer left however it settles:
   * at the limit, no answer, said by `send` before the headers and by `json` in the body.
   */
  async function within<R>(limitMs: number, run: (signal: AbortSignal) => Promise<R>): Promise<R> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), limitMs);
    try {
      return await run(abort.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The answer's body, or no answer when the limit (`signal`) stopped it on its way. */
  async function json<T>(res: Response, method: string, path: string, signal?: AbortSignal) {
    try {
      return (await res.json()) as T;
    } catch (e) {
      if (!signal?.aborted) throw e;
      captureApiFailure(method, path, 'network');
      throw new NetworkError();
    }
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await send(method, path, body, null, signal);
    if (res.status === 204) return undefined as T;
    return json<T>(res, method, path, signal);
  }

  return {
    get: (path, limitMs) =>
      limitMs === undefined
        ? request('GET', path)
        : within(limitMs, (signal) => request('GET', path, undefined, signal)),
    getTagged: <T>(path: string, etag: string | null) =>
      within(POLL_TIMEOUT_MS, async (signal) => {
        const res = await send('GET', path, undefined, etag, signal);
        if (res.status === 304) return null;
        return { body: await json<T>(res, 'GET', path, signal), etag: res.headers.get('etag') };
      }),
    post: (path, body, limitMs) =>
      limitMs === undefined
        ? request('POST', path, body)
        : within(limitMs, (signal) => request('POST', path, body, signal)),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path, body) => request('DELETE', path, body),
  };
}
