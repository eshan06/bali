import {
  type Database,
  enrollments,
  events,
  findUserByCognitoId,
  startSession,
  users,
} from '@bali/db';
import type {
  ApiErrorBody,
  MeResponse,
  RosterResponse,
  SessionSnapshot,
  UpdateMeResponse,
} from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  ctx = await makeAuthedApp(db);
});

afterEach(async () => {
  await ctx.close();
  await closeDb();
});

async function me(token: string): Promise<{ status: number; body: MeResponse }> {
  const res = await authedInject(ctx.app, token, { method: 'GET', url: '/v1/me' });
  return { status: res.statusCode, body: res.json<MeResponse>() };
}

describe('GET /v1/me', () => {
  it('creates the caller as a student on first call', async () => {
    const { status, body } = await me(await ctx.tokenFor('brand-new-cognito-sub'));
    expect(status).toBe(200);
    expect(body.user.role).toBe('student');
    expect(body.classes).toEqual([]);
    expect(body.session).toBeNull();
    // The row now exists.
    expect(await findUserByCognitoId(db, 'brand-new-cognito-sub')).toBeDefined();
  });

  it('takes the display name from an access token’s username, not only `name`', async () => {
    // By default Cognito puts profile attributes in the ID token only. Every
    // client here sends an ACCESS token, which then carries the username and no
    // `name` — so reading `name` alone left display_name NULL on every real
    // request and the live grid rendered a UUID prefix.
    const token = await ctx.issuer.sign({
      sub: 'access-token-sub',
      extraClaims: { username: 'demo-ana@example.test' },
    });

    const { body } = await me(token);

    expect(body.user.displayName).toBe('demo-ana@example.test');
  });

  it('prefers a real `name` claim when the token carries one', async () => {
    const token = await ctx.issuer.sign({
      sub: 'id-token-sub',
      extraClaims: { name: 'Ana Reyes', 'cognito:username': 'demo-ana@example.test' },
    });

    const { body } = await me(token);

    expect(body.user.displayName).toBe('Ana Reyes');
  });

  it('fills a display name the row was provisioned without', async () => {
    // Everyone already in the dev pool was created before the name could be
    // read, so the fix has to reach existing rows or it fixes nothing.
    const nameless = await ctx.issuer.sign({ sub: 'already-provisioned' });
    expect((await me(nameless)).body.user.displayName).toBeNull();

    const named = await ctx.issuer.sign({
      sub: 'already-provisioned',
      extraClaims: { username: 'demo-ben@example.test' },
    });
    const { body } = await me(named);

    expect(body.user.displayName).toBe('demo-ben@example.test');
    expect((await findUserByCognitoId(db, 'already-provisioned'))?.displayName).toBe(
      'demo-ben@example.test',
    );
  });

  it('never overwrites a display name the row already has', async () => {
    // It is a fill, not a sync: "edit own name" (PLAN.md phase 3) makes the
    // stored name the student's own, and a later sign-in must not put their
    // Cognito username back over it.
    const first = await ctx.issuer.sign({
      sub: 'renamed-later',
      extraClaims: { name: 'Ana Reyes' },
    });
    await me(first);

    const second = await ctx.issuer.sign({
      sub: 'renamed-later',
      extraClaims: { username: 'demo-ana@example.test' },
    });
    const { body } = await me(second);

    expect(body.user.displayName).toBe('Ana Reyes');
  });

  it('ignores a blank name claim rather than storing whitespace', async () => {
    const token = await ctx.issuer.sign({
      sub: 'blank-name',
      extraClaims: { name: '   ', username: 'demo-cal@example.test' },
    });

    const { body } = await me(token);

    expect(body.user.displayName).toBe('demo-cal@example.test');
  });

  it('stores nothing rather than an identifier no teacher could read', async () => {
    // A pool that signs users in by email gives every one of them a UUID as
    // `username`; a federated sign-in gives `Google_1102938…`. Storing either
    // would print worse than the grid's own eight-character fallback, and the
    // fill never overwrites, so it would stay.
    const uuidUser = await ctx.issuer.sign({
      sub: 'uuid-username',
      extraClaims: { username: '8f14e45f-ceea-467a-9b9c-1c1e6a4e7b3d' },
    });
    expect((await me(uuidUser)).body.user.displayName).toBeNull();
    const upperUuid = await ctx.issuer.sign({
      sub: 'uuid-username-upper',
      extraClaims: { username: '8F14E45F-CEEA-467A-9B9C-1C1E6A4E7B3D' },
    });
    expect((await me(upperUuid)).body.user.displayName).toBeNull();

    // Cognito names a federated user `<provider>_<subject>`; one per built-in
    // provider, in the subject shape that provider hands out, plus the
    // lower-cased spelling a case-insensitive pool can produce, and a subject
    // in upper case, which is read in either case as a UUID is.
    for (const [sub, username] of [
      ['federated-google', 'Google_110293847566123450987'],
      ['federated-google-lower', 'google_110293847566123450987'],
      ['federated-facebook', 'Facebook_10223344556677889'],
      ['federated-amazon', 'LoginWithAmazon_amzn1.account.AEXAMPLE1234567890'],
      ['federated-amazon-lower', 'loginwithamazon_amzn1.account.aexample1234567890'],
      ['federated-apple', 'SignInWithApple_001234.0123456789abcdef0123456789abcdef.0123'],
      ['federated-apple-upper', 'SignInWithApple_001234.0123456789ABCDEF0123456789ABCDEF.0123'],
    ]) {
      const token = await ctx.issuer.sign({ sub, extraClaims: { username } });
      expect((await me(token)).body.user.displayName, username).toBeNull();
    }
  });

  it('clamps an over-long name and strips control characters', async () => {
    // `name` and `preferred_username` are attributes the student can set on
    // themselves, and the value lands in a teacher's grid. C0 and C1 controls
    // (BEL, NEL, CSI) and a zero-width space all go.
    const token = await ctx.issuer.sign({
      sub: 'shouty',
      extraClaims: { name: `Ana\u0007\u0085\u009b\u200b ${'x'.repeat(200)}` },
    });

    const { body } = await me(token);

    expect(body.user.displayName).toHaveLength(64);
    expect(body.user.displayName).toMatch(/^Ana x+$/);
  });

  it('strips bidi controls from a name', async () => {
    // RLO, LRE…PDF and LRI…PDI: format characters that would make a teacher's
    // grid show one name while the row holds another.
    const token = await ctx.issuer.sign({
      sub: 'bidi',
      extraClaims: { name: 'Ana\u202Eseyer \u202Ax\u202C \u2066y\u2069' },
    });

    const { body } = await me(token);

    expect(body.user.displayName).toBe('Anaseyer x y');
  });

  it('strips every format character but the two joiners', async () => {
    // Not only bidi controls and zero-width spaces: a soft hyphen, a BOM, a
    // word joiner, an LRM, a Mongolian vowel separator, tag characters (which
    // can carry hidden text), an interlinear annotation anchor, a musical beam.
    const token = await ctx.issuer.sign({
      sub: 'format-characters',
      extraClaims: {
        name: 'Ana\u00ad\ufeff\u2060\u200e\u180e\u{E0001}\u{E0068}\u{E0069}\u{E007F}\ufff9\u{1D173} Reyes',
      },
    });

    const { body } = await me(token);

    expect(body.user.displayName).toBe('Ana Reyes');
  });

  it('keeps an ordinary school username that merely ends in digits', async () => {
    // `<name>_<year>` is a mainstream school convention. Rejecting it as
    // "machine-made" leaves display_name NULL and the teacher looking at a UUID
    // prefix — the exact outcome this whole change exists to remove.
    for (const [sub, username] of [
      ['school-a', 'jsmith_2028'],
      ['school-b', 'ana_2011'],
      ['school-c', 'mrs.reyes_7'],
      ['school-d', 'ana-reyes_2011'],
      // A surname carrying the year: a long tail with digits in it, which a
      // rule reading any such tail as a federated subject would reject.
      ['school-e', 'ana_rodriguez2029'],
      ['school-f', 'ana_martinez2029'],
      ['school-g', 'p_kowalski1987'],
      // A name and a student number: numeric like a provider's subject, but
      // with no provider in front of it.
      ['school-h', 'jsmith_100234'],
      // Ten digits and more, as long as a provider's subject: still no provider.
      ['school-i', 'jsmith_2029012345'],
      ['school-j', 'ana_1234567890'],
    ]) {
      const token = await ctx.issuer.sign({ sub, extraClaims: { username } });
      expect((await me(token)).body.user.displayName, username).toBe(username);
    }
  });

  it('draws the lines of the machine-made rule exactly where it says', async () => {
    const uuid = '8f14e45f-ceea-467a-9b9c-1c1e6a4e7b3d';
    const kept: [string, string][] = [
      // Nine digits is not a Google or Facebook subject; ten is.
      ['edge-google-9', 'google_123456789'],
      ['edge-facebook-9', 'facebook_123456789'],
      // A UUID with more around it is a username that contains one.
      ['edge-uuid-suffix', `${uuid}-ana`],
      ['edge-uuid-prefix', `ana-${uuid}`],
      // A provider prefix whose subject's shape has something after it, or
      // before it: the shape has to be the whole of what follows the prefix.
      ['edge-amazon-more', 'LoginWithAmazon_amzn1.account.AB12.ana'],
      ['edge-apple-more', 'SignInWithApple_001234.0123456789abcdef.0123.ana'],
      ['edge-google-after', 'google_2125551234_fan'],
      ['edge-facebook-after', 'facebook_2125551234_fan'],
      ['edge-google-before', 'google_fan_2125551234'],
      ['edge-facebook-before', 'facebook_fan_2125551234'],
      ['edge-amazon-before', 'LoginWithAmazon_my.amzn1.account.AB12'],
      ['edge-apple-before', 'SignInWithApple_ana.001234.0123456789abcdef.0123'],
    ];
    for (const [sub, username] of kept) {
      const token = await ctx.issuer.sign({ sub, extraClaims: { username } });
      expect((await me(token)).body.user.displayName, username).toBe(username);
    }
    for (const [sub, username] of [
      ['edge-google-10', 'google_1234567890'],
      ['edge-facebook-10', 'facebook_1234567890'],
    ]) {
      const token = await ctx.issuer.sign({ sub, extraClaims: { username } });
      expect((await me(token)).body.user.displayName, username).toBeNull();
    }
  });

  it('keeps a name someone chose even when it is shaped like an identifier', async () => {
    // Only the pool's own identifiers are screened: `name` and
    // `preferred_username` are what someone chose to be called.
    const uuid = '8f14e45f-ceea-467a-9b9c-1c1e6a4e7b3d';
    const federated = 'Google_110293847566123450987';
    for (const [sub, extraClaims, expected] of [
      ['chosen-uuid', { preferred_username: uuid, username: 'demo-eve@example.test' }, uuid],
      ['chosen-federated', { name: federated, username: 'demo-eve@example.test' }, federated],
    ] as const) {
      const token = await ctx.issuer.sign({ sub, extraClaims });
      expect((await me(token)).body.user.displayName, sub).toBe(expected);
    }
  });

  it('keeps a username that merely begins with a provider’s name', async () => {
    // Only a provider prefix followed by that provider's subject shape is a
    // federated username; a student called google_fan_2029 is a student.
    for (const [sub, username] of [
      ['prefix-a', 'google_fan_2029'],
      ['prefix-b', 'facebook_ana'],
      ['prefix-c', 'Google_Ana_Reyes'],
      // Numeric like Google's subject, but eight digits — a date, not a `sub`.
      ['prefix-d', 'google_20290101'],
      ['prefix-e', 'facebook_20290101'],
    ]) {
      const token = await ctx.issuer.sign({ sub, extraClaims: { username } });
      expect((await me(token)).body.user.displayName, username).toBe(username);
    }
  });

  it('drops a lone surrogate rather than storing U+FFFD for good', async () => {
    // A JWT's JSON can carry "\ud800" on its own. Postgres stores that as
    // U+FFFD, and the fill never replaces a stored name — the same outcome the
    // code-point clamp exists to prevent, arriving through the input instead.
    const token = await ctx.issuer.sign({
      sub: 'lone-surrogate',
      extraClaims: { name: 'Ana\uD800 Reyes\uDC00' },
    });

    const { body } = await me(token);

    expect(body.user.displayName).toBe('Ana Reyes');
    expect((await findUserByCognitoId(db, 'lone-surrogate'))?.displayName).toBe('Ana Reyes');
  });

  it('walks the claims in order: name, preferred_username, cognito:username, username', async () => {
    const cases: [string, Record<string, string>, string][] = [
      [
        'order-name',
        { name: 'Ana Reyes', preferred_username: 'Ana R.', username: 'ana_r' },
        'Ana Reyes',
      ],
      ['order-preferred', { preferred_username: 'Ana R.', 'cognito:username': 'ana_r' }, 'Ana R.'],
      [
        'order-cognito',
        { 'cognito:username': 'ana_id_token', username: 'ana_access' },
        'ana_id_token',
      ],
      ['order-username', { username: 'ana_access' }, 'ana_access'],
    ];
    for (const [sub, extraClaims, expected] of cases) {
      const token = await ctx.issuer.sign({ sub, extraClaims });
      expect((await me(token)).body.user.displayName, sub).toBe(expected);
    }
  });

  it('reads past an identifier claim it cannot use', async () => {
    // An opaque, non-string or invisible `cognito:username` is skipped, and the
    // walk goes on to `username`.
    for (const [sub, unusable] of [
      ['skip-uuid', '8f14e45f-ceea-467a-9b9c-1c1e6a4e7b3d'],
      ['skip-federated', 'google_110293847566123450987'],
      ['skip-number', 42],
      ['skip-invisible', '\u200b'],
    ] as const) {
      const token = await ctx.issuer.sign({
        sub,
        extraClaims: { 'cognito:username': unusable, username: 'ana_reyes' },
      });
      expect((await me(token)).body.user.displayName, sub).toBe('ana_reyes');
    }
  });

  it('reads preferred_username when there is no name', async () => {
    const token = await ctx.issuer.sign({
      sub: 'preferred',
      extraClaims: { preferred_username: 'Ana R.', username: 'demo-ana@example.test' },
    });

    expect((await me(token)).body.user.displayName).toBe('Ana R.');
  });

  it('clamps without splitting a character in half', async () => {
    // Slicing UTF-16 units can cut a surrogate pair, and Postgres then stores
    // the lone half as U+FFFD — permanently, since the fill never overwrites.
    // 65 code points, so the cut really happens — and lands right after the
    // pair: a UTF-16 slice to 64 would keep only its first half.
    const token = await ctx.issuer.sign({
      sub: 'emoji',
      extraClaims: { name: `${'A'.repeat(63)}\u{1F600}B` },
    });

    const stored = (await me(token)).body.user.displayName ?? '';

    // No lone surrogate left behind by the cut (`isWellFormed` is ES2024 and
    // this workspace does not target it).
    expect(stored).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
    expect(stored).not.toContain('\uFFFD');
    expect([...stored]).toHaveLength(64);
    expect(stored.endsWith('\u{1F600}')).toBe(true);
  });

  it('trims before it clamps, so leading spaces do not use up the length', async () => {
    const token = await ctx.issuer.sign({
      sub: 'leading-spaces',
      extraClaims: { name: `   ${'A'.repeat(70)}` },
    });

    expect((await me(token)).body.user.displayName).toBe('A'.repeat(64));
  });

  it('trims again after the clamp, when the cut lands just after a space', async () => {
    const token = await ctx.issuer.sign({
      sub: 'cut-at-space',
      extraClaims: { name: `${'A'.repeat(63)} ${'B'.repeat(5)}` },
    });

    expect((await me(token)).body.user.displayName).toBe('A'.repeat(63));
  });

  it('treats a name with nothing visible in it as no name', async () => {
    // Joiners only, or with a space between them, a Hangul filler, blank
    // braille cells, a musical null notehead: stored, any of these would blank
    // the student's cell in the grid for good and outrank the readable
    // username behind it. The check reads what would be stored, so a name
    // whose visible part falls past the 64-code-point clamp counts too.
    for (const [sub, name] of [
      ['invisible-joiners', '\u200d\u200c'],
      ['invisible-spaced-joiners', '\u200d \u200d'],
      ['invisible-hangul', '\u3164'],
      ['invisible-braille', '\u2800\u2800'],
      ['invisible-null-notehead', '\u{1D159}'],
      ['invisible-after-the-clamp', `${'\u3164'.repeat(64)}Ana`],
    ]) {
      const token = await ctx.issuer.sign({
        sub,
        extraClaims: { name, username: 'demo-eve@example.test' },
      });
      expect((await me(token)).body.user.displayName, sub).toBe('demo-eve@example.test');
    }
  });

  it('drops line and paragraph separators', async () => {
    // Inside the name, where the trim would not reach them.
    const token = await ctx.issuer.sign({
      sub: 'separators',
      extraClaims: { name: 'Ana\u2028Maria\u2029Reyes' },
    });

    expect((await me(token)).body.user.displayName).toBe('AnaMariaReyes');
  });

  it('reads past a name claim that is not a string', async () => {
    // A claim is any JSON a pre-token Lambda chose to put there.
    const token = await ctx.issuer.sign({
      sub: 'not-a-string',
      extraClaims: { name: 42, preferred_username: ['Ana'], username: 'ana_rodriguez2029' },
    });

    const { status, body } = await me(token);

    expect(status).toBe(200);
    expect(body.user.displayName).toBe('ana_rodriguez2029');
  });

  it('keeps a zero-width joiner inside an emoji sequence', async () => {
    const name = 'Ana \u{1F469}\u200d\u{1F4BB}';
    const token = await ctx.issuer.sign({ sub: 'zwj-emoji', extraClaims: { name } });

    expect((await me(token)).body.user.displayName).toBe(name);
  });

  it('keeps the joiners that carry meaning in a name', async () => {
    // ZWNJ and ZWJ are \p{Cf}, like the bidi overrides worth stripping, but
    // they are orthographic in Persian, Arabic and Indic names.
    const token = await ctx.issuer.sign({
      sub: 'joiners',
      extraClaims: { name: '\u0645\u200c\u06cc\u200c\u0631\u0648\u0645' },
    });

    expect((await me(token)).body.user.displayName).toBe(
      '\u0645\u200c\u06cc\u200c\u0631\u0648\u0645',
    );
  });

  it('is idempotent — a second call returns the same user, no duplicate', async () => {
    const token = await ctx.tokenFor('repeat-sub');
    const first = await me(token);
    const second = await me(token);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('returns a student their enrolled classes', async () => {
    const { student, klass } = await seedClassroom(db, 'me-student');
    const { body } = await me(await ctx.tokenFor(student.cognitoId));
    expect(body.user.role).toBe('student');
    expect(body.classes.map((c) => c.id)).toEqual([klass.id]);
  });

  it('returns a teacher their taught classes (existing role preserved)', async () => {
    const { teacher, klass } = await seedClassroom(db, 'me-teacher');
    const { body } = await me(await ctx.tokenFor(teacher.cognitoId));
    expect(body.user.role).toBe('teacher');
    expect(body.classes.map((c) => c.id)).toEqual([klass.id]);
  });

  it('fills a teacher’s missing display name too, and keeps the role', async () => {
    // The fill applies to any row the caller supplies a name for: a teacher
    // provisioned without one gets it on their next /v1/me, as a student does.
    const { teacher } = await seedClassroom(db, 'me-teacher-name');
    const token = await ctx.issuer.sign({
      sub: teacher.cognitoId,
      extraClaims: { username: 'ms.rivera' },
    });

    const { body } = await me(token);

    expect(body.user.role).toBe('teacher');
    expect(body.user.displayName).toBe('ms.rivera');
    expect((await findUserByCognitoId(db, teacher.cognitoId))?.displayName).toBe('ms.rivera');
  });

  it('requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /v1/me', () => {
  function rename(token: string | null, body?: unknown) {
    return ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { payload: body as object }),
    });
  }
  const renameTo = (token: string, displayName: string, eventId: string = randomUUID()) =>
    rename(token, { displayName, eventId });

  /** Another student, called `displayName`, in each of `classIds`. */
  async function classmate(tag: string, displayName: string | null, ...classIds: string[]) {
    const [row] = await db
      .insert(users)
      .values({ cognitoId: `student-${tag}`, role: 'student', displayName })
      .returning();
    for (const classId of classIds)
      await db.insert(enrollments).values({ classId, studentId: row!.id });
    return row!;
  }
  const storedName = async (userId: string) =>
    (await db.select().from(users).where(eq(users.id, userId)))[0]!.displayName;
  const renamesOf = (userId: string) =>
    db
      .select()
      .from(events)
      .where(and(eq(events.userId, userId), eq(events.type, 'display_name_changed')));
  const taken = {
    error: {
      code: 'conflict',
      reason: 'display_name_taken',
      message: 'a classmate already uses that name',
    },
  };

  it('sets the name, stored trimmed with each run of spaces made one, and records it', async () => {
    const { student } = await seedClassroom(db, 'rn-set');
    const token = await ctx.tokenFor(student.cognitoId);
    const eventId = randomUUID();

    const res = await renameTo(token, '  Ana \u00a0  Rodríguez ', eventId);

    expect(res.statusCode).toBe(200);
    expect(res.json<UpdateMeResponse>()).toEqual({
      outcome: 'applied',
      user: { id: student.id, role: 'student', displayName: 'Ana Rodríguez' },
    });
    expect((await me(token)).body.user.displayName).toBe('Ana Rodríguez');
    // One event, in no session and no class, keeping what it replaced.
    const [recorded, ...more] = await renamesOf(student.id);
    expect(more).toEqual([]);
    expect(recorded).toMatchObject({
      eventId,
      sessionId: null,
      classId: null,
      payload: { display_name: 'Ana Rodríguez', previous_display_name: null },
    });
  });

  it('tidies the blank symbols a name is compared without, as it tidies spaces', async () => {
    // The engine compares names with the blank braille cell and the null
    // notehead as blank space; the stored name must not keep one at an edge
    // (a leading U+2800 was stored as sent) or a run of them inside.
    const { student } = await seedClassroom(db, 'rn-blank');
    const token = await ctx.tokenFor(student.cognitoId);

    const res = await renameTo(token, '⠀Bea⠀⠀Ortiz\u{1D159}');

    expect(res.statusCode).toBe(200);
    expect(res.json<UpdateMeResponse>().user.displayName).toBe('Bea Ortiz');
    expect(await storedName(student.id)).toBe('Bea Ortiz');
  });

  it('reaches the teacher’s grid and roster at their next read', async () => {
    // The grid's names come from the snapshot, which the portal re-reads every
    // 15 s; no event carries a rename to the stream.
    const { teacher, student, klass } = await seedClassroom(db, 'rn-grid');
    const now = Date.now();
    const { session } = await startSession(db, {
      classId: klass.id,
      startedAt: new Date(now - 60_000),
      endsAt: new Date(now + 25 * 60_000),
    });
    expect((await renameTo(await ctx.tokenFor(student.cognitoId), 'Ana R.')).statusCode).toBe(200);

    const teacherToken = await ctx.tokenFor(teacher.cognitoId);
    const snapshot = await authedInject(ctx.app, teacherToken, {
      method: 'GET',
      url: `/v1/sessions/${session.id}`,
    });
    expect(snapshot.json<SessionSnapshot>().students.map((s) => s.displayName)).toEqual(['Ana R.']);
    const roster = await authedInject(ctx.app, teacherToken, {
      method: 'GET',
      url: `/v1/classes/${klass.id}/roster`,
    });
    expect(roster.json<RosterResponse>().students.map((s) => s.displayName)).toEqual(['Ana R.']);
  });

  it('answers a replay with the name now, applies nothing, and never refuses it', async () => {
    const { student, klass } = await seedClassroom(db, 'rn-replay');
    const token = await ctx.tokenFor(student.cognitoId);
    const first = randomUUID();
    expect((await renameTo(token, 'Ana', first)).statusCode).toBe(200);
    expect((await renameTo(token, 'Bea')).statusCode).toBe(200);
    // A classmate takes the name the lost request set, so a fresh attempt at
    // it would be refused: its replay is still only a replay.
    const cal = await classmate('rn-replay-cal', null, klass.id);
    expect((await renameTo(await ctx.tokenFor(cal.cognitoId), 'ana')).statusCode).toBe(200);

    const res = await renameTo(token, 'Ana', first);

    expect(res.statusCode).toBe(200);
    expect(res.json<UpdateMeResponse>()).toEqual({
      outcome: 'replay',
      user: { id: student.id, role: 'student', displayName: 'Bea' },
    });
    expect(await storedName(student.id)).toBe('Bea');
    expect((await renamesOf(student.id)).filter((e) => e.eventId === first)).toHaveLength(1);
  });

  it('refuses an eventId another event holds (409 event_id_conflict), changing nothing', async () => {
    const { student, klass, block } = await seedClassroom(db, 'rn-spent');
    const now = Date.now();
    await startSession(db, {
      classId: klass.id,
      startedAt: new Date(now - 60_000),
      endsAt: new Date(now + 25 * 60_000),
    });
    const token = await ctx.tokenFor(student.cognitoId);
    const tapped = randomUUID();
    const tap = await authedInject(ctx.app, token, {
      method: 'POST',
      url: '/v1/taps',
      payload: { tagId: block.tagId, eventId: tapped, deviceTime: new Date().toISOString() },
    });
    expect(tap.statusCode).toBe(200);
    // Another student's rename is not this one's to replay either.
    const other = await classmate('rn-spent-other', null);
    const theirs = randomUUID();
    expect((await renameTo(await ctx.tokenFor(other.cognitoId), 'Dee', theirs)).statusCode).toBe(
      200,
    );

    for (const eventId of [tapped, theirs]) {
      const res = await renameTo(token, 'Dee', eventId);
      expect(res.statusCode).toBe(409);
      expect(res.json<ApiErrorBody>().error.reason).toBe('event_id_conflict');
    }
    expect(await storedName(student.id)).toBeNull();
    expect(await renamesOf(student.id)).toEqual([]);
  });

  it('refuses a name a classmate in any shared class uses, ignoring case and spacing', async () => {
    // Ana is in two classes: Bea shares one, Cal the other (owner decision 8).
    const a = await seedClassroom(db, 'rn-taken-a');
    const b = await seedClassroom(db, 'rn-taken-b');
    await db.insert(enrollments).values({ classId: b.klass.id, studentId: a.student.id });
    await classmate('rn-taken-bea', 'Bea Ortiz', b.klass.id);
    await classmate('rn-taken-cal', 'Cal Díaz', a.klass.id);
    await classmate('rn-taken-zoe', 'Zo\u00eb', b.klass.id);
    const token = await ctx.tokenFor(a.student.cognitoId);

    for (const name of [
      'bea ortiz',
      '  BEA   ORTIZ ',
      'cal díaz',
      // The same letters, spelled another way: full-width, a decomposed accent.
      'Ｃａｌ Ｄíａｚ',
      'Zoe\u0308',
      // A character that draws nothing does not make it another name.
      'Bea\u200d Ortiz',
    ]) {
      const res = await renameTo(token, name);
      expect(res.statusCode, name).toBe(409);
      expect(res.json(), name).toEqual(taken);
    }
    // Refused, never a silent rename: nothing stored, nothing recorded.
    expect(await storedName(a.student.id)).toBeNull();
    expect(await renamesOf(a.student.id)).toEqual([]);
  });

  it('lets a name used only outside the caller’s classes, or by one who left, be taken', async () => {
    const a = await seedClassroom(db, 'rn-free-a');
    const elsewhere = await seedClassroom(db, 'rn-free-b');
    await classmate('rn-free-dana', 'Dana', elsewhere.klass.id);
    const eve = await classmate('rn-free-eve', 'Eve', a.klass.id);
    await db
      .update(enrollments)
      .set({ removedAt: new Date() })
      .where(eq(enrollments.studentId, eve.id));
    const token = await ctx.tokenFor(a.student.cognitoId);

    for (const name of ['Dana', 'Eve']) {
      const res = await renameTo(token, name);
      expect(res.statusCode, name).toBe(200);
      expect(res.json<UpdateMeResponse>().user.displayName).toBe(name);
    }
  });

  it('lets the student recase their own name', async () => {
    const { student } = await seedClassroom(db, 'rn-recase');
    const token = await ctx.tokenFor(student.cognitoId);
    expect((await renameTo(token, 'ana reyes')).statusCode).toBe(200);

    const res = await renameTo(token, 'Ana Reyes');

    expect(res.statusCode).toBe(200);
    expect(res.json<UpdateMeResponse>().user.displayName).toBe('Ana Reyes');
  });

  it('keeps a refused rename’s id free: sent again once the name is free, it applies', async () => {
    const { student, klass } = await seedClassroom(db, 'rn-retry');
    const bea = await classmate('rn-retry-bea', 'Bea', klass.id);
    const token = await ctx.tokenFor(student.cognitoId);
    const eventId = randomUUID();
    expect((await renameTo(token, 'Bea', eventId)).statusCode).toBe(409);
    expect((await renameTo(await ctx.tokenFor(bea.cognitoId), 'Beatriz')).statusCode).toBe(200);

    const res = await renameTo(token, 'Bea', eventId);

    expect(res.statusCode).toBe(200);
    expect(res.json<UpdateMeResponse>().outcome).toBe('applied');
  });

  it('never refuses a join over a name, and leaves the collision it makes', async () => {
    // Decision 8 polices an edit. A join refused over a classmate's choice
    // would keep a student out of their class; the teacher sees both names.
    const { teacher, student, klass } = await seedClassroom(db, 'rn-join');
    expect((await renameTo(await ctx.tokenFor(student.cognitoId), 'Ana')).statusCode).toBe(200);
    const newcomer = await ctx.tokenFor('rn-join-newcomer');
    expect((await renameTo(newcomer, 'ana')).statusCode).toBe(200);

    const join = await authedInject(ctx.app, newcomer, {
      method: 'POST',
      url: '/v1/enrollments',
      payload: {
        joinCode: klass.joinCode,
        eventId: randomUUID(),
        deviceTime: new Date().toISOString(),
      },
    });

    expect(join.statusCode).toBe(200);
    const roster = await authedInject(ctx.app, await ctx.tokenFor(teacher.cognitoId), {
      method: 'GET',
      url: `/v1/classes/${klass.id}/roster`,
    });
    expect(roster.json<RosterResponse>().students.map((s) => s.displayName)).toEqual([
      'Ana',
      'ana',
    ]);
  });

  it('does not police a name filled from sign-in claims', async () => {
    const { student, klass } = await seedClassroom(db, 'rn-fill');
    expect((await renameTo(await ctx.tokenFor(student.cognitoId), 'Ana Reyes')).statusCode).toBe(
      200,
    );
    const nameless = await classmate('rn-fill-other', null, klass.id);
    const token = await ctx.issuer.sign({
      sub: nameless.cognitoId,
      extraClaims: { name: 'Ana Reyes' },
    });

    expect((await me(token)).body.user.displayName).toBe('Ana Reyes');
  });

  it('is never overwritten by a later sign-in’s name', async () => {
    // The fill only ever fills a NULL, and a name the student set is never one.
    const { student } = await seedClassroom(db, 'rn-kept');
    const plain = await ctx.tokenFor(student.cognitoId);
    expect((await renameTo(plain, 'Bea')).statusCode).toBe(200);
    const named = await ctx.issuer.sign({
      sub: student.cognitoId,
      extraClaims: { name: 'Ana Reyes', username: 'demo-ana@example.test' },
    });

    expect((await me(named)).body.user.displayName).toBe('Bea');
    expect(await storedName(student.id)).toBe('Bea');
  });

  it('refuses a name that breaks a rule as display_name_invalid, and changes nothing', async () => {
    const { student } = await seedClassroom(db, 'rn-invalid');
    const token = await ctx.tokenFor(student.cognitoId);

    for (const name of [
      '',
      '   ',
      // Nothing visible: joiners, a Hangul filler, a blank braille cell.
      '\u200d\u200c',
      '\u3164',
      '\u2800',
      // Past the limit, counted in code points.
      'A'.repeat(65),
      '\u{1F600}'.repeat(65),
      // Controls and format characters, refused rather than stripped: a
      // newline or a tab, a bell, a bidi override, a line separator, a lone
      // surrogate half.
      'Ana\nReyes',
      'Ana\tReyes',
      'Ana\u0007',
      'Ana\u202eseyer',
      'Ana\u2028Reyes',
      'Ana\ud800',
    ]) {
      const res = await renameTo(token, name);
      expect(res.statusCode, JSON.stringify(name)).toBe(400);
      expect(res.json<ApiErrorBody>().error, JSON.stringify(name)).toMatchObject({
        code: 'bad_input',
        reason: 'display_name_invalid',
      });
    }
    expect(await storedName(student.id)).toBeNull();
    expect(await renamesOf(student.id)).toEqual([]);
  });

  it('takes a name at the limit, and the joiners names and emoji need', async () => {
    const { student } = await seedClassroom(db, 'rn-edge');
    const token = await ctx.tokenFor(student.cognitoId);

    for (const name of [
      'A'.repeat(64),
      '\u{1F600}'.repeat(64),
      'Ana \u{1F469}\u200d\u{1F4BB}',
      '\u0645\u200c\u06cc\u200c\u0631\u0648\u0645',
    ]) {
      const res = await renameTo(token, name);
      expect(res.statusCode, name).toBe(200);
      expect(res.json<UpdateMeResponse>().user.displayName, name).toBe(name);
    }
  });

  it('refuses a malformed body as invalid_request', async () => {
    const { student } = await seedClassroom(db, 'rn-malformed');
    const token = await ctx.tokenFor(student.cognitoId);

    for (const body of [
      undefined,
      {},
      { displayName: 'Ana' },
      { displayName: 'Ana', eventId: 'not-a-uuid' },
      { displayName: 42, eventId: randomUUID() },
      { eventId: randomUUID() },
    ]) {
      const res = await rename(token, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json<ApiErrorBody>().error, JSON.stringify(body)).toMatchObject({
        code: 'bad_input',
        reason: 'invalid_request',
      });
    }
  });

  it('gives a first-time caller a row, as a join does', async () => {
    const res = await renameTo(await ctx.tokenFor('rn-first-call'), 'Ana');

    expect(res.statusCode).toBe(200);
    const body = res.json<UpdateMeResponse>();
    expect(body).toMatchObject({
      outcome: 'applied',
      user: { role: 'student', displayName: 'Ana' },
    });
    expect((await findUserByCognitoId(db, 'rn-first-call'))?.id).toBe(body.user.id);
  });

  it('requires authentication', async () => {
    const res = await rename(null, { displayName: 'Ana', eventId: randomUUID() });
    expect(res.statusCode).toBe(401);
  });

  it('is a student’s: a teacher is 403, and their name is left as it is', async () => {
    const { teacher } = await seedClassroom(db, 'rn-teacher');

    const res = await renameTo(await ctx.tokenFor(teacher.cognitoId), 'Ms. Rivera');

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'forbidden', message: 'only a student sets their own name here' },
    });
    expect(await storedName(teacher.id)).toBeNull();
    expect(await renamesOf(teacher.id)).toEqual([]);
  });
});
