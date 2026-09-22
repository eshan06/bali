import { type Database, findUserByCognitoId } from '@bali/db';
import type { MeResponse } from '@bali/shared';
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
    // Cognito puts profile attributes in the ID token only. Every client here
    // sends an ACCESS token, which carries the username and no `name` — so
    // reading `name` alone left display_name NULL on every real request and the
    // live grid rendered a UUID prefix.
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

    const federated = await ctx.issuer.sign({
      sub: 'federated-username',
      extraClaims: { username: 'Google_110293847566123450987' },
    });
    expect((await me(federated)).body.user.displayName).toBeNull();
  });

  it('clamps an over-long name and strips control characters', async () => {
    // `name` and `preferred_username` are attributes the student can set on
    // themselves, and the value lands in a teacher's grid.
    const token = await ctx.issuer.sign({
      sub: 'shouty',
      extraClaims: { name: `Ana\u0007\u200b ${'x'.repeat(200)}` },
    });

    const { body } = await me(token);

    expect(body.user.displayName).toHaveLength(64);
    expect(body.user.displayName).toMatch(/^Ana x+$/);
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
    ]) {
      const token = await ctx.issuer.sign({ sub, extraClaims: { username } });
      expect((await me(token)).body.user.displayName).toBe(username);
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
    const token = await ctx.issuer.sign({
      sub: 'emoji',
      extraClaims: { name: `${'A'.repeat(63)}\u{1F600}` },
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

  it('requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
  });
});
