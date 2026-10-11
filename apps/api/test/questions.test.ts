import {
  answerQuestion,
  createSavedQuestion,
  type Database,
  endEnrollment,
  endSession,
  enrollments,
  events,
  newUuidV7,
  questions,
  savedQuestions,
  startSession,
  tapIn,
  users,
} from '@bali/db';
import type {
  ApiErrorBody,
  QuestionResponse,
  QuestionResults,
  SavedQuestionResponse,
  SavedQuestionsResponse,
  SessionSnapshot,
} from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * A live lesson's questions, the teacher's side (Phase 7, L3; ARCHITECTURE, "Live lesson",
 * decisions 3 and 6): open, close and the boot snapshot's open question, for the class's own
 * teacher; and a teacher's saved questions (L3b, decision 12). Who else is refused is the
 * authorization matrix's too; the engine's own rules and races are packages/db's (L1, L3b1).
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

/** A 09:00–09:25 lesson, its student enrolled and not tapped in, and its teacher's token. */
async function lesson(tag: string) {
  const c = await seedClassroom(db, tag);
  const { session } = await startSession(db, {
    classId: c.klass.id,
    startedAt: at(0),
    endsAt: at(25),
  });
  return { ...c, session, token: await ctx.tokenFor(c.teacher.cognitoId) };
}

/** An open's body: "Which?" with a, b and c, b correct, unless said. */
const asking = (over: Record<string, unknown> = {}) => ({
  eventId: newUuidV7(),
  prompt: 'Which?',
  options: ['a', 'b', 'c'],
  correctOption: 1,
  ...over,
});

const ask = (token: string, sessionId: string, payload: object) =>
  authedInject(ctx.app, token, {
    method: 'POST',
    url: `/v1/sessions/${sessionId}/questions`,
    payload,
  });

const close = (token: string, questionId: string, payload: object = { eventId: newUuidV7() }) =>
  authedInject(ctx.app, token, {
    method: 'POST',
    url: `/v1/questions/${questionId}/close`,
    payload,
  });

const snapshot = async (token: string, sessionId: string) =>
  (
    await authedInject(ctx.app, token, { method: 'GET', url: `/v1/sessions/${sessionId}` })
  ).json<SessionSnapshot>();

/** Open "Which?" through the route, as the class's teacher: the answer's question. */
async function asked(token: string, sessionId: string, over: Record<string, unknown> = {}) {
  const res = await ask(token, sessionId, asking(over));
  expect(res.statusCode).toBe(200);
  return res.json<QuestionResponse>().question;
}

const questionsOf = (sessionId: string) =>
  db.select().from(questions).where(eq(questions.sessionId, sessionId));

const eventsOf = (sessionId: string, type: 'question_opened' | 'question_closed') =>
  db
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.type, type)));

const reasonOf = (res: { json: () => unknown }) => (res.json() as ApiErrorBody).error.reason;

