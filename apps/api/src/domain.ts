import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { getDb, schema as s, type Db } from '@bali/db';
import { deriveParticipantState, type SessionDetailDTO, type UnlockReason } from '@bali/shared';
import { bus } from './bus';
import {
  countStates,
  renderEvent,
  serializeParticipant,
  serializeSession,
  shortName,
  type ParticipantSource,
} from './serialize';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type EventRow = typeof s.events.$inferSelect;
type SessionRow = typeof s.sessions.$inferSelect;

// ---------- event helper ----------

interface EventInput {
  schoolId: string;
  classId?: string | null;
  sessionId?: string | null;
  studentId?: string | null;
  teacherId?: string | null;
  type: (typeof s.eventTypeEnum.enumValues)[number];
  payload: Record<string, unknown>;
  at?: Date;
}

async function appendEvent(tx: Tx, input: EventInput): Promise<EventRow> {
  const [row] = await tx
    .insert(s.events)
    .values({
      schoolId: input.schoolId,
      classId: input.classId ?? null,
      sessionId: input.sessionId ?? null,
      studentId: input.studentId ?? null,
      teacherId: input.teacherId ?? null,
      type: input.type,
      payload: input.payload,
      at: input.at ?? new Date(),
    })
    .returning();
  if (!row) throw new Error('event insert failed');
  return row;
}

function publishEvents(sessionId: string | null, events: EventRow[]): void {
  if (!sessionId) return;
  for (const ev of events) bus.publish(sessionId, { kind: 'event', event: renderEvent(ev) });
}

// ---------- loading ----------

export async function loadSessionWithClass(sessionId: string) {
  const db = getDb();
  const session = await db.query.sessions.findFirst({ where: eq(s.sessions.id, sessionId) });
  if (!session) throw new HttpError(404, 'not_found', 'Session not found');
  const cls = await db.query.classes.findFirst({ where: eq(s.classes.id, session.classId) });
  if (!cls) throw new HttpError(404, 'not_found', 'Class not found');
  return { session, cls };
}

/** Full live detail: roster × participations × active passes × pending unlocks. */
export async function getSessionDetail(sessionId: string, now = new Date()): Promise<SessionDetailDTO> {
  const db = getDb();
  const { session, cls } = await loadSessionWithClass(sessionId);

  const members = await db
    .select({
      studentId: s.students.id,
      firstName: s.students.firstName,
      lastName: s.students.lastName,
    })
    .from(s.memberships)
    .innerJoin(s.students, eq(s.memberships.studentId, s.students.id))
    .where(and(eq(s.memberships.classId, session.classId), eq(s.memberships.status, 'active')))
    .orderBy(asc(s.memberships.joinedAt));

  const participations = await db.query.participations.findMany({
    where: eq(s.participations.sessionId, sessionId),
  });
  const activePasses = await db.query.passes.findMany({
    where: and(eq(s.passes.sessionId, sessionId), isNull(s.passes.endedAt)),
  });
  const pendingUnlocks = await db.query.unlocks.findMany({
    where: and(eq(s.unlocks.sessionId, sessionId), isNull(s.unlocks.reason)),
  });

  const byStudent = new Map(participations.map((p) => [p.studentId, p]));
  const passByStudent = new Map(activePasses.map((p) => [p.studentId, p]));
  const unlockByStudent = new Map(pendingUnlocks.map((u) => [u.studentId, u]));

  const participants = members.map((m) => {
    const src: ParticipantSource = {
      student: { id: m.studentId, firstName: m.firstName, lastName: m.lastName },
      participation: byStudent.get(m.studentId) ?? null,
      activePass: passByStudent.get(m.studentId) ?? null,
      pendingUnlock: unlockByStudent.get(m.studentId) ?? null,
    };
    return serializeParticipant(src, session, now);
  });

  return {
    session: serializeSession(session, cls.name),
    participants,
    counts: countStates(participants),
  };
}

async function publishParticipant(sessionId: string, studentId: string): Promise<void> {
  try {
    const detail = await getSessionDetail(sessionId);
    const participant = detail.participants.find((p) => p.studentId === studentId);
    if (participant) bus.publish(sessionId, { kind: 'participant', participant, counts: detail.counts });
  } catch {
    // live fan-out is best-effort; the poll fallback self-heals
  }
}

