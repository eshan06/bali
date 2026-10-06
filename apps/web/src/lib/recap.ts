import type {
  ReportStudent,
  SessionReportResponse,
  SessionReportsPage,
  SessionReportSummary,
  UnlockReason,
} from '@bali/shared';
import { isUnlockReason } from '@bali/shared';

import type { ApiClient } from './api-client';
import { errText } from './errors';

/*
 * The recap card's logic (R4), kept out of the component so it can be tested directly, as the
 * grid's is: which session it recaps, how it loads, and the words and numbers it shows. Class
 * aggregates only, as R2 answers them: never one student's minutes, so nothing ranks them.
 */

/**
 * The session the card recaps: the class's newest (R3's first row), once the server has marked
 * it over. One running, or past its bell before the sweep marks it, has no recap yet.
 */
export function latestEnded(page: SessionReportsPage): SessionReportSummary | null {
  const newest = page.sessions[0];
  return newest?.ended ? newest : null;
}

export type RecapState =
  /** Looking for the class's last session: the card shows nothing until there is one. */
  | { kind: 'finding' }
  | { kind: 'none' }
  /** Its report on the way; the session is null on a retry, until it is found again. */
  | { kind: 'loading'; session: SessionReportSummary | null }
  | { kind: 'ready'; session: SessionReportSummary; report: SessionReportResponse }
  | { kind: 'error'; message: string };

/**
 * The class's last session (R3, one row), or `known` (R5's opened row): read its report (R2),
 * telling `show` each step after the first. Every failure ends in `error`, for Try again.
 */
export async function loadRecap(
  api: Pick<ApiClient, 'get'>,
  classId: string,
  known: SessionReportSummary | undefined,
  show: (state: RecapState) => void,
): Promise<void> {
  const reports = `/v1/classes/${encodeURIComponent(classId)}/reports/sessions`;
  try {
    const session = known ?? latestEnded(await api.get<SessionReportsPage>(`${reports}?limit=1`));
    if (session === null) {
      show({ kind: 'none' });
      return;
    }
    show({ kind: 'loading', session });
    const report = await api.get<SessionReportResponse>(
      `${reports}/${encodeURIComponent(session.id)}`,
    );
    show({ kind: 'ready', session, report });
  } catch (e) {
    show({ kind: 'error', message: errText(e) });
  }
}

/** The viewer's own locale and time zone unless given, so tests can pin them. */
export interface RecapFormat {
  locale?: string;
  timeZone?: string;
}

/** When the session ran, its start to its end: "Sun, Oct 4, 9:05 AM to 9:30 AM". */
export function sessionTimes(
  session: SessionReportSummary,
  { locale, timeZone }: RecapFormat = {},
): string {
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  });
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const start = new Date(session.startedAt);
  const end = new Date(session.endedAt ?? session.endsAt);
  return `${day.format(start)}, ${clock.format(start)} to ${clock.format(end)}`;
}

/** The reasons as the student's phone shows them to pick. */
const REASON_TEXT: Record<UnlockReason, string> = {
  bathroom: 'Bathroom',
  nurse: 'Nurse',
  other: 'Other',
};

/** A student as the grid names them: their display name, else the start of their id. */
function nameOf(s: ReportStudent): string {
  return s.displayName ?? s.id.slice(0, 8);
}

/** One moment in a list: who, when, and for an unlock its reason. */
export interface RecapMoment {
  key: string;
  name: string;
  time: string;
  reason?: string;
}

/** The class's figures in words, as the card and the reports list (R5) both say them. */
export function classFigures(
  joined: number,
  minutes: Pick<SessionReportSummary, 'focusMinutes' | 'averageFocusMinutes' | 'silentMinutes'>,
  locale?: string,
) {
  const min = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute' }); // "83 min"
  return {
    joined: new Intl.NumberFormat(locale).format(joined),
    focus: min.format(minutes.focusMinutes),
    // Null only when nobody joined (R2), when there are no figures at all.
    average: min.format(minutes.averageFocusMinutes ?? 0),
    silent: min.format(minutes.silentMinutes),
  };
}

export interface RecapView {
  /** The class's figures; null when nobody joined, which the card says instead of zeros. */
  stats: ReturnType<typeof classFigures> | null;
  /** Who joined, in the order they first did (R2's). */
  joined: { key: string; name: string }[];
  /** Oldest first, every one R2 lists, whatever it changed. */
  unlocks: RecapMoment[];
  protectionOffs: RecapMoment[];
}

/**
 * The card's words and numbers, from R2's report. In Present (`present`), the projector the class
 * can see, every unlock is still listed by who and when, but never with its reason: the student
 * shares it with the teacher alone (#265's rule, `unlockNote`).
 */
export function recapView(
  report: SessionReportResponse,
  { locale, timeZone }: RecapFormat = {},
  present = false,
): RecapView {
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const moment = (e: { eventId: string; student: ReportStudent; occurredAt: string }) => ({
    key: e.eventId,
    name: nameOf(e.student),
    time: clock.format(new Date(e.occurredAt)),
  });
  return {
    stats: report.joined.length === 0 ? null : classFigures(report.joined.length, report, locale),
    joined: report.joined.map((s) => ({ key: s.id, name: nameOf(s) })),
    unlocks: report.unlocks.map((u) => ({
      ...moment(u),
      // A reason this build doesn't know reads as none (API decision 4).
      reason: present
        ? undefined
        : isUnlockReason(u.reason)
          ? REASON_TEXT[u.reason]
          : 'No reason given',
    })),
    protectionOffs: report.protectionOffs.map(moment),
  };
}