describe('POST /v1/sessions/:id/questions', () => {
  it('opens a question, answered with it open and its correct option', async () => {
    const { session, token } = await lesson('open');
    const body = asking();

    const res = await ask(token, session.id, body);

    expect(res.statusCode).toBe(200);
    const [row] = await questionsOf(session.id);
    expect(row).toMatchObject({ eventId: body.eventId, openedAt: now, closedAt: null });
    expect(res.json<QuestionResponse>()).toEqual({
      outcome: 'opened',
      question: {
        id: row!.id,
        prompt: 'Which?',
        options: ['a', 'b', 'c'],
        correctOption: 1,
        revealed: false,
        open: true,
      },
    });
    expect(await eventsOf(session.id, 'question_opened')).toHaveLength(1);
  });

  it('stores what it checked: trimmed, the prompt keeping its line breaks', async () => {
    const { session, token } = await lesson('open-text');

    const question = await asked(token, session.id, {
      prompt: '  Read the passage.\nWhich is the main idea?\n',
      options: [' a ', 'b'],
      correctOption: undefined,
    });

    expect(question).toMatchObject({
      prompt: 'Read the passage.\nWhich is the main idea?',
      options: ['a', 'b'],
      correctOption: null,
    });
    const [row] = await questionsOf(session.id);
    expect(row).toMatchObject({
      prompt: question.prompt,
      options: ['a', 'b'],
      correctOption: null,
    });
  });

  it('counts characters, not code units: 500 emoji are a prompt, 501 are too long', async () => {
    const { session, token } = await lesson('open-emoji');
    expect((await ask(token, session.id, asking({ prompt: '🙂'.repeat(500) }))).statusCode).toBe(
      200,
    );
    expect((await ask(token, session.id, asking({ prompt: '🙂'.repeat(501) }))).statusCode).toBe(
      400,
    );
  });

  it('answers its retry with the question it opened, recording nothing more', async () => {
    const { session, token } = await lesson('open-replay');
    const body = asking();
    const first = (await ask(token, session.id, body)).json<QuestionResponse>();

    const retry = await ask(token, session.id, body);

    expect(retry.statusCode).toBe(200);
    expect(retry.json<QuestionResponse>()).toEqual({ ...first, outcome: 'replay' });
    expect(await questionsOf(session.id)).toHaveLength(1);
    expect(await eventsOf(session.id, 'question_opened')).toHaveLength(1);
  });

  it('answers a retry after the bell with its question closed', async () => {
    const { session, token } = await lesson('open-replay-bell');
    const body = asking();
    await ask(token, session.id, body);
    now = at(26);

    const retry = await ask(token, session.id, body);

    expect(retry.statusCode).toBe(200);
    expect(retry.json<QuestionResponse>()).toMatchObject({
      outcome: 'replay',
      question: { open: false },
    });
  });

  it('closes the question open before it, as a newer question', async () => {
    const { session, token } = await lesson('open-newer');
    const first = await asked(token, session.id);
    now = at(12);

    const second = await asked(token, session.id);

    const rows = await questionsOf(session.id);
    expect(rows.find((q) => q.id === first.id)?.closedAt).toEqual(at(12));
    expect(rows.find((q) => q.id === second.id)?.closedAt).toBeNull();
    const [closed] = await eventsOf(session.id, 'question_closed');
    expect(closed?.payload).toMatchObject({ question_id: first.id, closed_by: 'newer_question' });
  });

  it('refuses a session not running by the server’s clock: past its bell, and ended', async () => {
    const { session, token } = await lesson('open-over');
    now = at(25);
    const pastBell = await ask(token, session.id, asking());
    expect(pastBell.statusCode).toBe(409);
    expect(reasonOf(pastBell)).toBe('session_not_running');

    now = at(10);
    await endSession(db, { sessionId: session.id, at: at(9), reason: 'ended' });
    const ended = await ask(token, session.id, asking());
    expect(ended.statusCode).toBe(409);
    expect(reasonOf(ended)).toBe('session_not_running');
    expect(await questionsOf(session.id)).toEqual([]);
  });

  it('refuses an eventId a tap holds, recording nothing', async () => {
    const { session, student, token } = await lesson('open-spent');
    const eventId = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId,
      deviceTime: at(5),
      now: at(5),
    });

    const res = await ask(token, session.id, asking({ eventId }));

    expect(res.statusCode).toBe(409);
    expect(reasonOf(res)).toBe('event_id_conflict');
    expect(await questionsOf(session.id)).toEqual([]);
  });

  it('refuses an unknown session as the other session routes do', async () => {
    const { token } = await lesson('open-unknown');
    const res = await ask(token, randomUUID(), asking());
    expect(res.statusCode).toBe(404);
    expect(reasonOf(res)).toBe('session_not_found');
  });

  it.each([
    ['a blank prompt', { prompt: ' \n ' }],
    ['a prompt of 501 characters', { prompt: 'x'.repeat(501) }],
    ['a prompt that draws nothing', { prompt: '​' }],
    ['a prompt with a bidi override', { prompt: 'Which ‮?' }],
    ['a prompt with a tab', { prompt: 'Which\t?' }],
    ['one option', { options: ['a'], correctOption: 0 }],
    ['seven options', { options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
    ['a blank option', { options: ['a', '  '] }],
    ['an option of 201 characters', { options: ['a', 'x'.repeat(201)] }],
    ['an option with a line break', { options: ['a', 'b\nc'] }],
    ['an option that is not text', { options: ['a', 2] }],
    ['a correct option past the last', { correctOption: 3 }],
    ['a negative correct option', { correctOption: -1 }],
    ['a correct option that is no index', { correctOption: 1.5 }],
    ['an eventId that is no UUIDv7', { eventId: randomUUID() }],
    ['no eventId', { eventId: undefined }],
  ])('refuses %s, recording nothing', async (_, over) => {
    const { session, token } = await lesson(`open-bad-${randomUUID()}`);

    const res = await ask(token, session.id, asking(over));

    expect(res.statusCode).toBe(400);
    expect(await questionsOf(session.id)).toEqual([]);
  });
});

