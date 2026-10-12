import {
  answerQuestion,
  closeQuestion,
  createSavedQuestion,
  type Database,
  findEnrolledStudent,
  findQuestion,
  findSavedQuestion,
  findSessionById,
  findShownQuestion,
  getLiveParticipation,
  listSavedQuestions,
  openQuestion,
  questionCounts,
  type QuestionRow,
  questionOpen,
  removeSavedQuestion,
  replaceSavedQuestion,
  type ResponseRow,
  type SavedQuestionResult,
  type SavedQuestionRow,
  sessionRunning,
} from '@bali/db';
import {
  type AnswerResponse,
  deriveDisplayState,
  type ParticipationSnapshot,
  type Presentation,
  QUESTION_OPTION_MAX_LENGTH,
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTIONS_MIN,
  QUESTION_PROMPT_MAX_LENGTH,
  type QuestionResponse,
  type QuestionResults,
  type SavedQuestion,
  type SavedQuestionResponse,
  type SavedQuestionsResponse,
  type StudentPhone,
  type StudentQuestion,
  type TeacherQuestion,
} from '@bali/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/plugin.js';
import { requireSessionOwner, requireTeacher } from '../auth/teacher.js';
import { INVISIBLE, UNPRINTABLE } from '../display-name.js';
import { ApiError, parseRequest } from '../errors.js';
import { sendTagged } from '../etag.js';
import { mapTransitionError, refusal } from './errors.js';

const Params = z.object({ id: z.string().uuid() });

/**
 * A question's text (decision 3), and a deck's title (M2): plain text, trimmed, something visible,
 * at most `max` code points; line breaks only where `lines` (the prompt's box takes them, an
 * option's doesn't). What is checked is what is stored: the engine stores what it is given.
 */
export const Text = (max: number, lines = false) =>
  z
    .string()
    .trim()
    .refine(
      (s) => (lines ? s.replaceAll('\n', '') : s).search(UNPRINTABLE) === -1,
      'has a character that cannot be shown',
    )
    .refine((s) => !INVISIBLE.test(s), 'is blank')
    .refine((s) => [...s].length <= max, `is longer than ${max} characters`);

const OpenBody = z
  .object({
    eventId: z.uuidv7(),
    prompt: Text(QUESTION_PROMPT_MAX_LENGTH, true),
    options: z
      .array(Text(QUESTION_OPTION_MAX_LENGTH))
      .min(QUESTION_OPTIONS_MIN)
      .max(QUESTION_OPTIONS_MAX),
    correctOption: z.number().int().min(0).nullish(),
  })
  .refine((b) => b.correctOption == null || b.correctOption < b.options.length, {
    message: 'names no option',
    path: ['correctOption'],
  });
const CloseBody = z.object({ eventId: z.uuidv7(), reveal: z.boolean().optional() });
const RemoveBody = z.object({ eventId: z.uuidv7() });
// Any index: one the question lacks is the engine's `invalid_option`.
const AnswerBody = z.object({ eventId: z.uuidv7(), option: z.number().int() });

const questionNotFound = () => ApiError.notFound('question not found', 'question_not_found');
const savedQuestionNotFound = () =>
  ApiError.notFound('saved question not found', 'saved_question_not_found');

/** A question as its teacher sees it, open or not by the server's clock (`questionOpen`). */
export function teacherQuestion(
  question: QuestionRow,
  session: Parameters<typeof questionOpen>[1],
  now: Date,
): TeacherQuestion {
  const { id, prompt, options, correctOption, revealed } = question;
  const open = questionOpen(question, session, now);
  return { id, prompt, options, correctOption, revealed, open };
}

/** A question as a student sees it: the correct option only once revealed, never a count. */
function studentQuestion(
  question: QuestionRow,
  response: ResponseRow | null,
  session: Parameters<typeof questionOpen>[1],
  now: Date,
): StudentQuestion {
  const { id, prompt, options, correctOption, revealed } = question;
  return {
    id,
    prompt,
    options,
    open: questionOpen(question, session, now),
    correctOption: revealed ? correctOption : null,
    answer: response && { option: response.option, eventId: response.eventId },
  };
}

/**
 * A student's own phone in a running session (W1; decision 13), derived as the grid derives it
 * (rule 2) at the server's clock. Its last contact only once silent: a check-in that leaves the
 * state as it was changes nothing in the body, so the poll stays `304`.
 */
function studentPhone(p: ParticipationSnapshot, now: Date): StudentPhone | null {
  const state = deriveDisplayState(p, now);
  if (state === 'ended') return null;
  const lastSeenAt = state === 'silent' ? (p.lastSeenAt ?? p.joinedAt).toISOString() : null;
  return { state, lastSeenAt };
}

/**
 * The caller, a student enrolled in the class `classId` now: the student routes' guard (decision
 * 2). Anyone else is `403`; looked up, never created.
 */