async function publishSession(sessionId: string): Promise<void> {
  try {
    const { session, cls } = await loadSessionWithClass(sessionId);
    bus.publish(sessionId, { kind: 'session', session: serializeSession(session, cls.name) });
  } catch {
    /* best-effort */
  }
}

// ---------- teacher: session lifecycle ----------

export async function findOpenSessionForClass(classId: string): Promise<SessionRow | null> {
  const db = getDb();
  const open = await db.query.sessions.findFirst({
    where: and(eq(s.sessions.classId, classId), isNull(s.sessions.endedAt)),
  });
  if (!open) return null;
  // Lazy bell: an overdue session is ended on sight, not served as live.
  if (open.endsAt <= new Date()) {
    await endSession(open.id, 'bell');
    return null;
  }
  return open;
}

export async function startSession(opts: {
  teacherId: string;
  schoolId: string;
  classId: string;
  endsAt: Date;
  policyId?: string;
}): Promise<SessionDetailDTO> {
  const db = getDb();
  const cls = await db.query.classes.findFirst({ where: eq(s.classes.id, opts.classId) });
  if (!cls || cls.teacherId !== opts.teacherId) throw new HttpError(404, 'not_found', 'Class not found');
  if (await findOpenSessionForClass(opts.classId))
    throw new HttpError(409, 'session_running', 'A session is already running for this class');
  if (opts.endsAt <= new Date()) throw new HttpError(400, 'ends_in_past', 'Session end must be in the future');

  const policyId = opts.policyId ?? cls.policyId;
  const policy = policyId
    ? await db.query.policies.findFirst({ where: eq(s.policies.id, policyId) })
    : null;
  // Snapshot frozen at start — sessions never re-resolve policy (WIRING_PLAN §1.5).
  const snapshot = policy
    ? { name: policy.name, messagesAllowed: policy.messagesAllowed, allowedAppLabels: policy.allowedAppLabels }
    : { name: 'Focus', messagesAllowed: true, allowedAppLabels: [] };

  const events: EventRow[] = [];
  const sessionId = await db.transaction(async (tx) => {
    const [session] = await tx
      .insert(s.sessions)
      .values({
        classId: cls.id,
        teacherId: opts.teacherId,
        policyId: policyId ?? null,
        policySnapshot: snapshot,
        endsAt: opts.endsAt,
      })
      .returning();
    if (!session) throw new Error('session insert failed');
    events.push(
      await appendEvent(tx, {
        schoolId: opts.schoolId,
        classId: cls.id,
        sessionId: session.id,
        teacherId: opts.teacherId,
        type: 'session_started',
        payload: { className: cls.name, policyName: snapshot.name },
      }),
    );
    return session.id;
  });

  publishEvents(sessionId, events);
  return getSessionDetail(sessionId);
}

export async function endSession(sessionId: string, reason: 'bell' | 'teacher'): Promise<void> {
  const db = getDb();
  const events: EventRow[] = [];
  const ended = await db.transaction(async (tx) => {
    const session = await tx.query.sessions.findFirst({ where: eq(s.sessions.id, sessionId) });
    if (!session || session.endedAt) return false;
    const cls = await tx.query.classes.findFirst({ where: eq(s.classes.id, session.classId) });
    const endedAt = reason === 'bell' && session.endsAt < new Date() ? session.endsAt : new Date();

    await tx.update(s.sessions).set({ endedAt, endReason: reason }).where(eq(s.sessions.id, sessionId));
    await tx
      .update(s.participations)
      .set({ state: 'ended' })
      .where(eq(s.participations.sessionId, sessionId));
    await tx
      .update(s.passes)
      .set({ endedAt })
      .where(and(eq(s.passes.sessionId, sessionId), isNull(s.passes.endedAt)));
    events.push(
      await appendEvent(tx, {
        schoolId: cls?.schoolId ?? session.classId,
        classId: session.classId,
        sessionId,
        teacherId: session.teacherId,
        type: 'session_ended',
        payload: { className: cls?.name, reason },
        at: endedAt,
      }),
    );
    return true;
  });

  if (ended) {
    publishEvents(sessionId, events);
    await publishSession(sessionId);
    // One snapshot so every chip flips to "Ended" together.
    const detail = await getSessionDetail(sessionId);
    bus.publish(sessionId, { kind: 'snapshot', detail });
  }
}

