import { defineConfig } from 'vitest/config';

// A loaded machine (CI, or several sessions on one box) can take longer than
// vitest's defaults (10 s per hook, 5 s per test) to start PGlite and run a
// test; the margin removes the phantom "Hook timed out in 10000ms". A test's
// own explicit timeout still overrides these. It changes no assertion.
export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