describe('POST /v1/questions/:id/close', () => {
  it('closes it, revealing the correct option when asked', async () => {
    const { session, token } = await lesson('close');
    const question = await asked(token, session.id);
    now = at(14);

    const res = await close(token, question.id, { eventId: newUuidV7(), reveal: true });

    expect(res.statusCode).toBe(200);
    expect(res.json<QuestionResponse>()).toEqual({
      outcome: 'closed',
      question: { ...question, revealed: true, open: false },
    });
    const [row] = await questionsOf(session.id);
    expect(row).toMatchObject({ closedAt: at(14), revealed: true });
    const [closed] = await eventsOf(session.id, 'question_closed');
    expect(closed?.payload).toMatchObject({ revealed: true, closed_by: 'teacher' });
  });

  it('reveals nothing unless asked, nor for a question with no correct option', async () => {
    const { session, token } = await lesson('close-quiet');
    const unasked = await asked(token, session.id);
    expect((await close(token, unasked.id)).json<QuestionResponse>().question.revealed).toBe(false);
    const none = await asked(token, session.id, { correctOption: null });
    const res = await close(token, none.id, { eventId: newUuidV7(), reveal: true });
    expect(res.json<QuestionResponse>().question).toMatchObject({ revealed: false, open: false });
  });

  it('answers its retry, and a close of a question already closed, with it now', async () => {
    const { session, token } = await lesson('close-replay');
    const question = await asked(token, session.id);
    const body = { eventId: newUuidV7(), reveal: true };
    const first = (await close(token, question.id, body)).json<QuestionResponse>();

    const retry = await close(token, question.id, body);
    const again = await close(token, question.id, { eventId: newUuidV7() });

    for (const res of [retry, again]) {
      expect(res.statusCode).toBe(200);
      expect(res.json<QuestionResponse>()).toEqual({ ...first, outcome: 'replay' });
    }
    expect(await eventsOf(session.id, 'question_closed')).toHaveLength(1);
  });

  it('answers a close past the bell, before the sweep, closed, recording nothing', async () => {
    const { session, token } = await lesson('close-bell');
    const question = await asked(token, session.id);
    now = at(26);

    const res = await close(token, question.id, { eventId: newUuidV7(), reveal: true });

    expect(res.statusCode).toBe(200);
    expect(res.json<QuestionResponse>()).toEqual({
      outcome: 'replay',
      question: { ...question, open: false },
    });
    // The sweep closes it at the bell, as the session's end.
    const [row] = await questionsOf(session.id);
    expect(row).toMatchObject({ closedAt: null, revealed: false });
    expect(await eventsOf(session.id, 'question_closed')).toEqual([]);
  });

  it('answers a question its session’s end closed as closed', async () => {
    const { session, token } = await lesson('close-ended');
    const question = await asked(token, session.id);
    await endSession(db, { sessionId: session.id, at: at(12), reason: 'ended' });

    const res = await close(token, question.id);

    expect(res.json<QuestionResponse>()).toMatchObject({
      outcome: 'replay',
      question: { open: false, revealed: false },
    });
  });

  it('refuses an unknown question, a student and another teacher, closing nothing', async () => {
    const { session, student, token } = await lesson('close-who');
    const other = await seedClassroom(db, 'close-who-elsewhere');
    const question = await asked(token, session.id);

    const unknown = await close(token, randomUUID());
    expect(unknown.statusCode).toBe(404);
    expect(reasonOf(unknown)).toBe('question_not_found');
    for (const cognitoId of [student.cognitoId, other.teacher.cognitoId]) {
      const res = await close(await ctx.tokenFor(cognitoId), question.id);
      expect(res.statusCode).toBe(403);
    }
    const [row] = await questionsOf(session.id);
    expect(row?.closedAt).toBeNull();
  });

  it('refuses an eventId a tap or an answer holds, closing nothing', async () => {
    const { session, student, token } = await lesson('close-spent');
    const question = await asked(token, session.id);
    const tapId = newUuidV7();
    const answerId = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: tapId,
      deviceTime: at(5),
      now: at(5),
    });
    await answerQuestion(db, {
      questionId: question.id,
      studentId: student.id,
      eventId: answerId,
      option: 0,
      now: at(11),
    });

    for (const eventId of [tapId, answerId]) {
      const res = await close(token, question.id, { eventId });
      expect(res.statusCode).toBe(409);
      expect(reasonOf(res)).toBe('event_id_conflict');
    }
    const [row] = await questionsOf(session.id);
    expect(row?.closedAt).toBeNull();
  });

  it.each([
    ['an eventId that is no UUIDv7', { eventId: randomUUID() }],
    ['no eventId', {}],
    ['a reveal that is no boolean', { eventId: newUuidV7(), reveal: 'yes' }],
  ])('refuses %s, closing nothing', async (_, payload) => {
    const { session, token } = await lesson(`close-bad-${randomUUID()}`);
    const question = await asked(token, session.id);

    const res = await close(token, question.id, payload);

    expect(res.statusCode).toBe(400);
    const [row] = await questionsOf(session.id);
    expect(row?.closedAt).toBeNull();
  });
});

