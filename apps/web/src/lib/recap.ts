import type {
  EventsPage,
  EventType,
  FeedEvent,
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
 * The recap card's logic (R4; PB5's timeline), kept out of the component so it can be tested
 * directly, as the grid's is: which session it recaps, how it loads, and the words, numbers and
 * marks it shows. Class aggregates only, as R2 answers them, and each moment a mark at its time:
 * never one student's minutes, so nothing ranks them.
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
  | {
      kind: 'ready';
      session: SessionReportSummary;
      report: SessionReportResponse;
      events: FeedEvent[];
    }
  | { kind: 'error'; message: string };

/**
 * Every event of a session, oldest first, as the catch-up feed pages them (200 a request), until a
 * page comes back empty.
 * ponytail: each page is a request on the teacher's budget, so a session of thousands of events
 * can meet a 429, said as any failure, with Try again; cap the pages if one ever does.
 */
export async function readEvents(
  api: Pick<ApiClient, 'get'>,
  sessionId: string,
): Promise<FeedEvent[]> {
  const events: FeedEvent[] = [];
  for (let after = 0; ;) {
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
 * The class's last session (R3, one row), or `known` (R5's opened row): read its report (R2) and
 * its events, telling `show` each step after the first. Every failure ends in `error`, for Try
 * again: the timeline is the recap, so its figures are never shown without it.
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

/** What a mark says happened, in the legend's order. */
export const MOMENTS = ['in', 'unlock', 'focus', 'off', 'on', 'silent', 'back', 'left'] as const;
export type Moment = (typeof MOMENTS)[number];

const payloadOf = (payload: unknown): Record<string, unknown> =>
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
 * Where `at` falls on the axis from `start` to `end`, in percent to a hundredth: 0 at the start,
 * 100 at the end.
 */
export function placement(at: number, start: number, end: number): number {
  const share = end > start ? Math.min(1, Math.max(0, (at - start) / (end - start))) : 0;
  return Math.round(share * 10_000) / 100;
}

/** Minutes between the axis's ticks: the least of these that leaves it 12 gaps or fewer. */
const STEPS = [5, 10, 15, 30, 60, 120];

/** The axis: its first and last times with AM or PM, the ticks between without. */
function axis(start: number, end: number, clock: Intl.DateTimeFormat) {
  const span = end - start;
  const step = (STEPS.find((m) => span <= m * 60_000 * 12) ?? 120) * 60_000;
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

/** A moment on a student's row: where it falls, when, and an unlock's reason. */
export interface Mark {
  key: string;
  moment: Moment;
  x: number;
  time: string;
  /** In words; null but on an unlock, and in Present, the projector the class can see (#265). */
  reason: string | null;
}

export interface Timeline {
  /** The moments its marks show, in the legend's order. */
  moments: Moment[];
  /** Who joined, in R2's order; then anyone else with an unlock or protection off there. */
  rows: { key: string; name: string; marks: Mark[] }[];
  ticks: { x: number; label: string }[];
  /** The gap between ticks, in percent of the axis: a gridline each. */
  step: number;
}

/**
 * The session as a timeline (the Recap & reports design): who joined down the side, the session's
 * own time across, from its start to its end (a record clamped after an early End stretches it, so
 * every mark sits at its time), and a mark at each moment. Marks only, never a bar: no student's
 * minutes. Names and each unlock's reason now (A20) are R2's.
 */
export function sessionTimeline(
  session: SessionReportSummary,
  report: SessionReportResponse,
  events: readonly FeedEvent[],
  { locale, timeZone }: RecapFormat = {},
  present = false,
): Timeline {
  const clock = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const named = [
    ...report.joined,
    ...report.unlocks.map((u) => u.student),
    ...report.protectionOffs.map((p) => p.student),
  ];
  const names = new Map(named.map((s) => [s.id, nameOf(s)]));
  const reasons = new Map(report.unlocks.map((u) => [u.eventId, u.reason]));
  // Every unlock and protection off R2 lists is marked, one the feed's read missed included (it
  // landed between the two reads): never left out.
  const read = new Set(events.map((e) => e.eventId));
  const feed: FeedEvent[] = [
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
  const found = new Map(
    report.joined.map((s) => [s.id, [] as { e: FeedEvent; moment: Moment; at: number }[]]),
  );
  // Its student has a row, joined or not.
  for (const e of feed) {
    const counted = e.type === 'unlock' || e.type === 'protection_off';
    if (counted && e.userId !== null && !found.has(e.userId)) found.set(e.userId, []);
  }
  for (const e of feed) {
    const moment = MARK[e.type];
    const late = LATE.has(e.type) && (payloadOf(e.payload).recorded_as ?? null) !== null;
    if (moment === undefined || late || e.userId === null) continue;
    found.get(e.userId)?.push({ e, moment, at: Date.parse(e.occurredAt) });
  }
  const start = Date.parse(session.startedAt);
  const all = [...found.values()].flat();
  const end = Math.max(Date.parse(session.endedAt ?? session.endsAt), ...all.map((m) => m.at));
  const rows = [...found].map(([id, moments]) => ({
    key: id,
    name: names.get(id) ?? id.slice(0, 8),
    marks: moments
      .sort((a, b) => a.at - b.at)
      .map(({ e, moment, at }) => {
        // R2's reason, else the record's own: one that landed between the two reads.
        const reason = reasons.has(e.eventId)
          ? reasons.get(e.eventId)
          : payloadOf(e.payload).reason;
        return {
          key: e.eventId,
          moment,
          x: placement(at, start, end),
          time: clock.format(at),
          reason:
            moment !== 'unlock' || present
              ? null
              : isUnlockReason(reason)
                ? REASON_TEXT[reason]
                : 'No reason given',
        };
      }),
  }));
  return {
    moments: MOMENTS.filter((m) => all.some((f) => f.moment === m)),
    rows,
    ...axis(start, end, clock),
  };
}

export interface RecapView {
  /** The class's figures; null when nobody joined, which the card says instead of zeros. */
  stats: ReturnType<typeof classFigures> | null;
  timeline: Timeline;
}

/**
 * The card's figures and its timeline, from R2's report and the session's events. In Present
 * (`present`), the projector the class can see, every unlock is still marked, but never with its
 * reason: the student shares it with the teacher alone (#265's rule, `unlockNote`).
 */
export function recapView(
  session: SessionReportSummary,
  report: SessionReportResponse,
  events: readonly FeedEvent[],
  format: RecapFormat = {},
  present = false,
): RecapView {
  return {
    stats:
      report.joined.length === 0 ? null : classFigures(report.joined.length, report, format.locale),
    timeline: sessionTimeline(session, report, events, format, present),
  };
}
