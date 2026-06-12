import type { FastifyInstance } from 'fastify';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { getDb, schema as s } from '@bali/db';
import {
  createPolicyBodySchema,
  createTagBodySchema,
  newTagCode,
  updateClassBodySchema,
  updatePolicyBodySchema,
  updateSettingsBodySchema,
  updateTagBodySchema,
} from '@bali/shared';
import { authenticate, requireTeacher } from '../auth';
import { appendEvent, findOpenSessionForClass, HttpError } from '../domain';

type PolicyRow = typeof s.policies.$inferSelect;
type TagRow = typeof s.tags.$inferSelect;

async function policyUsage(teacherId: string): Promise<Map<string | null, number>> {
  const db = getDb();
  const usage = await db
    .select({ policyId: s.classes.policyId, value: count() })
    .from(s.classes)
    .where(and(eq(s.classes.teacherId, teacherId), isNull(s.classes.archivedAt)))
    .groupBy(s.classes.policyId);
  return new Map(usage.map((u) => [u.policyId, u.value]));
}

const serializePolicy = (p: PolicyRow, usedByClasses: number) => ({
  id: p.id,
  name: p.name,
  messagesAllowed: p.messagesAllowed,
  allowedAppLabels: p.allowedAppLabels,
  usedByClasses,
});

const serializeTag = (t: TagRow, className: string) => ({
  id: t.id,
  classId: t.classId,
  className,
  label: t.label,
  code: t.code,
  active: t.active,
  createdAt: t.createdAt.toISOString(),
  deactivatedAt: t.deactivatedAt ? t.deactivatedAt.toISOString() : null,
});

/** Teacher management surfaces: class edit/archive (W3/W5), policies (W6), tags (W7),
 *  settings (W10). Registered with the same auth gate as the core teacher routes. */
