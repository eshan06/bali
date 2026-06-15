import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm';
import { getDb, schema as s } from '@bali/db';
import type {
  ChipState,
  SessionRecapDTO,
  ClassOverviewDTO,
  StudentHistoryDTO,
  ParentViewDTO,
  StoredParticipantState,
} from '@bali/shared';
import { deriveParticipantState } from '@bali/shared';
import { shortName } from './serialize';

/** W8's framing line — designed copy; the CSV export embeds it in its header row.
 *  The teacher iOS Recent/Recap surfaces reuse the same constant (T6/T10/T3). */
export const REPORTS_FRAMING_LINE = 'Patterns are conversation starters, not verdicts.';

export type ReportRange = 'week' | 'month';

/** Monday 00:00 local of the week containing `d`. */
export function weekStartMonday(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

export function rangeStart(range: ReportRange, now = new Date()): Date {
  if (range === 'week') return weekStartMonday(now);
  const out = new Date(now);
  out.setHours(0, 0, 0, 0);
  out.setDate(1);
  return out;
}

const monthDay = (d: Date): string =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const clock = (d: Date): string =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/ [AP]M$/, '');

export interface UnlockReportRow {
  unlockId: string;
  at: string;
  /** "Jun 10 · 10:31" — the table's When cell, server-rendered like every other string. */
  whenLabel: string;
  studentId: string;
  studentName: string;
  /** null = reason still pending. "skipped" renders tertiary, never highlighted. */
  reason: 'family' | 'medical' | 'safety' | 'other' | 'skipped' | null;
  classId: string;
  className: string;
  /** Unlock counts per week, oldest→newest, Monday-aligned, always 6 buckets. */
  weeks: number[];
}

export interface UnlocksReport {
  framing: string;
  range: ReportRange;
  count: number;
  rows: UnlockReportRow[];
}

export async function unlocksReport(opts: {
  teacherId: string;
  classId?: string;
  range: ReportRange;
  now?: Date;
}): Promise<UnlocksReport> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const since = rangeStart(opts.range, now);

  const scope = [eq(s.classes.teacherId, opts.teacherId)];
  if (opts.classId) scope.push(eq(s.classes.id, opts.classId));

  const rows = await db
    .select({
      unlockId: s.unlocks.id,
      at: s.unlocks.at,
      reason: s.unlocks.reason,
      studentId: s.students.id,
      firstName: s.students.firstName,
      lastName: s.students.lastName,
      classId: s.classes.id,
      className: s.classes.name,
    })
    .from(s.unlocks)
    .innerJoin(s.sessions, eq(s.unlocks.sessionId, s.sessions.id))
    .innerJoin(s.classes, eq(s.sessions.classId, s.classes.id))
    .innerJoin(s.students, eq(s.unlocks.studentId, s.students.id))
    .where(and(...scope, gte(s.unlocks.at, since)))
    .orderBy(desc(s.unlocks.at));

  // Sparkline: each student's unlock count per week for the last 6 weeks (always 6
  // buckets regardless of the range filter — the column header says "Last 6 wks").
  const sparkStart = weekStartMonday(now);
  sparkStart.setDate(sparkStart.getDate() - 7 * 5);
  const sparkRows = await db
    .select({ studentId: s.unlocks.studentId, at: s.unlocks.at })
    .from(s.unlocks)
    .innerJoin(s.sessions, eq(s.unlocks.sessionId, s.sessions.id))
    .innerJoin(s.classes, eq(s.sessions.classId, s.classes.id))
    .where(and(...scope, gte(s.unlocks.at, sparkStart)));

  const weeksByStudent = new Map<string, number[]>();
  for (const r of sparkRows) {
    const buckets = weeksByStudent.get(r.studentId) ?? [0, 0, 0, 0, 0, 0];
    const idx = Math.floor((weekStartMonday(r.at).getTime() - sparkStart.getTime()) / (7 * 86_400_000));
    if (idx >= 0 && idx < 6) buckets[idx] = (buckets[idx] ?? 0) + 1;
    weeksByStudent.set(r.studentId, buckets);
  }

  return {
    framing: REPORTS_FRAMING_LINE,
    range: opts.range,
    count: rows.length,
    rows: rows.map((r) => ({
      unlockId: r.unlockId,
      at: r.at.toISOString(),
      whenLabel: `${monthDay(r.at)} · ${clock(r.at)}`,
      studentId: r.studentId,
      studentName: `${r.firstName} ${r.lastName}`,
      reason: r.reason,
      classId: r.classId,
      className: r.className,
      weeks: weeksByStudent.get(r.studentId) ?? [0, 0, 0, 0, 0, 0],
    })),
  };
}

