import {
  API_ERROR_REASONS,
  API_ERROR_STATUS,
  type ApiErrorBody,
  type ApiErrorCode,
  CHECK_IN_STATUSES,
  type CheckInResponse,
  END_ENROLLMENT_OUTCOMES,
  END_ENROLLMENT_REASONS,
  type EndEnrollmentResponse,
  ENROLLMENT_JOIN_OUTCOMES,
  type EnrollmentJoinResponse,
  HISTORY_EVENT_TYPES,
  type HistoryEvent,
  type HistoryPage,
  type JoinCodePreviewResponse,
  type MeClass,
  type MeResponse,
  type MeUser,
  PARTICIPATION_STATES,
  PROTECTION_OFF_OUTCOMES,
  PROTECTION_OFF_RECORDED_AS,
  type ProtectionOffResponse,
  REFOCUS_OUTCOMES,
  type RefocusResponse,
  type SessionView,
  stateChangeDisposition,
  TAP_OUTCOMES,
  tapDisposition,
  type TapResponse,
  UNLOCK_REASONS,
  UNLOCK_RECORDED_AS,
  UNLOCK_RECORDED_OUTCOMES,
  unlockDisposition,
  type UnlockResponse,
  UPDATE_ME_OUTCOMES,
  type UpdateMeResponse,
  USER_ROLES,
} from '@bali/shared';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/*
 * What a contract fixture is (Phase 3 · A5) — its schemas, its endpoints and
 * how its file is written — for the golden-file test that captures and checks
 * every one, `../contract-fixtures.test.ts`.
 */

/** Where the fixtures live: the repo's top-level `contracts/fixtures/`. */
export const FIXTURES_DIR = fileURLToPath(
  new URL('../../../../contracts/fixtures/', import.meta.url),
);

/** The @bali/shared type each fixture's body must be, by name. */
interface Contract {
  MeResponse: MeResponse;
  TapResponse: TapResponse;
  CheckInResponse: CheckInResponse;
  UnlockResponse: UnlockResponse;
  RefocusResponse: RefocusResponse;
  ProtectionOffResponse: ProtectionOffResponse;
  EnrollmentJoinResponse: EnrollmentJoinResponse;
  EndEnrollmentResponse: EndEnrollmentResponse;
  JoinCodePreviewResponse: JoinCodePreviewResponse;
  HistoryPage: HistoryPage;
  UpdateMeResponse: UpdateMeResponse;
  ApiErrorBody: ApiErrorBody;
}
export type FixtureType = keyof Contract;

/**
 * A strict object schema for `T`. The compiler holds it to T's keys — exactly
 * them, optional ones included — and each to a value T allows, so neither the
 * type nor the schema can gain or lose a field alone; at run time it refuses
 * any other key.
 */
const object =
  <T>() =>
  <S extends { [K in keyof T]-?: z.ZodType<T[K]> }>(
    shape: S & Record<Exclude<keyof S, keyof T>, never>,
  ) =>
    z.strictObject(shape);

const state = z.enum(PARTICIPATION_STATES);
const sessionView = object<SessionView>()({
  id: z.uuid(),
  classId: z.uuid(),
  endsAt: z.iso.datetime(),
});
const meClass = object<MeClass>()({ id: z.uuid(), name: z.string() });
const meUser = object<MeUser>()({
  id: z.uuid(),
  role: z.enum(USER_ROLES),
  displayName: z.string().nullable(),
});
const historyEvent = object<HistoryEvent>()({
  eventId: z.uuid(),
  type: z.enum(HISTORY_EVENT_TYPES),
  occurredAt: z.iso.datetime(),
  class: meClass,
  teacher: object<HistoryEvent['teacher']>()({ displayName: z.string().nullable() }),
  session: object<NonNullable<HistoryEvent['session']>>()({
    id: z.uuid(),
    startedAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
  }).nullable(),
  reason: z.enum(UNLOCK_REASONS).nullable(),
  // Protection off's notes are a subset of an unlock's: one field, one vocabulary.
  recordedAs: z.enum(UNLOCK_RECORDED_AS).nullable(),
  countedIn: meClass.nullable(),
});

/**
 * Each type as a strict run-time schema: a field the type lacks, a missing
 * one, or a value outside its vocabulary is refused, so an answer cannot be
 * written as a fixture of a type that does not describe it.
 */
