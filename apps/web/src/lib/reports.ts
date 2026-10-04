import type { ClassDetail, SessionReportsPage, SessionReportSummary } from '@bali/shared';

import { type ApiClient, ApiError } from './api-client';
import { errText } from './errors';
import { classFigures, type RecapFormat, sessionTimes } from './recap';

/* The reports page's logic (R5), tested: R3's sessions a page at a time, and each row's words. */

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
  /** Why the last read failed, said where it was asked, with its Try again. */
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

/** A read starts, and what the last one said goes. */
export function startRead(list: SessionList, at: ReadAt): SessionList {
  return { ...list, reading: at, failure: null, restarted: false };
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
      return fresh.failure ? { ...fresh, nextBefore: null } : { ...fresh, restarted: true };
    }
    return { ...list, reading: null, failure: { at, message: errText(e) } };
  }
}

function settled(list: SessionList, kept: SessionReportSummary[], page: SessionReportsPage) {
  const known = new Set(kept.map((s) => s.id));
  const sessions = [...kept, ...page.sessions.filter((s) => s.ended && !known.has(s.id))];
  return { ...list, sessions, nextBefore: page.nextBefore, reading: null, failure: null };
}

/** A row's words, its figures as its recap says them (null: nobody joined). */
export function sessionRow(session: SessionReportSummary, format: RecapFormat = {}) {
  const count = new Intl.NumberFormat(format.locale);
  return {
    when: sessionTimes(session, format),
    figures: session.joinedCount ? classFigures(session.joinedCount, session, format.locale) : null,
    unlocks: count.format(session.unlockCount),
    protectionOffs: count.format(session.protectionOffCount),
  };
}