const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The export carries the same framing line in its header row (designed copy). */
export function unlocksCsv(report: UnlocksReport): string {
  const lines = [
    `# ${report.framing}`,
    'When,Student,Reason,Class',
    ...report.rows.map((r) =>
      [r.at, r.studentName, r.reason ?? 'pending', r.className].map(csvCell).join(','),
    ),
  ];
  return lines.join('\n') + '\n';
}

export interface FocusMinutesRow {
  classId: string;
  className: string;
  /** Average focused minutes per student per ended session — averages only, by design. */
  avgMinutes: number;
  sessionCount: number;
  scheduledMinutes: number;
}

const FOCUS_START_EVENTS = ['tapped_in', 'refocused', 'permission_restored'] as const;
const FOCUS_STOP_EVENTS = ['emergency_unlock', 'permission_revoked'] as const;

/**
 * Focus minutes from the append-only event stream: a student accumulates focus from
 * tap-in (or re-focus / permission restore) until emergency unlock, permission loss,
 * or session end. Passes do NOT stop the clock — they're sanctioned time.
 * No per-student output exists anywhere: rows aggregate to class averages only.
 */
export async function focusMinutesReport(opts: {
  teacherId: string;
  classId?: string;
  range: ReportRange;
  now?: Date;
}): Promise<{ rows: FocusMinutesRow[]; periodMinutes: number }> {
  const db = getDb();
  const since = rangeStart(opts.range, opts.now ?? new Date());

  const classScope = [eq(s.classes.teacherId, opts.teacherId)];
  if (opts.classId) classScope.push(eq(s.classes.id, opts.classId));
  const classes = await db.query.classes.findMany({ where: and(...classScope) });
  if (classes.length === 0) return { rows: [], periodMinutes: 50 };

  const sessions = await db.query.sessions.findMany({
    where: and(
      inArray(
        s.sessions.classId,
        classes.map((c) => c.id),
      ),
      gte(s.sessions.startedAt, since),
      isNotNull(s.sessions.endedAt),
    ),
  });

  const minutesOf = (hhmmss: string): number => {
    const [h = 0, m = 0] = hhmmss.split(':').map(Number);
    return h * 60 + m;
  };

  const sessionAverages = new Map<string, number[]>(); // classId → per-session averages
  if (sessions.length > 0) {
    const events = await db
      .select({
        sessionId: s.events.sessionId,
        studentId: s.events.studentId,
        type: s.events.type,
        at: s.events.at,
      })
      .from(s.events)
      .where(
        and(
          inArray(
            s.events.sessionId,
            sessions.map((x) => x.id),
          ),
          inArray(s.events.type, [...FOCUS_START_EVENTS, ...FOCUS_STOP_EVENTS]),
          isNotNull(s.events.studentId),
        ),
      )
      .orderBy(s.events.at);

    const bySession = new Map<string, Map<string, { focusedSince: Date | null; total: number }>>();
    for (const ev of events) {
      if (!ev.sessionId || !ev.studentId) continue;
      const perStudent = bySession.get(ev.sessionId) ?? new Map();
      bySession.set(ev.sessionId, perStudent);
      const acc = perStudent.get(ev.studentId) ?? { focusedSince: null, total: 0 };
      perStudent.set(ev.studentId, acc);
      if ((FOCUS_START_EVENTS as readonly string[]).includes(ev.type)) {
        acc.focusedSince ??= ev.at;
      } else if (acc.focusedSince) {
        acc.total += ev.at.getTime() - acc.focusedSince.getTime();
        acc.focusedSince = null;
      }
    }

    for (const session of sessions) {
      const perStudent = bySession.get(session.id);
      if (!perStudent || perStudent.size === 0) continue;
      const endedAt = session.endedAt!;
      const totals: number[] = [];
      for (const acc of perStudent.values()) {
        const total = acc.total + (acc.focusedSince ? endedAt.getTime() - acc.focusedSince.getTime() : 0);
        totals.push(Math.max(0, total));
      }
      const avgMs = totals.reduce((a, b) => a + b, 0) / totals.length;
      const list = sessionAverages.get(session.classId) ?? [];
      list.push(avgMs / 60_000);
      sessionAverages.set(session.classId, list);
    }
  }

  const rows: FocusMinutesRow[] = classes
    .map((cls) => {
      const perSession = sessionAverages.get(cls.id) ?? [];
      const avg =
        perSession.length > 0
          ? Math.round(perSession.reduce((a, b) => a + b, 0) / perSession.length)
          : 0;
      return {
        classId: cls.id,
        className: cls.name,
        avgMinutes: avg,
        sessionCount: perSession.length,
        scheduledMinutes: Math.max(0, minutesOf(cls.endTime) - minutesOf(cls.startTime)),
      };
    })
    .filter((r) => r.sessionCount > 0);

  // The caption reads "Out of a N-minute period" — N is the school's real longest
  // scheduled period, not the mock's 50, so the copy stays honest with live data.
  const longest = Math.max(0, ...rows.map((r) => r.scheduledMinutes));
  return { rows, periodMinutes: longest > 0 ? longest : 50 };
}