export async function extendSession(sessionId: string, minutes: number, teacherId: string, schoolId: string): Promise<void> {
  const db = getDb();
  const events: EventRow[] = [];
  await db.transaction(async (tx) => {
    const session = await tx.query.sessions.findFirst({ where: eq(s.sessions.id, sessionId) });
    if (!session || session.endedAt) throw new HttpError(409, 'not_live', 'Session is not running');
    if (session.teacherId !== teacherId) throw new HttpError(404, 'not_found', 'Session not found');
    const cls = await tx.query.classes.findFirst({ where: eq(s.classes.id, session.classId) });
    const endsAt = new Date(session.endsAt.getTime() + minutes * 60_000);
    await tx.update(s.sessions).set({ endsAt }).where(eq(s.sessions.id, sessionId));
    events.push(
      await appendEvent(tx, {
        schoolId,
        classId: session.classId,
        sessionId,
        teacherId,
        type: 'session_extended',
        payload: { className: cls?.name, minutes },
      }),
    );
  });
  publishEvents(sessionId, events);
  await publishSession(sessionId);
}

// ---------- teacher: passes / no-device ----------

export async function grantPass(opts: {
  teacherId: string;
  schoolId: string;
  sessionId: string;
  studentId: string;
  minutes: number;
  reason?: string;
}): Promise<{ passId: string; endsAt: Date }> {
  const db = getDb();
  const events: EventRow[] = [];
  const result = await db.transaction(async (tx) => {
    const session = await tx.query.sessions.findFirst({ where: eq(s.sessions.id, opts.sessionId) });
    if (!session || session.endedAt || session.endsAt <= new Date())
      throw new HttpError(409, 'not_live', 'Session is not running');
    if (session.teacherId !== opts.teacherId) throw new HttpError(404, 'not_found', 'Session not found');

    const participation = await tx.query.participations.findFirst({
      where: and(eq(s.participations.sessionId, opts.sessionId), eq(s.participations.studentId, opts.studentId)),
    });
    if (!participation || (participation.state !== 'focused' && participation.state !== 'pass'))
      throw new HttpError(409, 'not_focused', 'Passes go to students who are currently focused');

    const existing = await tx.query.passes.findFirst({
      where: and(
        eq(s.passes.sessionId, opts.sessionId),
        eq(s.passes.studentId, opts.studentId),
        isNull(s.passes.endedAt),
      ),
    });
    if (existing) throw new HttpError(409, 'pass_active', 'This student already has an active pass');

    const endsAt = new Date(Math.min(Date.now() + opts.minutes * 60_000, session.endsAt.getTime()));
    const [pass] = await tx
      .insert(s.passes)
      .values({
        sessionId: opts.sessionId,
        studentId: opts.studentId,
        minutes: opts.minutes,
        reason: opts.reason ?? null,
        endsAt,
      })
      .returning();
    if (!pass) throw new Error('pass insert failed');
    await tx.update(s.participations).set({ state: 'pass' }).where(eq(s.participations.id, participation.id));

    const student = await tx.query.students.findFirst({ where: eq(s.students.id, opts.studentId) });
    const cls = await tx.query.classes.findFirst({ where: eq(s.classes.id, session.classId) });
    events.push(
      await appendEvent(tx, {
        schoolId: opts.schoolId,
        classId: session.classId,
        sessionId: opts.sessionId,
        studentId: opts.studentId,
        teacherId: opts.teacherId,
        type: 'pass_granted',
        payload: {
          studentName: student ? `${student.firstName} ${student.lastName}` : undefined,
          className: cls?.name,
          minutes: opts.minutes,
          reason: opts.reason,
        },
      }),
    );
    return { passId: pass.id, endsAt };
  });

  publishEvents(opts.sessionId, events);
  await publishParticipant(opts.sessionId, opts.studentId);
  return result;
}

