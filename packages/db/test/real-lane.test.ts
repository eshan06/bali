import { expect, it } from 'vitest';

/*
 * A guard so the real-Postgres CI job can't silently regress into the PGlite
 * lane. The race tests are gated on TEST_DATABASE_URL (describe.runIf) and fail
 * open: if that variable is ever unset, renamed, or the service drifts, those
 * tests simply skip and the job still passes — the entire point of the second
 * lane (real concurrency coverage) vanishes with no signal.
 *
 * The `test-postgres` CI job sets REQUIRE_REAL_PG=1. This test then asserts the
 * lane is actually active, so the job fails loudly instead. Everywhere else
 * (the fast PGlite lane, local `npm test`) REQUIRE_REAL_PG is unset and this is
 * a no-op.
 */
it('runs on the real-Postgres lane when the CI job requires it', () => {
  if (!process.env.REQUIRE_REAL_PG) return;
  expect(
    Boolean(process.env.TEST_DATABASE_URL),
    'REQUIRE_REAL_PG is set but TEST_DATABASE_URL is not — the race tests would silently skip',
  ).toBe(true);
});
