import * as Sentry from '@sentry/browser';
import type { BrowserOptions, ErrorEvent, EventHint } from '@sentry/browser';

/*
 * Error monitoring in the portal (Phase 5, P2), on P1's rules for the API. Off
 * unless NEXT_PUBLIC_SENTRY_DSN is set at build time — tests and dev never set
 * it, so every call here is a no-op there. When on, only real failures leave:
 * an uncaught error or rejection, and an API call that got a 5xx or no answer
 * at all, never a 4xx refusal the screen already explains. Nothing about a
 * student or a teacher goes with them: no URL beyond its template, no token,
 * no breadcrumbs, no form values, no request or response bodies, no replay.
 */

/** A page or API path's ids (class and session UUIDs) become `:id`; its query goes. */
export function templatePath(path: string): string {
  const [bare = ''] = path.split(/[?#]/);
  return bare
    .split('/')
    .map((segment) => (segment === '' || /^(v\d+|[a-z-]+)$/.test(segment) ? segment : ':id'))
    .join('/');
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>()]+/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** A relative path's query or fragment (`/auth/callback?code=…`). */
const PATH_QUERY = /(\/[^\s?#"'<>()]*)[?#][^\s"'<>()]*/g;

/** A script's URL names code, not a person: only its query and any UUID go. */
function scrubFileName(name: string): string {
  return name.replace(/[?#].*$/, '').replace(UUID, ':id');
}

/** A URL keeps its origin and its path's template; a bare UUID becomes `:id`. */
function scrubText(text: string): string {
  return text
    .replace(URL_IN_TEXT, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${templatePath(parsed.pathname)}`;
      } catch {
        return '[url]';
      }
    })
    .replace(PATH_QUERY, '$1')
    .replace(UUID, ':id');
}

/** A failed API call, reported in place of the ApiError or NetworkError the screen shows. */
export class ApiFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiFailure';
  }
}

/** The API client's own errors: reported once, as an ApiFailure, or not at all (a 4xx). */
const API_ERROR_NAMES = new Set(['ApiError', 'NetworkError', 'UnauthorizedError']);

/**
 * The beforeSend scrubber, exported for its test. Keeps the error's type, its
 * scrubbed message and stack, the `route` tag and the release; drops the rest.
 */
export function scrubEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent | null {
  // An unhandled rejection of an API call: a 5xx or a network failure was
  // already reported where it happened, and a 4xx is the screen's to explain.
  const original = hint?.originalException;
  if (original instanceof Error && API_ERROR_NAMES.has(original.name)) return null;
  // The page URL (class ids), its query, headers (the referrer).
  delete event.request;
  delete event.user;
  // Free-form bags a capture call or an integration can fill with anything.
  delete event.extra;
  delete event.breadcrumbs;
  delete event.transaction;
  if (event.message !== undefined) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = scrubText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      // An inline script's frames are named by the page URL.
      if (frame.filename !== undefined) frame.filename = scrubFileName(frame.filename);
      if (frame.abs_path !== undefined) frame.abs_path = scrubFileName(frame.abs_path);
      delete frame.vars;
    }
  }
  return event;
}

export interface MonitoringOptions {
  dsn: string | undefined;
  environment?: string;
  release?: string;
  /** Tests only: where events go instead of the network. */
  transport?: BrowserOptions['transport'];
}

/** Start error monitoring when a DSN is set. Returns whether it started. */
export function initMonitoring(options: MonitoringOptions): boolean {
  if (options.dsn === undefined || options.dsn.trim() === '') return false;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    // Collect none of the user's data: no IP, cookies, headers, bodies or query.
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
    // An allow-list, not Sentry's defaults: those also record breadcrumbs
    // (clicks with element text, console lines, fetched URLs), the page URL
    // (HttpContext) and sessions. No replay, no tracing.
    defaultIntegrations: false,
    integrations: [
      Sentry.eventFiltersIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.browserApiErrorsIntegration(),
      // window.onerror and unhandledrejection: Next hands React's uncaught
      // render errors to reportError, so they arrive here too.
      Sentry.globalHandlersIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
    ],
    sendClientReports: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: () => null,
    ...(options.transport ? { transport: options.transport } : {}),
  });
  return true;
}

/**
 * Report an API call that failed for real: a 5xx (`status`), or no answer at
 * all (`'network'`). Only the method and the path's template leave, never the
 * URL, the body or the server's message. A no-op when monitoring is off.
 */
export function captureApiFailure(method: string, path: string, status: number | 'network'): void {
  const route = `${method} ${templatePath(path)}`;
  const what = status === 'network' ? 'no answer' : String(status);
  Sentry.withScope((scope) => {
    scope.setTag('route', route);
    scope.setTag('status', what);
    // One issue per route and status, not one for every call site's stack.
    scope.setFingerprint(['api-failure', route, what]);
    Sentry.captureException(new ApiFailure(`${route}: ${what}`));
  });
}