export async function setNoDevice(opts: {
  teacherId: string;
  schoolId: string;
  sessionId: string;
  studentId: string;
  on: boolean;
}): Promise<void> {
  const db = getDb();
  const events: EventRow[] = [];
  await db.transaction(async (tx) => {
    const session = await tx.query.sessions.findFirst({ where: eq(s.sessions.id, opts.sessionId) });
    if (!session || session.teacherId !== opts.teacherId)
      throw new HttpError(404, 'not_found', 'Session not found');

    const existing = await tx.query.participations.findFirst({
      where: and(eq(s.participations.sessionId, opts.sessionId), eq(s.participations.studentId, opts.studentId)),
    });
    if (existing) {
      await tx.update(s.participations).set({ noDevice: opts.on }).where(eq(s.participations.id, existing.id));
    } else {
      await tx
        .insert(s.participations)
        .values({ sessionId: opts.sessionId, studentId: opts.studentId, state: 'not_joined', noDevice: opts.on });
    }
    const student = await tx.query.students.findFirst({ where: eq(s.students.id, opts.studentId) });
    const cls = await tx.query.classes.findFirst({ where: eq(s.classes.id, session.classId) });
    events.push(
      await appendEvent(tx, {
        schoolId: opts.schoolId,
        classId: session.classId,
        sessionId: opts.sessionId,
        studentId: opts.studentId,
        teacherId: opts.teacherId,
        type: opts.on ? 'no_device_set' : 'no_device_cleared',
        payload: {
          studentName: student ? `${student.firstName} ${student.lastName}` : undefined,
          className: cls?.name,
        },
      }),
    );
  });
  publishEvents(opts.sessionId, events);
  await publishParticipant(opts.sessionId, opts.studentId);
}

// ---------- student: membership gate ----------

async function requireActiveMembership(sessionId: string, studentId: string) {
  const db = getDb();
  const { session, cls } = await loadSessionWithClass(sessionId);
  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(s.memberships.classId, session.classId),
      eq(s.memberships.studentId, studentId),
      eq(s.memberships.status, 'active'),
    ),
  });
  if (!membership) throw new HttpError(403, 'not_member', "You're not in this class yet");
  return { session, cls };
}

// ---------- student: tap-in / heartbeat / unlock / reason / refocus ----------

export async function tapIn(opts: {
  studentId: string;
  studentName: string;
  sessionId: string;
  clientEventId: string;
  tappedAt?: Date;
}): Promise<{ state: 'focused'; alreadyIn: boolean }> {
  const { session, cls } = await requireActiveMembership(opts.sessionId, opts.studentId);
  if (session.endedAt || session.endsAt <= new Date())
    throw new HttpError(409, 'session_over', 'This session has ended');

  const db = getDb();
  const events: EventRow[] = [];
  const alreadyIn = await db.transaction(async (tx) => {
    const existing = await tx.query.participations.findFirst({
      where: and(eq(s.participations.sessionId, opts.sessionId), eq(s.participations.studentId, opts.studentId)),
    });
    const now = new Date();
    const tappedAt = opts.tappedAt && opts.tappedAt < now ? opts.tappedAt : now;

    if (!existing) {
      await tx.insert(s.participations).values({
        sessionId: opts.sessionId,
        studentId: opts.studentId,
        state: 'focused',
        tappedInAt: tappedAt,
        lastSeenAt: now,
        tapClientEventId: opts.clientEventId,
      });
      events.push(
        await appendEvent(tx, {
          schoolId: cls.schoolId,
          classId: cls.id,
          sessionId: opts.sessionId,
          studentId: opts.studentId,
          type: 'tapped_in',
          payload: { studentName: opts.studentName, className: cls.name },
          at: tappedAt,
        }),
      );
      return false;
    }

    // Idempotent replay of the same physical tap.
    if (existing.tapClientEventId === opts.clientEventId && existing.state === 'focused') return true;

    if (existing.state === 'focused' || existing.state === 'pass') return true;

    // Re-tap after an unlock (or after restoring permission) returns to focus.
    const wasUnlocked = existing.state === 'emergency_unlocked';
    await tx
      .update(s.participations)
      .set({
        state: 'focused',
        tappedInAt: existing.tappedInAt ?? tappedAt,
        lastSeenAt: now,
        tapClientEventId: opts.clientEventId,
      })
      .where(eq(s.participations.id, existing.id));
    events.push(
      await appendEvent(tx, {
        schoolId: cls.schoolId,
        classId: cls.id,
        sessionId: opts.sessionId,
        studentId: opts.studentId,
        type: wasUnlocked ? 'refocused' : 'tapped_in',
        payload: { studentName: opts.studentName, className: cls.name },
      }),
    );
    return false;
  });

  publishEvents(opts.sessionId, events);
  await publishParticipant(opts.sessionId, opts.studentId);
  return { state: 'focused', alreadyIn };
}

