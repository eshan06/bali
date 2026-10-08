import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { validate as isUuid } from 'uuid';

import {
  ageChecks,
  armedTaps,
  classes,
  deviceTokens,
  enrollments,
  events,
  participations,
  schools,
  sessions,
  teacherInvites,
  users,
} from './schema.js';
import type { Database } from './types.js';

/*
 * One student's whole record, for a parent's inspection request (FERPA; Phase 6
 * C5): every row Bali holds that is keyed to the person, whole, every column,
 * and the names of the classes, sessions and school those rows point at, so a
 * reader can follow them. Nothing keyed to anyone else. A read: one
 * read-only, repeatable-read transaction, so the document is one moment's
 * truth and nothing is written, the engine's tables least of all.
 */

/**
 * Where each foreign key to `users` stands in the export: the section that
 * carries its rows, or why its rows are not this person's record. A test holds
 * this to the schema, so a new table or column keyed to a user fails CI until
 * it is exported here or its exclusion is argued.
 */
export const STUDENT_RECORD_COVERAGE = {
  exported: {
    'enrollments.student_id': 'enrollments',
    'participations.student_id': 'participations',
    'events.user_id': 'events',
    'armed_taps.student_id': 'armedTaps',
    'teacher_invites.redeemed_by': 'invitesRedeemed',
    'device_tokens.user_id': 'deviceTokens',
    'age_checks.user_id': 'ageCheck',
  },
  notTheirs: {
    'classes.teacher_id': "a teacher's classes: the school's records, with other students in them",
    'blocks.teacher_id': "a teacher's blocks: the school's equipment",
    'armed_taps.teacher_id': "the taps other students made on a teacher's block",
  },
} as const;

export const STUDENT_RECORD_FORMAT = 'bali.student-record/1';

/**
 * The record of the account whose id or Cognito subject is `who`; null when no
 * account has either. A deleted account (C3) is found by its id only: its
 * subject is gone, and its record is what the deletion left.
 */
export async function exportStudentRecord(db: Database, who: string, now: Date = new Date()) {
  return db.transaction(
    async (tx) => {
      const found = await tx
        .select()
        .from(users)
        .where(
          isUuid(who) ? or(eq(users.id, who), eq(users.cognitoId, who)) : eq(users.cognitoId, who),
        );
      const account = found[0];
      if (!account) return null;
      if (found.length > 1) throw new Error(`"${who}" names more than one account`);

      const id = account.id;
      const enrolled = await tx
        .select()
        .from(enrollments)
        .where(eq(enrollments.studentId, id))
        .orderBy(asc(enrollments.createdAt), asc(enrollments.id));
      const participated = await tx
        .select()
        .from(participations)
        .where(eq(participations.studentId, id))
        .orderBy(asc(participations.joinedAt), asc(participations.id));
      const happened = await tx
        .select()
        .from(events)
        .where(eq(events.userId, id))
        .orderBy(asc(events.seq));
      const armed = await tx
        .select()
        .from(armedTaps)
        .where(eq(armedTaps.studentId, id))
        .orderBy(asc(armedTaps.createdAt), asc(armedTaps.id));
      // A code's hash opens nothing and is no fact about the person: left out.
      const invitesRedeemed = await tx
        .select({
          id: teacherInvites.id,
          schoolId: teacherInvites.schoolId,
          createdAt: teacherInvites.createdAt,
          expiresAt: teacherInvites.expiresAt,
          redeemedAt: teacherInvites.redeemedAt,
          redeemEventId: teacherInvites.redeemEventId,
        })
        .from(teacherInvites)
        .where(eq(teacherInvites.redeemedBy, id));
      // Their phones' APNs tokens (N4), whole: a row keyed to them, the device
      // address included — it opens nothing without Bali's own APNs key.
      const tokens = await tx
        .select()
        .from(deviceTokens)
        .where(eq(deviceTokens.userId, id))
        .orderBy(asc(deviceTokens.createdAt), asc(deviceTokens.token));
      // Their 13+ yes (C7-server), if recorded: that they confirmed 13 or older, and when.
      const [ageCheck] = await tx.select().from(ageChecks).where(eq(ageChecks.userId, id));

      // What those rows point at, named: never another student, only the
      // class, its teacher's display name, its school, a session's window.
      const sessionIds = unique([
        ...participated.map((p) => p.sessionId),
        ...happened.map((e) => e.sessionId),
      ]);
      const sessionRows = sessionIds.length
        ? await tx
            .select({
              id: sessions.id,
              classId: sessions.classId,
              startedAt: sessions.startedAt,
              endsAt: sessions.endsAt,
              endedAt: sessions.endedAt,
            })
            .from(sessions)
            .where(inArray(sessions.id, sessionIds))
            .orderBy(asc(sessions.startedAt), asc(sessions.id))
        : [];
      // Those lessons' own moments, which carry no one's id: their start, a bell
      // moved, their end (#219's review) — when the student's lesson ended.
      const sessionEvents = sessionIds.length
        ? await tx
            .select()
            .from(events)
            .where(
              and(
                inArray(events.sessionId, sessionIds),
                isNull(events.userId),
                inArray(events.type, [
                  'session_started',
                  'session_extended',
                  'session_ended',
                  'session_expired',
                ]),
              ),
            )
            .orderBy(asc(events.seq))
        : [];
      const classIds = unique([
        ...enrolled.map((e) => e.classId),
        ...happened.map((e) => e.classId),
        ...sessionRows.map((s) => s.classId),
      ]);
      const classRows = classIds.length
        ? await tx
            .select({
              id: classes.id,
              name: classes.name,
              schoolId: classes.schoolId,
              teacherDisplayName: users.displayName,
              removedAt: classes.removedAt,
            })
            .from(classes)
            .innerJoin(users, eq(users.id, classes.teacherId))
            .where(inArray(classes.id, classIds))
            .orderBy(asc(classes.name), asc(classes.id))
        : [];
      const schoolIds = unique([
        account.schoolId,
        ...classRows.map((c) => c.schoolId),
        ...invitesRedeemed.map((i) => i.schoolId),
      ]);
      const schoolRows = schoolIds.length
        ? await tx
            .select({ id: schools.id, name: schools.name })
            .from(schools)
            .where(inArray(schools.id, schoolIds))
            .orderBy(asc(schools.name), asc(schools.id))
        : [];

      return {
        format: STUDENT_RECORD_FORMAT,
        exportedAt: now.toISOString(),
        deleted: account.removedAt !== null,
        account,
        enrollments: enrolled,
        participations: participated,
        events: happened,
        armedTaps: armed,
        invitesRedeemed,
        deviceTokens: tokens,
        ageCheck: ageCheck ?? null,
        classes: classRows,
        sessions: sessionRows,
        sessionEvents,
        schools: schoolRows,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

export type StudentRecord = NonNullable<Awaited<ReturnType<typeof exportStudentRecord>>>;

function unique(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.filter((v): v is string => v !== null))].sort();
}
