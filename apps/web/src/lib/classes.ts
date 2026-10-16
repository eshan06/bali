import type { ClassDetail, MeClassWithTeacher } from '@bali/shared';

import { type ApiClient, ApiError, NetworkError } from './api-client';
import { CANT_CREATE, CANT_REACH, errText } from './errors';

/*
 * A teacher's classes (D2e; Classes since PV16), tested: the name's limit, the create's answer, and
 * what the Classes page counts from each class's summary (PV2).
 */

/** A teacher's own class as `/v1/me` lists it, its summary (PV2) with it. */
export type TaughtClass = MeClassWithTeacher;

/**
 * The class's session running at `now` (ms) by this computer's clock: the last read's (running by
 * the server's clock then) until its bell, so its Live chip goes at the bell, as the home's live
 * card does (W3).
 */
export function liveNow(c: TaughtClass, now: number): { id: string; endsAt: string } | null {
  const running = c.summary?.runningSession ?? null;
  return running !== null && Date.parse(running.endsAt) > now ? running : null;
}

/**
 * How long after a bell Classes reads the account again: a computer's clock a little ahead of the
 * server's would otherwise read it before the server's bell and still find the session running.
 */
export const AFTER_BELL_MS = 3000;

/** The first bell still to ring among the classes live at `now`, or null: when to read them again. */
export function nextBell(classes: TaughtClass[], now: number): number | null {
  const bells = classes.flatMap((c) => {
    const live = liveNow(c, now);
    return live ? [Date.parse(live.endsAt)] : [];
  });
  return bells.length > 0 ? Math.min(...bells) : null;
}

/** How many calendar days `at` is before `now`, in `timeZone` (the viewer's own unless given). */
export function daysBefore(at: Date, now: Date, timeZone?: string): number {
  const day = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone,
  });
  const index = (d: Date) => {
    const part = (type: string) => Number(day.formatToParts(d).find((p) => p.type === type)?.value);
    return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
  };
  return index(now) - index(at);
}

/**
 * The longest name `POST /v1/classes` takes once trimmed (its `CreateBody`, pinned by the test):
 * the field holds no more, so the API's 400 for a longer one, a log line, is never met.
 */
export const CLASS_NAME_MAX = 120;

/** The create's answer, as the form acts on it. */
export type CreateAnswer =
  /** The class, as the server made it. */
  | { kind: 'created'; klass: ClassDetail }
  /** No class made that the page knows of (no answer, a refusal, over the budget): Try again. */
  | { kind: 'failed'; message: string }
  /** No class made, and a resend can't change that (a deleted account, C3): said, no Try again. */
  | { kind: 'final'; message: string };

/**
 * Create a class named `name` (`POST /v1/classes`), its answer in words, never thrown, so the
 * form always comes back with something to say. The route takes no `eventId`: a resend after a
 * lost answer makes a second class, as a second press always has, so the page reads the list
 * again after every answer, and a class made either way is in it to see.
 */
export async function createClass(
  api: Pick<ApiClient, 'post'>,
  name: string,
): Promise<CreateAnswer> {
  try {
    return { kind: 'created', klass: await api.post<ClassDetail>('/v1/classes', { name }) };
  } catch (e) {
    if (e instanceof NetworkError) return { kind: 'failed', message: CANT_REACH };
    // A refusal that carries something to go by, said as errText says it: the budget's wait, or a
    // `reason` (the route's `account_deleted`), which is final.
    if (e instanceof ApiError && e.status === 429) return { kind: 'failed', message: errText(e) };
    if (e instanceof ApiError && e.status < 500 && e.reason !== undefined) {
      return { kind: 'final', message: errText(e) };
    }
    // Anything else: a 5xx, a timeout, a body that isn't JSON, or a refusal with no reason, such
    // as the 409 for a teacher with no school, which no account reaches (a redeemed invite always
    // sets one). The API's own message is written for a log.
    return { kind: 'failed', message: CANT_CREATE };
  }
}
