import {
  type EventType,
  HISTORY_EVENT_TYPES,
  type HistoryEventType,
  isUnlockReason,
  type ParticipationState,
  UNLOCK_RECORDED_AS,
  type UnlockReason,
  type UnlockRecordedAs,
} from '@bali/shared';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { SQLWrapper } from 'drizzle-orm';

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
  // A named row is left as it is. The UPDATE below re-checks the NULL itself,
  // so skipping it here only saves two round trips on every later sign-in.
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
 * fix for "no name on the token" reaches an account already provisioned, once its
 * token carries a usable name, without anybody re-creating accounts.
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

/**
 * The class a join code opens: the live one holding it. The join
 * (`joinClassByCode`) and its preview (`previewJoinCode`) both find it by
 * this, so the two can never name different classes (A6).
 */
export function liveClassWithCode(joinCode: string) {
  return and(eq(classes.joinCode, joinCode), isNull(classes.removedAt));
}

export interface JoinCodePreview {
  class: ClassRow;
  teacherDisplayName: string | null;
  /** The student holds an active enrollment in it: a join would be `already_enrolled`. */
  alreadyEnrolled: boolean;
}

/**
 * What a join code opens, for the preview before joining (Phase 3 · A6): the
 * live class holding the code (`liveClassWithCode`, as the join finds it), its
 * teacher's display name, and whether `studentId` is in it already.
 * Undefined when no live class holds the code: unknown, archived, or
 * regenerated away. A read: no lock, no write; a caller with no row yet passes
 * no `studentId` and is in no class.
 */
export async function previewJoinCode(
  db: Database,
  joinCode: string,
  studentId: string | undefined,
): Promise<JoinCodePreview | undefined> {
  const found = first(
    await db
      .select({ class: classes, teacherDisplayName: users.displayName })
      .from(classes)
      .innerJoin(users, eq(users.id, classes.teacherId))
      .where(liveClassWithCode(joinCode))
      .limit(1),
  );
  if (!found) return undefined;
  const enrolled =
    studentId !== undefined &&
    (
      await db
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.classId, found.class.id),
            eq(enrollments.studentId, studentId),
            isNull(enrollments.removedAt),
          ),
        )
        .limit(1)
    ).length > 0;
  return { ...found, alreadyEnrolled: enrolled };
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
  /** Their latest unlock here since they last tapped in or refocused, or null. */
  unlock: {
    reason: UnlockReason | null;
    recordedAs: UnlockRecordedAs | null;
    occurredAt: Date;
  } | null;
  /** A protection-off report reached this session after it ended (A2c). */
  protectionOffAfterEnd: boolean;
}

/** An unlock's or a protection-off's note, as stored in `payload.recorded_as`; null when none. */
function recordedAsOf(payload: Record<string, unknown>): UnlockRecordedAs | null {
  return (UNLOCK_RECORDED_AS as readonly unknown[]).includes(payload.recorded_as)
    ? (payload.recorded_as as UnlockRecordedAs)
    : null;
}

/** What turns a chip: back to focus (a tap or a refocus), or away from it (an unlock). */
const CHIP_TURNS = ['tap_in', 'refocus', 'unlock'] as const satisfies readonly EventType[];

/**
 * The grid-boot roster for a session (decision 5): every student the session's
 * feed can name, with their participation IN THIS SESSION — the class's active
 * enrollments, so a student who hasn't tapped in yet still appears (with null
 * participation fields), and anyone the session holds a participation or an
 * unlock for who has since left the class, so a chip the stream painted never
 * outlives the snapshot that would refresh its name. One row a student, on
 * their live enrollment or else their last, in enrollment order.
 *
 * Beside the stored slice, what it does not show (A9): the student's latest
 * unlock since they last tapped in or refocused — the engine records one
 * without flipping the row when protection is off, when nothing is live, and
 * after the end — and whether a protection-off report came after the end,
 * which leaves the ended row alone (A2c). The caller derives each display
 * state; one statement, so the row and its records are read at one instant.
 */
