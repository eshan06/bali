/*
 * The one error shape (API-surface decision 4). Every failure the API returns —
 * bad input, bad token, not allowed, conflict, over budget — comes back as this
 * JSON, so every client can show something honest instead of guessing. Clients
 * import this contract, so it is additive-only once shipped.
 */

/**
 * The error vocabulary and the HTTP status each maps to. `unavailable` (503) is
 * deliberately distinct from `unauthorized` (401): per the auth honesty rule,
 * only a real "no" (a rejected token) signs a user out, while "we couldn't
 * check right now" must read as transient so the client keeps its session and
 * retries.
 */
export const API_ERROR_STATUS = {
  bad_input: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
} as const satisfies Record<string, number>;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

/** The body of every non-2xx response. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** Human-readable, safe to surface; never leaks internals. */
    message: string;
    /** Optional machine-readable detail, e.g. per-field validation issues. */
    details?: unknown;
  };
}
