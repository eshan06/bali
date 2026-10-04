import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  blocks,
  classes,
  createDb,
  enrollments,
  generateJoinCode,
  newUuidV7,
  schools,
  users,
} from '@bali/db';
import { recreateDatabase } from '@bali/db/testing';

import { makeTestIssuer, TEST_AUDIENCE, TEST_ISSUER } from '../../test/helpers/test-issuer.js';

/*
 * The load harness (Phase 4, L2a): a school at the bell, for L2b's one-address load gate to drive.
 * `npm run load:seed` makes it in a database of its own and writes its file, what the load script
 * reads; `npm run load:serve` runs the real API on it (serve.ts).
 *
 * Never dev's or prod's data: the Postgres server must be this machine's (`harnessServer`), and
 * the seed writes only into a database it drops and makes anew. Its tokens come from a key pair
 * each seed makes: the private half signs them and is never written down; the public half goes in
 * the file, for serve.ts to trust.
 */

/** 20 teachers start a class of 30 each at the bell: 600 students behind the school's address. */
const TEACHERS = 20;
const CLASS_SIZE = 30;
/** Seed in the morning, load-test all day. */
const TOKEN_HOURS = 12;

/** Where the seed writes and serve.ts reads, unless LOAD_SCHOOL_FILE says otherwise. */
export const SCHOOL_FILE =
  process.env.LOAD_SCHOOL_FILE ?? fileURLToPath(new URL('school.json', import.meta.url));

export interface SchoolFile {
  /** What serve.ts gives the API: its database on the server, and the issuer it trusts. */
  api: { database: string; issuer: string; audience: string; jwksUri: string; internalKey: string };
  /**
   * Per teacher: a token, the class they start at this bell, their block, and the second class
   * every other one teaches (null for the rest), which another room takes at another bell.
   */
  teachers: {
    token: string;
    classId: string;
    blockId: string;
    tagId: string;
    secondClassId: string | null;
  }[];
  /** Per student: a token, the tag of the block they tap, and their class there. */
  students: { token: string; tagId: string; classId: string }[];
  /** An account of the school's in no class: the load gate's flooder. */
  flooder: { token: string };
}

/**
 * The Postgres server in TEST_DATABASE_URL, the one the real-Postgres tests use, if it is on this
 * machine: neither command ever reaches dev's or prod's. The URL must name this machine, and
 * LOAD_LOCAL_POSTGRES=1 must vouch for the server behind it, as nothing can prove it: `localhost`
 * can be a tunnel to another machine, whose server, reached on its own loopback, says it answered
 * on loopback too — while CI's, a container on the runner, says it answered on Docker's network.
 */
export function harnessServer(env: NodeJS.ProcessEnv): string {
  const url = env.TEST_DATABASE_URL;
  if (!url) throw new Error('set TEST_DATABASE_URL to a Postgres server on this machine');
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    throw new Error(`TEST_DATABASE_URL must name a Postgres server on this machine, not ${host}`);
  }
  if (env.LOAD_LOCAL_POSTGRES !== '1') {
    throw new Error(
      `set LOAD_LOCAL_POSTGRES=1 to vouch that the Postgres at ${host} runs on this machine: ` +
        'it could be a tunnel to another one, and nothing here can tell',
    );
  }
  return url;
}

/**
 * A fresh `database` on `server` holding the school, and its file. Each teacher has a block and the
 * class they start at this bell; every other one teaches a second class too, which the room before
 * theirs takes at another bell. Rows go in directly, as the tests seed theirs: no participation,
 * no event.
 */
export async function seedSchool(server: string, database = 'bali_load'): Promise<SchoolFile> {
  const issuer = await makeTestIssuer();
  const schoolId = newUuidV7();
  const teachers = Array.from({ length: TEACHERS }, (_, i) => ({
    id: newUuidV7(),
    sub: `load-teacher-${i + 1}`,
    name: `Teacher ${i + 1}`,
    classId: newUuidV7(),
    secondClassId: i % 2 === 1 ? newUuidV7() : null,
    blockId: newUuidV7(),
    tagId: `LOAD-TAG-${i + 1}`,
  }));
  const students = Array.from({ length: TEACHERS * CLASS_SIZE }, (_, i) => {
    const room = Math.floor(i / CLASS_SIZE);
    const teacher = teachers[room]!;
    const elsewhere = teachers[room + 1]?.secondClassId ?? null;
    return {
      id: newUuidV7(),
      sub: `load-student-${i + 1}`,
      name: `Student ${i + 1}`,
      teacher,
      classIds: [teacher.classId, elsewhere].filter((id) => id !== null),
    };
  });

  const db = createDb(await recreateDatabase(server, database));
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schools).values({ id: schoolId, name: 'Load School' });
      await tx.insert(users).values([
        ...teachers.map((t) => ({
          id: t.id,
          cognitoId: t.sub,
          role: 'teacher' as const,
          schoolId,
          displayName: t.name,
        })),
        ...students.map((s) => ({
          id: s.id,
          cognitoId: s.sub,
          role: 'student' as const,
          schoolId,
          displayName: s.name,
        })),
        { cognitoId: 'load-flooder', role: 'student' as const, schoolId, displayName: 'Flooder' },
      ]);
      await tx.insert(classes).values(
        teachers.flatMap((t) =>
          [t.classId, t.secondClassId]
            .filter((id) => id !== null)
            .map((id, period) => ({
              id,
              teacherId: t.id,
              schoolId,
              name: `${t.name}, period ${period + 1}`,
              joinCode: generateJoinCode(),
            })),
        ),
      );
      await tx
        .insert(blocks)
        .values(teachers.map((t) => ({ id: t.blockId, tagId: t.tagId, teacherId: t.id })));
      await tx
        .insert(enrollments)
        .values(
          students.flatMap((s) => s.classIds.map((classId) => ({ classId, studentId: s.id }))),
        );
    });
  } finally {
    await db.$client.end();
  }

  const token = (sub: string) => issuer.sign({ sub, expiresInSeconds: TOKEN_HOURS * 3600 });
  const jwks = JSON.stringify({ keys: [issuer.publicJwk] });
  return {
    api: {
      database,
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      jwksUri: `data:application/json,${encodeURIComponent(jwks)}`,
      internalKey: randomBytes(32).toString('hex'),
    },
    teachers: await Promise.all(
      teachers.map(async (t) => ({
        token: await token(t.sub),
        classId: t.classId,
        blockId: t.blockId,
        tagId: t.tagId,
        secondClassId: t.secondClassId,
      })),
    ),
    students: await Promise.all(
      students.map(async (s) => ({
        token: await token(s.sub),
        tagId: s.teacher.tagId,
        classId: s.teacher.classId,
      })),
    ),
    flooder: { token: await token('load-flooder') },
  };
}
