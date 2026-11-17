import type {
  ClassDetail,
  FeedEvent,
  RosterResponse,
  RosterStudent,
  SessionReportQuestion,
  SessionReportQuestionsResponse,
  SessionReportResponse,
  SessionReportsPage,
  SessionReportSummary,
} from '@bali/shared';

import { type ApiClient, ApiError } from './api-client';
import { errText } from './errors';
import {
  bareTime,
  classFigures,
  type RecapFormat,
  readEvents,
  recapGroups,
  sessionWhen,
  type SessionWindow,
} from './recap';

/*
 * The reports' logic (R5), tested: R3's sessions a page at a time, each with how many stayed
 * focused the whole time, and each row's words; the share of class time spent focused (LO8); and a
 * session's own page (PV14).
 */

/**
 * The sessions Reports reads a page (LO8): ten, about as many as its board draws, since each one
 * someone joined costs three reads more for its whole-time count, all from the teacher's budget.
 */
export const REPORTS_PAGE = 10;

/** An id as the API mints them (a UUID): anything else in a URL names no class or session. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A session's report page (PV14): Reports' rows and the class page's recap link to it. */
export const reportPath = (classId: string, sessionId: string): string =>
  `/reports/${encodeURIComponent(classId)}/${encodeURIComponent(sessionId)}`;

/** The newest page, or Show earlier's: the one before the oldest read. */
export type ReadAt = 'newest' | 'earlier';

export interface SessionList {
  className: string | null;
  /** Newest first, each once; only sessions the server has marked over, as the card's rule is. */
  sessions: SessionReportSummary[];
  /**
   * How many of those who joined stayed focused the whole time, by session id: each session listed
   * that someone joined, counted as its recap counts them (`wholeTimeOf`) before it is listed.
   */
  wholeTime: Record<string, number>;
  /** Show earlier's cursor: null at the end, and before any page. */
  nextBefore: string | null;
  loaded: boolean;
  reading: ReadAt | null;
  /** Why the last read failed, said where it was asked, with its Try again, until a read answers. */
  failure: { at: ReadAt; message: string } | null;
  /** Show earlier's cursor was one the class doesn't hold, so the newest page was read again. */
  restarted: boolean;
}

export const FIRST_READ: SessionList = {
  className: null,
  sessions: [],
  wholeTime: {},
  nextBefore: null,
  loaded: false,
  reading: 'newest',
  failure: null,
  restarted: false,
};

/**
 * A read starts: a failure stays said until its answer, so its Try again holds in its place; the
 * place lost goes.
 */
export function startRead(list: SessionList, at: ReadAt): SessionList {
  return { ...list, reading: at, restarted: false };
}

/**
 * Read a page (R3, `REPORTS_PAGE` at a time) onto `list`: Show earlier's after those read, or the
 * newest (with the class, for its name) in their place, each session someone joined listed only once
 * its whole-time count is in (`counted` keeps them for the page, so a class picked again reads
 * none). Show earlier's cursor refused as `unknown_cursor` re-reads the newest, and says so; any
 * other failure, a count's included, is said where it was asked, the sessions read kept.
 */
export async function readSessions(
  api: Pick<ApiClient, 'get'>,
  classId: string,
  list: SessionList,
  at: ReadAt,
  counted: Map<string, number> = new Map(),
): Promise<SessionList> {
  const klass = `/v1/classes/${encodeURIComponent(classId)}`;
  const reports = `${klass}/reports/sessions?limit=${REPORTS_PAGE}`;
  try {
    if (at === 'earlier') {
      // At the end there is nothing earlier: the list as it is, never the newest page in its place.
      if (list.nextBefore === null) return { ...list, reading: null };
      const page = await api.get<SessionReportsPage>(
        `${reports}&before=${encodeURIComponent(list.nextBefore)}`,
      );
      return await settled(api, classId, counted, list, list, page);
    }
    const [{ name }, page] = await Promise.all([
      api.get<ClassDetail>(klass),
      api.get<SessionReportsPage>(reports),
    ]);
    const none = { sessions: [], wholeTime: {} };
    return {
      ...(await settled(api, classId, counted, list, none, page)),
      className: name,
      loaded: true,
    };
  } catch (e) {
    if (at === 'earlier' && e instanceof ApiError && e.reason === 'unknown_cursor') {
      const fresh = await readSessions(api, classId, list, 'newest', counted);
      // Failed too, it keeps no cursor: Show earlier never offers the one the server refused.
      return fresh.failure
        ? { ...fresh, nextBefore: null, restarted: false }
        : { ...fresh, restarted: true };
    }
    return { ...list, reading: null, failure: { at, message: errText(e) } };
  }
}