export async function heartbeat(opts: {
  studentId: string;
  studentName: string;
  sessionId: string;
  permissionOk: boolean;
  shieldsApplied: boolean;
}) {
  const db = getDb();
  const { session, cls } = await loadSessionWithClass(opts.sessionId);

  const participation = await db.query.participations.findFirst({
    where: and(eq(s.participations.sessionId, opts.sessionId), eq(s.participations.studentId, opts.studentId)),
  });
  if (!participation) throw new HttpError(404, 'not_participating', 'Tap in first');

  const sessionLive = !session.endedAt && session.endsAt > new Date();
  const events: EventRow[] = [];
  let stateChanged = false;

  await db.transaction(async (tx) => {
    let state = participation.state;
    if (sessionLive && !opts.permissionOk && (state === 'focused' || state === 'pass')) {
      state = 'revoked';
      events.push(
        await appendEvent(tx, {
          schoolId: cls.schoolId,
          classId: cls.id,
          sessionId: opts.sessionId,
          studentId: opts.studentId,
          type: 'permission_revoked',
          payload: { studentName: opts.studentName, className: cls.name },
        }),
      );
    } else if (sessionLive && opts.permissionOk && state === 'revoked') {
      state = 'focused';
      events.push(
        await appendEvent(tx, {
          schoolId: cls.schoolId,
          classId: cls.id,
          sessionId: opts.sessionId,
          studentId: opts.studentId,
          type: 'permission_restored',
          payload: { studentName: opts.studentName, className: cls.name },
        }),
      );
    }
    stateChanged = state !== participation.state;
    await tx
      .update(s.participations)
      .set({ state, lastSeenAt: new Date() })
      .where(eq(s.participations.id, participation.id));
  });

  publishEvents(opts.sessionId, events);
  // Heartbeats always refresh staleness on the grid; cheap and keeps badges honest.
  await publishParticipant(opts.sessionId, opts.studentId);
  void stateChanged;

  const activePass = await db.query.passes.findFirst({
    where: and(
      eq(s.passes.sessionId, opts.sessionId),
      eq(s.passes.studentId, opts.studentId),
      isNull(s.passes.endedAt),
    ),
  });
  const fresh = await db.query.participations.findFirst({
    where: eq(s.participations.id, participation.id),
  });

  // Return the DERIVED state — the same truth every chip renders (e.g. an active
  // pass reads `pass` even though the stored state is `focused`).
  const now = new Date();
  const derived = deriveParticipantState({
    storedState: fresh?.state ?? participation.state,
    noDevice: fresh?.noDevice ?? false,
    passEndsAt: activePass && !activePass.endedAt ? activePass.endsAt : null,
    lastSeenAt: now,
    session: { endsAt: session.endsAt, endedAt: session.endedAt },
    now,
  });

  return {
    session: {
      endsAt: session.endsAt.toISOString(),
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    },
    state: derived.state,
    passEndsAt: derived.state === 'pass' && activePass ? activePass.endsAt.toISOString() : null,
    allowedAppLabels: session.policySnapshot.allowedAppLabels,
    messagesAllowed: session.policySnapshot.messagesAllowed,
  };
}

