import { createHash } from 'node:crypto';

import {
  blocks,
  classes,
  type Database,
  enrollments,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  schools,
  users,
} from '@bali/db';

/**
 * The test database factory lives in `@bali/db/testing` so the api and db suites
 * share one backend switch (PGlite by default, real Postgres when
 * TEST_DATABASE_URL is set). Re-exported here so existing api tests keep
 * importing it from this helper.
 */
export { makeTestDb } from '@bali/db/testing';

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('expected a row');
  return row;
}

/**
 * A join code for `tag`, shaped like every real one — `JOIN_CODE_LENGTH`
 * symbols of the generator's alphabet, so upper-case, which the routes match
 * exactly after upper-casing what they are sent — and the same for the same
 * tag on every run, so a fixture naming it never drifts.
 */
export function joinCodeFor(tag: string): string {
  const bytes = createHash('sha256').update(tag).digest();
  return Array.from(
    bytes.subarray(0, JOIN_CODE_LENGTH),
    (byte) => JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length],
  ).join('');
}

/**
 * A school, a teacher (cognito id `teacher-<tag>`), an enrolled student
 * (`student-<tag>`), a class (join code `joinCodeFor(tag)`), and the teacher's
 * block (tag `TAG-<tag>`). The cognito ids are what the test issuer signs
 * tokens for.
 */
export async function seedClassroom(db: Database, tag: string) {
  const school = one(
    await db
      .insert(schools)
      .values({ name: `School ${tag}` })
      .returning(),
  );
  const teacher = one(
    await db
      .insert(users)
      .values({ cognitoId: `teacher-${tag}`, role: 'teacher', schoolId: school.id })
      .returning(),
  );
  const student = one(
    await db
      .insert(users)
      .values({ cognitoId: `student-${tag}`, role: 'student', schoolId: school.id })
      .returning(),
  );
  const klass = one(
    await db
      .insert(classes)
      .values({
        teacherId: teacher.id,
        schoolId: school.id,
        name: `Class ${tag}`,
        joinCode: joinCodeFor(tag),
      })
      .returning(),
  );
  await db.insert(enrollments).values({ classId: klass.id, studentId: student.id });
  const block = one(
    await db
      .insert(blocks)
      .values({ tagId: `TAG-${tag}`, teacherId: teacher.id })
      .returning(),
  );
  return { school, teacher, student, klass, block };
}
