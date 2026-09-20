import type { ApiErrorBody } from '@bali/shared';

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
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Couldn't reach the server. Retryable; must never sign the user out. */
export class NetworkError extends Error {
  constructor(message = "can't reach the server — retry") {
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
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const doFetch = opts.fetchImpl ?? fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const token = opts.getToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      // fetch rejects only on a network-level failure, never on an HTTP error
      // status — so this is "can't reach the server", not "not allowed".
      throw new NetworkError();
    }

    if (res.status === 401) {
      opts.onUnauthorized?.();
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const parsed = (await res.json().catch(() => null)) as ApiErrorBody | null;
      // Guard `parsed.error` too, not just `parsed`: a non-2xx body that is valid
      // JSON without our `{ error: { code, message } }` shape (an ALB/API-Gateway
      // `{ message }`, say) must still surface a clean ApiError, never a TypeError.
      throw new ApiError(
        res.status,
        parsed?.error?.code ?? 'error',
        parsed?.error?.message ?? `request failed (${res.status})`,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    del: (path) => request('DELETE', path),
  };
}
