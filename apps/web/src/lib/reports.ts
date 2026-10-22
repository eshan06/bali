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
  classFigures,
  type RecapFormat,
  readEvents,
  sessionWhen,
  type SessionWindow,
} from './recap';

/*
 * The reports' logic (R5), tested: R3's sessions a page at a time and each row's words, and a
 * session's own page (PV14).
 */

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
 * Read a page (R3) onto `list`: Show earlier's after those read, or the newest (with the class, for
 * its name) in their place. Show earlier's cursor refused as `unknown_cursor` re-reads the newest,
 * and says so; any other failure is said where it was asked, the sessions read kept.
 */
export async function readSessions(
  api: Pick<ApiClient, 'get'>,
  classId: string,
  list: SessionList,
  at: ReadAt,
): Promise<SessionList> {
  const klass = `/v1/classes/${encodeURIComponent(classId)}`;
  const reports = `${klass}/reports/sessions`;
  try {
    if (at === 'earlier') {
      // At the end there is nothing earlier: the list as it is, never the newest page in its place.
      if (list.nextBefore === null) return { ...list, reading: null };
      const page = await api.get<SessionReportsPage>(
        `${reports}?before=${encodeURIComponent(list.nextBefore)}`,
      );
      return settled(list, list.sessions, page);
    }
    const [{ name }, page] = await Promise.all([
      api.get<ClassDetail>(klass),
      api.get<SessionReportsPage>(reports),
    ]);
    return { ...settled(list, [], page), className: name, loaded: true };
  } catch (e) {
    if (at === 'earlier' && e instanceof ApiError && e.reason === 'unknown_cursor') {
      const fresh = await readSessions(api, classId, list, 'newest');
      // Failed too, it keeps no cursor: Show earlier never offers the one the server refused.
      return fresh.failure
        ? { ...fresh, nextBefore: null, restarted: false }
        : { ...fresh, restarted: true };
    }
    return { ...list, reading: null, failure: { at, message: errText(e) } };
  }
}

function settled(list: SessionList, kept: SessionReportSummary[], page: SessionReportsPage) {
  const known = new Set(kept.map((s) => s.id));
  const sessions = [...kept, ...page.sessions.filter((s) => s.ended && !known.has(s.id))];
  return { ...list, sessions, nextBefore: page.nextBefore, reading: null, failure: null };
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

/** A session's report as Home's Last session reads it (PV17c): being read, read, or why not. */
export type ReportRead =
  | { kind: 'loading' }
  | { kind: 'ready'; report: SessionReportResponse }
  | { kind: 'error'; message: string };

/**
 * Read a session's report (R2) alone, for Home's Last session: its figures. Within a minute of its
 * bell it says `ended: false` (the sweep hasn't marked it yet), its figures already counted to the
 * bell; the card never reads that flag. Never thrown: a failure is said with Try again.
 */
export async function readReport(
  api: Pick<ApiClient, 'get'>,
  classId: string,
  sessionId: string,
): Promise<Exclude<ReportRead, { kind: 'loading' }>> {
  try {
    const report = await api.get<SessionReportResponse>(
      `/v1/classes/${encodeURIComponent(classId)}/reports/sessions/${encodeURIComponent(sessionId)}`,
    );
    return { kind: 'ready', report };
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

/** A row's words: its day, its times, and its figures as its recap says them (null: nobody joined). */
export function sessionRow(session: SessionReportSummary, format: RecapFormat = {}) {
  const count = new Intl.NumberFormat(format.locale);
  return {
    ...sessionWhen(session, format),
    figures: session.joinedCount ? classFigures(session.joinedCount, session, format.locale) : null,
    unlocks: count.format(session.unlockCount),
    protectionOffs: count.format(session.protectionOffCount),
  };
}
