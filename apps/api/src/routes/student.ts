import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as s } from '@bali/db';
import {
  deriveParticipantState,
  heartbeatBodySchema,
  joinBodySchema,
  resolveTagBodySchema,
  tapInBodySchema,
  unlockBodySchema,
  unlockReasonBodySchema,
  type ChipState,
} from '@bali/shared';
import { authenticate, requireStudent, type StudentCtx } from '../auth';
import {
  emergencyUnlock,
  findOpenSessionForClass,
  heartbeat,
  joinByCode,
  leaveMembership,
  previewClassByCode,
  refocus,
  shareUnlockReason,
  tapIn,
} from '../domain';
import { renderEvent } from '../serialize';

const fullName = (st: StudentCtx) => `${st.firstName} ${st.lastName}`;

async function studentGate(req: FastifyRequest, reply: FastifyReply): Promise<StudentCtx | null> {
  return requireStudent(req, reply);
}

/** Per-route opt-in for the app-level rate limiter (keyed per bearer token). Limits sit
 *  far above any honest cadence (heartbeat ≈ 2/min) — they exist to stop runaway
 *  clients and code guessing, never a real student. */
const limited = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

export function studentRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', authenticate);

  // ---------- join ----------
  // S2 shows the class before the student commits, so the preview has to be free of
  // side effects — same shape as /v1/join, same limit, but no membership and no event.
  app.get('/v1/classes/preview', limited(10), async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    const query = joinBodySchema.parse(req.query);
    return previewClassByCode({ studentId: student.id, code: query.code });
  });

  app.post('/v1/join', limited(10), async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    const body = joinBodySchema.parse(req.body);
    return joinByCode({ studentId: student.id, studentName: fullName(student), code: body.code });
  });

  // ---------- home (S3) ----------
  app.get('/v1/student/home', async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    const db = getDb();

    const rows = await db
      .select({
        membershipId: s.memberships.id,
        status: s.memberships.status,
        classId: s.classes.id,
        className: s.classes.name,
        daysLabel: s.classes.daysLabel,
        startTime: s.classes.startTime,
        endTime: s.classes.endTime,
        teacherId: s.classes.teacherId,
      })
      .from(s.memberships)
      .innerJoin(s.classes, eq(s.memberships.classId, s.classes.id))
      .where(and(eq(s.memberships.studentId, student.id), isNull(s.classes.archivedAt)))
      .orderBy(asc(s.classes.startTime));

    const classes = [];
    for (const row of rows) {
      const teacher = await db.query.teachers.findFirst({ where: eq(s.teachers.id, row.teacherId) });
      const open = row.status === 'active' ? await findOpenSessionForClass(row.classId) : null;

      let mine: { state: ChipState; passEndsAt: string | null; pendingUnlockId: string | null } | null = null;
      if (open) {
        const participation = await db.query.participations.findFirst({
          where: and(eq(s.participations.sessionId, open.id), eq(s.participations.studentId, student.id)),
        });
        const activePass = await db.query.passes.findFirst({
          where: and(
            eq(s.passes.sessionId, open.id),
            eq(s.passes.studentId, student.id),
            isNull(s.passes.endedAt),
          ),
        });
        const pendingUnlock = await db.query.unlocks.findFirst({
          where: and(
            eq(s.unlocks.sessionId, open.id),
            eq(s.unlocks.studentId, student.id),
            isNull(s.unlocks.reason),
          ),
          orderBy: desc(s.unlocks.at),
        });
        // One state vocabulary everywhere: home returns the same DERIVED chip state the
        // heartbeat and the teacher's grid render, never the raw participation row. Two
        // vocabularies for one field meant the phone had to guess (a stored `pass` whose
        // window has closed is `focused` — shields are already returning).
        const now = new Date();
        const derived = deriveParticipantState({
          storedState: participation?.state ?? null,
          noDevice: participation?.noDevice ?? false,
          passEndsAt: activePass && !activePass.endedAt ? activePass.endsAt : null,
          lastSeenAt: participation?.lastSeenAt ?? null,
          session: { endsAt: open.endsAt, endedAt: open.endedAt },
          now,
        });
        mine = {
          state: derived.state,
          // Gated on the derived state so `pass` always arrives with an end time to act on.
          passEndsAt: derived.state === 'pass' && activePass ? activePass.endsAt.toISOString() : null,
          pendingUnlockId: pendingUnlock?.id ?? null,
        };
      }

      classes.push({
        membershipId: row.membershipId,
        membershipStatus: row.status,
        classId: row.classId,
        className: row.className,
        scheduleLabel: `${row.startTime.slice(0, 5)}–${row.endTime.slice(0, 5)} · ${
          teacher?.displayName ?? ''
        }`,
        teacherDisplayName: teacher?.displayName ?? '',
        live: open
          ? {
              sessionId: open.id,
              endsAt: open.endsAt.toISOString(),
              allowedAppLabels: open.policySnapshot.allowedAppLabels,
              messagesAllowed: open.policySnapshot.messagesAllowed,
              policyName: open.policySnapshot.name,
              mine,
            }
          : null,
      });
    }

    return {
      student: { id: student.id, firstName: student.firstName, lastName: student.lastName },
      classes,
    };
  });

  // ---------- tag resolution (S4's four variants) ----------
  app.post('/v1/tags/resolve', limited(30), async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    const body = resolveTagBodySchema.parse(req.body);
    const db = getDb();

    const tag = await db.query.tags.findFirst({
      where: and(eq(s.tags.code, body.code), eq(s.tags.active, true)),
    });
    if (!tag) return reply.code(404).send({ error: 'unknown_tag', message: 'This tag is not active' });

    const cls = await db.query.classes.findFirst({
      where: and(eq(s.classes.id, tag.classId), isNull(s.classes.archivedAt)),
    });
    if (!cls) return reply.code(404).send({ error: 'unknown_tag', message: 'This tag is not active' });
    const teacher = await db.query.teachers.findFirst({ where: eq(s.teachers.id, cls.teacherId) });

    const membership = await db.query.memberships.findFirst({
      where: and(eq(s.memberships.classId, cls.id), eq(s.memberships.studentId, student.id)),
    });

    const open = await findOpenSessionForClass(cls.id);

    // Variant decision happens server-side so iOS renders exactly one truth.
    const variant =
      !membership || membership.status === 'pending'
        ? 'not_member'
        : !open
          ? 'session_not_started'
          : 'ready';

    return {
      variant,
      classId: cls.id,
      className: cls.name,
      joinCode: cls.joinCode,
      teacherDisplayName: teacher?.displayName ?? 'Your teacher',
      membershipStatus: membership?.status ?? null,
      session: open
        ? {
            sessionId: open.id,
            endsAt: open.endsAt.toISOString(),
            allowedAppLabels: open.policySnapshot.allowedAppLabels,
            messagesAllowed: open.policySnapshot.messagesAllowed,
            policyName: open.policySnapshot.name,
          }
        : null,
    };
  });

  // ---------- focus lifecycle ----------
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/tap-in', limited(30), async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    const body = tapInBodySchema.parse(req.body);
    return tapIn({
      studentId: student.id,
      studentName: fullName(student),
      sessionId: req.params.id,
      clientEventId: body.clientEventId,
      tappedAt: body.tappedAt ? new Date(body.tappedAt) : undefined,
    });
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/heartbeat', limited(12), async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    const body = heartbeatBodySchema.parse(req.body);
    return heartbeat({
      studentId: student.id,
      studentName: fullName(student),
      sessionId: req.params.id,
      permissionOk: body.permissionOk,
      shieldsApplied: body.shieldsApplied,
    });
  });

  // Generous ceiling: the emergency path must never be the thing a limiter blocks.
  app.post<{ Params: { id: string } }>('/v1/sessions/:id/unlock', limited(30), async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    const body = unlockBodySchema.parse(req.body);
    return emergencyUnlock({
      studentId: student.id,
      studentName: fullName(student),
      sessionId: req.params.id,
      clientEventId: body.clientEventId,
      at: body.at ? new Date(body.at) : undefined,
    });
  });

  app.post<{ Params: { id: string } }>('/v1/unlocks/:id/reason', limited(20), async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    const body = unlockReasonBodySchema.parse(req.body);
    await shareUnlockReason({
      studentId: student.id,
      studentName: fullName(student),
      unlockId: req.params.id,
      reason: body.reason,
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/refocus', limited(20), async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    await refocus({ studentId: student.id, studentName: fullName(student), sessionId: req.params.id });
    return { ok: true };
  });

  // ---------- personal history (S8 — student-visible only, enforced here) ----------
  app.get('/v1/student/history', async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    const db = getDb();

    const participations = await db
      .select({
        sessionId: s.participations.sessionId,
        tappedInAt: s.participations.tappedInAt,
        startedAt: s.sessions.startedAt,
        endsAt: s.sessions.endsAt,
        endedAt: s.sessions.endedAt,
        classId: s.sessions.classId,
        className: s.classes.name,
      })
      .from(s.participations)
      .innerJoin(s.sessions, eq(s.participations.sessionId, s.sessions.id))
      .innerJoin(s.classes, eq(s.sessions.classId, s.classes.id))
      .where(eq(s.participations.studentId, student.id))
      .orderBy(desc(s.sessions.startedAt))
      .limit(40);

    const sessions = [];
    for (const p of participations) {
      const end = p.endedAt ?? (p.endsAt < new Date() ? p.endsAt : null);
      const focusedMinutes =
        p.tappedInAt && end ? Math.max(0, Math.round((end.getTime() - p.tappedInAt.getTime()) / 60_000)) : 0;
      const myEvents = await db.query.events.findMany({
        where: and(eq(s.events.sessionId, p.sessionId), eq(s.events.studentId, student.id)),
        orderBy: asc(s.events.at),
      });
      const unlockCount = myEvents.filter((e) => e.type === 'emergency_unlock').length;
      sessions.push({
        sessionId: p.sessionId,
        className: p.className,
        date: p.startedAt.toISOString(),
        focusedMinutes,
        unlockCount,
        timeline: myEvents.map(renderEvent),
        live: !p.endedAt && p.endsAt > new Date(),
      });
    }

    // This week's bars (Mon–Fri)
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
    const week = [0, 0, 0, 0, 0];
    for (const sess of sessions) {
      const d = new Date(sess.date);
      if (d >= weekStart) {
        const idx = (d.getDay() + 6) % 7;
        if (idx < 5 && week[idx] !== undefined) week[idx] += sess.focusedMinutes;
      }
    }

    // Streak: consecutive weekdays (back from today) with ≥25 focused minutes.
    const byDay = new Map<string, number>();
    for (const sess of sessions) {
      const key = new Date(sess.date).toDateString();
      byDay.set(key, (byDay.get(key) ?? 0) + sess.focusedMinutes);
    }
    let streak = 0;
    const cursor = new Date();
    for (let i = 0; i < 30; i++) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        const minutes = byDay.get(cursor.toDateString()) ?? 0;
        if (minutes >= 25) streak++;
        else if (!(i === 0)) break; // today not yet complete doesn't break the streak
        else if (minutes > 0 && minutes < 25) break;
      }
      cursor.setDate(cursor.getDate() - 1);
    }

    return { week, streakDays: streak, sessions };
  });

  // ---------- leave class ----------
  app.post<{ Params: { id: string } }>('/v1/memberships/:id/leave', limited(10), async (req, reply) => {
    const student = await studentGate(req, reply);
    if (!student) return;
    // Domain-side so leaving releases a live session the same way a teacher removal does —
    // a student who walks out mid-period must not be left shielded with the exit 403ing.
    await leaveMembership({ studentId: student.id, membershipId: req.params.id });
    return { ok: true };
  });
}
