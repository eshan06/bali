import type {
  EventsPage,
  EventType,
  FeedEvent,
  ReportStudent,
  RosterStudent,
  SessionReportResponse,
  SessionReportsPage,
  SessionReportSummary,
  UnlockReason,
} from '@bali/shared';
import { isUnlockReason } from '@bali/shared';

import type { ApiClient } from './api-client';
import { errText } from './errors';

/*
 * The recap's logic (R4; ClassEnded since PV12), kept out of the component so it can be tested
 * directly, as the grid's is: which session the class page recaps, how it loads, and the words,
 * numbers and marks the recap shows there and on a session's report page (PV14). Class aggregates
 * only, as R2 answers them, and each moment a mark at its time: never one student's minutes, so
 * nothing ranks them.
 */

/** When a session ran: its start, its bell and when it was marked over, as R3's row and R2 say. */
export type SessionWindow = Pick<SessionReportSummary, 'startedAt' | 'endsAt' | 'endedAt'>;

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
  | {
      kind: 'ready';
      session: SessionReportSummary;
      report: SessionReportResponse;
      events: FeedEvent[];
    }
  | { kind: 'error'; message: string };

/**
 * Every event of a session after `from` (its start, unless given), oldest first, as the catch-up
 * feed pages them (200 a request), until a page comes back empty.
 * ponytail: each page is a request on the teacher's budget, so a session of thousands of events
 * can meet a 429, said as any failure, with Try again; cap the pages if one ever does.
 */
