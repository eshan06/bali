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
  // A 404: no live class holds the join code (the join and its preview), or
  // none has the id on a route under /v1/classes/{id} — every one of them, so
  // one condition reaches a client in one shape (R3, #192's review).
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
  // DELETE /v1/enrollments/{id} (A19): a student leaving a class while it has
  // a session running by the server's clock — a 409; nothing was recorded.
  'class_in_session',
  // PATCH /v1/unlocks/{eventId} (A20): no unlock of the caller's in a session
  // has that id — a 404; or a return, a tap or an unlock of theirs there came
  // since, so their teacher no longer sees it — a 409. Nothing was recorded.
  'unlock_not_found',
  'unlock_superseded',
  // POST /v1/sessions/{id}/protection-on (#167): the student's participation
  // is not in protection off — a re-tap left it, or it never went — a 409;
  // nothing was recorded.
  'protection_not_off',
  // POST /v1/teacher-invites/redeem (T1b), nothing changed by any of them: the
  // code can't be one (a 400); no invite has it (a 404); it was used, or its
  // 14 days are over (a 409); or the account can't become a teacher — it is
  // one, or a student in a live class (a 409; the owner's ruling, 2026-10-04:
  // a separate account for teaching).
  'invite_code_invalid',
  'invite_not_found',
  'invite_used',
  'invite_expired',
  'already_teacher',
  'student_in_class',
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
