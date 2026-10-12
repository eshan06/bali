import {
  closeQuestion,
  createSavedQuestion,
  type Database,
  endEnrollment,
  endSession,
  enrollments,
  events,
  newUuidV7,
  openQuestion,
  participations,
  protectionOff,
  responses,
  startSession,
  tapIn,
  unlock,
  users,
} from '@bali/db';
import {
  type AnswerResponse,
  type ApiErrorBody,
  type Presentation,
  SILENCE_THRESHOLD_MS,
} from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * A live lesson, the student's side (Phase 7, L4; ARCHITECTURE, "Live lesson", decisions 2 and
 * 4–6): what a phone and the student web poll, and an answer. Who else is refused is the
 * authorization matrix's too; the engine's own rules and races are packages/db's (L1, L2).
 */

let db: Database;
let closeDb: () => Promise<void>;
let ctx: AuthedApp;
/** The server's clock: 09:10 in a 09:00–09:25 lesson unless a test moves it. */
let now: Date;

/** 09:mm on the lesson's day. */
const at = (minute: number) => new Date(`2026-01-01T09:${String(minute).padStart(2, '0')}:00Z`);

beforeEach(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  now = at(10);
  ctx = await makeAuthedApp(db, () => now);
});

afterEach(async () => {
  await ctx.close();
  await closeDb();
});

/** A 09:00–09:25 lesson, its student enrolled and not tapped in, and that student's token. */
async function lesson(tag: string) {
  const c = await seedClassroom(db, tag);
  const { session } = await startSession(db, {
    classId: c.klass.id,
    startedAt: at(0),
    endsAt: at(25),
  });
  return { ...c, session, phone: await ctx.tokenFor(c.student.cognitoId) };
}
type Lesson = Awaited<ReturnType<typeof lesson>>;

/** Another student in the lesson's class: their id and token. */
async function classmate(l: Lesson, name: string) {
  const [student] = await db
    .insert(users)
    .values({ cognitoId: `${l.klass.id}-${name}`, role: 'student', schoolId: l.school.id })
    .returning();
  const [enrollment] = await db
    .insert(enrollments)
    .values({ classId: l.klass.id, studentId: student!.id })
    .returning();
  return {
    id: student!.id,
    enrollmentId: enrollment!.id,
    phone: await ctx.tokenFor(student!.cognitoId),
  };
}

/** "Which?" with a, b and c, b correct, asked by the class's teacher at the clock's time. */
async function ask(l: Lesson, prompt = 'Which?') {
  const { question } = await openQuestion(db, {
    sessionId: l.session.id,
    teacherId: l.teacher.id,
    eventId: newUuidV7(),
    prompt,
    options: ['a', 'b', 'c'],
    correctOption: 1,
    now,
  });
  return question;
}

const close = (questionId: string, reveal = false) =>
  closeQuestion(db, { questionId, eventId: newUuidV7(), reveal, now });

const presentation = (token: string, sessionId: string, ifNoneMatch?: string) =>
  ctx.app.inject({
    method: 'GET',
    url: `/v1/sessions/${sessionId}/presentation`,
    headers: {
      authorization: `Bearer ${token}`,
      ...(ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch }),
    },
  });

async function shown(token: string, sessionId: string) {
  const res = await presentation(token, sessionId);
  expect(res.statusCode).toBe(200);
  return res.json<Presentation>();
}

const answer = (token: string, questionId: string, payload: object) =>
  authedInject(ctx.app, token, {
    method: 'POST',
    url: `/v1/questions/${questionId}/answers`,
    payload,
  });

/** An answer's body: `option`, under a fresh id. */
const picking = (option: unknown, over: Record<string, unknown> = {}) => ({
  eventId: newUuidV7(),
  option,
  ...over,
});

const answered = (res: { json: () => unknown }) => res.json() as AnswerResponse;
const reasonOf = (res: { json: () => unknown }) => (res.json() as ApiErrorBody).error.reason;
const responsesTo = (questionId: string) =>
  db.select().from(responses).where(eq(responses.questionId, questionId));

