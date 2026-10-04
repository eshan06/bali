import { readFileSync } from 'node:fs';

import { databaseUrl } from '@bali/db/testing';

import { harnessServer, SCHOOL_FILE, type SchoolFile } from './school.js';

/*
 * `npm run load:serve` — the real API (src/server.ts: every route, L1's rate limits, the minute
 * sweep) as a server process, on the school `npm run load:seed` made, trusting that seed's issuer
 * through env alone: AUTH_JWKS_URI is a `data:` URL holding its public key, which the verifier
 * reads as it reads Cognito's key set. No API code knows the harness, so a deployed API, its env
 * naming Cognito's pool, never trusts it.
 */
const server = harnessServer(process.env);
let school: SchoolFile;
try {
  school = JSON.parse(readFileSync(SCHOOL_FILE, 'utf8')) as SchoolFile;
} catch (err) {
  throw new Error(`no school to serve at ${SCHOOL_FILE}: run \`npm run load:seed\` first`, {
    cause: err,
  });
}

// Set before the API reads its env, whose .env never overrides what is set: a .env naming dev's
// database or Cognito's pool changes none of these.
Object.assign(process.env, {
  DATABASE_URL: databaseUrl(server, school.api.database),
  AUTH_ISSUER: school.api.issuer,
  AUTH_JWKS_URI: school.api.jwksUri,
  AUTH_AUDIENCE: school.api.audience,
  INTERNAL_API_KEY: school.api.internalKey,
  HOST: process.env.HOST ?? '127.0.0.1',
});
await import('../../src/server.js');
