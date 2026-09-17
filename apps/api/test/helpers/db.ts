import {
  blocks,
  classes,
  enrollments,
  type Database,
  MIGRATIONS_DIR,
  schema,
  schools,
  users,
} from '@bali/db';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

/**
 * An in-process Postgres (PGlite) with the committed migrations applied — the
 * real schema, no external database. Each test gets its own so they can't
 * interfere. Returns the handle typed as the shared Database and a closer.
 */
export async function makeTestDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, close: () => pg.close() };
}

function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error('expected a row');
  return row;
}

/**
 * A school, a teacher (cognito id `teacher-<tag>`), an enrolled student
 * (`student-<tag>`), a class, and the teacher's block (tag `TAG-<tag>`). The
 * cognito ids are what the test issuer signs tokens for.
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
        joinCode: `JOIN-${tag}`,
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
