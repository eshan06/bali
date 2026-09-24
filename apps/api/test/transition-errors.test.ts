import { TRANSITION_ERROR_CODES, TransitionError, type TransitionErrorCode } from '@bali/db';
import { API_ERROR_REASONS, type ApiErrorReason } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/errors.js';
import { mapTransitionError } from '../src/routes/errors.js';

/*
 * The mapper, directly — because the wire cannot reach all of it.
 *
 * `INVALID_EXTENSION` is the case that proved it: every route that could raise
 * it caps `durationMinutes` with zod first, so a wire test sending `0` never
 * gets past validation and asserts against zod's message, not this table's.
 * Three review rounds in a row flagged some version of that, and each time the
 * test named the zod bound more honestly without ever reaching the mapper. A
 * unit test over the table closes it in ten lines and needs no route at all.
 *
 * Exhaustive by construction: the `Record<TransitionErrorCode, …>` below is
 * typed, so adding a code to the engine without an expectation here fails
 * typecheck rather than slipping through with whatever default a partial map
 * would have given it — and the walk over `TRANSITION_ERROR_CODES` fails at
 * run time too.
 */
const EXPECTED: Record<
  TransitionErrorCode,
  { code: string; status: number; reason: ApiErrorReason; message: string }
> = {
  SESSION_NOT_FOUND: {
    code: 'not_found',
    status: 404,
    reason: 'session_not_found',
    message: 'session not found',
  },
  SESSION_NOT_RUNNING: {
    code: 'conflict',
    status: 409,
    reason: 'session_not_running',
    message: 'session has ended',
  },
  NOT_PARTICIPATING: {
    code: 'conflict',
    status: 409,
    reason: 'not_participating',
    message: 'not in this session',
  },
  INVALID_EXTENSION: {
    code: 'bad_input',
    status: 400,
    reason: 'invalid_extension',
    message: 'invalid extension duration',
  },
  EVENT_ID_CONFLICT: {
    code: 'conflict',
    status: 409,
    reason: 'event_id_conflict',
    message: 'event_id already used by another event',
  },
  CLASS_NOT_FOUND: {
    code: 'not_found',
    status: 404,
    reason: 'class_not_found',
    message: 'no class with that join code',
  },
  ENROLLMENT_NOT_FOUND: {
    code: 'not_found',
    status: 404,
    reason: 'enrollment_not_found',
    message: 'enrollment not found',
  },
  PROTECTION_OFF: {
    code: 'conflict',
    status: 409,
    reason: 'protection_off',
    message: 'Screen Time permission is off: tap the block to rejoin',
  },
};

/**
 * The reasons no engine refusal maps to: DELETE /v1/enrollments/{id}'s two
 * 403s, which that route raises itself (A6; pinned in enrollments.test.ts).
 */
const ROUTE_REASONS: ApiErrorReason[] = ['unknown_user', 'enrollment_not_yours'];

/** What `mapTransitionError` turns an engine refusal with `code` into. */
async function mapped(code: TransitionErrorCode): Promise<ApiError> {
  const thrown = await mapTransitionError(() =>
    Promise.reject(new TransitionError(code, 'engine said no')),
  ).catch((err: unknown) => err);
  expect(thrown).toBeInstanceOf(ApiError);
  return thrown as ApiError;
}

describe('mapTransitionError', () => {
  for (const [transitionCode, expected] of Object.entries(EXPECTED)) {
    it(`maps ${transitionCode} to ${expected.status} ${expected.code} (${expected.reason})`, async () => {
      const apiError = await mapped(transitionCode as TransitionErrorCode);
      expect(apiError.code).toBe(expected.code);
      expect(apiError.status).toBe(expected.status);
      expect(apiError.reason).toBe(expected.reason);
      // The message the phone reads, not the engine's internal one.
      expect(apiError.message).toBe(expected.message);
      expect(apiError.message).not.toBe('engine said no');
    });
  }

  it('gives every engine refusal its own reason, and the vocabulary no other (A5)', async () => {
    // A phone keys on the reason, never the message, so a refusal without one
    // — or two sharing one — is two answers it cannot tell apart. The rest of
    // the vocabulary is refusals a route makes itself (A6), named here so a
    // reason nobody gives cannot sit in it unnoticed.
    const reasons: (ApiErrorReason | undefined)[] = [...ROUTE_REASONS];
    for (const code of TRANSITION_ERROR_CODES) reasons.push((await mapped(code)).reason);
    expect(reasons.sort()).toEqual([...API_ERROR_REASONS].sort());
  });

  it('lets anything that is not a TransitionError through untouched', async () => {
    // The mapper must not swallow a bug into a tidy 4xx — an unexpected throw
    // has to reach the catch-all and be a 500.
    const boom = new Error('not a transition error');
    const thrown = await mapTransitionError(() => Promise.reject(boom)).catch(
      (err: unknown) => err,
    );
    expect(thrown).toBe(boom);
  });

  it('returns the value when nothing throws', async () => {
    await expect(mapTransitionError(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