export async function emergencyUnlock(opts: {
  studentId: string;
  studentName: string;
  sessionId: string;
  clientEventId: string;
  at?: Date;
}): Promise<{ unlockId: string | null; recorded: boolean }> {
  const db = getDb();
  const { session, cls } = await requireActiveMembership(opts.sessionId, opts.studentId);

  // Offline replays may land after the bell: shields are already off, nothing to record
  // as a live state change — acknowledge so the client clears its queue.
  const replayAfterEnd = !!session.endedAt || session.endsAt <= new Date();

  const existing = await db.query.unlocks.findFirst({
    where: eq(s.unlocks.clientEventId, opts.clientEventId),
  });
  if (existing) return { unlockId: existing.id, recorded: false };

  if (replayAfterEnd) return { unlockId: null, recorded: false };

  const events: EventRow[] = [];
  const unlockId = await db.transaction(async (tx) => {
    const at = opts.at && opts.at < new Date() ? opts.at : new Date();
    const [unlock] = await tx
      .insert(s.unlocks)
      .values({
        sessionId: opts.sessionId,
        studentId: opts.studentId,
        at,
        clientEventId: opts.clientEventId,
      })
      .onConflictDoNothing({ target: s.unlocks.clientEventId })
      .returning();
    if (!unlock) {
      const raced = await tx.query.unlocks.findFirst({ where: eq(s.unlocks.clientEventId, opts.clientEventId) });
      return raced?.id ?? null;
    }

    const participation = await tx.query.participations.findFirst({
      where: and(eq(s.participations.sessionId, opts.sessionId), eq(s.participations.studentId, opts.studentId)),
    });
    if (participation) {
      await tx
        .update(s.participations)
        .set({ state: 'emergency_unlocked', lastSeenAt: new Date() })
        .where(eq(s.participations.id, participation.id));
    } else {
      await tx.insert(s.participations).values({
        sessionId: opts.sessionId,
        studentId: opts.studentId,
        state: 'emergency_unlocked',
        lastSeenAt: new Date(),
      });
    }
    // An active pass doesn't survive an emergency unlock.
    await tx
      .update(s.passes)
      .set({ endedAt: at })
      .where(
        and(eq(s.passes.sessionId, opts.sessionId), eq(s.passes.studentId, opts.studentId), isNull(s.passes.endedAt)),
      );

    events.push(
      await appendEvent(tx, {
        schoolId: cls.schoolId,
        classId: cls.id,
        sessionId: opts.sessionId,
        studentId: opts.studentId,
        type: 'emergency_unlock',
        payload: { studentName: opts.studentName, className: cls.name },
        at,
      }),
    );
    return unlock.id;
  });

  publishEvents(opts.sessionId, events);
  await publishParticipant(opts.sessionId, opts.studentId);
  return { unlockId, recorded: unlockId !== null };
}

export async function shareUnlockReason(opts: {
  studentId: string;
  studentName: string;
  unlockId: string;
  reason: UnlockReason;
}): Promise<void> {
  const db = getDb();
  const unlock = await db.query.unlocks.findFirst({ where: eq(s.unlocks.id, opts.unlockId) });
  if (!unlock || unlock.studentId !== opts.studentId) throw new HttpError(404, 'not_found', 'Unlock not found');
  if (unlock.reason) return; // sharing is one-shot; replays are no-ops

  const { cls } = await loadSessionWithClass(unlock.sessionId);
  const events: EventRow[] = [];
  await db.transaction(async (tx) => {
    await tx
      .update(s.unlocks)
      .set({ reason: opts.reason, reasonSharedAt: new Date() })
      .where(eq(s.unlocks.id, opts.unlockId));
    events.push(
      await appendEvent(tx, {
        schoolId: cls.schoolId,
        classId: cls.id,
        sessionId: unlock.sessionId,
        studentId: opts.studentId,
        type: 'reason_shared',
        payload: { studentName: opts.studentName, className: cls.name, sharedReason: opts.reason },
      }),
    );
  });
  publishEvents(unlock.sessionId, events);
  await publishParticipant(unlock.sessionId, opts.studentId);
}

