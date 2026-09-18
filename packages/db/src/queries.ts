import { and, desc, eq, isNull } from 'drizzle-orm';

import { blocks, classes, enrollments, participations, sessions, users } from './schema.js';
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
 * The boot call's find-or-create (auth decision 3 / student app): the first-ever
 * /v1/me quietly creates the caller's row as a student. Race-safe via
 * ON CONFLICT on cognito_id + re-select, so two simultaneous first calls resolve
 * to one row. Teacher rows are provisioned elsewhere (out of scope here).
 */
export async function findOrCreateStudent(
  db: Database,
  cognitoId: string,
  displayName?: string,
): Promise<UserRow> {
  const existing = await findUserByCognitoId(db, cognitoId);
  if (existing) return existing;

  await db
    .insert(users)
    .values({ cognitoId, role: 'student', displayName: displayName ?? null })
    .onConflictDoNothing({ target: users.cognitoId });

  const row = await findUserByCognitoId(db, cognitoId);
  if (!row) throw new Error('findOrCreateStudent: row missing after insert');
  return row;
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