/** A page's sessions after those `kept`, each new one someone joined with its whole-time count. */
async function settled(
  api: Pick<ApiClient, 'get'>,
  classId: string,
  counted: Map<string, number>,
  list: SessionList,
  kept: Pick<SessionList, 'sessions' | 'wholeTime'>,
  page: SessionReportsPage,
): Promise<SessionList> {
  const known = new Set(kept.sessions.map((s) => s.id));
  const added = page.sessions.filter((s) => s.ended && !known.has(s.id));
  const counts = await Promise.all(
    added
      .filter((s) => s.joinedCount > 0)
      .map(async (s) => {
        // Its figures in the key: a late unlock or protection off, which can land after the bell
        // and end someone's whole time, changes them, so its count is read again.
        const key = `${s.id} ${s.joinedCount} ${s.unlockCount} ${s.protectionOffCount}`;
        const whole = counted.get(key) ?? (await wholeTimeOf(api, classId, s));
        counted.set(key, whole);
        return [s.id, whole] as const;
      }),
  );
  return {
    ...list,
    sessions: [...kept.sessions, ...added],
    wholeTime: { ...kept.wholeTime, ...Object.fromEntries(counts) },
    nextBefore: page.nextBefore,
    reading: null,
    failure: null,
  };
}

/**
 * How many of a session's students who joined stayed focused the whole time, as its recap counts
 * them (`recapGroups`), from its report (R2) and its events: the class page's own reads of its last
 * session (LO4), so Reports, the class page and the recap never disagree.
 */
export async function wholeTimeOf(
  api: Pick<ApiClient, 'get'>,
  classId: string,
  session: SessionReportSummary,
): Promise<number> {
  const [report, events] = await Promise.all([
    api.get<SessionReportResponse>(
      `/v1/classes/${encodeURIComponent(classId)}/reports/sessions/${encodeURIComponent(session.id)}`,
    ),
    readEvents(api, session.id),
  ]);
  return recapGroups(session, report, events, []).wholeTime.length;
}

/** A session's length in whole minutes: its start to its end, or to its bell until it is over. */
export const minutesLong = (session: SessionWindow): number =>
  Math.round(
    (Date.parse(session.endedAt ?? session.endsAt) - Date.parse(session.startedAt)) / 60_000,
  );

/**
 * A session's average focus as its bar (Reports): out of its length, rounded to whole minutes as R2
 * rounds the average; null when nobody joined, who have no average.
 */
export function focusBar(
  session: SessionReportSummary,
  locale?: string,
): { words: string; percent: number } | null {
  const average = session.averageFocusMinutes;
  if (average === null) return null;
  const length = minutesLong(session);
  const n = new Intl.NumberFormat(locale);
  return {
    words: `${n.format(average)} of ${n.format(length)} min`,
    percent: length > 0 ? Math.min(100, (average / length) * 100) : 0,
  };
}

/**
 * The share of class time spent focused (Reports, LO8), over the sessions listed someone joined:
 * the class's focus minutes over its students' time there, each student's time the session's length,
 * as its bar counts it. In whole percent, rounded down so it never claims more than was kept; null
 * when nobody joined any, which leaves no class time to share.
 */
