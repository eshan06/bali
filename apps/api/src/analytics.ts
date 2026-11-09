import { type Database, getSessionEvents, sessionTotalsOf } from '@bali/db';
import type { PortalEvent } from '@bali/shared';

import { captureFailure, environmentOf } from './monitoring.js';
import { counted } from './routes/reports.js';

/*
 * PostHog, the server's half (A2; ARCHITECTURE, "Analytics (PostHog)"): a class's totals when a
 * session starts, ends or is extended, posted to PostHog's capture endpoint with a plain fetch, no
 * SDK. Off until POSTHOG_KEY is set. Each event is built here alone: the class's teacher by Bali's
 * id, the server's time, and `sessionProperties`' numbers and one fixed word, so no student's id,
 * name or email, no class or session name, no URL and no free text can go. Sent once what it counts
 * has committed and never awaited: a send never fails or delays a request or the sweep, gives up
 * at its timeout, and a failure is logged with nothing personal in it. The portal's teacher
 * actions (A3a, `POST /v1/me/actions`) go the same way, built here too. Every event is personless,
 * so PostHog keeps no profile per teacher (A6, `capture`).
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

/** What a server event's properties may hold: these, and nothing else but `capture`'s flag (A6). */
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
 * counts (`counted`, R1), its bell's and its length so far in whole minutes. The bell's are the
 * whole minutes picked, its Start's and every extend's: the bell rings on the whole minute at or
 * after them (the owner, 2026-11-08), less than one more, so they are its length rounded down.
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
    planned_minutes: Math.floor((session.endsAt.getTime() - session.startedAt.getTime()) / 60_000),
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
  /**
   * Counts a teacher's action in the portal (A3a) in the background, as `teacherId` (Bali's id),
   * at the server's clock now, with `eventId` as its `uuid`; nothing while off.
   */
  action(event: PortalEvent, teacherId: string, eventId: string): void;
  /** Waits out every send still on its way: the shutdown's, and the owner's command's. */
  settled(): Promise<void>;
}

/**
 * What the owner's commands do with each lesson they end (`npm run school`, its
 * `SchoolCommandIO.ended`): one ended as an End ends it counts as the owner's, one past its bell
 * as the bell's.
 */
export function ownerEnds(analytics: Analytics) {
  return (sessionId: string, reason: 'ended' | 'expired') =>
    analytics.track('session_ended', sessionId, reason === 'ended' ? 'owner' : 'bell');
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
  if (!config) {
    return { track: () => undefined, action: () => undefined, settled: () => Promise.resolve() };
  }
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

  /** What a log line names an event by: never a person, never the key. */
  type About = { event: string; sessionId?: string };

  /** An event as `build` and `action` make it, without what every event carries. */
  type Made = {
    event: string;
    distinct_id: string;
    timestamp: string;
    uuid?: string;
    properties: object;
  };

  /**
   * Posts the event `made` builds, with what every event carries, added here because every send
   * comes through here: the project's key, and `$process_person_profile: false`, so PostHog keeps
   * no profile per teacher (A6, the owner, 2026-11-07). PostHog calls such an event personless
   * ("anonymous" in its docs). What its docs and its ingestion code say it does (read 2026-11-07):
   * - No person profile is made or updated: no person row, so none outlasts a teacher's events.
   *   Without it, an event sent to the capture endpoint is identified and makes one.
   * - The event keeps its `distinct_id`, the teacher's Bali id, and gets a person id made from that
   *   id alone (a UUIDv5 of the project and the id), so a teacher's events still share one: unique
   *   teachers, trends and funnels count them by teacher, as before. Lifecycle insights leave such
   *   events out, and cohorts, person properties and groups don't apply; Bali uses none of them.
   * - Nothing else changes: `$set`, `$set_once` and `$unset` are dropped, and Bali sends none.
   * - Only the boolean `false` counts; any other value is read as `true`, with a warning. A
   *   `distinct_id` that already has a profile stays linked to it: the flag stops new profiles and
   *   deletes none.
   * - PostHog's handbook still says each such id is also noted in a table of its own
   *   (`posthog_personlessdistinctid`); its ingestion stopped writing that table on 2026-08-11
   *   (PostHog's #80861), and the table is to be dropped.
   */
  const capture = async (about: About, made: () => Promise<Made> | Made) => {
    const { properties, ...event } = await made();
    const body = JSON.stringify({
      api_key: config.key,
      ...event,
      properties: { ...properties, $process_person_profile: false },
    });
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
      log.warn({ ...about, failure }, 'analytics event not sent');
      return;
    }
    // Read to its end, though none of it is used, so its connection goes back at once.
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok) {
      log.warn({ ...about, status: response.status }, 'analytics event refused');
    }
  };

  /** `capture` in the background, waited out by `settled`. */
  const send = (about: About, made: () => Promise<Made> | Made) => {
    const sending = capture(about, made)
      .catch((err: unknown) => {
        // Our own failure (reading the totals), not PostHog's: reported like a 500.
        log.error({ err, ...about }, 'analytics event failed');
        captureFailure(err, 'analytics');
      })
      .finally(() => {
        inFlight.delete(sending);
      });
    inFlight.add(sending);
  };

  return {
    track(event, sessionId, endedBy) {
      send({ event, sessionId }, () => build(event, sessionId, endedBy));
    },
    action(event, teacherId, eventId) {
      const at = clock();
      send({ event }, () => ({
        event,
        distinct_id: teacherId,
        timestamp: at.toISOString(),
        // So PostHog can drop a resend, the id lower case as the server prints ids, whatever case
        // it came in. Only best effort: PostHog keeps one of two events with the same uuid only
        // when they share the event, the distinct_id and the UTC day of their timestamp too, and
        // only once ClickHouse merges the parts that hold them, which it never promises (PostHog's
        // handbook, "sharded_events"). So a resend may still count twice, and one sent on another
        // UTC day always does.
        uuid: eventId.toLowerCase(),
        properties: { environment: config.environment },
      }));
    },
    async settled() {
      // Until none is left: a request still answering as the close began may add one.
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}
