import { TransitionError, type TransitionErrorCode } from '@bali/db';
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
 * would have given it.
 */
const EXPECTED: Record<TransitionErrorCode, { code: string; status: number; message: string }> = {
  SESSION_NOT_FOUND: { code: 'not_found', status: 404, message: 'session not found' },
  SESSION_NOT_RUNNING: { code: 'conflict', status: 409, message: 'session has ended' },
  NOT_PARTICIPATING: { code: 'conflict', status: 409, message: 'not in this session' },
  INVALID_EXTENSION: { code: 'bad_input', status: 400, message: 'invalid extension duration' },
  EVENT_ID_CONFLICT: {
    code: 'conflict',
    status: 409,
    message: 'event_id already used by another event',
  },
  CLASS_NOT_FOUND: { code: 'not_found', status: 404, message: 'no class with that join code' },
  ENROLLMENT_NOT_FOUND: { code: 'not_found', status: 404, message: 'enrollment not found' },
  PROTECTION_OFF: {
    code: 'conflict',
    status: 409,
    message: 'Screen Time permission is off: tap the block to rejoin',
  },
};

describe('mapTransitionError', () => {
  for (const [transitionCode, expected] of Object.entries(EXPECTED)) {
    it(`maps ${transitionCode} to ${expected.status} ${expected.code}`, async () => {
      const thrown = await mapTransitionError(() =>
        Promise.reject(
          new TransitionError(transitionCode as TransitionErrorCode, 'engine said no'),
        ),
      ).catch((err: unknown) => err);

      expect(thrown).toBeInstanceOf(ApiError);
      const apiError = thrown as ApiError;
      expect(apiError.code).toBe(expected.code);
      expect(apiError.status).toBe(expected.status);
      // The message the phone reads, not the engine's internal one.
      expect(apiError.message).toBe(expected.message);
      expect(apiError.message).not.toBe('engine said no');
    });
  }

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