export async function getSessionRoster(
  db: Database,
  sessionId: string,
  classId: string,
): Promise<SnapshotRosterRow[]> {
  const turn = db
    .select({ type: events.type, payload: events.payload, occurredAt: events.occurredAt })
    .from(events)
    .where(
      and(
        eq(events.sessionId, sessionId),
        eq(events.userId, users.id),
        inArray(events.type, CHIP_TURNS),
      ),
    )
    .orderBy(desc(events.seq))
    .limit(1)
    .as('turn');
  const lateOff = sql<boolean>`exists (select 1 from ${events} where ${events.sessionId} = ${sessionId} and ${events.userId} = ${users.id} and ${events.type} = 'protection_off' and ${events.payload}->>'recorded_as' = 'after_session_end')`;

  const rows = await db
    .selectDistinctOn([users.id], {
      enrollmentId: enrollments.id,
      enrolledAt: enrollments.createdAt,
      studentId: users.id,
      displayName: users.displayName,
      state: participations.state,
      joinedAt: participations.joinedAt,
      lastSeenAt: participations.lastSeenAt,
      endedAt: participations.endedAt,
      turnType: turn.type,
      turnPayload: turn.payload,
      turnAt: turn.occurredAt,
      protectionOffAfterEnd: lateOff,
    })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .leftJoin(
      participations,
      and(eq(participations.studentId, users.id), eq(participations.sessionId, sessionId)),
    )
    .leftJoinLateral(turn, sql`true`)
    .where(
      and(
        eq(enrollments.classId, classId),
        // An unlock is the only turn with no participation behind it.
        or(isNull(enrollments.removedAt), isNotNull(participations.id), isNotNull(turn.type)),
      ),
    )
    .orderBy(users.id, sql`${enrollments.removedAt} is null desc`, desc(enrollments.createdAt));

  return rows
    .sort((a, b) => a.enrolledAt.getTime() - b.enrolledAt.getTime())
    .map((r) => {
      const payload = (r.turnPayload ?? {}) as Record<string, unknown>;
      return {
        enrollmentId: r.enrollmentId,
        studentId: r.studentId,
        displayName: r.displayName,
        state: r.state,
        joinedAt: r.joinedAt,
        lastSeenAt: r.lastSeenAt,
        endedAt: r.endedAt,
        unlock:
          r.turnType === 'unlock' && r.turnAt !== null
            ? {
                reason: isUnlockReason(payload.reason) ? payload.reason : null,
                recordedAs: recordedAsOf(payload),
                occurredAt: r.turnAt,
              }
            : null,
        protectionOffAfterEnd: r.protectionOffAfterEnd,
      };
    });
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

/*
 * GET /v1/me/history (A7) — a student's own timeline, newest first, a page at
 * a time. Two sources, merged: their own events (`user_id`), and the end of
 * every session that ended with them in it — the session's event, which names
 * no student, found through the participation the end itself closed. Ordered
 * by `occurred_at`, then a leave before anything else at one instant (a
 * switch mints the `tap_in` first and stamps one instant on the pair, so
 * neither column alone puts the leave first), then `seq`.
 */
const SESSION_END_TYPES = ['session_ended', 'session_expired'] as const;
const OWN_HISTORY_TYPES = HISTORY_EVENT_TYPES.filter(
  (type) => !(SESSION_END_TYPES as readonly string[]).includes(type),
);

/** A moment's place in the order. `at` is microsecond UTC text: a `Date` would tie rows Postgres does not. */
export interface HistoryKey {
  at: string;
  tie: number;
  seq: number;
}
const exactly = (instant: SQLWrapper) =>
  sql<string>`to_char(${instant} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const tieOf = sql<number>`(case when ${events.type} = 'left_for_other_session' then 0 else 1 end)`;

/** The student's own moments: a shown type, in a class — an orphan unlock is in none. */
const ownMoments = (studentId: string) =>
  and(
    eq(events.userId, studentId),
    inArray(events.type, OWN_HISTORY_TYPES),
    isNotNull(events.classId),
  );
/** A session's end event, and the student's participation it closed. */
const endedWithStudent = (studentId: string) =>
  and(
    eq(events.sessionId, participations.sessionId),
    inArray(events.type, SESSION_END_TYPES),
    eq(participations.studentId, studentId),
    inArray(participations.endedReason, SESSION_END_TYPES),
  );
/** Older than `key`; the first bound is the rest, loosened, for the index to range on. */
function olderThan(key: HistoryKey, at: SQLWrapper, seq: SQLWrapper) {
  const instant = sql`${key.at}::timestamptz`;
  return sql`(${at} <= ${instant} and (${at} < ${instant} or ${tieOf} < ${key.tie} or (${tieOf} = ${key.tie} and ${seq} < ${key.seq})))`;
}

/**
 * The two reads a page merges, unexecuted — exported so a test can EXPLAIN
 * them: each is newest first, `take` rows at most, older than `key`, through
 * its own index. The class ending is stamped with the participation's end,
 * which the end wrote with the session's, so the instant its index ranges on
 * is the one its key compares.
 */
export function historyReads(
  db: Database,
  studentId: string,
  key: HistoryKey | undefined,
  take: number,
) {
  const moment = {
    eventId: events.eventId,
    type: events.type,
    seq: events.seq,
    tie: tieOf,
    payload: events.payload,
    classId: classes.id,
    className: classes.name,
    teacherDisplayName: users.displayName,
    sessionId: sessions.id,
    startedAt: sessions.startedAt,
    endsAt: sessions.endsAt,
    endedAt: sessions.endedAt,
  };
  return {
    own: db
      .select({ ...moment, occurredAt: events.occurredAt, at: exactly(events.occurredAt) })
      .from(events)
      .innerJoin(classes, eq(classes.id, events.classId))
      .innerJoin(users, eq(users.id, classes.teacherId))
      .leftJoin(sessions, eq(sessions.id, events.sessionId))
      .where(and(ownMoments(studentId), key && olderThan(key, events.occurredAt, events.seq)))
      .orderBy(desc(events.occurredAt), desc(tieOf), desc(events.seq))
      .limit(take),
    ended: db
      .select({
        ...moment,
        occurredAt: participations.endedAt,
        at: exactly(participations.endedAt),
      })
      .from(participations)
      .innerJoin(events, endedWithStudent(studentId))
      .innerJoin(sessions, eq(sessions.id, participations.sessionId))
      .innerJoin(classes, eq(classes.id, sessions.classId))
      .innerJoin(users, eq(users.id, classes.teacherId))
      .where(key && olderThan(key, participations.endedAt, events.seq))
      .orderBy(desc(participations.endedAt), desc(events.seq))
      .limit(take),
  };
}

export interface HistoryRow {
  eventId: string;
  type: HistoryEventType;
  occurredAt: Date;
  classId: string;
  className: string;
  teacherDisplayName: string | null;
  sessionId: string | null;
  startedAt: Date | null;
  endsAt: Date | null;
  endedAt: Date | null;
  reason: UnlockReason | null;
  /** An unlock's or a protection-off's note; the latter's are a subset of the former's. */
  recordedAs: UnlockRecordedAs | null;
  /** For `armed_tap_skipped`: the class of the student's own `tap_in` it was declined for. */
  countedIn: { id: string; name: string } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One page of a student's history, newest first: at most `limit` moments
 * older than the moment `before` (an event id from an earlier page), and the
 * id to pass for the page after — null when there is none. Undefined when
 * `before` is not a moment of this history. A cursor names a row, never an
 * offset, so a moment recorded between two pages shifts nothing: a newer one
 * waits for a reload from the top, an older one (a late unlock is clamped
 * into its class's window) is read in its place.
 */
export async function getHistoryPage(
  db: Database,
  studentId: string,
  page: { before?: string; limit: number },
): Promise<{ events: HistoryRow[]; nextBefore: string | null } | undefined> {
  let key: HistoryKey | undefined;
  if (page.before !== undefined) {
    [key] = await db
      .select({
        at: exactly(sql`coalesce(${participations.endedAt}, ${events.occurredAt})`),
        tie: tieOf,
        seq: events.seq,
      })
      .from(events)
      .leftJoin(participations, endedWithStudent(studentId))
      .where(
        and(
          eq(events.eventId, page.before),
          or(ownMoments(studentId), isNotNull(participations.id)),
        ),
      )
      .limit(1);
    if (!key) return undefined;
  }
  const reads = historyReads(db, studentId, key, page.limit + 1);
  const merged = [...(await reads.own), ...(await reads.ended)]
    .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : b.tie - a.tie || b.seq - a.seq))
    .slice(0, page.limit + 1);
  const rows = merged.slice(0, page.limit).map((row) => ({
    ...row,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));

  // A declined tap names the tap that already counted — the student's own `tap_in`.
  const declined = rows
    .filter((row) => row.type === 'armed_tap_skipped')
    .map((row) => row.payload.armed_tap_event_id)
    .filter((id): id is string => typeof id === 'string' && UUID.test(id));
  const counted = new Map(
    (declined.length === 0
      ? []
      : await db
          .select({ eventId: events.eventId, id: classes.id, name: classes.name })
          .from(events)
          .innerJoin(classes, eq(classes.id, events.classId))
          .where(
            and(
              inArray(events.eventId, declined),
              eq(events.userId, studentId),
              eq(events.type, 'tap_in'),
            ),
          )
    ).map(({ eventId, ...cls }) => [eventId, cls]),
  );

  return {
    events: rows.map(({ payload, ...row }) => ({
      ...row,
      // Every row is of a shown type, and a class ending always has its end.
      type: row.type as HistoryEventType,
      occurredAt: row.occurredAt!,
      reason: row.type === 'unlock' && isUnlockReason(payload.reason) ? payload.reason : null,
      recordedAs:
        row.type === 'unlock' || row.type === 'protection_off' ? recordedAsOf(payload) : null,
      countedIn:
        row.type === 'armed_tap_skipped'
          ? (counted.get(payload.armed_tap_event_id as string) ?? null)
          : null,
    })),
    nextBefore: merged.length > page.limit ? rows[rows.length - 1]!.eventId : null,
  };
}
