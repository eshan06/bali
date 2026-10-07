// Run by the root `npm test` (node's own runner). Evaluates .railway/railway.ts the way
// `railway config plan` does, with the SDK's own context, and checks what it declares.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';

import { createRailwayContext, project } from 'railway/iac';

import program, { PRESERVED, SERVICE_BY_ENVIRONMENT, partial } from '../../.railway/railway.ts';

const evaluate = (environment) =>
  program(createRailwayContext({ environment, projectName: 'Bali' }), project);

test('scoped by a named partial, so other services are never claimed or deleted', () => {
  assert.equal(partial, 'bali-api');
});

for (const [environment, name] of Object.entries({ dev: 'bali', production: 'bali prod' })) {
  test(`${environment} declares only the API service ${name}, with its build and deploy settings`, async () => {
    const definition = await evaluate(environment);
    assert.equal(definition.name, 'Bali');
    assert.equal(definition.resources.length, 1);
    const [api] = definition.resources;
    assert.equal(api.type, 'service');
    assert.equal(api.name, name);
    // checkSuites is the dashboard's "Wait for CI": an apply that leaves it out turns it off.
    assert.deepEqual(api.source, {
      type: 'github',
      repo: 'eshan06/bali',
      branch: 'main',
      checkSuites: true,
    });
    assert.deepEqual(api.build, { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' });
    // No startCommand: one applied through IaC on this Dockerfile service ran without a
    // shell, so `npm run migrate && npm start` ran only the migration and the API never
    // started (production, 2026-10-06). The Dockerfile's CMD is the only start command.
    assert.deepEqual(api.deploy, {
      healthcheckPath: '/healthz',
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
    });
  });
}

test('the service map names exactly dev and production', () => {
  assert.deepEqual(Object.keys(SERVICE_BY_ENVIRONMENT).sort(), ['dev', 'production']);
});

test('any other environment is refused rather than given a new service', () => {
  for (const environment of ['staging', 'pr-12', undefined]) {
    assert.throws(() => evaluate(environment), /only the dev and production environments/);
  }
});

test('every variable is preserved: no value lives in the file', async () => {
  const [api] = (await evaluate('dev')).resources;
  assert.deepEqual(Object.keys(api.variables).sort(), [...PRESERVED].sort());
  for (const value of Object.values(api.variables)) assert.deepEqual(value, { type: 'preserve' });
});

test('every variable the API reads is preserved, or an apply would delete it', () => {
  const source = readFileSync(new URL('../../apps/api/src/env.ts', import.meta.url), 'utf8');
  const schema = source.slice(source.indexOf('const envSchema'), source.indexOf('.superRefine'));
  const read = [...schema.matchAll(/^ {4}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]);
  assert.ok(read.length > 10, 'env.ts schema keys not found; update this parser');
  // Railway sets it on every deploy; it is never a service variable.
  const platform = new Set(['RAILWAY_GIT_COMMIT_SHA']);
  const missing = read.filter((key) => !platform.has(key) && !PRESERVED.includes(key));
  assert.deepEqual(missing, [], `add to PRESERVED in .railway/railway.ts: ${missing.join(', ')}`);
});

// With no start command in the IaC, the image's CMD alone migrates and starts the API. The
// shell runs the `&&` (without it only the migration would run); `exec` then makes the
// server's node process PID 1, so Railway's SIGTERM reaches makeShutdown (sh as PID 1
// ignores it, and a restart SIGKILLs the API mid-request).
test("the Dockerfile's CMD migrates, then execs the server, through a shell", () => {
  const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
  const cmds = dockerfile.split('\n').filter((line) => line.startsWith('CMD '));
  assert.deepEqual(cmds, [
    'CMD ["sh", "-c", "npm run migrate && cd apps/api && exec node --import tsx src/server.ts"]',
  ]);
  // The CMD runs what `npm start` runs, minus the wrapper; a changed start script fails here.
  const api = JSON.parse(readFileSync(new URL('../../apps/api/package.json', import.meta.url)));
  assert.equal(api.scripts.start, 'tsx src/server.ts');
});
