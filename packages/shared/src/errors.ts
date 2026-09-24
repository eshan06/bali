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

/**
 * Which refusal an error is, where its status alone does not say (A5): a
 * refocus's `409 conflict` is protection off, not in the session, the session
 * over, or a spent id, and a phone shows each differently — so it keys on this,
 * never on the message. One value per refusal the transition engine makes, and
 * per refusal a route makes itself where one status covers several on it —
 * leaving a class's two 403s (A6), the history's and a rename's two 400s (A8);
 * an error with no finer meaning than its status carries none. Additive-only
 * like the other vocab, and a client reads a value it does not know as none:
 * a newer server may send one.
 */
export const API_ERROR_REASONS = [
  'session_not_found',
  'session_not_running',
  'not_participating',
  'invalid_extension',
  'event_id_conflict',
  'class_not_found',
  'enrollment_not_found',
  'protection_off',
  // DELETE /v1/enrollments/{id}'s 403s: the caller has no account here yet, or
  // the enrollment is neither their own nor in a class they teach.
  'unknown_user',
  'enrollment_not_yours',
  // A request that fails validation (a client bug), on an endpoint where a 400
  // can also mean something else: GET /v1/me/history and PATCH /v1/me (A8).
  'invalid_request',
  // GET /v1/me/history: `before` names no moment of this history — reload
  // from the top.
  'unknown_cursor',
  // PATCH /v1/me (A8): the name breaks a rule (blank, too long, a character
  // that cannot be shown) — or a classmate in a shared class already uses it
  // (owner decision 8), a 409.
  'display_name_invalid',
  'display_name_taken',
] as const;
export type ApiErrorReason = (typeof API_ERROR_REASONS)[number];

/** The body of every non-2xx response. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    /** Which refusal this is, when the code alone does not say; absent otherwise. */
    reason?: ApiErrorReason;
    /** Human-readable, safe to surface; never leaks internals. */
    message: string;
    /** Optional machine-readable detail, e.g. per-field validation issues. */
    details?: unknown;
  };
}
