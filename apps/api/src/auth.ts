import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq, isNull, like, sql } from 'drizzle-orm';
import { getDb, schema as s } from '@bali/db';
import { env } from './env';

/** ID-token verification — same approach the legacy API proved against this pool. */
const verifier = CognitoJwtVerifier.create({
  userPoolId: env.COGNITO_USER_POOL_ID,
  clientId: env.COGNITO_CLIENT_ID,
  tokenUse: 'id',
});

export interface Identity {
  sub: string;
  email: string;
  name: string;
}

export interface TeacherCtx {
  id: string;
  schoolId: string;
  name: string;
  displayName: string;
}

export interface StudentCtx {
  id: string;
  schoolId: string | null;
  firstName: string;
  lastName: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity | null;
  }
}

/**
 * Dev-only test identities: `Bearer dev:<sub>:<email>:<name>` — accepted only when
 * ALLOW_DEV_TOKENS=1 AND not in production. Lets local integration tests drive the
 * full flow without real Cognito sign-ins; the web/iOS clients always use real SRP.
 */
function devIdentity(token: string): Identity | null {
  if (process.env.ALLOW_DEV_TOKENS !== '1' || process.env.NODE_ENV === 'production') return null;
  if (!token.startsWith('dev:')) return null;
  const [, sub, email = '', name = ''] = token.split(':');
  if (!sub) return null;
  return { sub: `dev-${sub}`, email, name: name || email };
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'unauthorized', message: 'Missing bearer token' });
    return;
  }
  const token = header.slice(7);

  const dev = devIdentity(token);
  if (dev) {
    req.identity = dev;
    return;
  }

  try {
    const payload = await verifier.verify(token);
    req.identity = {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      name: typeof payload.name === 'string' && payload.name ? payload.name : String(payload.email ?? ''),
    };
  } catch {
    reply.code(401).send({ error: 'unauthorized', message: 'Invalid or expired token' });
  }
}

/** Look up the teacher for this identity. 403 `bootstrap_required` if not provisioned. */
export async function requireTeacher(req: FastifyRequest, reply: FastifyReply): Promise<TeacherCtx | null> {
  const db = getDb();
  const identity = req.identity!;
  const row = await db.query.teachers.findFirst({ where: eq(s.teachers.cognitoSub, identity.sub) });
  if (!row) {
    reply.code(403).send({ error: 'bootstrap_required', message: 'Call POST /v1/auth/bootstrap first' });
    return null;
  }
  return { id: row.id, schoolId: row.schoolId, name: row.name, displayName: row.displayName };
}

export async function requireStudent(req: FastifyRequest, reply: FastifyReply): Promise<StudentCtx | null> {
  const db = getDb();
  const identity = req.identity!;
  const row = await db.query.students.findFirst({ where: eq(s.students.cognitoSub, identity.sub) });
  if (!row) {
    reply.code(403).send({ error: 'bootstrap_required', message: 'Call POST /v1/auth/bootstrap first' });
    return null;
  }
  return { id: row.id, schoolId: row.schoolId, firstName: row.firstName, lastName: row.lastName };
}

async function ensureDefaultSchool(): Promise<string> {
  const db = getDb();
  const existing = await db.query.schools.findFirst({ where: eq(s.schools.id, env.DEFAULT_SCHOOL_ID) });
  if (existing) return existing.id;
  const [row] = await db
    .insert(s.schools)
    .values({ id: env.DEFAULT_SCHOOL_ID, name: 'My School' })
    .onConflictDoNothing()
    .returning();
  return row?.id ?? env.DEFAULT_SCHOOL_ID;
}

/**
 * Provision (or adopt) the DB row for this Cognito identity. DB is authoritative for
 * roles — the row's existence IS the role. Seed adoption:
 *  - teacher: a seed row (`cognito_sub LIKE 'seed-%'`) with this email is claimed;
 *  - student: a seed row with no cognito_sub and a case-insensitive first/last match
 *    is claimed (signing up as "Jordan Park" becomes the demo persona).
 */
export async function bootstrapIdentity(
  identity: Identity,
  body: { role: 'teacher' | 'student'; firstName?: string; lastName?: string },
): Promise<{ role: 'teacher' | 'student' }> {
  const db = getDb();

  if (body.role === 'teacher') {
    const existing = await db.query.teachers.findFirst({ where: eq(s.teachers.cognitoSub, identity.sub) });
    if (existing) return { role: 'teacher' };

    const adoptable = identity.email
      ? await db.query.teachers.findFirst({
          where: (t, { and }) => and(eq(t.email, identity.email), like(t.cognitoSub, 'seed-%')),
        })
      : undefined;
    if (adoptable) {
      await db
        .update(s.teachers)
        .set({ cognitoSub: identity.sub, name: identity.name || adoptable.name, updatedAt: new Date() })
        .where(eq(s.teachers.id, adoptable.id));
      return { role: 'teacher' };
    }

    const schoolId = await ensureDefaultSchool();
    await db.insert(s.teachers).values({
      schoolId,
      cognitoSub: identity.sub,
      email: identity.email,
      name: identity.name || identity.email,
      displayName: identity.name || identity.email,
    });
    return { role: 'teacher' };
  }

  // student
  const existing = await db.query.students.findFirst({ where: eq(s.students.cognitoSub, identity.sub) });
  if (existing) return { role: 'student' };

  const firstName = body.firstName?.trim();
  const lastName = body.lastName?.trim();
  if (!firstName || !lastName) {
    throw Object.assign(new Error('First and last name are required to create a student account'), {
      statusCode: 400,
      code: 'name_required',
    });
  }

  const adoptable = await db.query.students.findFirst({
    where: (st, { and }) =>
      and(
        isNull(st.cognitoSub),
        sql`lower(${st.firstName}) = ${firstName.toLowerCase()}`,
        sql`lower(${st.lastName}) = ${lastName.toLowerCase()}`,
      ),
  });
  if (adoptable) {
    await db
      .update(s.students)
      .set({ cognitoSub: identity.sub, updatedAt: new Date() })
      .where(eq(s.students.id, adoptable.id));
    return { role: 'student' };
  }

  const schoolId = await ensureDefaultSchool();
  await db.insert(s.students).values({ schoolId, cognitoSub: identity.sub, firstName, lastName });
  return { role: 'student' };
}