// ---------- teacher iOS addendum aggregations (T6 Overview, T10 Recap, T3 Recent) ----------

const clock24 = (d: Date): string =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });
const weekdayShort = (d: Date): string => d.toLocaleDateString('en-US', { weekday: 'short' });

/** "today" / "yesterday" / weekday — the recap's relative day word. */
function dayWord(d: Date, now = new Date()): string {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const ref = new Date(now);
  ref.setHours(0, 0, 0, 0);
  const diff = Math.round((ref.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Focused minutes per student for ONE session, from the same append-only event stream
 * the W8 report uses: focus accrues from tap-in / re-focus / permission-restore until an
 * emergency unlock, permission loss, or `endAt`. Passes do NOT stop the clock (sanctioned).
 * Returns whole minutes; only participation/status data — nothing about device contents.
 */
async function focusMinutesByStudent(sessionId: string, endAt: Date): Promise<Map<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ studentId: s.events.studentId, type: s.events.type, at: s.events.at })
    .from(s.events)
    .where(
      and(
        eq(s.events.sessionId, sessionId),
        inArray(s.events.type, [...FOCUS_START_EVENTS, ...FOCUS_STOP_EVENTS]),
        isNotNull(s.events.studentId),
      ),
    )
    .orderBy(asc(s.events.at));

  const acc = new Map<string, { since: Date | null; total: number }>();
  for (const ev of rows) {
    if (!ev.studentId) continue;
    const a = acc.get(ev.studentId) ?? { since: null, total: 0 };
    acc.set(ev.studentId, a);
    if ((FOCUS_START_EVENTS as readonly string[]).includes(ev.type)) {
      a.since ??= ev.at;
    } else if (a.since) {
      a.total += ev.at.getTime() - a.since.getTime();
      a.since = null;
    }
  }
  const out = new Map<string, number>();
  for (const [studentId, a] of acc) {
    const total = a.total + (a.since ? endAt.getTime() - a.since.getTime() : 0);
    out.set(studentId, Math.max(0, Math.round(total / 60_000)));
  }
  return out;
}