/** The lesson's student taps in at 09:02. */
const tappedIn = (l: Lesson) =>
  tapIn(db, {
    sessionId: l.session.id,
    studentId: l.student.id,
    eventId: newUuidV7(),
    deviceTime: at(2),
    now: at(2),
  });

/**
 * The server last heard from the student's phone at `when` (null: never since its tap). Staged:
 * a check-in stamps the real clock, which runs long after this lesson's, so it reads as just heard.
 */
const lastHeard = (l: Lesson, when: Date | null) =>
  db
    .update(participations)
    .set({ lastSeenAt: when })
    .where(
      and(eq(participations.sessionId, l.session.id), eq(participations.studentId, l.student.id)),
    );

const checkIn = (l: Lesson) =>
  authedInject(ctx.app, l.phone, {
    method: 'POST',
    url: `/v1/sessions/${l.session.id}/checkin`,
    payload: { deviceTime: now.toISOString() },
  });

describe('GET /v1/sessions/:id/presentation', () => {
  it('shows no question while none was asked', async () => {
    const l = await lesson('show-none');
    expect(await shown(l.phone, l.session.id)).toEqual({
      running: true,
      question: null,
      slide: null,
      phone: null,
    });
  });

  it('shows the open question, its correct option hidden, and no one’s counts', async () => {
    const l = await lesson('show-open');
    const question = await ask(l);

    expect(await shown(l.phone, l.session.id)).toEqual({
      running: true,
      question: {
        id: question.id,
        prompt: 'Which?',
        options: ['a', 'b', 'c'],
        open: true,
        correctOption: null,
        answer: null,
      },
      slide: null,
      phone: null,
    });
  });

  it('carries each student’s own answer and its eventId, never another’s', async () => {
    const l = await lesson('show-own');
    const ana = await classmate(l, 'ana');
    const question = await ask(l);
    const mine = picking(1);
    const hers = picking(2);
    await answer(l.phone, question.id, mine);
    await answer(ana.phone, question.id, hers);

    expect((await shown(l.phone, l.session.id)).question?.answer).toEqual({
      option: 1,
      eventId: mine.eventId,
    });
    expect((await shown(ana.phone, l.session.id)).question?.answer).toEqual({
      option: 2,
      eventId: hers.eventId,
    });
  });

  it('keeps the last closed question until another opens, its correct option once revealed', async () => {
    const l = await lesson('show-closed');
    const first = await ask(l, 'First?');
    await close(first.id);
    expect((await shown(l.phone, l.session.id)).question).toMatchObject({
      id: first.id,
      open: false,
      correctOption: null,
    });

    now = at(12);
    const second = await ask(l, 'Second?');
    expect((await shown(l.phone, l.session.id)).question).toMatchObject({
      id: second.id,
      open: true,
    });
    now = at(14);
    await close(second.id, true);
    expect((await shown(l.phone, l.session.id)).question).toMatchObject({
      id: second.id,
      open: false,
      correctOption: 1,
    });
  });

  it('shows the open question, else the one closed last, never simply the one opened last', async () => {
    const l = await lesson('show-order');
    // Two opens racing: each reads the clock before the session's lock, so the later by the lock can
    // carry the earlier time, and it closes the other (DECISIONS, 2026-10-11, L4a). Staged in that
    // order, the question opened last by the clock is the one closed first.
    now = at(12);
    const beaten = await ask(l, 'Beaten?');
    now = at(11);
    const last = await ask(l, 'Last?');
    expect(beaten.openedAt.getTime()).toBeGreaterThan(last.openedAt.getTime());
    expect((await shown(l.phone, l.session.id)).question).toMatchObject({
      id: last.id,
      open: true,
    });

    now = at(13);
    await close(last.id);
    expect((await shown(l.phone, l.session.id)).question).toMatchObject({
      id: last.id,
      open: false,
    });
  });

  it('says the session is over at the bell, the sweep or not, and shows nothing then', async () => {
    const l = await lesson('show-bell');
    await ask(l);
    // Tapped in, so the phone too is shown no more, though the sweep has not ended its row.
    await tappedIn(l);
    const over = { running: false, question: null, slide: null, phone: null };
    now = at(25);
    expect(await shown(l.phone, l.session.id)).toEqual(over);

    now = at(10);
    await endSession(db, { sessionId: l.session.id, at: at(10), reason: 'ended' });
    expect(await shown(l.phone, l.session.id)).toEqual(over);
  });

  it('answers 304 while nothing of the caller’s changed, a classmate’s answer included', async () => {
    const l = await lesson('show-etag');
    const ana = await classmate(l, 'ana');
    const question = await ask(l);
    const first = await presentation(l.phone, l.session.id);
    const etag = String(first.headers.etag);
    // Strong, and the hash of the body as sent.
    expect(etag).toBe(`"${createHash('sha256').update(first.body).digest('base64url')}"`);

    const unchanged = await presentation(l.phone, l.session.id, etag);
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe('');
    // Totals only: another's answer moves nothing of this body.
    await answer(ana.phone, question.id, picking(0));
    expect((await presentation(l.phone, l.session.id, etag)).statusCode).toBe(304);

    // Their own answer, the close and the bell each do.
    const tags = new Set([etag]);
    for (const change of [
      () => answer(l.phone, question.id, picking(1)),
      () => close(question.id, true),
      () => (now = at(25)),
    ]) {
      await change();
      const res = await presentation(l.phone, l.session.id, etag);
      expect(res.statusCode).toBe(200);
      tags.add(String(res.headers.etag));
    }
    expect(tags.size).toBe(4);
  });

  it('refuses an unknown session, and anyone not enrolled in its class now, creating no one', async () => {
    const l = await lesson('show-who');
    const elsewhere = await seedClassroom(db, 'show-who-elsewhere');
    const removed = await classmate(l, 'removed');
    await endEnrollment(db, {
      enrollmentId: removed.enrollmentId,
      reason: 'removed_from_class',
      at: at(5),
    });

    const unknown = await presentation(l.phone, randomUUID());
    expect(unknown.statusCode).toBe(404);
    expect(reasonOf(unknown)).toBe('session_not_found');
    for (const token of [
      await ctx.tokenFor(elsewhere.student.cognitoId),
      await ctx.tokenFor(l.teacher.cognitoId),
      removed.phone,
      await ctx.tokenFor('student-show-who-new'),
    ]) {
      const res = await presentation(token, l.session.id);
      expect(res.statusCode).toBe(403);
      expect(res.headers.etag).toBeUndefined();
    }
    expect(
      await db.select().from(users).where(eq(users.cognitoId, 'student-show-who-new')),
    ).toEqual([]);
  });
});

