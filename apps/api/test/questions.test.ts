import {
  answerQuestion,
  type Database,
  endSession,
  events,
  newUuidV7,
  questions,
  startSession,
  tapIn,
} from '@bali/db';
import type { ApiErrorBody, QuestionResponse, SessionSnapshot } from '@bali/shared';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authedInject, makeAuthedApp, type AuthedApp } from './helpers/app.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';

/*
 * A live lesson's questions, the teacher's side (Phase 7, L3; ARCHITECTURE, "Live lesson",
 * decisions 3 and 6): open, close and the boot snapshot's open question, for the class's own
 * teacher. Who else is refused is the authorization matrix's too; the engine's own rules and races
 * are packages/db's (L1).
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