/**
 * T10 · Session Recap — neutral history for one (usually ended) session. Partitions every
 * active member into exactly one bucket by precedence (no_device > emergency > permission-off
 * > pass > focused > never-joined) so the counts sum to the roster. No ranking, no red.
 */
export async function sessionRecap(sessionId: string, now = new Date()): Promise<SessionRecapDTO | null> {
  const db = getDb();
  const session = await db.query.sessions.findFirst({ where: eq(s.sessions.id, sessionId) });
  if (!session) return null;
  const cls = await db.query.classes.findFirst({ where: eq(s.classes.id, session.classId) });
  const endAt = session.endedAt ?? now;

  const members = await db
    .select({
      studentId: s.students.id,
      firstName: s.students.firstName,
      lastName: s.students.lastName,
      defaultNoDevice: s.memberships.defaultNoDevice,
    })
    .from(s.memberships)
    .innerJoin(s.students, eq(s.memberships.studentId, s.students.id))
    .where(and(eq(s.memberships.classId, session.classId), eq(s.memberships.status, 'active')));

  const parts = await db.query.participations.findMany({ where: eq(s.participations.sessionId, sessionId) });
  const passes = await db.query.passes.findMany({ where: eq(s.passes.sessionId, sessionId) });
  const unlockRows = await db
    .select({
      studentId: s.unlocks.studentId,
      at: s.unlocks.at,
      reason: s.unlocks.reason,
      firstName: s.students.firstName,
      lastName: s.students.lastName,
    })
    .from(s.unlocks)
    .innerJoin(s.students, eq(s.unlocks.studentId, s.students.id))
    .where(eq(s.unlocks.sessionId, sessionId))
    .orderBy(asc(s.unlocks.at));
  const revokeRows = await db
    .select({ studentId: s.events.studentId })
    .from(s.events)
    .where(and(eq(s.events.sessionId, sessionId), eq(s.events.type, 'permission_revoked'), isNotNull(s.events.studentId)));
  const refocusRows = await db
    .select({ studentId: s.events.studentId, at: s.events.at })
    .from(s.events)
    .where(
      and(
        eq(s.events.sessionId, sessionId),
        inArray(s.events.type, ['refocused', 'permission_restored']),
        isNotNull(s.events.studentId),
      ),
    )
    .orderBy(asc(s.events.at));

  const focus = await focusMinutesByStudent(sessionId, endAt);
  const partByStudent = new Map(parts.map((p) => [p.studentId, p]));
  const passStudents = new Set(passes.map((p) => p.studentId));
  const unlockStudents = new Set(unlockRows.map((u) => u.studentId));
  const revokeStudents = new Set(revokeRows.map((r) => r.studentId));

  let focusedCount = 0;
  let emergencyCount = 0;
  let passCount = 0;
  let permissionOffCount = 0;
  let neverJoinedCount = 0;
  let studentsTappedIn = 0;
  const noDeviceNames: string[] = [];
  const focusValues: number[] = [];

  for (const m of members) {
    const p = partByStudent.get(m.studentId);
    const noDevice = p?.noDevice ?? m.defaultNoDevice;
    if (noDevice) {
      noDeviceNames.push(shortName(m.firstName, m.lastName));
      continue;
    }
    const didTap = !!p?.tappedInAt;
    if (didTap) studentsTappedIn += 1;
    const fm = focus.get(m.studentId) ?? 0;
    if (didTap && fm > 0) focusValues.push(fm);

    if (unlockStudents.has(m.studentId)) emergencyCount += 1;
    else if (revokeStudents.has(m.studentId)) permissionOffCount += 1;
    else if (passStudents.has(m.studentId)) passCount += 1;
    else if (didTap) focusedCount += 1;
    else neverJoinedCount += 1;
  }

  const emergencies = unlockRows.map((u) => {
    const reasonLabel =
      u.reason === null
        ? 'Reason pending'
        : u.reason === 'skipped'
          ? 'Reason: skipped'
          : `Reason shared: ${u.reason}`;
    const refocus = refocusRows.find((r) => r.studentId === u.studentId && r.at >= u.at);
    return {
      studentId: u.studentId,
      studentName: `${u.firstName} ${u.lastName}`,
      shortName: shortName(u.firstName, u.lastName),
      atLabel: clock24(u.at),
      reasonLabel,
      refocusedLabel: refocus ? `re-focused ${clock24(refocus.at)}` : null,
      nudge: `A quiet check-in with ${u.firstName} later might be welcome.`,
    };
  });

  const durationMinutes = Math.max(0, Math.round((endAt.getTime() - session.startedAt.getTime()) / 60_000));

  return {
    sessionId: session.id,
    classId: session.classId,
    className: cls?.name ?? session.policySnapshot.name,
    scheduleLabel: `${dayWord(session.startedAt, now)} ${clock24(session.startedAt)}–${clock24(session.endsAt)}`,
    durationMinutes,
    durationLabel: `${durationMinutes} min`,
    endReason: session.endReason,
    endedEarly: session.endReason === 'teacher',
    isLive: session.endedAt === null,
    focusedCount,
    emergencyCount,
    passCount,
    permissionOffCount,
    neverJoinedCount,
    studentsTappedIn,
    totalMembers: members.length,
    medianFocusMinutes: median(focusValues),
    noDeviceNames,
    clean: emergencyCount === 0 && permissionOffCount === 0,
    emergencies,
    framing: REPORTS_FRAMING_LINE,
  };
}