export async function readEvents(
  api: Pick<ApiClient, 'get'>,
  sessionId: string,
  from = 0,
): Promise<FeedEvent[]> {
  const events: FeedEvent[] = [];
  for (let after = from; ;) {
    const page = await api.get<EventsPage>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/events?after=${after}`,
    );
    events.push(...page.events);
    // An empty page is the end, whatever size the server pages by; a cursor that didn't move would
    // read the same page forever.
    if (page.events.length === 0 || page.nextAfter <= after) return events;
    after = page.nextAfter;
  }
}

/**
 * The class's last session (R3, one row): read its report (R2) and its events, telling `show` each
 * step after the first. Every failure ends in `error`, for Try again: the moments are the recap, so
 * its figures are never shown without them.
 */
export async function loadRecap(
  api: Pick<ApiClient, 'get'>,
  classId: string,
  show: (state: RecapState) => void,
): Promise<void> {
  const reports = `/v1/classes/${encodeURIComponent(classId)}/reports/sessions`;
  try {
    const session = latestEnded(await api.get<SessionReportsPage>(`${reports}?limit=1`));
    if (session === null) {
      show({ kind: 'none' });
      return;
    }
    show({ kind: 'loading', session });
    const [report, events] = await Promise.all([
      api.get<SessionReportResponse>(`${reports}/${encodeURIComponent(session.id)}`),
      readEvents(api, session.id),
    ]);
    show({ kind: 'ready', session, report, events });
  } catch (e) {
    show({ kind: 'error', message: errText(e) });
  }
}

/** The viewer's own locale and time zone unless given, so tests can pin them. */
export interface RecapFormat {
  locale?: string;
  timeZone?: string;
}

/** When the session ran: its day, "Sun, Oct 4", and its start to its end, "9:05 AM to 9:30 AM". */
export function sessionWhen(
  session: SessionWindow,
  { locale, timeZone }: RecapFormat = {},
): { day: string; times: string } {
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone,
  });
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const start = new Date(session.startedAt);
  const end = new Date(session.endedAt ?? session.endsAt);
  return { day: day.format(start), times: `${clock.format(start)} to ${clock.format(end)}` };
}

/** When the session ran, its start to its end: "Sun, Oct 4, 9:05 AM to 9:30 AM". */
export function sessionTimes(session: SessionWindow, format: RecapFormat = {}): string {
  const { day, times } = sessionWhen(session, format);
  return `${day}, ${times}`;
}

/** A student as the grid names them: their display name, else the start of their id. */
export function nameOf(s: ReportStudent): string {
  return s.displayName ?? s.id.slice(0, 8);
}

/**
 * The class's figures, each a number in the viewer's format, as the card and the reports list (R5)
 * both say them; their unit, "min", is the page's.
 */
export function classFigures(
  joined: number,
  minutes: Pick<SessionReportSummary, 'focusMinutes' | 'averageFocusMinutes' | 'silentMinutes'>,
  locale?: string,
) {
  const n = new Intl.NumberFormat(locale);
  return {
    joined: n.format(joined),
    focus: n.format(minutes.focusMinutes),
    // Null only when nobody joined (R2), when there are no figures at all.
    average: n.format(minutes.averageFocusMinutes ?? 0),
    silent: n.format(minutes.silentMinutes),
  };
}

/** What a mark says happened. */
export const MOMENTS = ['in', 'unlock', 'focus', 'off', 'on', 'silent', 'back', 'left'] as const;
export type Moment = (typeof MOMENTS)[number];

export const payloadOf = (payload: unknown): Record<string, unknown> =>
  typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

/** The mark each event draws: only what the consent card says a teacher sees. */
const MARK: Partial<Record<EventType, Moment>> = {
  tap_in: 'in',
  unlock: 'unlock',
  refocus: 'focus',
  protection_off: 'off',
  protection_on: 'on',
  went_silent: 'silent',
  came_back: 'back',
  left_for_other_session: 'left',
  enrollment_left: 'left',
  enrollment_removed: 'left',
};
/**
 * Noted late (A12–A14), these changed nothing, so they draw no mark; every unlock and protection off
 * does, whatever it changed, as R2 lists them.
 */
const LATE = new Set<EventType>(['tap_in', 'refocus', 'protection_on']);

/**
 * The moment an event is, or none: the one rule the recap's marks and the student panel's list
 * (PV11a) both read, so the two never disagree.
 */
export function momentOf(e: Pick<FeedEvent, 'type' | 'payload'>): Moment | null {
  const late = LATE.has(e.type) && (payloadOf(e.payload).recorded_as ?? null) !== null;
  return late ? null : (MARK[e.type] ?? null);
}

/** One of a student's moments in a session: what happened, as the recap marks it, and when. */
export interface StudentMoment {
  /** Its event id. */
  key: string;
  moment: Moment;
  /** When, by the server's record (rule 1: the phone's claim held to the session's window). */
  at: Date;
  /**
   * An unlock's reason now: its latest change's (A20), else the one it was sent with; null when
   * none, or one this tab doesn't know, as the tile reads it, and on any other moment.
   */
  reason: UnlockReason | null;
}

/**
 * One student's moments in a session, from its events (any other student's left out): each event
 * once by its id, as a replay in the overlap is; each the mark `momentOf` gives it, at its time on
 * the server's record, oldest first and, at one instant, in the engine's order. The one list the
 * student panel (PV11a) and the recap's groups (PV12a) both read, so the two never disagree.
 */
export function studentMoments(events: readonly FeedEvent[], studentId: string): StudentMoment[] {
  // Each once by its event id, in the engine's order.
  const theirs = [
    ...new Map(events.filter((e) => e.userId === studentId).map((e) => [e.eventId, e])).values(),
  ].sort((a, b) => a.seq - b.seq);
  // Each unlock's latest change, in the engine's order (A20).
  const changed = new Map<unknown, unknown>();
  for (const e of theirs) {
    if (e.type !== 'unlock_reason_changed') continue;
    const { unlock_event_id: of, reason } = payloadOf(e.payload);
    changed.set(of, reason);
  }
  const moments: StudentMoment[] = [];
  for (const e of theirs) {
    const moment = momentOf(e);
    if (moment === null) continue;
    const reason = changed.has(e.eventId) ? changed.get(e.eventId) : payloadOf(e.payload).reason;
    moments.push({
      key: e.eventId,
      moment,
      at: new Date(e.occurredAt),
      reason: moment === 'unlock' && isUnlockReason(reason) ? reason : null,
    });
  }
  // Oldest first, as the recap places them; the sort keeps the engine's order at one instant.
  return moments.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Where `at` falls on the axis from `start` to `end`, in percent to a hundredth: 0 at the start,
 * 100 at the end.
 */
export function placement(at: number, start: number, end: number): number {
  const share = end > start ? Math.min(1, Math.max(0, (at - start) / (end - start))) : 0;
  return Math.round(share * 10_000) / 100;
}

/** Minutes between the axis's ticks: the least of these that leaves it 6 gaps or fewer. */
const STEPS = [5, 10, 15, 30, 60, 120];

/**
 * The recap's axis (ClassEnded): its first and last times with AM or PM, the ticks between
 * without, 6 gaps or fewer: a tick each 10 minutes for 50.
 */
function axis(start: number, end: number, clock: Intl.DateTimeFormat) {
  const span = end - start;
  const step = (STEPS.find((m) => span <= m * 60_000 * 6) ?? 120) * 60_000;
  const bare = (t: number) =>
    clock
      .formatToParts(t)
      .filter((p) => p.type !== 'dayPeriod')
      .map((p) => p.value)
      .join('')
      .trim();
  const ticks = [{ x: 0, label: clock.format(start) }];
  // None nearer the end than a whole gap, so its label never runs into the end's.
  for (let t = start + step; end - t >= step; t += step) {
    ticks.push({ x: placement(t, start, end), label: bare(t) });
  }
  ticks.push({ x: 100, label: clock.format(end) });
  return { ticks, step: span > 0 ? (step / span) * 100 : 100 };
}

/** Everyone R2 names: who joined, then whoever has an unlock or protection off there. */
const namedIn = (report: SessionReportResponse): ReportStudent[] => [
  ...report.joined,
  ...report.unlocks.map((u) => u.student),
  ...report.protectionOffs.map((p) => p.student),
];

/**
 * The session's events, and every unlock and protection off R2 lists that the feed's read missed
 * (it landed between the two reads), so the recap never leaves one out.
 */
function recapFeed(report: SessionReportResponse, events: readonly FeedEvent[]): FeedEvent[] {
  const read = new Set(events.map((e) => e.eventId));
  return [
    ...events,
    ...[
      ...report.unlocks.map((u) => ({ ...u, type: 'unlock' as const })),
      ...report.protectionOffs.map((p) => ({ ...p, type: 'protection_off' as const })),
    ]
      .filter((r) => !read.has(r.eventId))
      .map(({ eventId, type, student, occurredAt }) => ({
        seq: 0,
        eventId,
        type,
        userId: student.id,
        occurredAt,
        payload: {},
      })),
  ];
}

/** One of a student's moments in the recap: their panel's own (`studentMoments`), on the axis. */
export interface RecapMoment extends StudentMoment {
  /** Where it falls on the axis, in percent: 0 at the session's start, 100 at the axis's end. */
  x: number;
}

/** A student in the recap: who, their line and their moments, for PV12b to draw and to say. */
export interface RecapStudent {
  /** Their id. */
  key: string;
  /** As the grid names them: their display name now, else the start of their id. */
  name: string;
  /**
   * Their line on the axis, in percent: their time in the session, from each tap-in to their
   * leaving it or the session's end, whichever came first. None for who never joined.
   */
  spans: { from: number; to: number }[];
  /** Their moments in the session, oldest first, each where it falls on the axis. */
  moments: RecapMoment[];
}

/** The recap's three groups (ClassEnded), and the axis their lines run on. */
export interface RecapGroups {
  /** Who joined and wasn't focused the whole time (`breaksFocus`), by when that first broke. */
  partTime: RecapStudent[];
  /** Who joined and was, from their own tap-in to the session's end: a late tap-in still counts. */
  wholeTime: RecapStudent[];
  /**
   * Who never joined: on the roster by the session's end, and anyone with an unlock or protection
   * off here (R2 lists every one), which they carry.
   */
  notJoined: RecapStudent[];
  /** The axis, from the session's start to its end or a later moment of a row drawn on it. */
  ticks: { x: number; label: string }[];
  /** The gap between ticks, in percent of the axis: a gridline each. */
  step: number;
}

/**
 * Whether a moment ends "focused the whole time" (the owner's rule, 2026-10-12): an unlock or
 * protection off whenever it was recorded, a late one and one after the bell too, since R2 lists
 * every one and the whole-time list shows none; going silent or leaving before the session's end.
 * A leave stamped at the bell or after it (a removal before the sweep, the next class's tap) and a
 * silence first marked there came once class was over: the report counts the student focused to the
 * end.
 */
function breaksFocus(m: StudentMoment, end: number): boolean {
  if (m.moment === 'unlock' || m.moment === 'off') return true;
  return (m.moment === 'silent' || m.moment === 'left') && m.at.getTime() < end;
}

/**
 * A student's time in the session: from each tap-in to their leaving, or the session's end,
 * whichever came first; a tap-in while in it already starts nothing. Walked in the engine's order,
 * each time held to no earlier than the one before, as R2 holds them, so a phone's clock set ahead
 * never draws a line past the removal the server stamped before its tap's claimed time.
 */
function lineOf(events: readonly FeedEvent[], studentId: string, end: number): [number, number][] {
  const spans: [number, number][] = [];
  let from: number | null = null;
  let last = 0;
  const theirs = events.filter((e) => e.userId === studentId).sort((a, b) => a.seq - b.seq);
  for (const e of theirs) {
    const moment = momentOf(e);
    if (moment !== 'in' && moment !== 'left') continue;
    last = Math.max(last, Math.min(Date.parse(e.occurredAt), end));
    if (moment === 'in' && from === null) from = last;
    if (moment === 'left' && from !== null) {
      spans.push([from, last]);
      from = null;
    }
  }
  return from === null ? spans : [...spans, [from, end]];
}

/**
 * The recap's groups (PV12a; the canvas's ClassEnded): who wasn't focused the whole time, each with
 * their line and moments, who was, and who didn't join. Who joined, every unlock and protection off,
 * and each unlock's reason now are R2's (`sessionReport`), so the recap and the report never
 * disagree; the moments are the student panel's own (`studentMoments`). `roster` is the class's now:
 * of those on it, who enrolled by the session's end and never joined didn't join. Each group in the
 * roster's order, anyone off it after; the first then by when each one's focus first broke. Data
 * only: PV12b says it.
 */
export function recapGroups(
  session: SessionWindow,
  report: SessionReportResponse,
  events: readonly FeedEvent[],
  roster: readonly RosterStudent[],
  { locale, timeZone }: RecapFormat = {},
): RecapGroups {
  const feed = recapFeed(report, events);
  const start = Date.parse(session.startedAt);
  const end = Date.parse(session.endedAt ?? session.endsAt);
  const joined = new Set(report.joined.map((s) => s.id));
  const reasons = new Map(report.unlocks.map((u) => [u.eventId, u.reason]));
  const listed = roster.map((r) => ({ id: r.studentId, displayName: r.displayName }));
  const names = new Map([...listed, ...namedIn(report)].map((s) => [s.id, nameOf(s)]));
  const place = new Map(roster.map((r, i) => [r.studentId, i]));
  const ids = new Set([
    ...joined,
    ...feed.flatMap((e) =>
      (e.type === 'unlock' || e.type === 'protection_off') && e.userId !== null ? [e.userId] : [],
    ),
    ...roster.filter((r) => Date.parse(r.joinedAt) < end).map((r) => r.studentId),
  ]);
  const rows = [...ids]
    .map((id) => {
      // Each unlock R2 lists says R2's reason, as the report does.
      const moments = studentMoments(feed, id).map((m) => {
        if (!reasons.has(m.key)) return m;
        const reason = reasons.get(m.key);
        return { ...m, reason: isUnlockReason(reason) ? reason : null };
      });
      const broke = moments.find((m) => breaksFocus(m, end))?.at.getTime() ?? null;
      return { id, moments, broke };
    })
    .sort((a, b) => (place.get(a.id) ?? roster.length) - (place.get(b.id) ?? roster.length));
  const partTime = rows
    .filter((r): r is typeof r & { broke: number } => joined.has(r.id) && r.broke !== null)
    .sort((a, b) => a.broke - b.broke);
  const notJoined = rows.filter((r) => !joined.has(r.id));
  // Stretched only for what is drawn on it, so a whole-time leave after the bell moves nothing.
  const drawn = [...partTime, ...notJoined].flatMap((r) => r.moments.map((m) => m.at.getTime()));
  const axisEnd = Math.max(end, ...drawn);
  const x = (t: number) => placement(t, start, axisEnd);
  const student = (r: (typeof rows)[number]): RecapStudent => ({
    key: r.id,
    name: names.get(r.id) ?? r.id.slice(0, 8),
    spans: lineOf(feed, r.id, end).map(([from, to]) => ({ from: x(from), to: x(to) })),
    moments: r.moments.map((m) => ({ ...m, x: x(m.at.getTime()) })),
  });
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  return {
    partTime: partTime.map(student),
    wholeTime: rows.filter((r) => joined.has(r.id) && r.broke === null).map(student),
    notJoined: notJoined.map(student),
    ...axis(start, axisEnd, clock),
  };
}
