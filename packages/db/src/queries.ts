import type { EventType, ParticipationState } from '@bali/shared';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { blocks, classes, enrollments, events, participations, sessions, users } from './schema.js';
import type { Database } from './types.js';

/*
 * Read-side queries for the endpoints (the transition engine owns writes to
 * participations/events; these never touch those two tables except to read).
 */

export type UserRow = typeof users.$inferSelect;
type ClassRow = typeof classes.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type ParticipationRow = typeof participations.$inferSelect;
type EnrollmentRow = typeof enrollments.$inferSelect;

function first<T>(rows: T[]): T | undefined {
  return rows[0];
}

export async function findUserByCognitoId(
  db: Database,
  cognitoId: string,
): Promise<UserRow | undefined> {
  return first(await db.select().from(users).where(eq(users.cognitoId, cognitoId)).limit(1));
}

/**
 * Fill in a display name the row does not have — never overwrite one it does.
 * It applies to any row the caller supplies a name for, teachers included.
 *
 * A fill, not a sync, for two reasons. Rows provisioned before the caller could
 * read a name off the token kept `display_name` NULL forever, because the name
 * was only ever applied at creation; without this they would render as a UUID
 * prefix for good. And "edit own name" (PLAN.md, phase 3) makes the stored name
 * the student's own once they set it, so a later sign-in must not quietly put
 * their Cognito username back.
 */
async function fillMissingDisplayName(
  db: Database,
  row: UserRow,
  displayName: string | undefined,
): Promise<UserRow> {
  if (displayName === undefined || row.displayName !== null) return row;

  // The NULL is re-checked in the UPDATE itself, so a concurrent sign-in that
  // filled it first wins rather than being overwritten.
  const updated = first(
    await db
      .update(users)
      .set({ displayName })
      .where(and(eq(users.id, row.id), isNull(users.displayName)))
      .returning(),
  );
  if (updated) return updated;
  // That concurrent call won: report what the row actually says now, not the
  // NULL this one started with. A row that has vanished between the two reads
  // is not something to paper over — say so, as the insert path does.
  const current = await findUserByCognitoId(db, row.cognitoId);
  if (!current) throw new Error('fillMissingDisplayName: row missing after update');
  return current;
}

/**
 * The boot call's find-or-create (auth decision 3 / student app): the first-ever
 * /v1/me quietly creates the caller's row as a student. Race-safe via
 * ON CONFLICT on cognito_id + re-select, so two simultaneous first calls resolve
 * to one row. Teacher rows are provisioned elsewhere (out of scope here).
 *
 * A row that already exists still gets a missing display name filled in, so the
 * fix for "no name on the token" reaches everyone already provisioned without
 * anybody re-creating accounts.
 */
export async function findOrCreateStudent(
  db: Database,
  cognitoId: string,
  displayName?: string,
): Promise<UserRow> {
  const existing = await findUserByCognitoId(db, cognitoId);
  if (existing) return fillMissingDisplayName(db, existing, displayName);

  await db
    .insert(users)
    .values({ cognitoId, role: 'student', displayName: displayName ?? null })
    .onConflictDoNothing({ target: users.cognitoId });

  const row = await findUserByCognitoId(db, cognitoId);
  if (!row) throw new Error('findOrCreateStudent: row missing after insert');
  // Our insert may have lost the race to one that carried no name.
  return fillMissingDisplayName(db, row, displayName);
}

/** A student's active classes. */
export async function getEnrolledClasses(db: Database, studentId: string): Promise<ClassRow[]> {
  return db
    .select({ ...classesColumns })
    .from(classes)
    .innerJoin(enrollments, eq(enrollments.classId, classes.id))
    .where(
      and(
        eq(enrollments.studentId, studentId),
        isNull(enrollments.removedAt),
        isNull(classes.removedAt),
      ),
    );
}

// Drizzle needs an explicit column map when selecting one table across a join.
const classesColumns = {
  id: classes.id,
  teacherId: classes.teacherId,
  schoolId: classes.schoolId,
  name: classes.name,
  joinCode: classes.joinCode,
  createdAt: classes.createdAt,
  removedAt: classes.removedAt,
};

export async function findClassById(db: Database, classId: string): Promise<ClassRow | undefined> {
  return first(
    await db
      .select()
      .from(classes)
      .where(and(eq(classes.id, classId), isNull(classes.removedAt)))
      .limit(1),
  );
}

/** A session by id (any state), so the lifecycle routes can authorize the teacher. */
export async function findSessionById(
  db: Database,
  sessionId: string,
): Promise<SessionRow | undefined> {
  return first(await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1));
}

/**
 * A class's running session, if any — the same definition startSession uses to
 * decide "existing" (`ended_at IS NULL`), so the portal can recover the live
 * grid after a reload instead of offering to start a session that is already
 * running.
 */
export async function findLiveSessionForClass(
  db: Database,
  classId: string,
): Promise<SessionRow | undefined> {
  return first(
    await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.classId, classId), isNull(sessions.endedAt)))
      .limit(1),
  );
}

/** A teacher's active classes. */
export async function getTaughtClasses(db: Database, teacherId: string): Promise<ClassRow[]> {
  return db
    .select()
    .from(classes)
    .where(and(eq(classes.teacherId, teacherId), isNull(classes.removedAt)));
}