/**
 * T3 · Recent — the last N ended sessions for one (student, class), each as a factual
 * outcome row. Status only: durations and events, never device contents. The dot state
 * follows §2 precedence: no_device > permission-off > pass > (focused, with an unlock note).
 */
export async function studentSessionHistory(opts: {
  classId: string;
  studentId: string;
  limit?: number;
  now?: Date;
}): Promise<StudentHistoryDTO | null> {
  const db = getDb();
  const limit = opts.limit ?? 5;
  const student = await db.query.students.findFirst({ where: eq(s.students.id, opts.studentId) });
  if (!student) return null;

  const sessions = await db.query.sessions.findMany({
    where: and(eq(s.sessions.classId, opts.classId), isNotNull(s.sessions.endedAt)),
    orderBy: desc(s.sessions.startedAt),
    limit,
  });

  const rows: StudentHistoryDTO['rows'] = [];
  for (const ses of sessions) {
    const endAt = ses.endedAt!;
    const participation = await db.query.participations.findFirst({
      where: and(eq(s.participations.sessionId, ses.id), eq(s.participations.studentId, opts.studentId)),
    });
    const dayLabel = weekdayShort(ses.startedAt);

    if (participation?.noDevice) {
      rows.push({ sessionId: ses.id, dayLabel, state: 'no_device', label: 'No device that day' });
      continue;
    }

    const focusMap = await focusMinutesByStudent(ses.id, endAt);
    const fm = focusMap.get(opts.studentId) ?? 0;
    const studentUnlocks = await db.query.unlocks.findMany({
      where: and(eq(s.unlocks.sessionId, ses.id), eq(s.unlocks.studentId, opts.studentId)),
    });
    const studentPasses = await db.query.passes.findMany({
      where: and(eq(s.passes.sessionId, ses.id), eq(s.passes.studentId, opts.studentId)),
    });
    const revokes = await db
      .select({ at: s.events.at })
      .from(s.events)
      .where(
        and(
          eq(s.events.sessionId, ses.id),
          eq(s.events.studentId, opts.studentId),
          eq(s.events.type, 'permission_revoked'),
        ),
      )
      .orderBy(asc(s.events.at));
    const restores = await db
      .select({ at: s.events.at })
      .from(s.events)
      .where(
        and(
          eq(s.events.sessionId, ses.id),
          eq(s.events.studentId, opts.studentId),
          eq(s.events.type, 'permission_restored'),
        ),
      )
      .orderBy(asc(s.events.at));

    let state: ChipState;
    let label: string;
    if (revokes.length > 0) {
      state = 'revoked';
      const firstRevoke = revokes[0]!.at;
      const restore = restores.find((r) => r.at >= firstRevoke);
      if (restore) {
        const mins = Math.max(1, Math.round((restore.at.getTime() - firstRevoke.getTime()) / 60_000));
        label = `Permission off · rejoined ${mins} min later`;
      } else {
        label = 'Permission off · stayed off';
      }
    } else if (studentPasses.length > 0) {
      state = 'pass';
      label = `Focused ${fm} min · ${studentPasses[0]!.minutes}-min pass`;
    } else if (studentUnlocks.length > 0) {
      state = 'focused';
      const n = studentUnlocks.length;
      label = `Focused ${fm} min · ${n} unlock${n > 1 ? 's' : ''}, re-focused`;
    } else if (participation?.tappedInAt) {
      state = 'focused';
      label = `Focused ${fm} min, full session`;
    } else {
      state = 'not_joined';
      label = 'Didn’t join that day';
    }
    rows.push({ sessionId: ses.id, dayLabel, state, label });
  }

  return {
    studentId: student.id,
    studentName: `${student.firstName} ${student.lastName}`,
    shortName: shortName(student.firstName, student.lastName),
    rows,
    framing: REPORTS_FRAMING_LINE,
    boundary: `Session status only — Bali never sees ${student.firstName}’s screen, apps, messages, or location.`,
  };
}

