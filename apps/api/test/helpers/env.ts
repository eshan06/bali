import type { Env } from '../../src/env.js';

import { TEST_AUDIENCE, TEST_ISSUER } from './test-issuer.js';

/** A complete, valid Env for in-process tests (buildApp takes an injected verifier). */
export const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  SHUTDOWN_DEADLINE_MS: 8000,
  AUTH_ISSUER: TEST_ISSUER,
  AUTH_JWKS_URI: `${TEST_ISSUER}/.well-known/jwks.json`,
  AUTH_AUDIENCE: TEST_AUDIENCE,
};

/**
 * The same values as process-env strings, for tests that spawn the real server.
 * LOG_LEVEL is left at its default (info) on purpose: the boot-contract tests
 * assert on the "Server listening" and "shutting down" log lines.
 */
export const testEnvVars: Record<string, string> = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  AUTH_ISSUER: TEST_ISSUER,
  AUTH_JWKS_URI: `${TEST_ISSUER}/.well-known/jwks.json`,
  AUTH_AUDIENCE: TEST_AUDIENCE,
};
