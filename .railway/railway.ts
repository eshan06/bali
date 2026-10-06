// Railway Infrastructure as Code for the Bali API (P8; docs/DEPLOY.md, docs/RUNBOOKS.md
// runbook 8). The owner plans and applies it by hand; Railway never reads it on a deploy.
//
// It manages one service per environment and nothing else: dev's `bali` and production's
// `bali prod`. The named partial below scopes every apply to the services this file
// declares, so the Postgres services and the sweep crons are never claimed, changed or
// deleted from here.
//
// Every variable the API reads is listed as preserve(): an apply deletes a declared
// service's variables that the file leaves out, and preserve() keeps the value set in
// Railway without writing it here. A new variable in apps/api/src/env.ts goes in
// PRESERVED too (infra/railway/iac.test.mjs fails until it does).
import { defineRailway, github, preserve, project, service } from 'railway/iac';

export const partial = 'bali-api';

/** The API's service in each Railway environment; any other environment is refused. */
export const SERVICE_BY_ENVIRONMENT: Readonly<Record<string, string>> = {
  dev: 'bali',
  production: 'bali prod',
};

/** Set in Railway's Variables tab, never in this file (docs/DEPLOY.md, runbook 1 step 6). */
export const PRESERVED = [
  'DATABASE_URL',
  'AUTH_ISSUER',
  'AUTH_JWKS_URI',
  'AUTH_AUDIENCE',
  'INTERNAL_API_KEY',
  'CORS_ORIGINS',
  'TZ',
  'LOG_LEVEL',
  'NODE_ENV',
  'PORT',
  'HOST',
  'SHUTDOWN_DEADLINE_MS',
  'SENTRY_DSN',
  'SENTRY_ENVIRONMENT',
  'APNS_KEY_P8',
  'APNS_KEY_ID',
  'APNS_TEAM_ID',
  'APNS_TOPIC',
  'RAILWAY_DEPLOYMENT_DRAINING_SECONDS',
] as const;

export default defineRailway((ctx) => {
  const environment = ctx.environment ?? '(none)';
  const name = SERVICE_BY_ENVIRONMENT[environment];
  if (name === undefined) {
    throw new Error(
      `.railway/railway.ts manages only the dev and production environments, not "${environment}"`,
    );
  }

  // The same settings railway.json holds: the Dockerfile build, migrations before the
  // server starts, the /healthz check, and three restarts after a crash.
  const api = service(name, {
    // checkSuites is the dashboard's "Wait for CI": a deploy waits for main's checks to
    // pass. Left out, an apply turns it off (it did on production, 2026-10-06).
    source: github('eshan06/bali', { branch: 'main', checkSuites: true }),
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    start: 'npm run migrate && npm start',
    healthcheck: '/healthz',
    deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3 },
    env: Object.fromEntries(PRESERVED.map((key) => [key, preserve()])),
  });

  // The project's name is never changed by an apply; the CLI passes the linked one.
  return project(ctx.projectName ?? 'bali', { resources: [api] });
});