/** T6 · Overview quick stats — members, sessions this week, last-session recap pointer, median focus. */
export async function classOverview(classId: string, now = new Date()): Promise<ClassOverviewDTO> {
  const db = getDb();
  const [{ value: memberCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(s.memberships)
    .where(and(eq(s.memberships.classId, classId), eq(s.memberships.status, 'active')));

  const weekStart = weekStartMonday(now);
  const weekSessions = await db.query.sessions.findMany({
    where: and(eq(s.sessions.classId, classId), gte(s.sessions.startedAt, weekStart)),
    columns: { id: true },
  });

  const lastEnded = await db.query.sessions.findFirst({
    where: and(eq(s.sessions.classId, classId), isNotNull(s.sessions.endedAt)),
    orderBy: desc(s.sessions.startedAt),
  });

  let lastSession: ClassOverviewDTO['lastSession'] = null;
  if (lastEnded) {
    const recap = await sessionRecap(lastEnded.id, now);
    if (recap) {
      lastSession = {
        sessionId: lastEnded.id,
        dayLabel: weekdayShort(lastEnded.startedAt),
        durationMinutes: recap.durationMinutes,
        durationLabel: recap.durationLabel,
        focusedCount: recap.focusedCount,
        totalMembers: recap.totalMembers,
      };
    }
  }

  // Median focus per session over the last ~4 weeks of ended sessions for this class.
  const since = weekStartMonday(now);
  since.setDate(since.getDate() - 21);
  const recentEnded = await db.query.sessions.findMany({
    where: and(eq(s.sessions.classId, classId), isNotNull(s.sessions.endedAt), gte(s.sessions.startedAt, since)),
    columns: { id: true, endedAt: true },
  });
  const allFocus: number[] = [];
  for (const ses of recentEnded) {
    if (!ses.endedAt) continue;
    const fmap = await focusMinutesByStudent(ses.id, ses.endedAt);
    for (const v of fmap.values()) if (v > 0) allFocus.push(v);
  }

  return {
    classId,
    memberCount,
    sessionsThisWeek: weekSessions.length,
    medianFocusMinutes: median(allFocus),
    lastSession,
  };
}

/** Parent-friendly label for the live chip state (status only, never a verdict). */
function parentLiveLabel(state: ChipState): string {
  switch (state) {
    case 'focused':
      return 'Focused right now';
    case 'pass':
      return 'On a teacher pass';
    case 'emergency_unlocked':
      return 'Unlocked — emergency';
    case 'revoked':
      return 'Focus permission off';
    case 'no_device':
      return 'No device today';
    case 'not_joined':
      return 'In class — focus not started yet';
    default:
      return 'Session ending';
  }
}

/** "Jun 15, 9:41 AM" — server-local friendly stamp for the parent view header. */
function friendlyStamp(d: Date): string {
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${month} ${day}, ${h}:${mm} ${ampm}`;
}

/**
 * Read-only parent surface for one (student × class), keyed by membership. Composed
 * entirely from the existing event-stream reports — status only, no screen content.
 * Returns null when the membership/class/student no longer resolves (→ 404).
 */
export async function parentView(membershipId: string, now = new Date()): Promise<ParentViewDTO | null> {
  const db = getDb();
  const membership = await db.query.memberships.findFirst({ where: eq(s.memberships.id, membershipId) });
  if (!membership) return null;
  const cls = await db.query.classes.findFirst({ where: eq(s.classes.id, membership.classId) });
  if (!cls) return null;
  const [teacher, school, history] = await Promise.all([
    db.query.teachers.findFirst({ where: eq(s.teachers.id, cls.teacherId) }),
    db.query.schools.findFirst({ where: eq(s.schools.id, cls.schoolId) }),
    studentSessionHistory({ classId: cls.id, studentId: membership.studentId, now }),
  ]);
  if (!history) return null;

  // Live chip — only while a session is open right now for this class.
  let live: ParentViewDTO['live'] = null;
  const open = await db.query.sessions.findFirst({
    where: and(eq(s.sessions.classId, cls.id), isNull(s.sessions.endedAt)),
    orderBy: desc(s.sessions.startedAt),
  });
  if (open) {
    const [participation, activePass] = await Promise.all([
      db.query.participations.findFirst({
        where: and(eq(s.participations.sessionId, open.id), eq(s.participations.studentId, membership.studentId)),
      }),
      db.query.passes.findFirst({
        where: and(
          eq(s.passes.sessionId, open.id),
          eq(s.passes.studentId, membership.studentId),
          isNull(s.passes.endedAt),
        ),
        orderBy: desc(s.passes.grantedAt),
      }),
    ]);
    const derived = deriveParticipantState({
      storedState: (participation?.state as StoredParticipantState | undefined) ?? null,
      noDevice: participation?.noDevice ?? membership.defaultNoDevice,
      passEndsAt: activePass?.endsAt ?? null,
      lastSeenAt: participation?.lastSeenAt ?? null,
      session: { endsAt: open.endsAt, endedAt: open.endedAt },
      now,
    });
    live = { state: derived.state, label: parentLiveLabel(derived.state) };
  }

  // Honest summary over the shown window. `totalUnlocks` is the true row count;
  // `focusedSessions` counts sessions the student ended in the `focused` state.
  const sessionIds = history.rows.map((r) => r.sessionId);
  let totalUnlocks = 0;
  if (sessionIds.length > 0) {
    const [{ value } = { value: 0 }] = await db
      .select({ value: count() })
      .from(s.unlocks)
      .where(and(inArray(s.unlocks.sessionId, sessionIds), eq(s.unlocks.studentId, membership.studentId)));
    totalUnlocks = value;
  }
  const focusedSessions = history.rows.filter((r) => r.state === 'focused').length;

  return {
    studentShortName: history.shortName,
    className: cls.name,
    teacherName: teacher?.displayName ?? teacher?.name ?? 'Your child’s teacher',
    schoolName: school?.name ?? '',
    generatedAtLabel: `as of ${friendlyStamp(now)}`,
    live,
    summary: { sessionsShown: history.rows.length, focusedSessions, totalUnlocks },
    history,
  };
}
