import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { getDb, schema as s } from '@bali/db';

/** W8's framing line — designed copy; the CSV export embeds it in its header row. */
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
