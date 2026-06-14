import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb, schema as s } from '@bali/db';
import {
  createClassBodySchema,
  extendSessionBodySchema,
  grantPassBodySchema,
  newJoinCode,
  startSessionBodySchema,
  updateMembershipBodySchema,
} from '@bali/shared';
import { z } from 'zod';
import { authenticate, requireTeacher, type TeacherCtx } from '../auth';
import {
  decideMembership,
  endSession,
  extendSession,
  findOpenSessionForClass,
  getSessionDetail,
  grantPass,
  removeMembership,
  setMembershipDefaults,
  setNoDevice,
  startSession,
} from '../domain';
import { classOverview, sessionRecap, studentSessionHistory } from '../reports';
import { renderEvent } from '../serialize';
import { streamSession } from '../live';

const todayAt = (hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
};

const hhmm12 = (d: Date): string =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', ' ');

async function teacherGate(req: FastifyRequest, reply: FastifyReply): Promise<TeacherCtx | null> {
  return requireTeacher(req, reply);
}

/** "today" / "yesterday" / weekday — T1's idle "last met" recency. */
const relativeDay = (d: Date, now = new Date()): string => {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const ref = new Date(now);
  ref.setHours(0, 0, 0, 0);
  const diff = Math.round((ref.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short' });
};

/** Class card payload shared by W3 list, the portal, and T1/T6 on iOS. */
async function classCard(cls: typeof s.classes.$inferSelect) {
  const db = getDb();
  const [{ value: memberCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(s.memberships)
    .where(and(eq(s.memberships.classId, cls.id), eq(s.memberships.status, 'active')));
  const open = await findOpenSessionForClass(cls.id);
  const policy = cls.policyId
    ? await getDb().query.policies.findFirst({ where: eq(s.policies.id, cls.policyId) })
    : null;
  const lastEnded = open
    ? null
    : await db.query.sessions.findFirst({
        where: and(eq(s.sessions.classId, cls.id), isNotNull(s.sessions.endedAt)),
        orderBy: desc(s.sessions.startedAt),
      });
  return {
    id: cls.id,
    name: cls.name,
    daysLabel: cls.daysLabel,
    startTime: cls.startTime.slice(0, 5),
    endTime: cls.endTime.slice(0, 5),
    joinCode: cls.joinCode,
    requireApproval: cls.requireApproval,
    /** Convenience inverse for the iOS copy ("auto-approve off"). */
    autoApprove: !cls.requireApproval,
    memberCount,
    policyId: cls.policyId,
    policyName: policy?.name ?? null,
    allowedAppLabels: policy?.allowedAppLabels ?? [],
    archived: cls.archivedAt !== null,
    lastMetLabel: lastEnded?.endedAt ? relativeDay(lastEnded.endedAt) : null,
    live: open
      ? { sessionId: open.id, endsAt: open.endsAt.toISOString(), endsAtLabel: hhmm12(open.endsAt) }
      : null,
  };
}

export function teacherRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', authenticate);

  // ---------- classes ----------
  app.get('/v1/classes', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const db = getDb();
    const rows = await db.query.classes.findMany({
      where: and(eq(s.classes.teacherId, teacher.id), isNull(s.classes.archivedAt)),
      orderBy: asc(s.classes.startTime),
    });
    return { classes: await Promise.all(rows.map(classCard)) };
  });

  app.post('/v1/classes', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const body = createClassBodySchema.parse(req.body);
    const db = getDb();
    const [cls] = await db
      .insert(s.classes)
      .values({
        schoolId: teacher.schoolId,
        teacherId: teacher.id,
        name: body.name,
        daysLabel: body.daysLabel,
        startTime: body.startTime,
        endTime: body.endTime,
        policyId: body.policyId ?? null,
        joinCode: newJoinCode(),
        requireApproval: body.requireApproval,
      })
      .returning();
    if (!cls) throw new Error('class insert failed');
    return reply.code(201).send(await classCard(cls));
  });

  app.get<{ Params: { id: string } }>('/v1/classes/:id', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const db = getDb();
    const cls = await db.query.classes.findFirst({
      where: and(eq(s.classes.id, req.params.id), eq(s.classes.teacherId, teacher.id)),
    });
    if (!cls) return reply.code(404).send({ error: 'not_found', message: 'Class not found' });
    return classCard(cls);
  });

  // ---------- roster ----------
  app.get<{ Params: { id: string } }>('/v1/classes/:id/roster', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const db = getDb();
    const cls = await db.query.classes.findFirst({
      where: and(eq(s.classes.id, req.params.id), eq(s.classes.teacherId, teacher.id)),
    });
    if (!cls) return reply.code(404).send({ error: 'not_found', message: 'Class not found' });

    const rows = await db
      .select({
        membershipId: s.memberships.id,
        status: s.memberships.status,
        source: s.memberships.source,
        defaultNoDevice: s.memberships.defaultNoDevice,
        joinedAt: s.memberships.joinedAt,
        studentId: s.students.id,
        firstName: s.students.firstName,
        lastName: s.students.lastName,
      })
      .from(s.memberships)
      .innerJoin(s.students, eq(s.memberships.studentId, s.students.id))
      .where(eq(s.memberships.classId, cls.id))
      .orderBy(asc(s.students.firstName));

    const open = await findOpenSessionForClass(cls.id);
    const live = open ? await getSessionDetail(open.id) : null;
    const stateByStudent = new Map(live?.participants.map((p) => [p.studentId, p]) ?? []);

    return {
      class: await classCard(cls),
      members: rows
        .filter((r) => r.status === 'active')
        .map((r) => ({
          membershipId: r.membershipId,
          studentId: r.studentId,
          name: `${r.firstName} ${r.lastName}`,
          joinedAt: r.joinedAt.toISOString(),
          source: r.source,
          defaultNoDevice: r.defaultNoDevice,
          current: stateByStudent.get(r.studentId) ?? null,
        })),
      pending: rows
        .filter((r) => r.status === 'pending')
        .map((r) => ({
          membershipId: r.membershipId,
          studentId: r.studentId,
          name: `${r.firstName} ${r.lastName}`,
          requestedAt: r.joinedAt.toISOString(),
          source: r.source,
        })),
    };
  });

  app.patch<{ Params: { id: string } }>('/v1/memberships/:id', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const body = updateMembershipBodySchema.parse(req.body);
    return setMembershipDefaults({
      teacherId: teacher.id,
      membershipId: req.params.id,
      defaultNoDevice: body.defaultNoDevice,
    });
  });

  app.post<{ Params: { id: string } }>('/v1/memberships/:id/approve', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    await decideMembership({
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
      membershipId: req.params.id,
      approve: true,
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/v1/memberships/:id/decline', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    await decideMembership({
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
      membershipId: req.params.id,
      approve: false,
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/v1/memberships/:id', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    await removeMembership({ teacherId: teacher.id, schoolId: teacher.schoolId, membershipId: req.params.id });
    return { ok: true };
  });

  // ---------- policies (list powers the start-session sheet + W6 later) ----------
  app.get('/v1/policies', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const db = getDb();
    const rows = await db.query.policies.findMany({
      where: eq(s.policies.teacherId, teacher.id),
      orderBy: asc(s.policies.createdAt),
    });
    const usage = await db
      .select({ policyId: s.classes.policyId, value: count() })
      .from(s.classes)
      .where(and(eq(s.classes.teacherId, teacher.id), isNull(s.classes.archivedAt)))
      .groupBy(s.classes.policyId);
    const usedBy = new Map(usage.map((u) => [u.policyId, u.value]));
    return {
      policies: rows.map((p) => ({
        id: p.id,
        name: p.name,
        messagesAllowed: p.messagesAllowed,
        allowedAppLabels: p.allowedAppLabels,
        usedByClasses: usedBy.get(p.id) ?? 0,
      })),
    };
  });

  // ---------- sessions ----------
  app.post<{ Params: { id: string } }>('/v1/classes/:id/sessions', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const body = startSessionBodySchema.parse(req.body);
    const detail = await startSession({
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
      classId: req.params.id,
      endsAt: new Date(body.endsAt),
      policyId: body.policyId,
    });
    return reply.code(201).send(detail);
  });

  app.get<{ Params: { id: string } }>('/v1/sessions/:id', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const detail = await getSessionDetail(req.params.id);
    return detail;
  });

  app.get<{ Params: { id: string } }>('/v1/sessions/:id/stream', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    await streamSession(req, reply, req.params.id);
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/end', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    await endSession(req.params.id, 'teacher');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/extend', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const body = extendSessionBodySchema.parse(req.body);
    await extendSession(req.params.id, body.minutes, teacher.id, teacher.schoolId);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/passes', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const body = grantPassBodySchema.parse(req.body);
    const result = await grantPass({
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
      sessionId: req.params.id,
      studentId: body.studentId,
      minutes: body.minutes,
      reason: body.reason,
    });
    return reply.code(201).send({ passId: result.passId, endsAt: result.endsAt.toISOString() });
  });

  app.post<{ Params: { id: string } }>('/v1/sessions/:id/no-device', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const body = z.object({ studentId: z.string().uuid(), on: z.boolean() }).parse(req.body);
    await setNoDevice({
      teacherId: teacher.id,
      schoolId: teacher.schoolId,
      sessionId: req.params.id,
      studentId: body.studentId,
      on: body.on,
    });
    return { ok: true };
  });

  /** Per-student session timeline for the StudentPanel / T3 sheet. */
  app.get<{ Params: { id: string; studentId: string } }>(
    '/v1/sessions/:id/students/:studentId/timeline',
    async (req, reply) => {
      const teacher = await teacherGate(req, reply);
      if (!teacher) return;
      const db = getDb();
      const rows = await db.query.events.findMany({
        where: and(eq(s.events.sessionId, req.params.id), eq(s.events.studentId, req.params.studentId)),
        orderBy: asc(s.events.at),
      });
      return { events: rows.map(renderEvent) };
    },
  );

  // ---------- T6 · Overview · T10 · Recap · T3 · Recent ----------

  /** T6 Overview quick stats — members, sessions this week, last-session recap pointer. */
  app.get<{ Params: { id: string } }>('/v1/classes/:id/overview', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const db = getDb();
    const cls = await db.query.classes.findFirst({
      where: and(eq(s.classes.id, req.params.id), eq(s.classes.teacherId, teacher.id)),
    });
    if (!cls) return reply.code(404).send({ error: 'not_found', message: 'Class not found' });
    return classOverview(cls.id);
  });

  /** T10 Session Recap — neutral aggregates for one (usually ended) session. */
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/recap', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const db = getDb();
    const session = await db.query.sessions.findFirst({
      where: and(eq(s.sessions.id, req.params.id), eq(s.sessions.teacherId, teacher.id)),
    });
    if (!session) return reply.code(404).send({ error: 'not_found', message: 'Session not found' });
    const recap = await sessionRecap(session.id);
    if (!recap) return reply.code(404).send({ error: 'not_found', message: 'Session not found' });
    return recap;
  });

  /** T3 Recent — last ~5 sessions for one (student, class) as outcome rows. */
  app.get<{ Params: { id: string; studentId: string } }>(
    '/v1/classes/:id/students/:studentId/history',
    async (req, reply) => {
      const teacher = await teacherGate(req, reply);
      if (!teacher) return;
      const db = getDb();
      const cls = await db.query.classes.findFirst({
        where: and(eq(s.classes.id, req.params.id), eq(s.classes.teacherId, teacher.id)),
      });
      if (!cls) return reply.code(404).send({ error: 'not_found', message: 'Class not found' });
      const history = await studentSessionHistory({ classId: cls.id, studentId: req.params.studentId });
      if (!history) return reply.code(404).send({ error: 'not_found', message: 'Student not found' });
      return history;
    },
  );

  // ---------- portal home ----------
  app.get('/v1/portal/home', async (req, reply) => {
    const teacher = await teacherGate(req, reply);
    if (!teacher) return;
    const db = getDb();
    const school = await db.query.schools.findFirst({ where: eq(s.schools.id, teacher.schoolId) });
    const classes = await db.query.classes.findMany({
      where: and(eq(s.classes.teacherId, teacher.id), isNull(s.classes.archivedAt)),
      orderBy: asc(s.classes.startTime),
    });

    // live-now card
    let live: Awaited<ReturnType<typeof getSessionDetail>> | null = null;
    for (const cls of classes) {
      const open = await findOpenSessionForClass(cls.id);
      if (open) {
        live = await getSessionDetail(open.id);
        break;
      }
    }

    // today rows: past (ended session today) · now · future
    const now = new Date();
    const today: Array<Record<string, unknown>> = [];
    for (const cls of classes) {
      const start = todayAt(cls.startTime.slice(0, 5));
      const end = todayAt(cls.endTime.slice(0, 5));
      const card = await classCard(cls);
      if (card.live) {
        today.push({
          kind: 'now',
          classId: cls.id,
          sessionId: card.live.sessionId,
          name: cls.name,
          // Bell time like the other rows — the "● Live now" trailing label carries the state.
          timeLabel: hhmm12(start).replace(' AM', '').replace(' PM', ''),
          subtitle: `live until ${card.live.endsAtLabel} · ${card.memberCount} students`,
        });
        continue;
      }
      if (end <= now) {
        // this morning's ended session, if any
        const ended = await db.query.sessions.findFirst({
          where: and(eq(s.sessions.classId, cls.id)),
          orderBy: desc(s.sessions.startedAt),
        });
        const sameDay = ended?.endedAt && ended.endedAt.toDateString() === now.toDateString();
        const avg =
          sameDay && ended
            ? Math.round((ended.endedAt!.getTime() - ended.startedAt.getTime()) / 60_000)
            : null;
        today.push({
          kind: 'past',
          classId: cls.id,
          name: cls.name,
          timeLabel: hhmm12(start).replace(' AM', '').replace(' PM', ''),
          subtitle: sameDay && avg !== null ? `ended · ${avg} min session` : 'no session today',
        });
      } else {
        today.push({
          kind: 'future',
          classId: cls.id,
          name: cls.name,
          policyName: card.policyName,
          timeLabel: hhmm12(start).replace(' AM', '').replace(' PM', ''),
          startLabel: hhmm12(start),
          endsAtIso: end.toISOString(),
          subtitle: `${card.policyName ?? 'Focus'} policy · ends at the ${hhmm12(end)} bell`,
        });
      }
    }

    // approvals across classes
    const pending = await db
      .select({
        membershipId: s.memberships.id,
        classId: s.classes.id,
        joinedAt: s.memberships.joinedAt,
        firstName: s.students.firstName,
        lastName: s.students.lastName,
        className: s.classes.name,
      })
      .from(s.memberships)
      .innerJoin(s.students, eq(s.memberships.studentId, s.students.id))
      .innerJoin(s.classes, eq(s.memberships.classId, s.classes.id))
      .where(and(eq(s.classes.teacherId, teacher.id), eq(s.memberships.status, 'pending')))
      .orderBy(desc(s.memberships.joinedAt));

    const recent = await db.query.events.findMany({
      where: eq(s.events.schoolId, teacher.schoolId),
      orderBy: desc(s.events.at),
      limit: 3,
    });

    const nextBell = (() => {
      const upcoming = classes
        .map((c) => todayAt(c.endTime.slice(0, 5)))
        .filter((d) => d > now)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      return upcoming ? hhmm12(upcoming) : null;
    })();

    return {
      teacher: { displayName: teacher.displayName, schoolName: school?.name ?? '' },
      dateLabel: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      nextBell,
      live,
      today,
      approvals: pending.map((p) => ({
        membershipId: p.membershipId,
        classId: p.classId,
        name: `${p.firstName} ${p.lastName}`,
        className: p.className,
        requestedAt: p.joinedAt.toISOString(),
      })),
      recent: recent.map(renderEvent),
    };
  });

}
