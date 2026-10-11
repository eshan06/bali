import { sessionReport } from '@bali/shared';
import { and, asc, eq } from 'drizzle-orm';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { getHistoryPage, getSessionEvents, getSessionRoster } from '../src/queries.js';
import {
  armedTaps,
  classes,
  enrollments,
  events,
  participations,
  questions,
  responses,
  schools,
  sessions,
  users,
} from '../src/schema.js';
import { makeTestDb } from '../src/testing.js';
import {
  answerQuestion,
  armTap,
  closeQuestion,
  endSession,
  expireDueSessions,
  openQuestion,
  startSession,
  tapIn,
  unlock,
} from '../src/transitions.js';
import type { Database } from '../src/types.js';

/*
 * Live lesson, Slice 1 (Phase 7, L1; ARCHITECTURE, "Live lesson", decisions 2–5): a teacher opens
 * a question in a running session and closes it, revealing the correct option or not; a newer
 * question and the session's end close it too; a student answers, writing no event. An answer's
 * eventId is spent for every other mutation, and an event's for an answer. The races are in
 * races.test.ts.
 */

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

/** 09:mm on the lesson's day: its window is 09:00–09:25, so 09:10 is mid-lesson. */
const at = (minute: number) => new Date(`2026-01-01T09:${String(minute).padStart(2, '0')}:00Z`);

/** A 09:00–09:25 lesson of Ms Rivera's, Ana and Ben enrolled, neither tapped in. */
async function lesson(tag: string) {
  const [school] = await db
    .insert(schools)
    .values({ name: `School ${tag}` })
    .returning();
  const [teacher, other, ana, ben] = await db
    .insert(users)
    .values([
      { cognitoId: `teacher-${tag}`, role: 'teacher', schoolId: school!.id },
      { cognitoId: `other-${tag}`, role: 'teacher', schoolId: school!.id },
      { cognitoId: `ana-${tag}`, role: 'student', schoolId: school!.id },
      { cognitoId: `ben-${tag}`, role: 'student', schoolId: school!.id },
    ])
    .returning();
  const [klass] = await db
    .insert(classes)
    .values({ teacherId: teacher!.id, schoolId: school!.id, name: tag, joinCode: tag })
    .returning();
  await db.insert(enrollments).values([
    { classId: klass!.id, studentId: ana!.id },
    { classId: klass!.id, studentId: ben!.id },
  ]);
  const { session } = await startSession(db, {
    classId: klass!.id,
    startedAt: at(0),
    endsAt: at(25),
  });
  /** Ms Rivera asks "Which?" at 09:mm, its correct option b unless said. */
  const ask = (minute: number, extra: { eventId?: string; correctOption?: number | null } = {}) =>
    openQuestion(db, {
      sessionId: session.id,
      teacherId: teacher!.id,
      eventId: extra.eventId ?? newUuidV7(),
      prompt: 'Which?',
      options: ['a', 'b', 'c'],
      correctOption: extra.correctOption === undefined ? 1 : extra.correctOption,
      now: at(minute),
    });
  return {
    school: school!,
    teacher: teacher!,
    other: other!,
    ana: ana!,
    ben: ben!,
    klass: klass!,
    session,
    ask,
  };
}

/** A student's answer to `questionId`, heard at 09:mm. */
const answer = (
  questionId: string,
  studentId: string,
  option: number,
  minute: number,
  eventId = newUuidV7(),
) => answerQuestion(db, { questionId, studentId, eventId, option, now: at(minute) });

const lessonEvents = (sessionId: string) =>
  db.select().from(events).where(eq(events.sessionId, sessionId)).orderBy(asc(events.seq));

const ofType = async (sessionId: string, type: 'question_opened' | 'question_closed') =>
  (await lessonEvents(sessionId)).filter((e) => e.type === type);

const questionNow = async (id: string) =>
  (await db.select().from(questions).where(eq(questions.id, id)))[0]!;

const answersTo = (questionId: string) =>
  db.select().from(responses).where(eq(responses.questionId, questionId));