describe('GET /v1/questions/:id/results', () => {
  const results = (token: string, questionId: string, ifNoneMatch?: string) =>
    ctx.app.inject({
      method: 'GET',
      url: `/v1/questions/${questionId}/results`,
      headers: {
        authorization: `Bearer ${token}`,
        ...(ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch }),
      },
    });
  const resultsOf = async (token: string, questionId: string) =>
    (await results(token, questionId)).json<QuestionResults>();

  /** `n` students more in the lesson's class, each enrolled and not tapped in. */
  async function classmates(c: Awaited<ReturnType<typeof lesson>>, n: number) {
    const added = [];
    for (let i = 0; i < n; i += 1) {
      const [student] = await db
        .insert(users)
        .values({ cognitoId: `${c.klass.id}-${i}`, role: 'student', schoolId: c.school.id })
        .returning();
      const [enrollment] = await db
        .insert(enrollments)
        .values({ classId: c.klass.id, studentId: student!.id })
        .returning();
      added.push({ id: student!.id, enrollmentId: enrollment!.id });
    }
    return added;
  }

  /** `studentId`'s answer at 09:11, as the engine records it (the answer route is L4's). */
  const answer = (questionId: string, studentId: string, option: number) =>
    answerQuestion(db, { questionId, studentId, eventId: newUuidV7(), option, now: at(11) });

  it('shows the counts per option only from 3 answers: before, N of M alone', async () => {
    const c = await lesson('results-guard');
    const [ana, ben, cy] = await classmates(c, 3);
    const question = await asked(c.token, c.session.id);
    expect(await resultsOf(c.token, question.id)).toEqual({
      answered: 0,
      eligible: 4,
      open: true,
      correctOption: 1,
      revealed: false,
      counts: null,
    });

    await answer(question.id, ana!.id, 0);
    await answer(question.id, ben!.id, 1);
    expect(await resultsOf(c.token, question.id)).toMatchObject({ answered: 2, counts: null });

    await answer(question.id, cy!.id, 1);
    expect(await resultsOf(c.token, question.id)).toEqual({
      answered: 3,
      eligible: 4,
      open: true,
      correctOption: 1,
      revealed: false,
      counts: [1, 2, 0],
    });
  });

  it('keeps counting an answer whose student was removed mid-session, against everyone who could have answered', async () => {
    const c = await lesson('results-removed');
    const [tappedAnswered, answeredOnly, tappedOnly, neither, stays] = await classmates(c, 5);
    for (const student of [tappedAnswered!, tappedOnly!]) {
      await tapIn(db, {
        sessionId: c.session.id,
        studentId: student.id,
        eventId: newUuidV7(),
        deviceTime: at(2),
        now: at(2),
      });
    }
    const question = await asked(c.token, c.session.id);
    await answer(question.id, tappedAnswered!.id, 0);
    await answer(question.id, answeredOnly!.id, 2);
    await answer(question.id, stays!.id, 2);

    for (const student of [tappedAnswered!, answeredOnly!, tappedOnly!, neither!]) {
      await endEnrollment(db, {
        enrollmentId: student.enrollmentId,
        reason: 'removed_from_class',
        at: at(12),
      });
    }

    // N: the three who answered. M: the class now (the seeded student, `stays`), the session's
    // participants, removed since (`tappedAnswered`, `tappedOnly`) and N's (`answeredOnly`): five,
    // never below N. `neither` is in none of them.
    expect(await resultsOf(c.token, question.id)).toMatchObject({
      answered: 3,
      eligible: 5,
      counts: [1, 0, 2],
    });
  });

  it('says whether it is open by the server’s clock, and whether its close revealed the answer', async () => {
    const c = await lesson('results-open');
    const revealed = await asked(c.token, c.session.id);
    await close(c.token, revealed.id, { eventId: newUuidV7(), reveal: true });
    expect(await resultsOf(c.token, revealed.id)).toMatchObject({
      open: false,
      correctOption: 1,
      revealed: true,
    });

    const pastBell = await asked(c.token, c.session.id);
    now = at(26);
    expect(await resultsOf(c.token, pastBell.id)).toMatchObject({ open: false, revealed: false });
  });

  it('answers 304 while nothing changed, then 200 and a new ETag once an answer lands or the bell rings', async () => {
    const c = await lesson('results-etag');
    const [ana] = await classmates(c, 1);
    const question = await asked(c.token, c.session.id);
    const first = await results(c.token, question.id);
    const etag = String(first.headers.etag);
    // Strong, and the hash of the body as sent.
    expect(etag).toBe(`"${createHash('sha256').update(first.body).digest('base64url')}"`);

    const unchanged = await results(c.token, question.id, etag);
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe('');
    expect(unchanged.headers.etag).toBe(etag);
    // Held in a list, or weak: compared as RFC 9110 says.
    expect((await results(c.token, question.id, `"other", W/${etag}`)).statusCode).toBe(304);

    await answer(question.id, ana!.id, 0);
    const answered = await results(c.token, question.id, etag);
    expect(answered.statusCode).toBe(200);
    expect(answered.json<QuestionResults>().answered).toBe(1);
    const next = String(answered.headers.etag);
    expect(next).not.toBe(etag);

    // Nothing written, but the body says closed past the bell, so its tag is another.
    now = at(26);
    const pastBell = await results(c.token, question.id, next);
    expect(pastBell.statusCode).toBe(200);
    expect(pastBell.json<QuestionResults>().open).toBe(false);
  });

  it('refuses an unknown question, a student and another teacher', async () => {
    const c = await lesson('results-who');
    const other = await seedClassroom(db, 'results-who-elsewhere');
    const question = await asked(c.token, c.session.id);

    const unknown = await results(c.token, randomUUID());
    expect(unknown.statusCode).toBe(404);
    expect(reasonOf(unknown)).toBe('question_not_found');
    for (const cognitoId of [c.student.cognitoId, other.teacher.cognitoId]) {
      const res = await results(await ctx.tokenFor(cognitoId), question.id);
      expect(res.statusCode).toBe(403);
      expect(res.headers.etag).toBeUndefined();
    }
  });
});