describe('the caller’s own phone in the presentation (W1)', () => {
  const phoneOf = async (token: string, sessionId: string) => (await shown(token, sessionId)).phone;
  /** `ms` past 09:09. */
  const after909 = (ms: number) => new Date(at(9).getTime() + ms);

  it('shows it in each state the grid shows, and none before the student taps in', async () => {
    const l = await lesson('phone-states');
    const own = { sessionId: l.session.id, studentId: l.student.id };
    expect(await phoneOf(l.phone, l.session.id)).toBeNull();

    await tappedIn(l);
    expect(await phoneOf(l.phone, l.session.id)).toEqual({ state: 'focused', lastSeenAt: null });
    await unlock(db, { ...own, eventId: newUuidV7(), deviceTime: at(3) });
    expect(await phoneOf(l.phone, l.session.id)).toEqual({ state: 'unlocked', lastSeenAt: null });
    await protectionOff(db, { ...own, eventId: newUuidV7(), deviceTime: at(4) });
    // Only a focused phone reads silent, as on the grid: protection off stands, however quiet.
    await lastHeard(l, at(0));
    expect(await phoneOf(l.phone, l.session.id)).toEqual({
      state: 'protection_off',
      lastSeenAt: null,
    });
  });

  it('reads a focused phone silent past 90 s without a check-in, by the server’s clock', async () => {
    const l = await lesson('phone-silent');
    await tappedIn(l);
    await lastHeard(l, at(9));
    now = after909(SILENCE_THRESHOLD_MS);
    expect(await phoneOf(l.phone, l.session.id)).toEqual({ state: 'focused', lastSeenAt: null });
    now = after909(SILENCE_THRESHOLD_MS + 1);
    expect(await phoneOf(l.phone, l.session.id)).toEqual({
      state: 'silent',
      lastSeenAt: at(9).toISOString(),
    });

    // Never heard since its tap: silent from the tap, as the grid counts it.
    await lastHeard(l, null);
    now = new Date(at(2).getTime() + SILENCE_THRESHOLD_MS + 1);
    expect(await phoneOf(l.phone, l.session.id)).toEqual({
      state: 'silent',
      lastSeenAt: at(2).toISOString(),
    });
  });

  it('shows none once the student has gone to another class, and never another student’s', async () => {
    const l = await lesson('phone-whose');
    const ana = await classmate(l, 'ana');
    const hers = { sessionId: l.session.id, studentId: ana.id };
    await tappedIn(l);
    expect(await phoneOf(ana.phone, l.session.id)).toBeNull();
    await tapIn(db, { ...hers, eventId: newUuidV7(), deviceTime: at(3), now: at(3) });
    await unlock(db, { ...hers, eventId: newUuidV7(), deviceTime: at(4) });
    expect(await phoneOf(l.phone, l.session.id)).toMatchObject({ state: 'focused' });
    expect(await phoneOf(ana.phone, l.session.id)).toMatchObject({ state: 'unlocked' });

    // The student taps into another class's lesson: this one shows their phone no more.
    const other = await seedClassroom(db, 'phone-whose-other');
    await db.insert(enrollments).values({ classId: other.klass.id, studentId: l.student.id });
    const { session: elsewhere } = await startSession(db, {
      classId: other.klass.id,
      startedAt: at(0),
      endsAt: at(25),
    });
    const switched = await tapIn(db, {
      sessionId: elsewhere.id,
      studentId: l.student.id,
      eventId: newUuidV7(),
      deviceTime: at(5),
      now: at(5),
    });
    expect(switched.outcome).toBe('switched');
    expect(await phoneOf(l.phone, l.session.id)).toBeNull();
    expect(await phoneOf(l.phone, elsewhere.id)).toMatchObject({ state: 'focused' });
  });

  it('answers 304 across a check-in while nothing changes, and anew when the clock makes it silent', async () => {
    const l = await lesson('phone-etag');
    await tappedIn(l);
    await lastHeard(l, at(9));
    const focused = String((await presentation(l.phone, l.session.id)).headers.etag);

    // A check-in moves the row's time, never the body.
    expect((await checkIn(l)).statusCode).toBe(200);
    const [row] = await db
      .select()
      .from(participations)
      .where(eq(participations.studentId, l.student.id));
    expect(row!.lastSeenAt).not.toEqual(at(9));
    expect((await presentation(l.phone, l.session.id, focused)).statusCode).toBe(304);

    // The clock alone makes it silent: a new body, unchanged then while it stays silent.
    await lastHeard(l, at(9));
    now = after909(SILENCE_THRESHOLD_MS + 1);
    const silent = await presentation(l.phone, l.session.id, focused);
    expect(silent.statusCode).toBe(200);
    expect(silent.json<Presentation>().phone).toMatchObject({ state: 'silent' });
    const quiet = String(silent.headers.etag);
    now = at(12);
    expect((await presentation(l.phone, l.session.id, quiet)).statusCode).toBe(304);

    // Its next check-in brings it back.
    await checkIn(l);
    const back = await presentation(l.phone, l.session.id, quiet);
    expect(back.statusCode).toBe(200);
    expect(back.json<Presentation>().phone).toEqual({ state: 'focused', lastSeenAt: null });
  });
});

