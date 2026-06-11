/**
 * Canonical demo seed (design doc 01 §demo content). Dev/demo only — never run
 * automatically. Idempotent: keyed on the Period 3 join code; `--reset` wipes the
 * bali_v2 tables first.
 *
 * Ownership trick: the demo teacher (Ms. Rivera) and persona student (Jordan Park)
 * are created with `seed-…` cognito subs and an adoptable email. When a real Cognito
 * user with that email first calls POST /v1/auth/bootstrap, the API adopts the seed
 * row (swaps in the real sub) so the demo world belongs to a real sign-in.
 *   SEED_TEACHER_EMAIL overrides the adoptable teacher email; the persona student
 *   (Jordan Park) is adopted by name match at student bootstrap instead.
 */
import { randomUUID } from 'node:crypto';
import { closeDb, getDb, loadRootEnv } from './client';
import * as s from './schema';

loadRootEnv();

const db = getDb();

const TEACHER_EMAIL = process.env.SEED_TEACHER_EMAIL ?? 'teacher@example.com';
const SCHOOL_ID = process.env.DEFAULT_SCHOOL_ID ?? '11111111-1111-1111-1111-111111111111';

// 28 students of Period 3 — Algebra II (canonical grid roster, in grid order).
const ROSTER: Array<[string, string]> = [
  ['Jordan', 'Park'],
  ['Lena', 'Walsh'],
  ['Aisha', 'Khan'],
  ['Marcus', 'Jones'],
  ['Sam', 'Torres'],
  ['Noor', 'Haddad'],
  ['Maya', 'Reyes'],
  ['Tavi', 'Okafor'],
  ['Diego', 'Morales'],
  ['Ethan', 'Cole'],
  ['Priya', 'Shah'],
  ['Zoe', 'Bennett'],
  ['Amara', 'Diallo'],
  ['Felix', 'Garcia'],
  ['Hana', 'Sato'],
  ['Ivan', 'Kovac'],
  ['Jade', 'Lin'],
  ['Kai', 'Nguyen'],
  ['Luca', 'Ferri'],
  ['Mei', 'Tanaka'],
  ['Nia', 'Williams'],
  ['Omar', 'Ali'],
  ['Rosa', 'Vargas'],
  ['Theo', 'Brooks'],
  ['Uma', 'Patel'],
  ['Vik', 'Rao'],
  ['Wren', 'Hayes'],
  ['Yusuf', 'Eze'],
];

const PENDING: Array<[string, string]> = [
  ['Casey', 'Nguyen'],
  ['Robbie', 'Fox'],
];

async function reset() {
  // Order matters (FKs).
  await db.delete(s.events);
  await db.delete(s.unlocks);
  await db.delete(s.passes);
  await db.delete(s.participations);
  await db.delete(s.sessions);
  await db.delete(s.memberships);
  await db.delete(s.tags);
  await db.delete(s.classes);
  await db.delete(s.policies);
  await db.delete(s.students);
  await db.delete(s.teachers);
  await db.delete(s.schools);
  console.log('reset: cleared all bali_v2 tables');
}