export async function refocus(opts: { studentId: string; studentName: string; sessionId: string }): Promise<void> {
  const db = getDb();
  const { session, cls } = await requireActiveMembership(opts.sessionId, opts.studentId);
  if (session.endedAt || session.endsAt <= new Date())
    throw new HttpError(409, 'session_over', 'This session has ended');

  const events: EventRow[] = [];
  await db.transaction(async (tx) => {
    const participation = await tx.query.participations.findFirst({
      where: and(eq(s.participations.sessionId, opts.sessionId), eq(s.participations.studentId, opts.studentId)),
    });
    if (!participation || participation.state !== 'emergency_unlocked')
      throw new HttpError(409, 'not_unlocked', 'Nothing to re-focus');
    await tx
      .update(s.participations)
      .set({ state: 'focused', lastSeenAt: new Date() })
      .where(eq(s.participations.id, participation.id));
    events.push(
      await appendEvent(tx, {
        schoolId: cls.schoolId,
        classId: cls.id,
        sessionId: opts.sessionId,
        studentId: opts.studentId,
        type: 'refocused',
        payload: { studentName: opts.studentName, className: cls.name },
      }),
    );
  });
  publishEvents(opts.sessionId, events);
  await publishParticipant(opts.sessionId, opts.studentId);
}

// ---------- sweeper ----------

/** Ends overdue sessions (the bell) and expires passes. Runs every SWEEP_INTERVAL_MS. */
export async function sweep(now = new Date()): Promise<void> {
  const db = getDb();

  const overdueSessions = await db.query.sessions.findMany({
    where: and(isNull(s.sessions.endedAt), lte(s.sessions.endsAt, now)),
  });
  for (const session of overdueSessions) await endSession(session.id, 'bell');

  const overduePasses = await db.query.passes.findMany({
    where: and(isNull(s.passes.endedAt), lte(s.passes.endsAt, now)),
  });
  if (overduePasses.length === 0) return;

  for (const pass of overduePasses) {
    const events: EventRow[] = [];
    await db.transaction(async (tx) => {
      await tx.update(s.passes).set({ endedAt: pass.endsAt }).where(eq(s.passes.id, pass.id));
      const participation = await tx.query.participations.findFirst({
        where: and(eq(s.participations.sessionId, pass.sessionId), eq(s.participations.studentId, pass.studentId)),
      });
      // Shields return automatically — but only if the student is still on the pass.
      if (participation?.state === 'pass') {
        await tx.update(s.participations).set({ state: 'focused' }).where(eq(s.participations.id, participation.id));
      }
      const session = await tx.query.sessions.findFirst({ where: eq(s.sessions.id, pass.sessionId) });
      if (session && !session.endedAt) {
        const student = await tx.query.students.findFirst({ where: eq(s.students.id, pass.studentId) });
        const cls = await tx.query.classes.findFirst({ where: eq(s.classes.id, session.classId) });
        events.push(
          await appendEvent(tx, {
            schoolId: cls?.schoolId ?? '',
            classId: session.classId,
            sessionId: pass.sessionId,
            studentId: pass.studentId,
            type: 'pass_ended',
            payload: {
              studentName: student ? `${student.firstName} ${student.lastName}` : undefined,
              className: cls?.name,
            },
            at: pass.endsAt,
          }),
        );
      }
    });
    publishEvents(pass.sessionId, events);
    await publishParticipant(pass.sessionId, pass.studentId);
  }
}

// ---------- membership (join / approve / decline / remove / leave) ----------

export async function joinByCode(opts: {
  studentId: string;
  studentName: string;
  code: string;
}): Promise<{
  membershipStatus: 'pending' | 'active';
  classId: string;
  className: string;
  teacherDisplayName: string;
  scheduleLabel: string;
  allowedAppLabels: string[];
  messagesAllowed: boolean;
}> {
  const db = getDb();
  const cls = await db.query.classes.findFirst({
    where: and(eq(s.classes.joinCode, opts.code), isNull(s.classes.archivedAt)),
  });
  if (!cls) throw new HttpError(404, 'bad_code', "That code doesn't match a class — check the board.");

  const teacher = await db.query.teachers.findFirst({ where: eq(s.teachers.id, cls.teacherId) });
  const policy = cls.policyId
    ? await db.query.policies.findFirst({ where: eq(s.policies.id, cls.policyId) })
    : null;

  const existing = await db.query.memberships.findFirst({
    where: and(eq(s.memberships.classId, cls.id), eq(s.memberships.studentId, opts.studentId)),
  });

  let status: 'pending' | 'active';
  if (existing) {
    status = existing.status;
  } else {
    status = cls.requireApproval ? 'pending' : 'active';
    const events: EventRow[] = [];
    await db.transaction(async (tx) => {
      await tx.insert(s.memberships).values({
        classId: cls.id,
        studentId: opts.studentId,
        status,
        approvedAt: status === 'active' ? new Date() : null,
      });
      events.push(
        await appendEvent(tx, {
          schoolId: cls.schoolId,
          classId: cls.id,
          studentId: opts.studentId,
          type: status === 'active' ? 'member_joined' : 'member_requested',
          payload: { studentName: opts.studentName, className: cls.name },
        }),
      );
    });
    const open = await findOpenSessionForClass(cls.id);
    publishEvents(open?.id ?? null, events);
  }

  return {
    membershipStatus: status,
    classId: cls.id,
    className: cls.name,
    teacherDisplayName: teacher?.displayName ?? 'Your teacher',
    scheduleLabel: `${cls.daysLabel}, ${cls.startTime.slice(0, 5)}–${cls.endTime.slice(0, 5)}`,
    allowedAppLabels: policy?.allowedAppLabels ?? [],
    messagesAllowed: policy?.messagesAllowed ?? true,
  };
}