export function manageRoutes(app: FastifyInstance): void {
  app.addHook('preHandler', authenticate);

  // ---------- class edit / archive (PATCH /v1/classes/:id) ----------
  app.patch<{ Params: { id: string } }>('/v1/classes/:id', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const body = updateClassBodySchema.parse(req.body);
    const db = getDb();

    const cls = await db.query.classes.findFirst({
      where: and(eq(s.classes.id, req.params.id), eq(s.classes.teacherId, teacher.id)),
    });
    if (!cls) throw new HttpError(404, 'not_found', 'Class not found');

    if (body.policyId) {
      const policy = await db.query.policies.findFirst({
        where: and(eq(s.policies.id, body.policyId), eq(s.policies.teacherId, teacher.id)),
      });
      if (!policy) throw new HttpError(404, 'not_found', 'Policy not found');
    }

    if (body.archived && !cls.archivedAt && (await findOpenSessionForClass(cls.id)))
      throw new HttpError(409, 'session_running', 'End the live session before archiving');

    const [updated] = await db
      .update(s.classes)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.daysLabel !== undefined ? { daysLabel: body.daysLabel } : {}),
        ...(body.startTime !== undefined ? { startTime: body.startTime } : {}),
        ...(body.endTime !== undefined ? { endTime: body.endTime } : {}),
        ...(body.policyId !== undefined ? { policyId: body.policyId } : {}),
        ...(body.requireApproval !== undefined ? { requireApproval: body.requireApproval } : {}),
        ...(body.archived !== undefined ? { archivedAt: body.archived ? cls.archivedAt ?? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(s.classes.id, cls.id))
      .returning();
    if (!updated) throw new Error('class update failed');

    return {
      id: updated.id,
      name: updated.name,
      daysLabel: updated.daysLabel,
      startTime: updated.startTime.slice(0, 5),
      endTime: updated.endTime.slice(0, 5),
      joinCode: updated.joinCode,
      requireApproval: updated.requireApproval,
      policyId: updated.policyId,
      archived: updated.archivedAt !== null,
    };
  });

  // ---------- policies (W6) ----------
  app.post('/v1/policies', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const body = createPolicyBodySchema.parse(req.body);
    const db = getDb();
    const [policy] = await db
      .insert(s.policies)
      .values({
        teacherId: teacher.id,
        name: body.name,
        messagesAllowed: body.messagesAllowed,
        allowedAppLabels: body.allowedAppLabels,
      })
      .returning();
    if (!policy) throw new Error('policy insert failed');
    return reply.code(201).send(serializePolicy(policy, 0));
  });

  app.patch<{ Params: { id: string } }>('/v1/policies/:id', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const body = updatePolicyBodySchema.parse(req.body);
    const db = getDb();
    const policy = await db.query.policies.findFirst({
      where: and(eq(s.policies.id, req.params.id), eq(s.policies.teacherId, teacher.id)),
    });
    if (!policy) throw new HttpError(404, 'not_found', 'Policy not found');

    const [updated] = await db
      .update(s.policies)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.messagesAllowed !== undefined ? { messagesAllowed: body.messagesAllowed } : {}),
        ...(body.allowedAppLabels !== undefined ? { allowedAppLabels: body.allowedAppLabels } : {}),
        updatedAt: new Date(),
      })
      .where(eq(s.policies.id, policy.id))
      .returning();
    if (!updated) throw new Error('policy update failed');
    const usage = await policyUsage(teacher.id);
    return serializePolicy(updated, usage.get(updated.id) ?? 0);
  });

  app.delete<{ Params: { id: string } }>('/v1/policies/:id', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const db = getDb();
    const policy = await db.query.policies.findFirst({
      where: and(eq(s.policies.id, req.params.id), eq(s.policies.teacherId, teacher.id)),
    });
    if (!policy) throw new HttpError(404, 'not_found', 'Policy not found');

    const usage = await policyUsage(teacher.id);
    const inUse = usage.get(policy.id) ?? 0;
    if (inUse > 0)
      throw new HttpError(
        409,
        'policy_in_use',
        `In use — detach from ${inUse} ${inUse === 1 ? 'class' : 'classes'} first.`,
      );

    await db.transaction(async (tx) => {
      // History keeps its truth via policy_snapshot; the FK provenance pointers clear.
      await tx.update(s.sessions).set({ policyId: null }).where(eq(s.sessions.policyId, policy.id));
      await tx.update(s.classes).set({ policyId: null }).where(eq(s.classes.policyId, policy.id));
      await tx.delete(s.policies).where(eq(s.policies.id, policy.id));
    });
    return { ok: true };
  });

  // ---------- tags (W7 + T4) ----------
  app.get<{ Params: { id: string } }>('/v1/classes/:id/tags', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const db = getDb();
    const cls = await db.query.classes.findFirst({
      where: and(eq(s.classes.id, req.params.id), eq(s.classes.teacherId, teacher.id)),
    });
    if (!cls) throw new HttpError(404, 'not_found', 'Class not found');
    const rows = await db.query.tags.findMany({
      where: eq(s.tags.classId, cls.id),
      orderBy: asc(s.tags.createdAt),
    });
    return { class: { id: cls.id, name: cls.name }, tags: rows.map((t) => serializeTag(t, cls.name)) };
  });

  app.post<{ Params: { id: string } }>('/v1/classes/:id/tags', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const body = createTagBodySchema.parse(req.body);
    const db = getDb();
    const cls = await db.query.classes.findFirst({
      where: and(eq(s.classes.id, req.params.id), eq(s.classes.teacherId, teacher.id)),
    });
    if (!cls) throw new HttpError(404, 'not_found', 'Class not found');

    if (body.code) {
      const existing = await db.query.tags.findFirst({ where: eq(s.tags.code, body.code) });
      if (existing) throw new HttpError(409, 'code_taken', 'That tag code is already in use');
    }

    const tag = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(s.tags)
        .values({ classId: cls.id, label: body.label, code: body.code ?? newTagCode() })
        .returning();
      if (!row) throw new Error('tag insert failed');
      await appendEvent(tx, {
        schoolId: cls.schoolId,
        classId: cls.id,
        teacherId: teacher.id,
        type: 'tag_created',
        payload: { label: row.label, className: cls.name },
      });
      return row;
    });
    return reply.code(201).send(serializeTag(tag, cls.name));
  });

  app.patch<{ Params: { id: string } }>('/v1/tags/:id', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const body = updateTagBodySchema.parse(req.body);
    const db = getDb();

    const tag = await db.query.tags.findFirst({ where: eq(s.tags.id, req.params.id) });
    if (!tag) throw new HttpError(404, 'not_found', 'Tag not found');
    const cls = await db.query.classes.findFirst({
      where: and(eq(s.classes.id, tag.classId), eq(s.classes.teacherId, teacher.id)),
    });
    if (!cls) throw new HttpError(404, 'not_found', 'Tag not found');

    const updated = await db.transaction(async (tx) => {
      const deactivating = body.active === false && tag.active;
      const reactivating = body.active === true && !tag.active;
      const [row] = await tx
        .update(s.tags)
        .set({
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(deactivating ? { active: false, deactivatedAt: new Date() } : {}),
          ...(reactivating ? { active: true, deactivatedAt: null } : {}),
        })
        .where(eq(s.tags.id, tag.id))
        .returning();
      if (!row) throw new Error('tag update failed');
      if (deactivating || reactivating) {
        await appendEvent(tx, {
          schoolId: cls.schoolId,
          classId: cls.id,
          teacherId: teacher.id,
          // Reactivation renders "Tag … is live" — literally true, no new event type needed.
          type: deactivating ? 'tag_deactivated' : 'tag_created',
          payload: { label: row.label, className: cls.name },
        });
      }
      return row;
    });
    return serializeTag(updated, cls.name);
  });

  // ---------- settings (W10) ----------
  app.get('/v1/me/settings', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const db = getDb();
    const row = await db.query.teachers.findFirst({ where: eq(s.teachers.id, teacher.id) });
    const school = await db.query.schools.findFirst({ where: eq(s.schools.id, teacher.schoolId) });
    if (!row) throw new HttpError(404, 'not_found', 'Teacher not found');
    return {
      name: row.name,
      displayName: row.displayName,
      email: row.email,
      schoolName: school?.name ?? '',
      notifyEmergency: row.notifyEmergency,
      notifyRevoked: row.notifyRevoked,
      notifyWeekly: row.notifyWeekly,
    };
  });

  app.patch('/v1/me/settings', async (req, reply) => {
    const teacher = await requireTeacher(req, reply);
    if (!teacher) return;
    const body = updateSettingsBodySchema.parse(req.body);
    const db = getDb();

    await db.transaction(async (tx) => {
      await tx
        .update(s.teachers)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.notifyEmergency !== undefined ? { notifyEmergency: body.notifyEmergency } : {}),
          ...(body.notifyRevoked !== undefined ? { notifyRevoked: body.notifyRevoked } : {}),
          ...(body.notifyWeekly !== undefined ? { notifyWeekly: body.notifyWeekly } : {}),
          updatedAt: new Date(),
        })
        .where(eq(s.teachers.id, teacher.id));
      if (body.schoolName !== undefined) {
        await tx.update(s.schools).set({ name: body.schoolName }).where(eq(s.schools.id, teacher.schoolId));
      }
    });

    const row = await db.query.teachers.findFirst({ where: eq(s.teachers.id, teacher.id) });
    const school = await db.query.schools.findFirst({ where: eq(s.schools.id, teacher.schoolId) });
    return {
      name: row!.name,
      displayName: row!.displayName,
      email: row!.email,
      schoolName: school?.name ?? '',
      notifyEmergency: row!.notifyEmergency,
      notifyRevoked: row!.notifyRevoked,
      notifyWeekly: row!.notifyWeekly,
    };
  });
}
