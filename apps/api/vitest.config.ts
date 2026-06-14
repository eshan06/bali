import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // setup-env points the app at TEST_DATABASE_URL before any app module imports.
    setupFiles: ['./test/setup-env.ts'],
    // migrate + seed run in beforeAll; give them room.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
