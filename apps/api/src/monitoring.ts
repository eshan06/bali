import * as Sentry from '@sentry/node';
import type { ErrorEvent, NodeOptions } from '@sentry/node';

import type { Env } from './env.js';

/*
 * Error monitoring (Phase 5, P1). Off unless SENTRY_DSN is set — tests and dev
 * never set it, so `captureFailure` is a no-op there. When on, only real
 * failures leave (a 500 from the error handler, an uncaught exception or
 * rejection), never an expected 4xx refusal, and nothing about a student goes
 * with them: the scrubber below keeps the error's type, its stack, the route
 * template and the release, and drops everything else that could carry
 * personal data.
 */

/** Drizzle's query errors end `\nparams: <values>` — the values are student data. */
const PARAMS = /\bparams:[\s\S]*$/;
/** Postgres echoes the offending row in errors (`Key (email)=(a@b.c)`, `Failing row contains (…)`). */
const ROW_VALUES = /(Key \([^)]*\)=)\([\s\S]*?\)|(Failing row contains )\([\s\S]*?\)/g;

function scrubText(text: string): string {
  return text.replace(PARAMS, 'params: [scrubbed]').replace(ROW_VALUES, '$1$2([scrubbed])');
}

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
 * Report a 500 — an unexpected error the handler turned into `internal`.
 * A no-op when monitoring is off. Only the route template is attached
 * (`/v1/join-codes/:code`), never the URL.
 */
export function captureFailure(error: unknown, route: string): void {
  Sentry.withScope((scope) => {
    scope.setTag('route', route);
    Sentry.captureException(error);
  });
}
