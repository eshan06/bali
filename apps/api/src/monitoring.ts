import * as Sentry from '@sentry/node';
import type { ErrorEvent, NodeOptions } from '@sentry/node';

import type { Env } from './env.js';
import { scrubText } from './redact.js';

/*
 * Error monitoring (Phase 5, P1). Off unless SENTRY_DSN is set — tests and dev
 * never set it, so `captureFailure` is a no-op there. When on, only real
 * failures leave (a 500 from the error handler, an uncaught exception or
 * rejection), never an expected 4xx refusal, and nothing about a student goes
 * with them: the scrubber below keeps the error's type, its stack, the route
 * template and the release, and drops everything else that could carry
 * personal data. Messages are scrubbed by the same rule as the logs
 * (`redact.ts`, Phase 6 S2).
 */

/**
 * The beforeSend scrubber. Exported for its test; anything Sentry or an
 * integration adds that is not on the keep-list below is dropped.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // The request: its URL (join codes ride in paths), query, headers
  // (Authorization, x-internal-key, cookies) and body (unlock reasons, names).
  // The route template is on the `route` tag instead.
  delete event.request;
  // Cognito ids, emails, names; IP addresses.
  delete event.user;
  // Free-form bags an integration or a capture call can fill with anything.
  delete event.extra;
  delete event.breadcrumbs;
  // The raw URL as a transaction name would carry a join code.
  delete event.transaction;
  if (event.message !== undefined) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = scrubText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  return event;
}

/** Sentry's default integrations that stay on: error shape, dedupe, stack context, crash handlers. */
const KEPT_INTEGRATIONS = new Set([
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'Dedupe',
  'NodeSystemError',
  'OnUncaughtException',
  'ContextLines',
  'Context',
]);

export interface MonitoringOptions {
  /** Tests only: where events go instead of the network. */
  transport?: NodeOptions['transport'];
}

/** Start error monitoring when SENTRY_DSN is set. Returns whether it started. */
export function initMonitoring(env: Env, options: MonitoringOptions = {}): boolean {
  if (env.SENTRY_DSN === undefined) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    // Railway sets the deployed commit; unset (a local run), Sentry tags none.
    release: env.RAILWAY_GIT_COMMIT_SHA,
    // v11's replacement for `sendDefaultPii: false`: collect none of it.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    includeLocalVariables: false,
    // Performance tracing is off: no sample rate means no spans are sent.
    tracesSampleRate: undefined,
    // An allow-list, not Sentry's defaults: those also instrument HTTP and
    // Fastify, which would report on their own (4xx included) and record URLs.
    integrations: (defaults) => [
      ...defaults.filter((integration) => KEPT_INTEGRATIONS.has(integration.name)),
      // Keep Node's own behaviour for an unhandled rejection — the process
      // exits and the platform restarts it — after the event is sent.
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
    beforeSend: scrubEvent,
    // Breadcrumbs carry URLs and log lines; none are kept (scrubEvent drops
    // them anyway — this keeps them out of memory too).
    beforeBreadcrumb: () => null,
    ...(options.transport ? { transport: options.transport } : {}),
  });
  return true;
}

/**
 * Report a real failure: a 5xx from the error handler (the route template,
 * `POST /v1/join-codes/:code`, never the URL), a failed sweep, a failed boot.
 * A no-op when monitoring is off.
 */
export function captureFailure(error: unknown, where: string): void {
  Sentry.withScope((scope) => {
    scope.setTag('route', where);
    Sentry.captureException(error);
  });
}

/**
 * The sweep's Sentry Cron monitor, made (or updated) by its first check-in.
 * Every environment (dev, production) checks in to this one slug under its own
 * environment, and each check-in sends the config below: change it for all.
 */
export const SWEEP_MONITOR_SLUG = 'api-sweep';

const SWEEP_MONITOR_CONFIG: Parameters<typeof Sentry.withMonitor>[2] = {
  // The API's own minute tick (sweep.ts), not Railway's five-minute cron.
  schedule: { type: 'interval', value: 1, unit: 'minute' },
  // A deploy's restart or one skipped tick stays inside the margin.
  checkinMargin: 2,
  // A run in progress longer than this is reported as timed out.
  maxRuntime: 5,
  // One failed run already reaches Sentry as an error (captureFailure); the
  // monitor opens an issue when the sweep keeps failing or stops checking in.
  failureIssueThreshold: 2,
  recoveryThreshold: 1,
};

/**
 * Run one sweep inside a Sentry Cron check-in: `in_progress` when it starts,
 * then `ok`, or `error` when it throws (the error is rethrown unchanged). A
 * process that stops sweeping stops checking in, which the monitor reports as
 * missed. A check-in carries the slug, status and duration, nothing else. A
 * plain call when monitoring is off.
 */
export function withSweepMonitor<T>(run: () => Promise<T>): Promise<T> {
  return Sentry.withMonitor(SWEEP_MONITOR_SLUG, run, SWEEP_MONITOR_CONFIG);
}

/** Wait for queued events to send, before the process exits. A no-op when off. */
export async function flushMonitoring(): Promise<void> {
  await Sentry.flush(2000);
}