export const SCHEMAS = {
  MeResponse: object<MeResponse>()({
    user: meUser,
    classes: z.array(meClass),
    session: object<NonNullable<MeResponse['session']>>()({
      ...sessionView.shape,
      state: z.enum([...PARTICIPATION_STATES, 'ended', 'silent']),
    }).nullable(),
  }),
  TapResponse: object<TapResponse>()({
    outcome: z.enum(TAP_OUTCOMES),
    session: sessionView.nullable(),
    state: state.nullable(),
  }),
  CheckInResponse: object<CheckInResponse>()({
    status: z.enum(CHECK_IN_STATUSES),
    state: state.nullable(),
    session: sessionView.nullable(),
  }),
  UnlockResponse: object<UnlockResponse>()({
    outcome: z.enum(UNLOCK_RECORDED_OUTCOMES),
    recordedAs: z.enum(UNLOCK_RECORDED_AS).nullable(),
    state: state.nullable(),
    session: sessionView.nullable(),
    reason: z.enum(UNLOCK_REASONS).nullable(),
  }),
  RefocusResponse: object<RefocusResponse>()({
    outcome: z.enum(REFOCUS_OUTCOMES),
    state: state.nullable(),
    session: sessionView.nullable(),
  }),
  ProtectionOffResponse: object<ProtectionOffResponse>()({
    outcome: z.enum(PROTECTION_OFF_OUTCOMES),
    recordedAs: z.enum(PROTECTION_OFF_RECORDED_AS).nullable(),
    state: state.nullable(),
    session: sessionView.nullable(),
  }),
  EnrollmentJoinResponse: object<EnrollmentJoinResponse>()({
    outcome: z.enum(ENROLLMENT_JOIN_OUTCOMES),
    enrollmentId: z.uuid(),
    class: meClass,
  }),
  EndEnrollmentResponse: object<EndEnrollmentResponse>()({
    outcome: z.enum(END_ENROLLMENT_OUTCOMES),
    reason: z.enum(END_ENROLLMENT_REASONS),
    endedParticipation: z.boolean(),
  }),
  JoinCodePreviewResponse: object<JoinCodePreviewResponse>()({
    class: meClass,
    teacher: object<JoinCodePreviewResponse['teacher']>()({ displayName: z.string().nullable() }),
    alreadyEnrolled: z.boolean(),
  }),
  HistoryPage: object<HistoryPage>()({
    events: z.array(historyEvent),
    nextBefore: z.uuid().nullable(),
  }),
  UpdateMeResponse: object<UpdateMeResponse>()({
    outcome: z.enum(UPDATE_ME_OUTCOMES),
    user: meUser,
  }),
  ApiErrorBody: object<ApiErrorBody>()({
    error: object<ApiErrorBody['error']>()({
      code: z.enum(Object.keys(API_ERROR_STATUS) as ApiErrorCode[]),
      reason: z.enum(API_ERROR_REASONS).optional(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  }),
} satisfies Record<FixtureType, z.ZodType>;

/*
 * `object` holds a schema to its type's keys and values; this holds the type
 * to the schema's values too — a vocabulary that gains a value its schema
 * lacks names that type here, and the line fails to compile.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Disagreeing = {
  [K in FixtureType]: Same<z.output<(typeof SCHEMAS)[K]>, Contract[K]> extends true ? never : K;
}[FixtureType];
export const SCHEMAS_AGREE: [Disagreeing] extends [never] ? true : Disagreeing = true;

/** The outbox table a phone runs an endpoint's answers through, in `@bali/shared`. */
export const DISPOSITIONS = {
  tap: tapDisposition,
  change: stateChangeDisposition,
  unlock: unlockDisposition,
};

/** Every student endpoint with a fixture: the type of its 2xx body, and its outbox table. */
export const ENDPOINTS: Record<
  string,
  { type: Exclude<FixtureType, 'ApiErrorBody'>; outbox?: keyof typeof DISPOSITIONS }
> = {
  'GET /v1/me': { type: 'MeResponse' },
  'POST /v1/taps': { type: 'TapResponse', outbox: 'tap' },
  'POST /v1/sessions/{id}/checkin': { type: 'CheckInResponse' },
  'POST /v1/sessions/{id}/unlock': { type: 'UnlockResponse', outbox: 'unlock' },
  'POST /v1/sessions/{id}/refocus': { type: 'RefocusResponse', outbox: 'change' },
  'POST /v1/sessions/{id}/protection-off': { type: 'ProtectionOffResponse', outbox: 'change' },
  'POST /v1/enrollments': { type: 'EnrollmentJoinResponse' },
  'DELETE /v1/enrollments/{id}': { type: 'EndEnrollmentResponse' },
  'GET /v1/join-codes/{code}': { type: 'JoinCodePreviewResponse' },
  'GET /v1/me/history': { type: 'HistoryPage' },
  // Not an outbox record: the Me screen sends a rename while open (A8).
  'PATCH /v1/me': { type: 'UpdateMeResponse' },
};

/** One checked-in fixture: a real request, the answer it got, and what the phone does with it. */
export interface Fixture {
  endpoint: string;
  scenario: string;
  request: { path: string; body?: object };
  status: number;
  type: FixtureType;
  body: unknown;
  /** The endpoint's outbox table applied to this answer — what BaliCore's port must also say. */
  disposition?: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

/**
 * A fixture as its file holds it. Each distinct id and timestamp becomes a
 * stable stand-in, numbered in order of first appearance — still a valid UUID
 * and ISO 8601 time, so a client decodes it with its real types — so a fixture
 * changes only when the contract does, never because a run minted new ids.
 */
export function serialize(fixture: Fixture): string {
  const standIn = (make: (n: number) => string) => {
    const seen = new Map<string, string>();
    return (found: string) => {
      if (!seen.has(found)) seen.set(found, make(seen.size + 1));
      return seen.get(found)!;
    };
  };
  const json = JSON.stringify(fixture, null, 2)
    .replace(
      UUID,
      standIn((n) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`),
    )
    .replace(
      TIMESTAMP,
      standIn((n) => new Date(Date.UTC(2000, 0, 1, 0, n)).toISOString()),
    );
  return `${json}\n`;
}

/** Every `.json` file under `dir`, relative to it — what the drift check reconciles. */
export async function jsonFiles(dir: string): Promise<string[]> {
  const files = await readdir(dir, { recursive: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  return files.filter((file) => file.endsWith('.json')).sort();
}

/**
 * Rewrite `dir` to hold exactly `fixtures` — what `npm run fixtures` does. It
 * clears only what the drift check reconciles, every `.json` (a stale one is a
 * fixture of nothing), so a file kept beside them — a README for BaliCore's
 * authors — outlives a regenerate.
 */
export async function writeFixtures(dir: string, fixtures: Map<string, Fixture>): Promise<void> {
  for (const file of await jsonFiles(dir)) await rm(join(dir, file));
  for (const [name, fixture] of fixtures) {
    const file = join(dir, `${name}.json`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, serialize(fixture));
  }
}
