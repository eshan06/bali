import {
  answerQuestion,
  changeUnlockReason,
  closeQuestion,
  completeDeck,
  createDeck,
  createSavedQuestion,
  type Database,
  endSession,
  enrollments,
  extendSession,
  formatInviteCode,
  mintTeacherInvite,
  newUuidV7,
  openQuestion,
  protectionOff,
  protectionOn,
  recordAgreement,
  registerPushToken,
  renameStudent,
  replaceSavedQuestion,
  schema,
  showSlide,
  startSession,
  tapIn,
  unlock,
  unlockUnderTap,
} from '@bali/db';
import type { UnlockReason } from '@bali/shared';
import { eq, type SQL, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import type { FastifyInstance, InjectOptions, RouteOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../src/app.js';
import { memoryDeckStorage } from '../src/deck-storage.js';
import { makeTestDb, seedClassroom } from './helpers/db.js';
import { testEnv } from './helpers/env.js';
import { routeTable } from './helpers/openapi.js';
import { makeTestIssuer, type TestIssuer } from './helpers/test-issuer.js';

/*
 * A repeated event id on every data-changing route (the pre-pilot step, part 1 of 3;
 * docs/DECISIONS.md, 2026-10-23). Every mutation carries a client-minted event id and is
 * idempotent on it: sent again, it writes nothing and answers the truth now (CLAUDE.md;
 * ARCHITECTURE, rule 4). A client resends what it never heard answered, and may write the id in
 * either case: the portal and the phone's outbox mint lower case, Foundation's `uuidString`
 * upper, and Postgres matches a `uuid` in any case where a string compare does not.
 *
 * Driven from the route table the authorization matrix walks (`routeTable()`, which its guard holds
 * to MATRIX row for row): every route but a GET or its HEAD changes data, and each one has a
 * scenario in REPEATS or is listed in NO_EVENT_ID with why it takes none, or the guard fails. A new
 * route fails here until it is one or the other.
 *
 * Each scenario runs twice, in a world of its own each: its request sent first with every id in it
 * lower case, then resent as it was, then resent in upper case; and the same sent first in upper
 * case, resent so, then in lower case. Everything else in the world, the scenario's own setup and
 * what happens between the sends, is sent as the server prints ids, in lower case. Each resend must
 * be answered 2xx with the replay, the truth now (the first answer, `outcome: 'replay'`, unless the
 * scenario says what its route's replay is), and add or remove no row: every table in the schema is
 * counted around it, so a new table is counted too. A resend that only rewrote a row in place is
 * seen where its answer shows it, as an outcome that is no replay. And the two worlds must write
 * alike: a request whose ids come in upper case lands as the same one in lower case does.
 *
 * What fails today is LEFT, each entry with its one-line reason and exactly what the check finds;
 * the list only shrinks. A route on it that passes, or fails otherwise, fails here until its entry
 * says so.
 */

type Json = Record<string, unknown>;
type Seeded = Awaited<ReturnType<typeof seedClassroom>>;

/** One classroom: its teacher, its student, enrolled, and its session, running, no one in it yet. */
interface World {
  tag: string;
  owner: Seeded['teacher'];
  student: Seeded['student'];
  klass: Seeded['klass'];
  block: Seeded['block'];
  enrollmentId: string;
  sessionId: string;
}

/** Who sends a route's request: the class's teacher or its student, or a sign-in with no account. */
type Caller = 'owner' | 'student' | 'newcomer';

/** A route's request as its caller first sends it, and what its resends answer. */
interface Sent {
  url: string;
  body?: Json;
  /** What legitimately changes the truth between the first send and its resends, given its answer. */
  between?: (first: Json) => Promise<unknown>;
  /** The replay, the truth now, from the first send's answer: its route's own, as its docs say. */
  replay?: (first: Json) => Json;
}

/** A route's scenario: who sends it, and the request, in a world set up for it. */
interface Repeat {
  as: Caller;
  sent: (w: World) => Sent | Promise<Sent>;
}

/** A field a route mints afresh for every request, a resend's too: any string answers it. */
const FRESH = Symbol('fresh');

/** Most routes' replay: the first answer, as their outcome says nothing was written again. */
const asReplay = (first: Json): Json => ({ ...first, outcome: 'replay' });

const deviceTime = () => new Date().toISOString();

/** An APNs device token no phone has registered: 64 hex digits. */
const pushToken = () => randomUUID().replace(/-/g, '').repeat(2);

/** The student in the class's session, by a tap of their own: its id. */
async function tappedIn(w: World): Promise<string> {
  const eventId = newUuidV7();
  const own = { sessionId: w.sessionId, studentId: w.student.id };
  await tapIn(db, { ...own, eventId, deviceTime: new Date() });
  return eventId;
}

/** The student's Emergency Unlock in the class's session: its id. */
async function unlocked(w: World): Promise<string> {
  const eventId = newUuidV7();
  const own = { sessionId: w.sessionId, studentId: w.student.id };
  await unlock(db, { ...own, eventId, deviceTime: new Date() });
  return eventId;
}

/** The student changes their unlock's reason (A20), naming it as the server prints it. */
const reasonChanged = (w: World, unlockEventId: string, reason: UnlockReason) => () =>
  changeUnlockReason(db, { unlockEventId, studentId: w.student.id, eventId: newUuidV7(), reason });

/** The student's phone reports its Screen Time permission gone, or back (#167). */
function protection(w: World, now: 'off' | 'on') {
  const report = { sessionId: w.sessionId, studentId: w.student.id, eventId: newUuidV7() };
  return (now === 'off' ? protectionOff : protectionOn)(db, { ...report, deviceTime: new Date() });
}

/** A question the teacher asked in the class's session: its id. */
async function asked(w: World): Promise<string> {
  const { question } = await openQuestion(db, {
    sessionId: w.sessionId,
    teacherId: w.owner.id,
    eventId: newUuidV7(),
    prompt: 'Which?',
    options: ['a', 'b'],
  });
  return question.id;
}

/** The teacher's saved question: its id. */
async function drafted(w: World): Promise<string> {
  const draft = await createSavedQuestion(db, {
    teacherId: w.owner.id,
    eventId: newUuidV7(),
    prompt: 'Which?',
    options: ['a', 'b'],
  });
  if (draft.outcome !== 'created') throw new Error(`no draft: ${draft.outcome}`);
  return draft.savedQuestion.id;
}

/** The teacher's deck, pending, or checked ready with 3 pages: its id. */
async function deck(w: World, ready = false): Promise<string> {
  const { deck: made } = await createDeck(db, {
    teacherId: w.owner.id,
    schoolId: w.owner.schoolId!,
    eventId: newUuidV7(),
    title: 'Cells',
    bytes: 1_000,
    sha256: 'c'.repeat(64),
  });
  if (ready) {
    const verdict = { status: 'ready', pageCount: 3 } as const;
    await completeDeck(db, { deckId: made.id, eventId: newUuidV7(), verdict });
  }
  return made.id;
}

/**
 * Every data-changing route that takes an event id, and the one gap that should (LEFT): its
 * scenario. Where a later write of the same caller's changes what a replay must answer, the
 * scenario makes it between the sends, so a replay that only echoed its first answer fails; and a
 * replay a route answers otherwise than `outcome: 'replay'` says so, after its docs.
 */
const REPEATS: Record<string, Repeat> = {
  // Renamed again since: a replay applies nothing and answers the name now (A8).
  'PATCH /v1/me': {
    as: 'student',
    sent: (w) => ({
      url: '/v1/me',
      body: { displayName: 'Ada', eventId: newUuidV7() },
      between: () =>
        renameStudent(db, { studentId: w.student.id, displayName: 'Ada L', eventId: newUuidV7() }),
      replay: (first) => ({
        outcome: 'replay',
        user: { ...(first.user as Json), displayName: 'Ada L' },
      }),
    }),
  },
  // A retry, from a sign-in with no account here now, is `already_deleted` and makes none (C3).
  'DELETE /v1/me': {
    as: 'student',
    sent: () => ({
      url: '/v1/me',
      body: { eventId: newUuidV7() },
      replay: () => ({ outcome: 'already_deleted' }),
    }),
  },
  // Registered again since, for another environment: a replay answers the token's now (N3).
  'PUT /v1/me/push-token': {
    as: 'student',
    sent(w) {
      const token = pushToken();
      const again = { userId: w.student.id, token, environment: 'sandbox' } as const;
      return {
        url: '/v1/me/push-token',
        body: { token, environment: 'production', eventId: newUuidV7() },
        between: () => registerPushToken(db, { ...again, eventId: newUuidV7() }),
        replay: () => ({ outcome: 'replay', environment: 'sandbox' }),
      };
    },
  },
  // The row goes for good, so a retry re-reads the truth: no such token is the caller's (N3).
  'DELETE /v1/me/push-token': {
    as: 'student',
    async sent(w) {
      const token = pushToken();
      const registered = { token, environment: 'production', eventId: newUuidV7() } as const;
      await registerPushToken(db, { userId: w.student.id, ...registered });
      return {
        url: '/v1/me/push-token',
        body: { token, eventId: newUuidV7() },
        replay: () => ({ outcome: 'not_registered' }),
      };
    },
  },
  // Passed once, under any id, keeps its first: always `{ passed: true }` (C7-server).
  'PUT /v1/me/age-check': {
    as: 'student',
    sent: () => ({ url: '/v1/me/age-check', body: { eventId: newUuidV7() }, replay: (f) => f }),
  },
  // The phone tapped, then unlocked while the tap was unanswered: the unlock, sent under the tap's
  // id, landed first and was kept (decision 11). The tap files it as it lands, so both arrival
  // orders end alike: the student unlocked.
  'POST /v1/taps': {
    as: 'student',
    async sent(w) {
      const eventId = newUuidV7();
      const tapped = new Date(Date.now() - 2_000);
      const kept = { studentId: w.student.id, eventId: newUuidV7() };
      const unlockedAt = new Date(Date.now() - 1_000);
      await unlockUnderTap(db, { ...kept, tapEventId: eventId, deviceTime: unlockedAt });
      const body = { tagId: w.block.tagId, eventId, deviceTime: tapped.toISOString() };
      return { url: '/v1/taps', body };
    },
  },
  // Its tap landed, so it is filed in the tap's session at once; then its reason changes (A20): a
  // replay answers the reason now, recorded as no fresh unlock is.
  'POST /v1/taps/:eventId/unlock': {
    as: 'student',
    async sent(w) {
      const tapId = await tappedIn(w);
      const eventId = newUuidV7();
      return {
        url: `/v1/taps/${tapId}/unlock`,
        body: { eventId, deviceTime: deviceTime(), reason: 'bathroom' },
        between: reasonChanged(w, eventId, 'nurse'),
        replay: (first) => ({ ...first, outcome: 'replay', recordedAs: null, reason: 'nurse' }),
      };
    },
  },
  // Changed again since: a replay answers the reason now, whatever came since (A20).
  'PATCH /v1/unlocks/:eventId': {
    as: 'student',
    async sent(w) {
      await tappedIn(w);
      const unlockId = await unlocked(w);
      return {
        url: `/v1/unlocks/${unlockId}`,
        body: { reason: 'nurse', eventId: newUuidV7() },
        between: reasonChanged(w, unlockId, 'other'),
        replay: () => ({ outcome: 'replay', reason: 'other' }),
      };
    },
  },
  // Joining a class one is in already is `already_enrolled`, the enrollment as it is.
  'POST /v1/enrollments': {
    as: 'newcomer',
    sent: (w) => ({
      url: '/v1/enrollments',
      body: { joinCode: w.klass.joinCode, eventId: newUuidV7(), deviceTime: deviceTime() },
      replay: (first) => ({ ...first, outcome: 'already_enrolled' }),
    }),
  },
  // Never while the class is in session (A19); a retry of a leave that landed is `already_removed`.
  'DELETE /v1/enrollments/:id': {
    as: 'student',
    async sent(w) {
      await endSession(db, { sessionId: w.sessionId, at: new Date(), reason: 'ended' });
      return {
        url: `/v1/enrollments/${w.enrollmentId}`,
        body: { eventId: newUuidV7() },
        replay: (first) => ({ ...first, outcome: 'already_removed' }),
      };
    },
  },
  // A first sign-in, at a school whose agreement is on record, redeems its code (T1b).
  'POST /v1/teacher-invites/redeem': {
    as: 'newcomer',
    async sent(w) {
      const schoolId = w.owner.schoolId!;
      await recordAgreement(db, { schoolId, signedOn: '2026-09-30' });
      const minted = await mintTeacherInvite(db, { schoolId });
      if (minted.outcome !== 'minted') throw new Error(`no invite: ${minted.outcome}`);
      const code = formatInviteCode(minted.code);
      return { url: '/v1/teacher-invites/redeem', body: { code, eventId: newUuidV7() } };
    },
  },
  // Takes no event id yet (LEFT): sent one, as every mutation carries one, its replay is the class
  // the first send made.
  'POST /v1/classes': {
    as: 'owner',
    sent: () => ({
      url: '/v1/classes',
      body: { name: 'Period 2', eventId: newUuidV7() },
      replay: (f) => f,
    }),
  },
  // Time added again since: a replay adds none and answers the bell now, `extended` as always.
  'POST /v1/sessions/:id/extend': {
    as: 'owner',
    sent: (w) => ({
      url: `/v1/sessions/${w.sessionId}/extend`,
      body: { durationMinutes: 5, eventId: newUuidV7() },
      between: () =>
        extendSession(db, {
          sessionId: w.sessionId,
          durationMinutes: 5,
          at: new Date(),
          eventId: newUuidV7(),
        }),
      replay: (first) => {
        const session = first.session as Json;
        const endsAt = new Date(Date.parse(String(session.endsAt)) + 5 * 60_000).toISOString();
        return { ...first, session: { ...session, endsAt } };
      },
    }),
  },
  // Then its reason changes (A20): a replay answers the reason now, recorded as no fresh unlock is.
  'POST /v1/sessions/:id/unlock': {
    as: 'student',
    async sent(w) {
      await tappedIn(w);
      const eventId = newUuidV7();
      return {
        url: `/v1/sessions/${w.sessionId}/unlock`,
        body: { eventId, deviceTime: deviceTime(), reason: 'bathroom' },
        between: reasonChanged(w, eventId, 'nurse'),
        replay: (first) => ({ ...first, outcome: 'replay', recordedAs: null, reason: 'nurse' }),
      };
    },
  },
  // Unlocked again since: a replay answers the state now.
  'POST /v1/sessions/:id/refocus': {
    as: 'student',
    async sent(w) {
      await tappedIn(w);
      await unlocked(w);
      return {
        url: `/v1/sessions/${w.sessionId}/refocus`,
        body: { eventId: newUuidV7(), deviceTime: deviceTime() },
        between: () => unlocked(w),
        replay: (first) => ({ ...first, outcome: 'replay', state: 'unlocked' }),
      };
    },
  },
  // Screen Time back on since (#167): a replay answers the state now, focused again.
  'POST /v1/sessions/:id/protection-off': {
    as: 'student',
    async sent(w) {
      await tappedIn(w);
      return {
        url: `/v1/sessions/${w.sessionId}/protection-off`,
        body: { eventId: newUuidV7(), deviceTime: deviceTime() },
        between: () => protection(w, 'on'),
        replay: (first) => ({ ...first, outcome: 'replay', state: 'focused' }),
      };
    },
  },
  // It needs protection off first (#167); off again since: a replay answers the state now.
  'POST /v1/sessions/:id/protection-on': {
    as: 'student',
    async sent(w) {
      await tappedIn(w);
      await protection(w, 'off');
      return {
        url: `/v1/sessions/${w.sessionId}/protection-on`,
        body: { eventId: newUuidV7(), deviceTime: deviceTime() },
        between: () => protection(w, 'off'),
        replay: (first) => ({ ...first, outcome: 'replay', state: 'protection_off' }),
      };
    },
  },
  // Closed since: a replay answers the question now, whatever has happened since (L3a).
  'POST /v1/sessions/:id/questions': {
    as: 'owner',
    sent: (w) => ({
      url: `/v1/sessions/${w.sessionId}/questions`,
      body: { eventId: newUuidV7(), prompt: 'Which?', options: ['a', 'b'] },
      between: (first) =>
        closeQuestion(db, {
          questionId: String((first.question as Json).id),
          eventId: newUuidV7(),
        }),
      replay: (first) => ({
        ...first,
        outcome: 'replay',
        question: { ...(first.question as Json), open: false },
      }),
    }),
  },
  'POST /v1/questions/:id/close': {
    as: 'owner',
    sent: async (w) => ({
      url: `/v1/questions/${await asked(w)}/close`,
      body: { eventId: newUuidV7() },
    }),
  },
  // Answered again since: a replay, or an older answer, answers the answer now (decision 4).
  'POST /v1/questions/:id/answers': {
    as: 'student',
    async sent(w) {
      const questionId = await asked(w);
      const later = { questionId, studentId: w.student.id, option: 0, eventId: '' };
      return {
        url: `/v1/questions/${questionId}/answers`,
        body: { eventId: newUuidV7(), option: 1 },
        between: () => answerQuestion(db, Object.assign(later, { eventId: newUuidV7() })),
        replay: () => ({ outcome: 'replay', answer: { option: 0, eventId: later.eventId } }),
      };
    },
  },
  'POST /v1/saved-questions': {
    as: 'owner',
    sent: () => ({
      url: '/v1/saved-questions',
      body: { eventId: newUuidV7(), prompt: 'Which?', options: ['a', 'b'] },
    }),
  },
  // Saved again since: a replay, or an older save, answers the draft now (decision 12).
  'PUT /v1/saved-questions/:id': {
    as: 'owner',
    async sent(w) {
      const savedQuestionId = await drafted(w);
      let now: Json = {};
      return {
        url: `/v1/saved-questions/${savedQuestionId}`,
        body: { eventId: newUuidV7(), prompt: 'Why?', options: ['a', 'b'] },
        async between() {
          const words = { prompt: 'How?', options: ['a', 'b'] };
          const saved = await replaceSavedQuestion(db, {
            savedQuestionId,
            eventId: newUuidV7(),
            ...words,
          });
          if (saved.outcome !== 'replaced') throw new Error(`not saved: ${saved.outcome}`);
          const { eventId, updatedAt } = saved.savedQuestion;
          now = { ...words, eventId, updatedAt: updatedAt.toISOString() };
        },
        replay: (first) => ({
          outcome: 'replay',
          savedQuestion: { ...(first.savedQuestion as Json), ...now },
        }),
      };
    },
  },
  'DELETE /v1/saved-questions/:id': {
    as: 'owner',
    sent: async (w) => ({
      url: `/v1/saved-questions/${await drafted(w)}`,
      body: { eventId: newUuidV7() },
    }),
  },
  // A replay carries a fresh upload URL: the first answer's never reached the caller (M2b2).
  'POST /v1/decks': {
    as: 'owner',
    sent: () => ({
      url: '/v1/decks',
      body: { eventId: newUuidV7(), title: 'Cells', bytes: 1_000, sha256: 'c'.repeat(64) },
      replay: (first) => ({ ...first, outcome: 'replay', uploadUrl: FRESH }),
    }),
  },
  'DELETE /v1/decks/:id': {
    as: 'owner',
    sent: async (w) => ({ url: `/v1/decks/${await deck(w)}`, body: { eventId: newUuidV7() } }),
  },
  // Nothing uploaded: checked, and rejected `unfinished`; a deck checked is answered its verdict.
  'POST /v1/decks/:id/complete': {
    as: 'owner',
    sent: async (w) => ({
      url: `/v1/decks/${await deck(w)}/complete`,
      body: { eventId: newUuidV7() },
    }),
  },
  // Paged on since: a replay, or an older change, answers the slide now and its change's id (M3a).
  'POST /v1/sessions/:id/slide': {
    as: 'owner',
    async sent(w) {
      const deckId = await deck(w, true);
      const later = { sessionId: w.sessionId, teacherId: w.owner.id, deckId, page: 3, eventId: '' };
      return {
        url: `/v1/sessions/${w.sessionId}/slide`,
        body: { eventId: newUuidV7(), deckId, page: 2 },
        between: () => showSlide(db, Object.assign(later, { eventId: newUuidV7() })),
        replay: (first) => ({
          outcome: 'replay',
          slide: { ...(first.slide as Json), page: 3 },
          eventId: later.eventId,
        }),
      };
    },
  },
};

/**
 * The data-changing routes that take no event id by design, each with why a second send doubles
 * nothing; run here as REPEATS are, their answers left unread, but for the sweep's two, which
 * sweep every world of this file at once.
 */
const NO_EVENT_ID: Record<string, { why: string; repeat?: Repeat }> = {
  'POST /internal/sweep': {
    why: 'the sweep, the cron’s call with the internal key, is idempotent by design (hosting decision 3); internal.test.ts sends it twice',
  },
  'POST /internal/sessions/expire': { why: 'the sweep’s Phase 1 alias, the same handler' },
  'POST /v1/classes/:id/sessions': {
    why: 'Start: one running session a class (its partial unique index), so a second Start is answered `existing`, that session',
    repeat: {
      as: 'owner',
      async sent(w) {
        await endSession(db, { sessionId: w.sessionId, at: new Date(), reason: 'ended' });
        return { url: `/v1/classes/${w.klass.id}/sessions`, body: { durationMinutes: 25 } };
      },
    },
  },
  'POST /v1/sessions/:id/end': {
    why: 'End: a session ends once, and a second End is answered `already_ended`, recording nothing',
    repeat: { as: 'owner', sent: (w) => ({ url: `/v1/sessions/${w.sessionId}/end` }) },
  },
  'POST /v1/blocks': {
    why: 'a block’s registration: one live block a tag (its partial unique index), so the tag registered again is answered its block',
    repeat: {
      as: 'owner',
      sent: (w) => ({ url: '/v1/blocks', body: { tagId: `TAG-${w.tag}-new` } }),
    },
  },
  'PATCH /v1/classes/:id': {
    why: 'a rename or a new join code rewrites the class’s one row and records nothing; a second new code replaces the first, and its answer names the one the class holds',
    repeat: {
      as: 'owner',
      sent: (w) => ({
        url: `/v1/classes/${w.klass.id}`,
        body: { name: 'Renamed', regenerateCode: true },
      }),
    },
  },
  'POST /v1/sessions/:id/checkin': {
    why: 'the heartbeat: it moves `last_seen_at` alone (data-model decision 7), and a silence’s `came_back` once, by its marker',
    repeat: {
      as: 'student',
      async sent(w) {
        await tappedIn(w);
        return { url: `/v1/sessions/${w.sessionId}/checkin`, body: { deviceTime: deviceTime() } };
      },
    },
  },
};

/**
 * What fails today, each with its one-line reason and exactly what the check finds. Only ever
 * shrinks: the step that fixes one takes its entry off (part 2 of the pre-pilot step, Create class;
 * part 3, the other four, where an id is compared as text: docs/DECISIONS.md, 2026-10-22, #437).
 */
const LEFT: Record<string, { why: string; fails: string[] }> = {
  'POST /v1/classes': {
    why: 'takes no eventId (2026-09-20), so every resend makes another class, which no route removes (#432)',
    fails: ['resent in lower case: wrote classes +1', 'resent in upper case: wrote classes +1'],
  },
  'DELETE /v1/decks/:id': {
    why: '`removeDeck` compares the id the deck holds as text, so a removal resent in another case is `404 deck_not_found`',
    fails: ['resent in upper case: 404 deck_not_found'],
  },
  'POST /v1/taps': {
    why: '`unlocksAwaitingTap` and `lockTap` match the tap’s id as text, so an unlock kept under it in another case is never filed',
    fails: ['sent first in upper case: wrote events +1, where first in lower case +2'],
  },
  'POST /v1/taps/:eventId/unlock': {
    why: '`recordedReason` reads the reason’s change under the id as sent, as text, so a replay in another case answers the reason first recorded',
    fails: ['resent in upper case: answered otherwise (reason)'],
  },
  'POST /v1/sessions/:id/unlock': {
    why: '`recordedReason` reads the reason’s change under the id as sent, as text, so a replay in another case answers the reason first recorded',
    fails: ['resent in upper case: answered otherwise (reason)'],
  },
};

let db: Database;
let closeDb: () => Promise<void>;
let issuer: TestIssuer;
let app: FastifyInstance;
let tables: string[];
let worlds = 0;

beforeAll(async () => {
  ({ db, close: closeDb } = await makeTestDb());
  issuer = await makeTestIssuer();
  // Decks' storage on (M2), in memory: off, a teacher's every deck route is 503 (decks.test.ts).
  app = buildApp(testEnv, { db, verifyToken: issuer.verifier, deckStorage: memoryDeckStorage() });
  const names = await query<{ name: string }>(
    sql`select table_name::text as name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  tables = names.map(({ name }) => name);
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

/** A raw statement's rows, on either backend: postgres.js answers an array, PGlite `{ rows }`. */
async function query<T>(statement: SQL): Promise<T[]> {
  const result = (await db.execute(statement)) as T[] | { rows: T[] };
  return Array.isArray(result) ? result : result.rows;
}

/** How many rows each table of the schema holds now. */
async function rows(): Promise<Record<string, number>> {
  const counts = await query<{ name: string; n: number }>(
    sql.join(
      tables.map(
        (t) => sql`select ${t}::text as name, count(*)::int as n from ${sql.identifier(t)}`,
      ),
      sql` union all `,
    ),
  );
  return Object.fromEntries(counts.map(({ name, n }) => [name, Number(n)]));
}

const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

/** Each table whose count moved from `before` to `after`, and by how much. */
const moved = (before: Record<string, number>, after: Record<string, number>) =>
  Object.fromEntries(
    tables.filter((t) => after[t] !== before[t]).map((t) => [t, after[t]! - before[t]!]),
  );

/** A fresh world: one classroom, its session running, no one tapped in. */
async function world(): Promise<World> {
  const tag = `repeat-${(worlds += 1)}`;
  const { teacher, student, klass, block } = await seedClassroom(db, tag);
  const { session } = await startSession(db, {
    classId: klass.id,
    startedAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 25 * 60_000),
  });
  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(eq(enrollments.studentId, student.id));
  return {
    tag,
    owner: teacher,
    student,
    klass,
    block,
    enrollmentId: enrollment!.id,
    sessionId: session.id,
  };
}

type Case = 'lower' | 'upper';
const OTHER: Record<Case, Case> = { lower: 'upper', upper: 'lower' };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** `sent` with every id it names, in its path and its body, in `c`. */
function cased(sent: Sent, c: Case): { url: string; payload?: Json } {
  const to = (s: string) =>
    s.replace(UUID, (id) => (c === 'upper' ? id.toUpperCase() : id.toLowerCase()));
  const payload = sent.body && (JSON.parse(to(JSON.stringify(sent.body))) as Json);
  return { url: to(sent.url), ...(payload && { payload }) };
}

/** A refusal, as its status and reason (the one error shape). */
function refusal(res: { statusCode: number; json: () => unknown }): string {
  const { error } = (res.json() ?? {}) as { error?: { code?: string; reason?: string } };
  return `${res.statusCode} ${error?.reason ?? error?.code ?? ''}`.trim();
}

/** The fields of `answer` that are not the replay's, by name. */
function differing(replay: Json, answer: Json): string[] {
  return [...new Set([...Object.keys(replay), ...Object.keys(answer)])]
    .filter((key) =>
      replay[key] === FRESH
        ? typeof answer[key] !== 'string'
        : !isDeepStrictEqual(replay[key], answer[key]),
    )
    .sort();
}

/** One scenario, run in a world of its own, its request sent first in `first` case. */
interface Run {
  /** What went wrong, one line each. */
  failures: string[];
  /** The rows the whole scenario wrote, by table: the same whatever case it was sent in first. */
  wrote: Record<string, number>;
  /** Every answer, for a failure's message. */
  answers: string[];
}

async function run(method: string, repeat: Repeat, first: Case, read: boolean): Promise<Run> {
  const failures: string[] = [];
  const answers: string[] = [];
  const w = await world();
  const sent = await repeat.sent(w);
  const sub = { owner: w.owner.cognitoId, student: w.student.cognitoId, newcomer: `new-${w.tag}` };
  const send = async (c: Case) => {
    const token = await issuer.sign({ sub: sub[repeat.as] });
    const res = await app.inject({
      method: method as InjectOptions['method'],
      ...cased(sent, c),
      headers: { authorization: `Bearer ${token}` },
    });
    answers.push(`${method} ${sent.url}, ${c} case: ${res.statusCode} ${res.body}`);
    return res;
  };

  const start = await rows();
  const one = await send(first);
  const landed = one.statusCode < 300;
  if (!landed) failures.push(`sent in ${first} case: ${refusal(one)}`);
  // Refused, nothing landed to change since, nor a replay to answer: its resends are still sent.
  if (landed) await sent.between?.(one.json());
  const replay = read && landed ? (sent.replay ?? asReplay)(one.json()) : undefined;

  let before = await rows();
  for (const c of [first, OTHER[first]]) {
    const again = await send(c);
    const after = await rows();
    const wrote = Object.entries(moved(before, after));
    before = after;
    const said = `resent in ${c} case`;
    if (again.statusCode >= 300) failures.push(`${said}: ${refusal(again)}`);
    // A resend that wrote is no replay: its answer names what it wrote, so that is said alone.
    for (const [table, n] of wrote) failures.push(`${said}: wrote ${table} ${signed(n)}`);
    if (again.statusCode >= 300 || wrote.length > 0 || !replay) continue;
    const fields = differing(replay, again.json());
    if (fields.length > 0) failures.push(`${said}: answered otherwise (${fields.join(', ')})`);
  }
  return { failures, wrote: moved(start, before), answers };
}

/** Where the world sent first in upper case wrote otherwise than the one sent first in lower case. */
function unlike(lower: Run, upper: Run): string[] {
  return tables
    .filter((t) => (lower.wrote[t] ?? 0) !== (upper.wrote[t] ?? 0))
    .map(
      (t) =>
        `sent first in upper case: wrote ${t} ${signed(upper.wrote[t] ?? 0)}, where first in lower case ${signed(lower.wrote[t] ?? 0)}`,
    );
}

/** Both runs of a route's scenario, and the failures they found together, sorted, each once. */
async function check(method: string, repeat: Repeat, read: boolean) {
  const lower = await run(method, repeat, 'lower', read);
  const upper = await run(method, repeat, 'upper', read);
  const failures = [...new Set([...lower.failures, ...upper.failures, ...unlike(lower, upper)])];
  return { failures: failures.sort(), answers: [...lower.answers, ...upper.answers].join('\n') };
}

/** The route's key, as the authorization matrix names it. */
const keyOf = (route: Pick<RouteOptions, 'method' | 'url'>) =>
  `${String(route.method)} ${route.url}`;

/** Every route that changes data: any but a GET, and the HEAD Fastify answers beside it. */
const changing = (routes: readonly RouteOptions[]) =>
  routes.filter((route) => route.method !== 'GET' && route.method !== 'HEAD');

/** Whether the route takes an `eventId`, in its body or its path, in any branch of their schemas. */
function takesEventId(route: RouteOptions): boolean {
  const { body, params } = route.config?.parses ?? {};
  return [body, params].some(
    (part) =>
      part !== undefined &&
      JSON.stringify(z.toJSONSchema(part, { io: 'input', unrepresentable: 'any' })).includes(
        '"eventId"',
      ),
  );
}

/** The guard: each data-changing route with no scenario here and no reason it takes no event id. */
function uncovered(routes: readonly RouteOptions[]): string[] {
  return changing(routes)
    .map(keyOf)
    .filter((key) => !(key in REPEATS) && !(key in NO_EVENT_ID));
}

// The app's real route table, read before the tests are declared: one test per data-changing route.
const routes = await routeTable();

describe('the guard', () => {
  it('has every data-changing route the authorization matrix lists: a scenario, or why it takes no event id', () => {
    expect(
      uncovered(routes),
      'give each a scenario in REPEATS, or list it in NO_EVENT_ID with why a second send doubles nothing',
    ).toEqual([]);
    const listed = changing(routes).map(keyOf);
    const twice = Object.keys(REPEATS).filter((key) => key in NO_EVENT_ID);
    const stale = [...Object.keys(REPEATS), ...Object.keys(NO_EVENT_ID)].filter(
      (key) => !listed.includes(key),
    );
    expect({ twice, stale }).toEqual({ twice: [], stale: [] });
  });

  // Every route's "adds no row" rests on the count: one that missed a table, or saw none, would pass
  // every resend.
  it('counts every table the schema defines, and sees the rows a world adds', async () => {
    const defined = Object.values(schema)
      .filter((table) => table instanceof PgTable)
      .map((table) => getTableConfig(table).name);
    expect(tables).toEqual(expect.arrayContaining(defined));
    const before = await rows();
    await world();
    const added = { schools: 1, users: 2, classes: 1, enrollments: 1, blocks: 1, sessions: 1 };
    expect(moved(before, await rows())).toEqual({ ...added, events: 1 });
  });

  it('fails a data-changing route added with neither, and only that', () => {
    const added = (method: string): RouteOptions => ({
      method,
      url: '/v1/new',
      handler: () => ({}),
    });
    expect(uncovered([...routes, added('POST'), added('GET')])).toEqual(['POST /v1/new']);
  });

  it('lists as taking no event id only routes that take none; one with a scenario and none is LEFT', () => {
    const byKey = new Map(changing(routes).map((route) => [keyOf(route), route]));
    // A key no route has is the first test's to name.
    const takes = (key: string) => byKey.has(key) && takesEventId(byKey.get(key)!);
    expect(Object.keys(NO_EVENT_ID).filter(takes), 'takes one: give it a scenario').toEqual([]);
    const gaps = Object.keys(REPEATS).filter((key) => !takes(key));
    expect(gaps, 'takes none: a gap, on LEFT').toEqual(gaps.filter((key) => key in LEFT));
    expect(Object.keys(LEFT).filter((key) => !(key in REPEATS))).toEqual([]);
  });
});

/** A route's scenario: its event id's, or, taking none by design, its own; none for the sweep's. */
const repeatOf = (route: RouteOptions): Repeat | undefined =>
  REPEATS[keyOf(route)] ?? NO_EVENT_ID[keyOf(route)]?.repeat;

describe.each(changing(routes).filter((route) => repeatOf(route) !== undefined))(
  '$method $url',
  (route) => {
    const key = keyOf(route);
    // A route that takes no event id by design is sent again all the same: its answers unread.
    const read = key in REPEATS;
    const left = LEFT[key];
    const does = read
      ? 'resent under its event id, in either case, is its replay and adds no row'
      : 'sent again, it doubles nothing';

    it(left ? `${does}: not yet, as LEFT says` : does, async () => {
      const { failures, answers } = await check(String(route.method), repeatOf(route)!, read);
      const said = left ? `LEFT: ${left.why}; fixed, take its entry off\n` : '';
      expect(failures, `${said}${answers}`).toEqual(left?.fails ?? []);
    });
  },
);