async function main() {
  if (process.argv.includes('--reset')) await reset();

  const existing = await db.query.classes.findFirst({ where: (c, { eq }) => eq(c.joinCode, 'KM3W7Q2A') });
  if (existing) {
    console.log('seed already present (Period 3 found) — nothing to do. Use --reset to reseed.');
    await closeDb();
    return;
  }

  await db.transaction(async (tx) => {
    const [school] = await tx
      .insert(s.schools)
      .values({ id: SCHOOL_ID, name: 'Jefferson High' })
      .onConflictDoNothing()
      .returning();
    const schoolId = school?.id ?? SCHOOL_ID;

    const [rivera] = await tx
      .insert(s.teachers)
      .values({
        schoolId,
        cognitoSub: `seed-${randomUUID()}`,
        email: TEACHER_EMAIL,
        name: 'Maria Rivera',
        displayName: 'Ms. Rivera',
      })
      .returning();
    if (!rivera) throw new Error('teacher insert failed');

    const [lecture] = await tx
      .insert(s.policies)
      .values({
        teacherId: rivera.id,
        name: 'Lecture',
        messagesAllowed: true,
        allowedAppLabels: ['Notes', 'Camera', 'Calculator'],
      })
      .returning();
    const [quiz] = await tx
      .insert(s.policies)
      .values({ teacherId: rivera.id, name: 'Quiz', messagesAllowed: false, allowedAppLabels: ['Calculator'] })
      .returning();
    await tx
      .insert(s.policies)
      .values({ teacherId: rivera.id, name: 'Lab', messagesAllowed: true, allowedAppLabels: ['Camera', 'Notes'] });
    if (!lecture || !quiz) throw new Error('policy insert failed');

    const classRows = await tx
      .insert(s.classes)
      .values([
        {
          schoolId,
          teacherId: rivera.id,
          name: 'Period 1 — Algebra I',
          daysLabel: 'Mon–Fri',
          startTime: '08:05',
          endTime: '08:50',
          policyId: lecture.id,
          joinCode: 'QH8B2N4D',
        },
        {
          schoolId,
          teacherId: rivera.id,
          name: 'Period 3 — Algebra II',
          daysLabel: 'Mon–Fri',
          startTime: '10:00',
          endTime: '10:45',
          policyId: lecture.id,
          joinCode: 'KM3W7Q2A',
          requireApproval: true,
        },
        {
          schoolId,
          teacherId: rivera.id,
          name: 'Period 4 — Precalculus',
          daysLabel: 'Mon–Fri',
          startTime: '12:05',
          endTime: '12:50',
          policyId: lecture.id,
          joinCode: 'QV4N8R1C',
        },
        {
          schoolId,
          teacherId: rivera.id,
          name: 'Period 6 — Geometry',
          daysLabel: 'Mon–Fri',
          startTime: '14:50',
          endTime: '15:35',
          policyId: quiz.id,
          joinCode: 'TX5C7P9E',
        },
      ])
      .returning();

    const p1 = classRows.find((c) => c.name.startsWith('Period 1'))!;
    const p3 = classRows.find((c) => c.name.startsWith('Period 3'))!;

    await tx.insert(s.tags).values([
      { classId: p3.id, label: 'Front desk', code: 'T7XK2M9QPF' },
      { classId: p3.id, label: 'Window desk', code: 'W3RD8K2QAN' },
      { classId: p3.id, label: 'Door shelf', code: 'D9QM4T6XKE' },
    ]);

    // Students carry no email column (privacy: minimum data). A real iOS sign-up
    // whose first/last name matches a seed row with no cognito_sub ADOPTS that row
    // (see POST /v1/auth/bootstrap) — signing up as "Jordan Park" becomes the persona.
    const studentRows = await tx
      .insert(s.students)
      .values(ROSTER.map(([firstName, lastName]) => ({ schoolId, firstName, lastName })))
      .returning();

    await tx.insert(s.memberships).values(
      studentRows.map((st) => ({
        classId: p3.id,
        studentId: st.id,
        status: 'active' as const,
        approvedAt: new Date(),
      })),
    );
    // A few of the same students also sit in Period 1 (history realism).
    await tx.insert(s.memberships).values(
      studentRows.slice(0, 24).map((st) => ({
        classId: p1.id,
        studentId: st.id,
        status: 'active' as const,
        approvedAt: new Date(),
      })),
    );

    const pendingRows = await tx
      .insert(s.students)
      .values(PENDING.map(([firstName, lastName]) => ({ schoolId, firstName, lastName })))
      .returning();
    await tx.insert(s.memberships).values(
      pendingRows.map((st) => ({ classId: p3.id, studentId: st.id, status: 'pending' as const })),
    );
    await tx.insert(s.events).values(
      pendingRows.map((st) => ({
        schoolId,
        classId: p3.id,
        studentId: st.id,
        type: 'member_requested' as const,
        payload: { studentName: `${st.firstName} ${st.lastName}`, className: p3.name },
      })),
    );

    // This morning's ended Period 1 session (8:05–8:50) for history/portal realism.
    const today = new Date();
    const at = (h: number, m: number) => {
      const d = new Date(today);
      d.setHours(h, m, 0, 0);
      return d;
    };
    const [p1Session] = await tx
      .insert(s.sessions)
      .values({
        classId: p1.id,
        teacherId: rivera.id,
        policyId: lecture.id,
        policySnapshot: {
          name: lecture.name,
          messagesAllowed: lecture.messagesAllowed,
          allowedAppLabels: lecture.allowedAppLabels,
        },
        startedAt: at(8, 5),
        endsAt: at(8, 50),
        endedAt: at(8, 50),
        endReason: 'bell',
      })
      .returning();
    if (p1Session) {
      await tx.insert(s.participations).values(
        studentRows.slice(0, 24).map((st, i) => ({
          sessionId: p1Session.id,
          studentId: st.id,
          state: 'ended' as const,
          tappedInAt: at(8, 5 + (i % 7)),
          lastSeenAt: at(8, 50),
        })),
      );
      await tx.insert(s.events).values([
        {
          schoolId,
          classId: p1.id,
          sessionId: p1Session.id,
          teacherId: rivera.id,
          type: 'session_started',
          payload: { className: p1.name, tappedIn: 24 },
          at: at(8, 5),
        },
        {
          schoolId,
          classId: p1.id,
          sessionId: p1Session.id,
          teacherId: rivera.id,
          type: 'session_ended',
          payload: { className: p1.name, reason: 'bell', focusedMinutesAvg: 44 },
          at: at(8, 50),
        },
      ]);
    }

    console.log(
      `seeded: Jefferson High · Ms. Rivera (adoptable: ${TEACHER_EMAIL}) · 4 classes · ` +
        `${studentRows.length} students in Period 3 (+${pendingRows.length} pending) · 3 tags · 1 ended session`,
    );
  });

  await closeDb();
}

main().catch(async (err) => {
  console.error('seed failed:', err);
  await closeDb().catch(() => {});
  process.exit(1);
});