export function focusShare(sessions: readonly SessionReportSummary[]): number | null {
  let focus = 0;
  let time = 0;
  for (const session of sessions) {
    if (session.joinedCount === 0) continue;
    focus += session.focusMinutes;
    time += session.joinedCount * minutesLong(session);
  }
  // Whole minutes both, so the division is exact where it is whole: 29 of 100 is 29, never 28.
  return time > 0 ? Math.min(100, Math.floor((100 * focus) / time)) : null;
}

/** A session's report page as it reads (PV14): loading, read, or why it couldn't be. */
export type SessionPage =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      /** When it ran, R2's own. */
      session: SessionWindow;
      report: SessionReportResponse;
      events: FeedEvent[];
      /** The class's roster now: who didn't join, as the class page's recap reads it. */
      roster: RosterStudent[];
    }
  | { kind: 'error'; message: string };

/**
 * Read a session's page: its report (R2, when it ran included), its events and the class's roster,
 * all three at once. Any failure is said with Try again, which reads all three again; so is a
 * report that says nothing of when it ran, an API's from before PV14 (the portal can deploy first).
 * Home's Last session reads it too (LO3), its figures counted as the recap counts them.
 */
export async function readSessionPage(
  api: Pick<ApiClient, 'get'>,
  classId: string,
  sessionId: string,
): Promise<SessionPage> {
  const klass = `/v1/classes/${encodeURIComponent(classId)}`;
  try {
    const [report, events, { students }] = await Promise.all([
      api.get<SessionReportResponse>(`${klass}/reports/sessions/${encodeURIComponent(sessionId)}`),
      readEvents(api, sessionId),
      api.get<RosterResponse>(`${klass}/roster`),
    ]);
    const { startedAt, endsAt, endedAt = null } = report;
    if (startedAt === undefined || endsAt === undefined) {
      return { kind: 'error', message: errText(null) };
    }
    return {
      kind: 'ready',
      session: { startedAt, endsAt, endedAt },
      report,
      events,
      roster: students,
    };
  } catch (e) {
    return { kind: 'error', message: errText(e) };
  }
}

/** A session's Questions card as it reads (L7c): loading, read, or not read. */
export type SessionQuestions =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      /** In the order asked, each with its totals as the server counts them; none: none asked. */
      questions: SessionReportQuestion[];
    }
  | { kind: 'error' };

/**
 * Read the questions a session asked (L3c's read), for its report page's Questions card: each with
 * its totals through the server's one guarded count, `counts` null under 3 answers. Its failure is
 * the card's own, said with Try again (LessonStates' line), the rest of the page left as it is.
 */
export async function readSessionQuestions(
  api: Pick<ApiClient, 'get'>,
  classId: string,
  sessionId: string,
): Promise<SessionQuestions> {
  try {
    const { questions } = await api.get<SessionReportQuestionsResponse>(
      `/v1/classes/${encodeURIComponent(classId)}/reports/sessions/${encodeURIComponent(sessionId)}/questions`,
    );
    return { kind: 'ready', questions };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * A row's words: its day; its times as Reports says them, the start's AM or PM left off when the
 * end's is the same, "9:05 to 9:55 AM", and kept when it isn't, "11:30 AM to 12:20 PM"; and its
 * figures as its recap says them (null: nobody joined).
 */
export function sessionRow(session: SessionReportSummary, format: RecapFormat = {}) {
  const { locale, timeZone } = format;
  const count = new Intl.NumberFormat(locale);
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const start = Date.parse(session.startedAt);
  const end = Date.parse(session.endedAt ?? session.endsAt);
  const period = (at: number) => clock.formatToParts(at).find((p) => p.type === 'dayPeriod')?.value;
  const from = period(start) === period(end) ? bareTime(start, clock) : clock.format(start);
  return {
    day: sessionWhen(session, format).day,
    times: `${from} to ${clock.format(end)}`,
    figures: session.joinedCount ? classFigures(session.joinedCount, session, locale) : null,
    unlocks: count.format(session.unlockCount),
    protectionOffs: count.format(session.protectionOffCount),
  };
}