/** The student's current live participation and its session, if any. */
export async function getLiveParticipation(
  db: Database,
  studentId: string,
): Promise<{ participation: ParticipationRow; session: SessionRow } | undefined> {
  const row = first(
    await db
      .select({ participation: participations, session: sessions })
      .from(participations)
      .innerJoin(sessions, eq(participations.sessionId, sessions.id))
      .where(and(eq(participations.studentId, studentId), isNull(participations.endedAt)))
      .limit(1),
  );
  return row;
}

export interface TapTarget {
  blockId: string;
  teacherId: string;
  /** The running session the tap should join, or null when the tap is armed. */
  session: SessionRow | null;
}

/**
 * Resolve a tapped tag to what should happen: the block identifies the teacher
 * (one block serves all a teacher's classes), then we look for a running session
 * of one of that teacher's classes the student is enrolled in. If exactly that
 * exists the tap joins it; if none, the caller arms the tap. Returns null only
 * when the tag matches no active block. When more than one enrolled class of the
 * teacher is running (rare), the most recently started wins.
 */
export async function resolveTapTarget(
  db: Database,
  tagId: string,
  studentId: string,
): Promise<TapTarget | null> {
  const block = first(
    await db
      .select()
      .from(blocks)
      .where(and(eq(blocks.tagId, tagId), isNull(blocks.removedAt)))
      .limit(1),
  );
  if (!block) return null;

  const session = first(
    await db
      .select({ session: sessions })
      .from(sessions)
      .innerJoin(classes, eq(sessions.classId, classes.id))
      .innerJoin(enrollments, eq(enrollments.classId, classes.id))
      .where(
        and(
          eq(classes.teacherId, block.teacherId),
          isNull(sessions.endedAt),
          eq(enrollments.studentId, studentId),
          isNull(enrollments.removedAt),
        ),
      )
      .orderBy(desc(sessions.startedAt))
      .limit(1),
  );

  return { blockId: block.id, teacherId: block.teacherId, session: session?.session ?? null };
}

export interface RosterEntry {
  enrollmentId: string;
  studentId: string;
  displayName: string | null;
  joinedAt: Date;
}

/** A class's active roster: enrolled students with their names, in join order. */
export async function getRoster(db: Database, classId: string): Promise<RosterEntry[]> {
  return db
    .select({
      enrollmentId: enrollments.id,
      studentId: users.id,
      displayName: users.displayName,
      joinedAt: enrollments.createdAt,
    })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .where(and(eq(enrollments.classId, classId), isNull(enrollments.removedAt)))
    .orderBy(enrollments.createdAt);
}

/** An enrollment by id (any state), so the DELETE route can authorize before ending it. */
export async function findEnrollmentById(
  db: Database,
  enrollmentId: string,
): Promise<EnrollmentRow | undefined> {
  return first(
    await db.select().from(enrollments).where(eq(enrollments.id, enrollmentId)).limit(1),
  );
}

export interface SnapshotRosterRow {
  enrollmentId: string;
  studentId: string;
  displayName: string | null;
  /** Null when the student has no participation in this session (never joined it). */
  state: ParticipationState | null;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
  endedAt: Date | null;
}

/**
 * The grid-boot roster for a session (decision 5): every active enrollment of the
 * class LEFT JOINed to that student's participation IN THIS SESSION, so a student
 * who hasn't tapped in yet still appears (with null participation fields). The
 * caller derives each display state; this returns the stored slice.
 */
export async function getSessionRoster(
  db: Database,
  sessionId: string,
  classId: string,
): Promise<SnapshotRosterRow[]> {
  return db
    .select({
      enrollmentId: enrollments.id,
      studentId: users.id,
      displayName: users.displayName,
      state: participations.state,
      joinedAt: participations.joinedAt,
      lastSeenAt: participations.lastSeenAt,
      endedAt: participations.endedAt,
    })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .leftJoin(
      participations,
      and(eq(participations.studentId, users.id), eq(participations.sessionId, sessionId)),
    )
    .where(and(eq(enrollments.classId, classId), isNull(enrollments.removedAt)))
    .orderBy(enrollments.createdAt);
}

/** The highest event seq for a session (0 when it has none) — the snapshot's stream cursor. */
export async function getLatestSeq(db: Database, sessionId: string): Promise<number> {
  const row = first(
    await db
      .select({ seq: sql<number>`coalesce(max(${events.seq}), 0)` })
      .from(events)
      .where(eq(events.sessionId, sessionId)),
  );
  return Number(row?.seq ?? 0);
}

export interface FeedEventRow {
  seq: number;
  eventId: string;
  type: EventType;
  userId: string | null;
  occurredAt: Date;
  payload: unknown;
}

/**
 * A page of a session's events with `seq` strictly greater than `afterSeq`, in
 * seq order — the catch-up read and the stream's re-read both use this. The
 * server is dumb and literal: it returns exactly what the cursor asks for, and
 * the caller handles the overlap/dedupe (decision 2).
 */
export async function getEventsSince(
  db: Database,
  sessionId: string,
  afterSeq: number,
  limit: number,
): Promise<FeedEventRow[]> {
  return db
    .select({
      seq: events.seq,
      eventId: events.eventId,
      type: events.type,
      userId: events.userId,
      occurredAt: events.occurredAt,
      payload: events.payload,
    })
    .from(events)
    .where(and(eq(events.sessionId, sessionId), gt(events.seq, afterSeq)))
    .orderBy(asc(events.seq))
    .limit(limit);
}