describe('opening a question', () => {
  it('records it with its question_opened event, which names no one', async () => {
    const { session, teacher, ask } = await lesson('q-open');
    const eventId = newUuidV7();

    const opened = await ask(5, { eventId });

    expect(opened.outcome).toBe('opened');
    expect(opened.question).toMatchObject({
      sessionId: session.id,
      prompt: 'Which?',
      options: ['a', 'b', 'c'],
      correctOption: 1,
      eventId,
      openedAt: at(5),
      closedAt: null,
      revealed: false,
      createdBy: teacher.id,
    });
    expect(await ofType(session.id, 'question_opened')).toMatchObject([
      {
        eventId,
        sessionId: session.id,
        classId: session.classId,
        userId: null,
        occurredAt: at(5),
        payload: { question_id: opened.question.id },
      },
    ]);
  });

  it('closes the open one in the same transaction, by a newer question, revealing nothing', async () => {
    const { session, ask } = await lesson('q-newer');
    const first = await ask(5);

    const second = await ask(7);

    expect(await questionNow(first.question.id)).toMatchObject({
      closedAt: at(7),
      revealed: false,
    });
    expect(second.question.closedAt).toBeNull();
    expect(await ofType(session.id, 'question_closed')).toMatchObject([
      {
        userId: null,
        occurredAt: at(7),
        payload: { question_id: first.question.id, revealed: false, closed_by: 'newer_question' },
      },
    ]);
  });

  it('answers its replay with the question it opened, after the session too, and refuses another teacher’s', async () => {
    const { session, other, ask } = await lesson('q-replay');
    const eventId = newUuidV7();
    const opened = await ask(5, { eventId });

    expect(await ask(6, { eventId })).toEqual({ outcome: 'replay', question: opened.question });
    await endSession(db, { sessionId: session.id, at: at(10), reason: 'ended' });
    expect(await ask(11, { eventId })).toMatchObject({
      outcome: 'replay',
      question: { id: opened.question.id },
    });
    await expect(
      openQuestion(db, {
        sessionId: session.id,
        teacherId: other.id,
        eventId,
        prompt: 'Mine?',
        options: ['x', 'y'],
        now: at(6),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    expect(await ofType(session.id, 'question_opened')).toHaveLength(1);
  });

  it('is refused outside a running session: past the bell, ended, or unknown', async () => {
    const { session, ask } = await lesson('q-not-running');

    // Past the bell by the server's clock, before the sweep has marked it (A17).
    await expect(ask(30)).rejects.toMatchObject({ code: 'SESSION_NOT_RUNNING' });
    await endSession(db, { sessionId: session.id, at: at(10), reason: 'ended' });
    await expect(ask(11)).rejects.toMatchObject({ code: 'SESSION_NOT_RUNNING' });
    await expect(
      openQuestion(db, {
        sessionId: newUuidV7(),
        teacherId: newUuidV7(),
        eventId: newUuidV7(),
        prompt: 'Which?',
        options: ['a', 'b'],
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(await db.select().from(questions).where(eq(questions.sessionId, session.id))).toEqual(
      [],
    );
  });

  it('refuses an eventId another event holds, opening nothing', async () => {
    const { session, ana, ask } = await lesson('q-spent');
    const tap = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: tap,
      deviceTime: at(1),
      now: at(1),
    });

    await expect(ask(5, { eventId: tap })).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    expect(await db.select().from(questions).where(eq(questions.sessionId, session.id))).toEqual(
      [],
    );
  });
});

describe('closing a question', () => {
  it('is the teacher’s, revealing the correct option when asked', async () => {
    const { session, ask } = await lesson('q-close');
    const { question } = await ask(5);
    const eventId = newUuidV7();

    const closed = await closeQuestion(db, {
      questionId: question.id,
      eventId,
      reveal: true,
      now: at(9),
    });

    expect(closed).toMatchObject({
      outcome: 'closed',
      question: { id: question.id, closedAt: at(9), revealed: true },
    });
    expect(await ofType(session.id, 'question_closed')).toMatchObject([
      {
        eventId,
        userId: null,
        occurredAt: at(9),
        payload: { question_id: question.id, revealed: true, closed_by: 'teacher' },
      },
    ]);
  });

  it('reveals nothing when not asked, or when the question has no correct option', async () => {
    const { ask } = await lesson('q-no-reveal');
    const kept = await ask(5);
    expect(
      await closeQuestion(db, { questionId: kept.question.id, eventId: newUuidV7(), now: at(6) }),
    ).toMatchObject({ outcome: 'closed', question: { revealed: false } });
    const none = await ask(7, { correctOption: null });
    expect(
      await closeQuestion(db, {
        questionId: none.question.id,
        eventId: newUuidV7(),
        reveal: true,
        now: at(8),
      }),
    ).toMatchObject({ outcome: 'closed', question: { revealed: false, correctOption: null } });
  });

  it('answers a replay, or a close of one already closed, with the question now, recording nothing', async () => {
    const { session, ask } = await lesson('q-close-replay');
    const { question } = await ask(5);
    const eventId = newUuidV7();
    const closed = await closeQuestion(db, { questionId: question.id, eventId, now: at(9) });

    const again = newUuidV7();
    expect(
      await closeQuestion(db, { questionId: question.id, eventId, reveal: true, now: at(10) }),
    ).toEqual({ outcome: 'replay', question: (closed as { question: unknown }).question });
    expect(
      await closeQuestion(db, { questionId: question.id, eventId: again, now: at(11) }),
    ).toMatchObject({ outcome: 'replay', question: { closedAt: at(9), revealed: false } });
    expect(await ofType(session.id, 'question_closed')).toHaveLength(1);
    // Its eventId is kept only with the event it records.
    expect(await db.select().from(events).where(eq(events.eventId, again))).toEqual([]);
  });

  it('changes nothing past the bell, where the session’s end has closed it already (A17)', async () => {
    const { session, ask } = await lesson('q-close-bell');
    const { question } = await ask(5);

    expect(
      await closeQuestion(db, { questionId: question.id, eventId: newUuidV7(), now: at(30) }),
    ).toMatchObject({ outcome: 'replay', question: { closedAt: null } });
    expect(await ofType(session.id, 'question_closed')).toEqual([]);
  });

  it('refuses the eventId of another question’s close, leaving it open', async () => {
    const { ask } = await lesson('q-close-spent');
    const first = await ask(5);
    const eventId = newUuidV7();
    await closeQuestion(db, { questionId: first.question.id, eventId, now: at(6) });
    const second = await ask(7);

    await expect(
      closeQuestion(db, { questionId: second.question.id, eventId, now: at(8) }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    expect((await questionNow(second.question.id)).closedAt).toBeNull();
  });

  it('says so for a question no one opened', async () => {
    expect(await closeQuestion(db, { questionId: newUuidV7(), eventId: newUuidV7() })).toEqual({
      outcome: 'question_not_found',
    });
  });
});

describe('a session’s end closes its open question', () => {
  it('when the teacher ends it, then', async () => {
    const { session, ask } = await lesson('q-end');
    const { question } = await ask(5);

    await endSession(db, { sessionId: session.id, at: at(10), reason: 'ended' });

    expect(await questionNow(question.id)).toMatchObject({ closedAt: at(10), revealed: false });
    const types = (await lessonEvents(session.id)).map((e) => e.type);
    expect(types.slice(-2)).toEqual(['question_closed', 'session_ended']);
    expect((await ofType(session.id, 'question_closed'))[0]!.payload).toEqual({
      question_id: question.id,
      revealed: false,
      closed_by: 'session_end',
    });
  });

  it('at the bell when the sweep ends it, never at the sweep’s own time', async () => {
    const { session, ask } = await lesson('q-sweep');
    const { question } = await ask(5);

    expect(await expireDueSessions(db, at(40))).toContain(session.id);

    expect((await questionNow(question.id)).closedAt).toEqual(at(25));
    expect(await ofType(session.id, 'question_closed')).toMatchObject([
      { occurredAt: at(25), payload: { closed_by: 'session_end' } },
    ]);
  });

  it('at the bell when a Start past it ends it (A18)', async () => {
    const { session, klass, ask } = await lesson('q-a18');
    const { question } = await ask(5);

    const next = await startSession(db, { classId: klass.id, startedAt: at(30), endsAt: at(55) });

    expect(next.outcome).toBe('created');
    expect((await questionNow(question.id)).closedAt).toEqual(at(25));
    expect(await ofType(session.id, 'question_closed')).toHaveLength(1);
  });

  it('and leaves a closed one as it was', async () => {
    const { session, ask } = await lesson('q-end-closed');
    const { question } = await ask(5);
    await closeQuestion(db, { questionId: question.id, eventId: newUuidV7(), now: at(6) });

    await endSession(db, { sessionId: session.id, at: at(10), reason: 'ended' });

    expect((await questionNow(question.id)).closedAt).toEqual(at(6));
    expect(await ofType(session.id, 'question_closed')).toHaveLength(1);
  });
});

describe('answering a question', () => {
  it('records the answer now, under its eventId, and writes no event', async () => {
    const { session, ana, ask } = await lesson('a-record');
    const { question } = await ask(5);
    const before = await lessonEvents(session.id);
    const eventId = newUuidV7();

    const answered = await answer(question.id, ana.id, 2, 6, eventId);

    expect(answered).toMatchObject({
      outcome: 'answered',
      response: {
        questionId: question.id,
        studentId: ana.id,
        option: 2,
        eventId,
        answeredAt: at(6),
      },
    });
    expect(await lessonEvents(session.id)).toEqual(before);
    expect(await db.select().from(events).where(eq(events.eventId, eventId))).toEqual([]);
  });

  it('is replaced only by an answer whose eventId sorts after the one held (decision 4)', async () => {
    const { ana, ben, ask } = await lesson('a-order');
    const { question } = await ask(5);
    const [first, second, third] = [1, 2, 3].map((n) => v7({ msecs: Date.UTC(2026, 0, 1, 9, n) }));

    await answer(question.id, ana.id, 0, 6, second);
    // The first answer, slow, lands after the second: it never undoes it.
    expect(await answer(question.id, ana.id, 1, 7, first)).toMatchObject({
      outcome: 'replay',
      response: { option: 0, eventId: second, answeredAt: at(6) },
    });
    expect(await answer(question.id, ana.id, 2, 8, third)).toMatchObject({
      outcome: 'answered',
      response: { option: 2, eventId: third, answeredAt: at(8) },
    });
    expect(await answersTo(question.id)).toHaveLength(1);
    // A replaced answer's id is not kept, so only the one held is anyone else's to refuse.
    expect(await answer(question.id, ben.id, 1, 9, second)).toMatchObject({ outcome: 'answered' });
  });

  it('answers its replay with the answer now, past the close too', async () => {
    const { ana, ask } = await lesson('a-replay');
    const { question } = await ask(5);
    const eventId = newUuidV7();
    const answered = await answer(question.id, ana.id, 1, 6, eventId);
    await closeQuestion(db, { questionId: question.id, eventId: newUuidV7(), now: at(7) });

    expect(await answer(question.id, ana.id, 2, 8, eventId)).toEqual({
      outcome: 'replay',
      response: (answered as { response: unknown }).response,
    });
  });

  it('refuses an eventId any other response or any event holds, recording nothing (decision 6)', async () => {
    const { session, ana, ben, ask } = await lesson('a-spent');
    const { question: first } = await ask(5);
    const anas = newUuidV7();
    await answer(first.id, ana.id, 0, 6, anas);
    const tap = newUuidV7();
    await tapIn(db, {
      sessionId: session.id,
      studentId: ana.id,
      eventId: tap,
      deviceTime: at(6),
      now: at(6),
    });

    // Another student's answer; then, on a newer question, the student's own other answer, their
    // own tap, and the teacher's open.
    await expect(answer(first.id, ben.id, 1, 7, anas)).rejects.toMatchObject({
      code: 'EVENT_ID_CONFLICT',
    });
    const { question: second } = await ask(8);
    for (const eventId of [anas, tap, second.eventId]) {
      await expect(answer(second.id, ana.id, 1, 9, eventId)).rejects.toMatchObject({
        code: 'EVENT_ID_CONFLICT',
      });
    }
    expect(await answersTo(second.id)).toEqual([]);
    expect(await answersTo(first.id)).toMatchObject([{ studentId: ana.id }]);
  });

  it('counts only while the question is open and its session running by the server’s clock (A17)', async () => {
    const { ana, ben, ask } = await lesson('a-closed');
    const { question: first } = await ask(5);
    await closeQuestion(db, { questionId: first.id, eventId: newUuidV7(), now: at(6) });
    const { question: second } = await ask(7);

    expect(await answer(first.id, ana.id, 1, 8)).toEqual({ outcome: 'question_closed' });
    // Past the bell, before the sweep has marked the session or closed the question.
    expect(await answer(second.id, ben.id, 1, 30)).toEqual({ outcome: 'question_closed' });
    expect(await answersTo(first.id)).toEqual([]);
    expect(await answersTo(second.id)).toEqual([]);
  });

  it('refuses an option the question lacks, and says so for a question no one opened', async () => {
    const { ana, ask } = await lesson('a-option');
    const { question } = await ask(5);

    for (const option of [-1, 3, 1.5]) {
      expect(await answer(question.id, ana.id, option, 6)).toEqual({ outcome: 'invalid_option' });
    }
    expect(await answer(newUuidV7(), ana.id, 0, 6)).toEqual({ outcome: 'question_not_found' });
    expect(await answersTo(question.id)).toEqual([]);
  });
});

describe('an answer’s eventId, spent for every other mutation (settled 2026-10-10)', () => {
  it('a tap, an unlock or an arm reusing it is refused as a reused id is: 409, nothing recorded', async () => {
    const { session, ana, teacher, ask } = await lesson('a-reuse');
    const { question } = await ask(5);
    const eventId = newUuidV7();
    await answer(question.id, ana.id, 1, 6, eventId);
    const studentId = ana.id;

    await expect(
      tapIn(db, { sessionId: session.id, studentId, eventId, deviceTime: at(7), now: at(7) }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    // A refusal, never an answer meaning "recorded": the phone keeps the unlock and says so.
    await expect(
      unlock(db, { sessionId: session.id, studentId, eventId, deviceTime: at(7) }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
    await expect(
      armTap(db, {
        studentId,
        teacherId: teacher.id,
        eventId,
        deviceTime: at(7),
        expiresAt: at(59),
        now: at(7),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });

    expect(await db.select().from(events).where(eq(events.eventId, eventId))).toEqual([]);
    expect(await db.select().from(armedTaps).where(eq(armedTaps.eventId, eventId))).toEqual([]);
    expect(
      await db.select().from(participations).where(eq(participations.sessionId, session.id)),
    ).toEqual([]);
  });

  it('a waiting tap whose id an answer took since still joins at its Start, under a fresh id', async () => {
    // Its Start is refused the spent id before writing anything under it, so the conversion's
    // collided-id branch runs as for an id another event holds.
    const { ana, teacher, ask } = await lesson('a-armed');
    const [later] = await db
      .insert(classes)
      .values({ teacherId: teacher.id, schoolId: ana.schoolId!, name: 'later', joinCode: 'later' })
      .returning();
    await db.insert(enrollments).values({ classId: later!.id, studentId: ana.id });
    const { question } = await ask(5);
    const eventId = newUuidV7();
    // Armed for Ms Rivera's next class while this one runs, ana not in it.
    await armTap(db, {
      studentId: ana.id,
      teacherId: teacher.id,
      eventId,
      deviceTime: at(6),
      expiresAt: at(59),
      now: at(6),
    });
    await answer(question.id, ana.id, 1, 7, eventId);

    const started = await startSession(db, {
      classId: later!.id,
      startedAt: at(8),
      endsAt: at(50),
    });

    expect(started.convertedStudentIds).toEqual([ana.id]);
    const [tap] = await db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, started.session.id), eq(events.type, 'tap_in')));
    expect(tap).toMatchObject({ userId: ana.id, payload: { armed_tap_event_id: eventId } });
    expect(tap!.eventId).not.toBe(eventId);
  });
});

describe('the report, the grid and the history ignore a lesson’s questions', () => {
  it('read the same with its question events as without them', async () => {
    const { session, klass, ana, ben, ask } = await lesson('q-ignored');
    const act = (minute: number) => ({
      sessionId: session.id,
      studentId: ana.id,
      eventId: newUuidV7(),
      deviceTime: at(minute),
      now: at(minute),
    });
    await tapIn(db, act(1));
    await unlock(db, act(3));
    const grid = await getSessionRoster(db, session.id, klass.id);
    const history = await getHistoryPage(db, ana.id, { limit: 50 });

    const { question } = await ask(5);
    await answer(question.id, ana.id, 1, 6);
    await answer(question.id, ben.id, 2, 6);
    await closeQuestion(db, { questionId: question.id, eventId: newUuidV7(), now: at(7) });
    await ask(8);
    expect(await getSessionRoster(db, session.id, klass.id)).toEqual(grid);
    expect(await getHistoryPage(db, ana.id, { limit: 50 })).toEqual(history);

    await endSession(db, { sessionId: session.id, at: at(12), reason: 'ended' });
    const all = await getSessionEvents(db, session.id);
    const without = all.filter((e) => e.type !== 'question_opened' && e.type !== 'question_closed');
    expect(all.length - without.length).toBe(4);
    const [ended] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    const report = sessionReport(ended!, all, at(30));
    expect(report).toEqual(sessionReport(ended!, without, at(30)));
    // Ben, who answered and never tapped in, joined nothing.
    expect(report.joined).toEqual([ana.id]);
  });
});