async function requireEnrolled(db: Database, request: FastifyRequest, classId: string) {
  const student = await findEnrolledStudent(db, requireAuth(request).sub, classId);
  if (!student) throw ApiError.forbidden('not in this class');
  return student;
}

/**
 * The question `id` names, in a class the caller teaches: the shared guard for the question routes.
 * A student and another teacher are `403`, an unknown question `404 question_not_found`.
 */
async function requireOwnQuestion(db: Database, request: FastifyRequest, id: string) {
  const teacher = await requireTeacher(db, request);
  const found = await findQuestion(db, id);
  if (!found) throw questionNotFound();
  if (found.teacherId !== teacher.id) throw ApiError.forbidden('not your question');
  return found;
}

/**
 * The draft `id` names is the caller's: a student and another teacher are `403`, an unknown draft
 * `404 saved_question_not_found`. A removed one passes, for its removal's retry; the engine answers
 * any other write to it `404` too.
 */
async function requireOwnSavedQuestion(db: Database, request: FastifyRequest, id: string) {
  const teacher = await requireTeacher(db, request);
  const found = await findSavedQuestion(db, id);
  if (!found) throw savedQuestionNotFound();
  if (found.teacherId !== teacher.id) throw ApiError.forbidden('not your question');
}

const savedQuestion = (draft: SavedQuestionRow): SavedQuestion => ({
  id: draft.id,
  prompt: draft.prompt,
  options: draft.options,
  correctOption: draft.correctOption,
  eventId: draft.eventId,
  createdAt: draft.createdAt.toISOString(),
  updatedAt: draft.updatedAt.toISOString(),
});

function savedAnswer(result: SavedQuestionResult): SavedQuestionResponse {
  if (result.outcome === 'saved_question_not_found') throw savedQuestionNotFound();
  return { outcome: result.outcome, savedQuestion: savedQuestion(result.savedQuestion) };
}

/**
 * A live lesson's questions (Phase 7, L3; "Live lesson", decisions 3 and 6), the class's own
 * teacher only. Thin over the engine, which writes them; every answer says whether the question is
 * open now by the server's clock, so a close past the bell, before the sweep, answers it closed.
 * And a teacher's saved questions (L3b; decision 12), their own drafts only, each body checked as an
 * open's. And the student's side (L4), for a student enrolled in the session's class now.
 *
 * POST /v1/sessions/:id/questions  open one in a running session, closing the one open there
 * POST /v1/questions/:id/close     close it, revealing its correct option when asked
 * GET  /v1/questions/:id/results   its totals, through the one guarded count; ETag and 304
 * GET  /v1/sessions/:id/presentation  what a student shows: the question, their answer, their
 *                                     phone; ETag, 304
 * POST /v1/questions/:id/answers   a student answers, writing no event
 * GET  /v1/saved-questions         the caller's drafts, newest first, none removed
 * POST /v1/saved-questions         write one
 * PUT  /v1/saved-questions/:id     replace it whole, unless the draft holds a later save
 * DELETE /v1/saved-questions/:id   remove it
 */