describe('POST /v1/questions/:id/answers', () => {
  it('records the answer, writing no event, answered with it', async () => {
    const l = await lesson('answer');
    const question = await ask(l);
    const body = picking(1);

    const res = await answer(l.phone, question.id, body);

    expect(res.statusCode).toBe(200);
    expect(answered(res)).toEqual({
      outcome: 'answered',
      answer: { option: 1, eventId: body.eventId },
    });
    expect(await responsesTo(question.id)).toMatchObject([
      { studentId: l.student.id, option: 1, eventId: body.eventId, answeredAt: now },
    ]);
    expect(await db.select().from(events).where(eq(events.eventId, body.eventId))).toEqual([]);
  });

  it('takes an answer from a student tapped in and unlocked as from one never tapped in', async () => {
    const l = await lesson('answer-unlocked');
    const own = { sessionId: l.session.id, studentId: l.student.id };
    await tapIn(db, { ...own, eventId: newUuidV7(), deviceTime: at(2), now: at(2) });
    expect((await unlock(db, { ...own, eventId: newUuidV7(), deviceTime: at(3) })).state).toBe(
      'unlocked',
    );
    const question = await ask(l);

    const res = await answer(l.phone, question.id, picking(0));

    expect(res.statusCode).toBe(200);
    expect(answered(res).outcome).toBe('answered');
  });

  it('replaces it with a later answer, never with an older one: that answers the answer now', async () => {
    const l = await lesson('answer-order');
    const question = await ask(l);
    // Minted in this order, as one phone's two taps.
    const [older, newer] = [picking(0), picking(2)];

    expect(answered(await answer(l.phone, question.id, newer)).outcome).toBe('answered');
    const late = await answer(l.phone, question.id, older);

    expect(late.statusCode).toBe(200);
    expect(answered(late)).toEqual({
      outcome: 'replay',
      answer: { option: 2, eventId: newer.eventId },
    });
    expect(await responsesTo(question.id)).toMatchObject([{ option: 2, eventId: newer.eventId }]);
  });

  it('answers its retry with the answer now, past the close too', async () => {
    const l = await lesson('answer-replay');
    const question = await ask(l);
    const first = picking(1);
    await answer(l.phone, question.id, first);
    const second = picking(2);
    await answer(l.phone, question.id, second);
    const now2 = { outcome: 'replay', answer: { option: 2, eventId: second.eventId } };

    // The first's id went with it: its retry is older than the answer now.
    expect(answered(await answer(l.phone, question.id, first))).toEqual(now2);
    await close(question.id);
    const retry = await answer(l.phone, question.id, second);
    expect(retry.statusCode).toBe(200);
    expect(answered(retry)).toEqual(now2);
  });

  it('refuses an option the question lacks, recording nothing', async () => {
    const l = await lesson('answer-option');
    const question = await ask(l);

    for (const option of [3, -1]) {
      const res = await answer(l.phone, question.id, picking(option));
      expect(res.statusCode).toBe(400);
      expect(reasonOf(res)).toBe('invalid_option');
    }
    expect(await responsesTo(question.id)).toEqual([]);
  });

  it.each([
    ['an option that is no index', { option: 1.5 }],
    ['an option that is text', { option: '1' }],
    ['no option', { option: undefined }],
    ['an eventId that is no UUIDv7', { eventId: randomUUID() }],
    ['no eventId', { eventId: undefined }],
  ])('refuses %s as a malformed request, recording nothing', async (_, over) => {
    const l = await lesson(`answer-bad-${randomUUID()}`);
    const question = await ask(l);

    const res = await answer(l.phone, question.id, picking(1, over));

    expect(res.statusCode).toBe(400);
    expect(reasonOf(res)).toBe('invalid_request');
    expect(await responsesTo(question.id)).toEqual([]);
  });

  it('refuses an answer past the close, the bell and the session’s end, recording nothing', async () => {
    const l = await lesson('answer-closed');
    const closed = await ask(l);
    await close(closed.id);
    const pastBell = await ask(l);

    const refused = [await answer(l.phone, closed.id, picking(1))];
    now = at(25);
    refused.push(await answer(l.phone, pastBell.id, picking(1)));
    now = at(10);
    await endSession(db, { sessionId: l.session.id, at: at(10), reason: 'ended' });
    refused.push(await answer(l.phone, pastBell.id, picking(1)));

    for (const res of refused) {
      expect(res.statusCode).toBe(409);
      expect(reasonOf(res)).toBe('question_closed');
    }
    expect(await db.select().from(responses)).toEqual([]);
  });

  it('refuses an unknown question, and anyone not enrolled in its class now, creating no one', async () => {
    const l = await lesson('answer-who');
    const elsewhere = await seedClassroom(db, 'answer-who-elsewhere');
    const removed = await classmate(l, 'removed');
    const question = await ask(l);
    await endEnrollment(db, {
      enrollmentId: removed.enrollmentId,
      reason: 'removed_from_class',
      at: at(10),
    });

    const unknown = await answer(l.phone, randomUUID(), picking(1));
    expect(unknown.statusCode).toBe(404);
    expect(reasonOf(unknown)).toBe('question_not_found');
    for (const token of [
      await ctx.tokenFor(elsewhere.student.cognitoId),
      await ctx.tokenFor(l.teacher.cognitoId),
      removed.phone,
      await ctx.tokenFor('student-answer-who-new'),
    ]) {
      expect((await answer(token, question.id, picking(1))).statusCode).toBe(403);
    }
    expect(await responsesTo(question.id)).toEqual([]);
    expect(
      await db.select().from(users).where(eq(users.cognitoId, 'student-answer-who-new')),
    ).toEqual([]);
  });

  it('refuses an eventId spent elsewhere, its own answer to another question included', async () => {
    const l = await lesson('answer-spent');
    const ana = await classmate(l, 'ana');
    const earlier = await ask(l, 'Earlier?');
    const ownEarlier = picking(0);
    await answer(l.phone, earlier.id, ownEarlier);
    const question = await ask(l);
    const hers = picking(2);
    await answer(ana.phone, question.id, hers);
    const tapId = newUuidV7();
    await tapIn(db, {
      sessionId: l.session.id,
      studentId: l.student.id,
      eventId: tapId,
      deviceTime: at(2),
      now: at(2),
    });
    const draft = await createSavedQuestion(db, {
      teacherId: l.teacher.id,
      eventId: newUuidV7(),
      prompt: 'Later?',
      options: ['a', 'b'],
    });
    if (draft.outcome !== 'created') throw new Error(draft.outcome);

    for (const eventId of [ownEarlier.eventId, hers.eventId, tapId, draft.savedQuestion.eventId]) {
      const res = await answer(l.phone, question.id, picking(1, { eventId }));
      expect(res.statusCode).toBe(409);
      expect(reasonOf(res)).toBe('event_id_conflict');
    }
    expect(
      await db
        .select()
        .from(responses)
        .where(and(eq(responses.questionId, question.id), eq(responses.studentId, l.student.id))),
    ).toEqual([]);
  });

  it('answers one answer’s two deliveries at once with it, never a 500', async () => {
    const l = await lesson('answer-twice');
    const question = await ask(l);
    const body = picking(1);

    const both = await Promise.all([
      answer(l.phone, question.id, body),
      answer(l.phone, question.id, body),
    ]);

    expect(both.map((res) => res.statusCode)).toEqual([200, 200]);
    expect(both.map((res) => answered(res).outcome).sort()).toEqual(['answered', 'replay']);
    expect(await responsesTo(question.id)).toHaveLength(1);
  });

  it('refuses an answer reaching an account deleted on its way, recording nothing', async () => {
    const l = await lesson('answer-deleted');
    const question = await ask(l);
    // The deletion committing after the route found the account: its row marked, as the engine
    // then reads it, while the sign-in and the enrollment the route read stand.
    await db
      .update(users)
      .set({ removedAt: at(9) })
      .where(eq(users.id, l.student.id));

    const res = await answer(l.phone, question.id, picking(1));

    expect(res.statusCode).toBe(409);
    expect(reasonOf(res)).toBe('account_deleted');
    expect(await responsesTo(question.id)).toEqual([]);
  });
});