describe('GET /v1/sessions/:id: the open question', () => {
  it('carries the open question, and none before or after', async () => {
    const { session, token } = await lesson('snap-question');
    expect((await snapshot(token, session.id)).question).toBeNull();

    const question = await asked(token, session.id);
    expect((await snapshot(token, session.id)).question).toEqual(question);

    await close(token, question.id);
    expect((await snapshot(token, session.id)).question).toBeNull();
  });

  it('carries none past the bell, though the sweep has not closed it yet', async () => {
    const { session, token } = await lesson('snap-bell');
    await asked(token, session.id);
    now = at(25);

    expect((await snapshot(token, session.id)).question).toBeNull();
    const [row] = await questionsOf(session.id);
    expect(row?.closedAt).toBeNull();
  });
});

describe('a teacher’s saved questions (L3b)', () => {
  const list = async (token: string) =>
    (
      await authedInject(ctx.app, token, { method: 'GET', url: '/v1/saved-questions' })
    ).json<SavedQuestionsResponse>().savedQuestions;
  const create = (token: string, payload: object) =>
    authedInject(ctx.app, token, { method: 'POST', url: '/v1/saved-questions', payload });
  const replace = (token: string, id: string, payload: object) =>
    authedInject(ctx.app, token, { method: 'PUT', url: `/v1/saved-questions/${id}`, payload });
  const remove = (token: string, id: string, payload: object = { eventId: newUuidV7() }) =>
    authedInject(ctx.app, token, { method: 'DELETE', url: `/v1/saved-questions/${id}`, payload });
  const answered = (res: { json: () => unknown }) => res.json() as SavedQuestionResponse;

  /** Write a draft through the route, its body an open's (`asking`): the answer's draft. */
  async function drafted(token: string, over: Record<string, unknown> = {}) {
    const res = await create(token, asking(over));
    expect(res.statusCode).toBe(200);
    return answered(res).savedQuestion;
  }

  const draftsOf = (teacherId: string) =>
    db.select().from(savedQuestions).where(eq(savedQuestions.teacherId, teacherId));

  it('writes one as checked, answered with it, and answers its retry with the draft now', async () => {
    const { teacher, token } = await lesson('draft-create');
    const body = asking({ prompt: '  Which?\nPick one. ', options: [' a ', 'b'] });

    const res = await create(token, body);

    expect(res.statusCode).toBe(200);
    const [row] = await draftsOf(teacher.id);
    expect(answered(res)).toEqual({
      outcome: 'created',
      savedQuestion: {
        id: row!.id,
        prompt: 'Which?\nPick one.',
        options: ['a', 'b'],
        correctOption: 1,
        eventId: body.eventId,
        createdAt: at(10).toISOString(),
        updatedAt: at(10).toISOString(),
      },
    });
    now = at(12);
    expect(answered(await create(token, body))).toEqual({ ...answered(res), outcome: 'replay' });
    expect(await draftsOf(teacher.id)).toHaveLength(1);
  });

  it('lists the caller’s own, newest first, never a removed one', async () => {
    const c = await lesson('draft-list');
    const other = await seedClassroom(db, 'draft-list-elsewhere');
    expect(await list(c.token)).toEqual([]);
    const first = await drafted(c.token, { prompt: 'First?' });
    now = at(11);
    const second = await drafted(c.token, { prompt: 'Second?' });
    now = at(12);
    const third = await drafted(c.token, { prompt: 'Third?' });
    await drafted(await ctx.tokenFor(other.teacher.cognitoId), { prompt: 'Theirs?' });

    await remove(c.token, second.id);

    expect(await list(c.token)).toEqual([third, first]);
  });

  it('replaces one whole, and answers its retry with the draft now', async () => {
    const { token } = await lesson('draft-replace');
    const draft = await drafted(token);
    now = at(12);
    const body = asking({ prompt: 'Why?', options: ['x', 'y'], correctOption: undefined });

    const res = await replace(token, draft.id, body);

    expect(res.statusCode).toBe(200);
    expect(answered(res)).toEqual({
      outcome: 'replaced',
      savedQuestion: {
        ...draft,
        prompt: 'Why?',
        options: ['x', 'y'],
        correctOption: null,
        eventId: body.eventId,
        updatedAt: at(12).toISOString(),
      },
    });
    expect(answered(await replace(token, draft.id, body))).toEqual({
      ...answered(res),
      outcome: 'replay',
    });
  });

  it('keeps the later of two saves landing out of order: the older answers the draft now', async () => {
    const { teacher, token } = await lesson('draft-order');
    const draft = await drafted(token);
    // Minted in this order, as a teacher's two saves.
    const [older, newer] = [asking({ prompt: 'Earlier?' }), asking({ prompt: 'Later?' })];

    const later = await replace(token, draft.id, newer);
    const late = await replace(token, draft.id, older);

    expect(answered(later).outcome).toBe('replaced');
    expect(late.statusCode).toBe(200);
    expect(answered(late)).toEqual({ ...answered(later), outcome: 'replay' });
    expect(await draftsOf(teacher.id)).toMatchObject([
      { prompt: 'Later?', eventId: newer.eventId },
    ]);
  });

  it('removes one, answering its retry so; then no write finds it', async () => {
    const { teacher, token } = await lesson('draft-remove');
    const draft = await drafted(token);
    now = at(12);
    const body = { eventId: newUuidV7() };

    const res = await remove(token, draft.id, body);

    expect(res.statusCode).toBe(200);
    expect(answered(res)).toEqual({
      outcome: 'removed',
      savedQuestion: { ...draft, eventId: body.eventId, updatedAt: at(12).toISOString() },
    });
    expect(answered(await remove(token, draft.id, body))).toEqual({
      ...answered(res),
      outcome: 'replay',
    });
    for (const gone of [await remove(token, draft.id), await replace(token, draft.id, asking())]) {
      expect(gone.statusCode).toBe(404);
      expect(reasonOf(gone)).toBe('saved_question_not_found');
    }
    expect(await list(token)).toEqual([]);
    expect(await draftsOf(teacher.id)).toMatchObject([{ removedAt: at(12) }]);
  });

  it('writes a create’s retry anew once its draft was removed: the removal holds the draft’s id', async () => {
    // Never a 404: a draft keeps only its last write's id (L3b1). After a deletion, a disposal or
    // a retention run, which keep it, the caller is no teacher: 403.
    const { teacher, token } = await lesson('draft-create-removed');
    const body = asking();
    const draft = answered(await create(token, body)).savedQuestion;
    await remove(token, draft.id);

    const retry = await create(token, body);

    expect(retry.statusCode).toBe(200);
    expect(answered(retry)).toMatchObject({
      outcome: 'created',
      savedQuestion: { eventId: body.eventId },
    });
    expect(answered(retry).savedQuestion.id).not.toBe(draft.id);
    expect(await draftsOf(teacher.id)).toHaveLength(2);
  });

  it('refuses a student, another teacher’s draft and an unknown one, writing nothing', async () => {
    const c = await lesson('draft-who');
    const other = await seedClassroom(db, 'draft-who-elsewhere');
    const draft = await drafted(c.token);
    const student = await ctx.tokenFor(c.student.cognitoId);
    const theirs = await ctx.tokenFor(other.teacher.cognitoId);

    const refused = [
      await authedInject(ctx.app, student, { method: 'GET', url: '/v1/saved-questions' }),
      await create(student, asking()),
      await replace(student, draft.id, asking()),
      await remove(student, draft.id),
      await replace(theirs, draft.id, asking()),
      await remove(theirs, draft.id),
    ];
    const unknown = [
      await replace(c.token, newUuidV7(), asking()),
      await remove(c.token, newUuidV7()),
    ];

    for (const res of refused) expect(res.statusCode).toBe(403);
    for (const res of unknown) {
      expect(res.statusCode).toBe(404);
      expect(reasonOf(res)).toBe('saved_question_not_found');
    }
    expect(await draftsOf(c.teacher.id)).toMatchObject([{ id: draft.id, prompt: 'Which?' }]);
    expect(await draftsOf(c.student.id)).toEqual([]);
    expect(await draftsOf(other.teacher.id)).toEqual([]);
  });

  it('refuses an eventId a tap or an answer holds, writing nothing', async () => {
    const { session, student, teacher, token } = await lesson('draft-spent');
    const question = await asked(token, session.id);
    const draft = await drafted(token);
    const tapId = newUuidV7();
    const answerId = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: student.id,
      eventId: tapId,
      deviceTime: at(5),
      now: at(5),
    });
    await answerQuestion(db, {
      questionId: question.id,
      studentId: student.id,
      eventId: answerId,
      option: 0,
      now: at(11),
    });

    for (const eventId of [tapId, answerId]) {
      for (const res of [
        await create(token, asking({ eventId, prompt: 'Why?' })),
        await replace(token, draft.id, asking({ eventId, prompt: 'Why?' })),
        await remove(token, draft.id, { eventId }),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(reasonOf(res)).toBe('event_id_conflict');
      }
    }
    expect(await draftsOf(teacher.id)).toMatchObject([
      { id: draft.id, prompt: 'Which?', eventId: draft.eventId, removedAt: null },
    ]);
  });

  it.each([
    ['a blank prompt', { prompt: ' \n ' }],
    ['a prompt of 501 characters', { prompt: 'x'.repeat(501) }],
    ['a prompt with a bidi override', { prompt: 'Which ‮?' }],
    ['one option', { options: ['a'], correctOption: 0 }],
    ['seven options', { options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
    ['an option with a line break', { options: ['a', 'b\nc'] }],
    ['a correct option past the last', { correctOption: 3 }],
    ['an eventId that is no UUIDv7', { eventId: randomUUID() }],
    ['no eventId', { eventId: undefined }],
  ])('checks a save as an open: refuses %s, writing nothing', async (_, over) => {
    const { teacher, token } = await lesson(`draft-bad-${randomUUID()}`);
    const draft = await drafted(token);

    const res = [await create(token, asking(over)), await replace(token, draft.id, asking(over))];

    expect(res.map((r) => r.statusCode)).toEqual([400, 400]);
    expect(await draftsOf(teacher.id)).toMatchObject([{ id: draft.id, prompt: 'Which?' }]);
  });

  it('refuses a removal with no UUIDv7 eventId, removing nothing', async () => {
    const { teacher, token } = await lesson('draft-remove-bad');
    const draft = await drafted(token);

    for (const payload of [{}, { eventId: randomUUID() }]) {
      expect((await remove(token, draft.id, payload)).statusCode).toBe(400);
    }
    expect(await draftsOf(teacher.id)).toMatchObject([{ removedAt: null }]);
  });
});

describe('a saved question’s eventId (L3b)', () => {
  it('is refused to a tap, an unlock and an open as a spent id, recording nothing', async () => {
    const { session, teacher, student, block, token } = await lesson('draft-spent');
    const drafted = await createSavedQuestion(db, {
      teacherId: teacher.id,
      eventId: newUuidV7(),
      prompt: 'Which?',
      options: ['a', 'b'],
    });
    if (drafted.outcome !== 'created') throw new Error(drafted.outcome);
    const { eventId } = drafted.savedQuestion;
    const phone = await ctx.tokenFor(student.cognitoId);
    const deviceTime = at(9).toISOString();

    const refused = [
      await authedInject(ctx.app, phone, {
        method: 'POST',
        url: '/v1/taps',
        payload: { tagId: block.tagId, eventId, deviceTime },
      }),
      // Kept and resent by the phone, never discarded: a 409 is no "recorded".
      await authedInject(ctx.app, phone, {
        method: 'POST',
        url: `/v1/sessions/${session.id}/unlock`,
        payload: { eventId, deviceTime },
      }),
      await ask(token, session.id, asking({ eventId })),
    ];

    for (const res of refused) {
      expect(res.statusCode).toBe(409);
      expect(reasonOf(res)).toBe('event_id_conflict');
    }
    expect(await db.select().from(events).where(eq(events.eventId, eventId))).toEqual([]);
    expect(await questionsOf(session.id)).toEqual([]);
  });
});