export function registerQuestionsRoutes(
  app: FastifyInstance,
  db: Database,
  clock: () => Date,
): void {
  app.post(
    '/v1/sessions/:id/questions',
    { preHandler: app.authenticate, config: { parses: { params: Params, body: OpenBody } } },
    async (request): Promise<QuestionResponse> => {
      const { id } = parseRequest(request, 'params', Params);
      const { teacher, session } = await requireSessionOwner(db, request, id);
      const body = parseRequest(request, 'body', OpenBody);
      const now = clock();
      const result = await mapTransitionError(() =>
        openQuestion(db, { ...body, sessionId: session.id, teacherId: teacher.id, now }),
      );
      return {
        outcome: result.outcome,
        question: teacherQuestion(result.question, result.session, now),
      };
    },
  );

  app.post(
    '/v1/questions/:id/close',
    { preHandler: app.authenticate, config: { parses: { params: Params, body: CloseBody } } },
    async (request): Promise<QuestionResponse> => {
      const { id } = parseRequest(request, 'params', Params);
      await requireOwnQuestion(db, request, id);
      const body = parseRequest(request, 'body', CloseBody);
      const now = clock();
      const result = await mapTransitionError(() =>
        closeQuestion(db, { ...body, questionId: id, now }),
      );
      // Found by the guard, and a question is never deleted.
      if (result.outcome === 'question_not_found') throw questionNotFound();
      return {
        outcome: result.outcome,
        question: teacherQuestion(result.question, result.session, now),
      };
    },
  );

  app.get(
    '/v1/questions/:id/results',
    { preHandler: app.authenticate, config: { parses: { params: Params } } },
    async (request, reply) => {
      const { id } = parseRequest(request, 'params', Params);
      const { question, session } = await requireOwnQuestion(db, request, id);
      // Counted after the question is read, never before: a recorded close commits after every
      // answer it lets count, so a question read closed by one is answered with its final counts.
      // Past the bell, before the sweep, an answer begun before the bell may land after this read.
      const counted = await questionCounts(db, id);
      // Found by the guard, and a question is never deleted.
      if (!counted) throw questionNotFound();
      const { open, correctOption, revealed } = teacherQuestion(question, session, clock());
      const results: QuestionResults = {
        answered: counted.answered,
        eligible: counted.eligible,
        open,
        correctOption,
        revealed,
        counts: counted.counts,
      };
      return sendTagged(request, reply, results);
    },
  );

  app.get(
    '/v1/sessions/:id/presentation',
    { preHandler: app.authenticate, config: { parses: { params: Params } } },
    async (request, reply) => {
      const { id } = parseRequest(request, 'params', Params);
      const session = await findSessionById(db, id);
      if (!session) throw refusal('SESSION_NOT_FOUND');
      const student = await requireEnrolled(db, request, session.classId);
      const now = clock();
      const running = sessionRunning(session, now);
      // Nothing is shown outside a running session (decision 2): past the bell too, unswept.
      const shown = running ? await findShownQuestion(db, session.id, student.id) : undefined;
      // The caller's own, never another's: one live participation a student, at most (decision 4).
      const live = running ? await getLiveParticipation(db, student.id) : undefined;
      const presentation: Presentation = {
        running,
        question: shown ? studentQuestion(shown.question, shown.response, session, now) : null,
        phone: live?.session.id === session.id ? studentPhone(live.participation, now) : null,
      };
      return sendTagged(request, reply, presentation);
    },
  );

  app.post(
    '/v1/questions/:id/answers',
    { preHandler: app.authenticate, config: { parses: { params: Params, body: AnswerBody } } },
    async (request): Promise<AnswerResponse> => {
      const { id } = parseRequest(request, 'params', Params);
      const found = await findQuestion(db, id);
      if (!found) throw questionNotFound();
      const student = await requireEnrolled(db, request, found.session.classId);
      // A 400 here can also be `invalid_option`, so a malformed body says which it is.
      const body = parseRequest(request, 'body', AnswerBody, 'invalid_request');
      const result = await mapTransitionError(() =>
        answerQuestion(db, { ...body, questionId: id, studentId: student.id, now: clock() }),
      );
      switch (result.outcome) {
        case 'answered':
        case 'replay': {
          const { option, eventId } = result.response;
          return { outcome: result.outcome, answer: { option, eventId } };
        }
        case 'question_closed':
          throw ApiError.conflict('the question is closed', 'question_closed');
        case 'invalid_option':
          throw ApiError.badInput('the question has no such option', undefined, 'invalid_option');
        // Found by the guard, and a question is never deleted.
        case 'question_not_found':
          throw questionNotFound();
      }
    },
  );

  app.get(
    '/v1/saved-questions',
    { preHandler: app.authenticate },
    async (request): Promise<SavedQuestionsResponse> => {
      const teacher = await requireTeacher(db, request);
      return { savedQuestions: (await listSavedQuestions(db, teacher.id)).map(savedQuestion) };
    },
  );

  app.post(
    '/v1/saved-questions',
    { preHandler: app.authenticate, config: { parses: { body: OpenBody } } },
    async (request): Promise<SavedQuestionResponse> => {
      const teacher = await requireTeacher(db, request);
      const body = parseRequest(request, 'body', OpenBody);
      return savedAnswer(
        await mapTransitionError(() =>
          createSavedQuestion(db, { ...body, teacherId: teacher.id, now: clock() }),
        ),
      );
    },
  );

  app.put(
    '/v1/saved-questions/:id',
    { preHandler: app.authenticate, config: { parses: { params: Params, body: OpenBody } } },
    async (request): Promise<SavedQuestionResponse> => {
      const { id } = parseRequest(request, 'params', Params);
      await requireOwnSavedQuestion(db, request, id);
      const body = parseRequest(request, 'body', OpenBody);
      return savedAnswer(
        await mapTransitionError(() =>
          replaceSavedQuestion(db, { ...body, savedQuestionId: id, now: clock() }),
        ),
      );
    },
  );

  app.delete(
    '/v1/saved-questions/:id',
    { preHandler: app.authenticate, config: { parses: { params: Params, body: RemoveBody } } },
    async (request): Promise<SavedQuestionResponse> => {
      const { id } = parseRequest(request, 'params', Params);
      await requireOwnSavedQuestion(db, request, id);
      const { eventId } = parseRequest(request, 'body', RemoveBody);
      return savedAnswer(
        await mapTransitionError(() =>
          removeSavedQuestion(db, { eventId, savedQuestionId: id, now: clock() }),
        ),
      );
    },
  );
}
