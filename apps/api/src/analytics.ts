import { type Database, getSessionEvents, sessionTotalsOf } from '@bali/db';

import { captureFailure, environmentOf } from './monitoring.js';
import { counted } from './routes/reports.js';

/*
 * PostHog, the server's half (A2; ARCHITECTURE, "Analytics (PostHog)"): a class's totals when a
 * session starts, ends or is extended, posted to PostHog's capture endpoint with a plain fetch, no
 * SDK. Off until POSTHOG_KEY is set. Each event is built here alone: the class's teacher by Bali's
 * id, the server's time, and `sessionProperties`' numbers and one fixed word, so no student's id,
 * name or email, no class or session name, no URL and no free text can go. Sent once what it counts
 * has committed and never awaited: a send never fails or delays a request or the sweep, gives up
 * at its timeout, and a failure is logged with nothing personal in it.
 */

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
/** How long one send may take: well inside the shutdown's deadline. */
const POSTHOG_TIMEOUT_MS = 5_000;

export type SessionEvent = 'session_started' | 'session_ended' | 'session_extended';
/**
 * Who ended a session: its teacher's End; its bell (the sweep, or a Start or a disposal past it);
 * or the owner's command (`npm run school`'s end-session, or a disposal ending it while it ran).
 */
export type EndedBy = 'teacher' | 'bell' | 'owner';

/** What a server event's properties may hold: these, and nothing else. */
export interface SessionProperties {
  environment: string;
  students_enrolled: number;
  students_tapped_in: number;
  planned_minutes: number;
  session_minutes: number;
  focus_minutes: number;
  /** One number, never split by reason ("nurse" may be health data). */
  unlocks: number;
  ended_by?: EndedBy;
}

const minutes = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60_000);

/**
 * A class's totals as an event's properties, the one place they are made: the report's own
 * counts (`counted`, R1), its bell's and its length so far in whole minutes.
 */
export function sessionProperties(totals: {
  environment: string;
  enrolled: number;
  session: { startedAt: Date; endsAt: Date };
  report: ReturnType<typeof counted>;
  /** The event's time. */
  at: Date;
  endedBy?: EndedBy;
}): SessionProperties {
  const { session, report } = totals;
  return {
    environment: totals.environment,
    students_enrolled: totals.enrolled,
    students_tapped_in: report.joined.length,
    planned_minutes: minutes(session.startedAt, session.endsAt),
    session_minutes: minutes(session.startedAt, totals.at),
    focus_minutes: report.focusMinutes,
    unlocks: report.unlocks.length,
    ...(totals.endedBy && { ended_by: totals.endedBy }),
  };
}

export interface AnalyticsConfig {
  key: string;
  /** The capture endpoint. */
  url: string;
  environment: string;
}

type AnalyticsEnv = {
  POSTHOG_KEY?: string | undefined;
  POSTHOG_HOST?: string | undefined;
  SENTRY_ENVIRONMENT?: string | undefined;
  NODE_ENV?: string | undefined;
};

/**
 * PostHog's configuration, or undefined while its key is unset (env.ts): from the API's env, or
 * from the owner's command's own process, where blank is unset too.
 */
export function analyticsConfig(env: AnalyticsEnv): AnalyticsConfig | undefined {
  if (!env.POSTHOG_KEY) return undefined;
  const host = (env.POSTHOG_HOST || DEFAULT_POSTHOG_HOST).replace(/\/+$/, '');
  return { key: env.POSTHOG_KEY, url: `${host}/i/v0/e/`, environment: environmentOf(env) };
}

/** Where a failure is logged: the app's logger, or the owner's command's. */
export interface AnalyticsLog {
  warn(details: object, message: string): void;
  error(details: object, message: string): void;
}

export interface Analytics {
  /** Counts a session's event in the background, after its commit; nothing while off. */
  track(event: SessionEvent, sessionId: string, endedBy?: EndedBy): void;
  /** Waits out every send still on its way: the shutdown's, and the owner's command's. */
  settled(): Promise<void>;
}

export interface AnalyticsOptions {
  /** Tests send to a fake; unset, the real fetch. */
  fetch?: typeof fetch;
  /** The server's clock; unset, the system's. */
  clock?: () => Date;
  timeoutMs?: number;
}

export function createAnalytics(
  config: AnalyticsConfig | undefined,
  db: Database,
  log: AnalyticsLog,
  {
    fetch: post = fetch,
    clock = () => new Date(),
    timeoutMs = POSTHOG_TIMEOUT_MS,
  }: AnalyticsOptions = {},
): Analytics {
  if (!config) return { track: () => undefined, settled: () => Promise.resolve() };
  const inFlight = new Set<Promise<void>>();

  /**
   * The event, read after the commit: the session's totals as its report counts them, to its end
   * once it has ended, else to now; stamped when the server started or ended it, or now.
   */
  const build = async (event: SessionEvent, sessionId: string, endedBy?: EndedBy) => {
    const now = clock();
    const read = await sessionTotalsOf(db, sessionId, now);
    // Each caller has just written it, and no path deletes a session.
    if (!read) throw new Error(`session ${sessionId} vanished before it was counted`);
    const { session, teacherId, enrolled } = read;
    const until = session.endedAt ?? now;
    const stamps = {
      session_started: session.startedAt,
      session_ended: until,
      session_extended: now,
    };
    const at = stamps[event];
    const report = counted(session, await getSessionEvents(db, sessionId), until);
    return {
      api_key: config.key,
      event,
      distinct_id: teacherId,
      timestamp: at.toISOString(),
      properties: sessionProperties({
        environment: config.environment,
        enrolled,
        session,
        report,
        at,
        endedBy,
      }),
    };
  };

  const capture = async (event: SessionEvent, sessionId: string, endedBy?: EndedBy) => {
    const body = JSON.stringify(await build(event, sessionId, endedBy));
    let response: Response;
    try {
      response = await post(config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // PostHog's failure, or the network's: its words carry no key, but make sure.
      const failure = (err instanceof Error ? err.message : String(err)).replaceAll(
        config.key,
        '[key]',
      );
      log.warn({ event, sessionId, failure }, 'analytics event not sent');
      return;
    }
    // Read to its end, though none of it is used, so its connection goes back at once.
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok) {
      log.warn({ event, sessionId, status: response.status }, 'analytics event refused');
    }
  };

  return {
    track(event, sessionId, endedBy) {
      const sending = capture(event, sessionId, endedBy)
        .catch((err: unknown) => {
          // Our own failure (reading the totals), not PostHog's: reported like a 500.
          log.error({ err, event, sessionId }, 'analytics event failed');
          captureFailure(err, 'analytics');
        })
        .finally(() => {
          inFlight.delete(sending);
        });
      inFlight.add(sending);
    },
    async settled() {
      // Until none is left: a request still answering as the close began may add one.
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}