export async function removeMembership(opts: {
  teacherId: string;
  schoolId: string;
  membershipId: string;
}): Promise<void> {
  const db = getDb();
  const membership = await db.query.memberships.findFirst({ where: eq(s.memberships.id, opts.membershipId) });
  if (!membership) throw new HttpError(404, 'not_found', 'Membership not found');
  const cls = await db.query.classes.findFirst({ where: eq(s.classes.id, membership.classId) });
  if (!cls || cls.teacherId !== opts.teacherId) throw new HttpError(404, 'not_found', 'Membership not found');

  const student = await db.query.students.findFirst({ where: eq(s.students.id, membership.studentId) });
  const events: EventRow[] = [];
  await db.transaction(async (tx) => {
    await tx.delete(s.memberships).where(eq(s.memberships.id, opts.membershipId));
    events.push(
      await appendEvent(tx, {
        schoolId: opts.schoolId,
        classId: cls.id,
        studentId: membership.studentId,
        teacherId: opts.teacherId,
        type: 'member_removed',
        payload: {
          studentName: student ? `${student.firstName} ${student.lastName}` : undefined,
          className: cls.name,
        },
      }),
    );
  });
  const open = await findOpenSessionForClass(cls.id);
  publishEvents(open?.id ?? null, events);
  // Roster shrank — push a fresh snapshot so a live grid drops the chip immediately.
  if (open) {
    const detail = await getSessionDetail(open.id);
    bus.publish(open.id, { kind: 'snapshot', detail });
  }
}

export async function decideMembership(opts: {
  teacherId: string;
  schoolId: string;
  membershipId: string;
  approve: boolean;
}): Promise<void> {
  const db = getDb();
  const membership = await db.query.memberships.findFirst({ where: eq(s.memberships.id, opts.membershipId) });
  if (!membership) throw new HttpError(404, 'not_found', 'Request not found');
  const cls = await db.query.classes.findFirst({ where: eq(s.classes.id, membership.classId) });
  if (!cls || cls.teacherId !== opts.teacherId) throw new HttpError(404, 'not_found', 'Request not found');
  if (membership.status !== 'pending') throw new HttpError(409, 'not_pending', 'Already decided');

  const student = await db.query.students.findFirst({ where: eq(s.students.id, membership.studentId) });
  const events: EventRow[] = [];
  await db.transaction(async (tx) => {
    if (opts.approve) {
      await tx
        .update(s.memberships)
        .set({ status: 'active', approvedAt: new Date() })
        .where(eq(s.memberships.id, opts.membershipId));
    } else {
      await tx.delete(s.memberships).where(eq(s.memberships.id, opts.membershipId));
    }
    events.push(
      await appendEvent(tx, {
        schoolId: opts.schoolId,
        classId: cls.id,
        studentId: membership.studentId,
        teacherId: opts.teacherId,
        type: opts.approve ? 'member_approved' : 'member_declined',
        payload: {
          studentName: student ? `${student.firstName} ${student.lastName}` : undefined,
          className: cls.name,
        },
      }),
    );
  });
  const open = await findOpenSessionForClass(cls.id);
  publishEvents(open?.id ?? null, events);
}

export { appendEvent, shortName };
export type { EventRow, Tx };
