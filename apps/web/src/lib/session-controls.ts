import { type ExtendSessionResponse, MAX_SESSION_MINUTES } from '@bali/shared';

import { type ApiClient, ApiError, NetworkError } from './api-client';
import { CANT_ADD_TIME, CANT_REACH, errText } from './errors';
import { newEventId } from './event-id';
import type { RecapFormat } from './recap';

/* The class page's controls (P10), tested: the session's length, and adding time to it. */

/** The lengths offered as presets, in minutes, and the pick when this computer remembers none. */
export const LENGTH_PRESETS = [25, 50, 75] as const;
export const DEFAULT_MINUTES = 50;
/** What each Extend button adds, in minutes. */
export const EXTEND_PRESETS = [5, 10] as const;

/**
 * The minutes typed under Other, as the Start route takes them: a whole number from 1 to
 * `MAX_SESSION_MINUTES`, spaces around it allowed; null for anything else, said before a Start
 * is sent with it.
 */
export function parseMinutes(typed: string): number | null {
  const digits = typed.trim();
  if (!/^\d+$/.test(digits)) return null;
  const minutes = Number(digits);
  return minutes >= 1 && minutes <= MAX_SESSION_MINUTES ? minutes : null;
}

/** The picker's state: a preset, or Other with the minutes typed under it. */
export interface LengthPick {
  pick: number | 'other';
  other: string;
}

/**
 * The picker as a remembered length opens it: a preset selects itself; any other length reopens
 * Other with it typed in; none remembered picks the default.
 */
export function pickFor(minutes: number | null): LengthPick {
  if (minutes === null) return { pick: DEFAULT_MINUTES, other: '' };
  return LENGTH_PRESETS.some((preset) => preset === minutes)
    ? { pick: minutes, other: '' }
    : { pick: 'other', other: String(minutes) };
}

/** Where a class's last pick is kept on this computer: a key of its own, so classes share none. */
const lengthKey = (classId: string) => `bali.session-minutes.${classId}`;

/** The browser's localStorage, or none: reading it can throw (a private window, storage off). */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The class's last pick on this computer, or null: none, unreadable, or not a length. */
export function rememberedMinutes(classId: string, storage = store()): number | null {
  try {
    return parseMinutes(storage?.getItem(lengthKey(classId)) ?? '');
  } catch {
    return null;
  }
}

/** Keep the class's pick on this computer; a storage that refuses loses only the memory. */
export function rememberMinutes(classId: string, minutes: number, storage = store()): void {
  try {
    storage?.setItem(lengthKey(classId), String(minutes));
  } catch {
    // The page works without it: the default is picked next time.
  }
}

/** One extend: the minutes to add, and the `eventId` it is sent under. */
export interface ExtendAttempt {
  minutes: number;
  eventId: string;
}

/**
 * The attempt to send `minutes` as. `unanswered` is the last one sent whose answer never came: it
 * may have landed, so the same minutes resend it, applied once (rule 4), never added twice. Other
 * minutes, or none unanswered, are a fresh attempt with a new `eventId`.
 */
export function extendAttemptFor(
  unanswered: ExtendAttempt | null,
  minutes: number,
  mint = newEventId,
): ExtendAttempt {
  return unanswered?.minutes === minutes ? unanswered : { minutes, eventId: mint() };
}

/** An extend's answer, as the page acts on it. */
export type ExtendAnswer =
  /** The time is added, or this attempt's replay: the bell is `endsAt` now. */
  | { kind: 'extended'; endsAt: string }
  /** Refused, nothing changed; `reason` says which, keyed on as `errText` is. */
  | { kind: 'refused'; message: string; reason: string | undefined }
  /** No answer to go by (unreachable, a timeout, a 5xx, over the budget): Try again resends it. */
  | { kind: 'failed'; message: string };

/**
 * What stays unanswered after `answer` to `attempt`: the attempt itself when no answer came (it
 * may have landed, so only a resend under its id is safe); nothing once the server answered, an
 * extend or a refusal, since the next press is then a new one (rule 4).
 */
export function keepUnanswered(attempt: ExtendAttempt, answer: ExtendAnswer): ExtendAttempt | null {
  return answer.kind === 'failed' ? attempt : null;
}

/** Add `attempt.minutes` to the session (`POST /v1/sessions/{id}/extend`), its answer in words. */
export async function extendSession(
  api: Pick<ApiClient, 'post'>,
  sessionId: string,
  attempt: ExtendAttempt,
): Promise<ExtendAnswer> {
  try {
    const res = await api.post<ExtendSessionResponse>(`/v1/sessions/${sessionId}/extend`, {
      durationMinutes: attempt.minutes,
      eventId: attempt.eventId,
    });
    return { kind: 'extended', endsAt: res.session.endsAt };
  } catch (e) {
    if (e instanceof NetworkError) return { kind: 'failed', message: CANT_REACH };
    // 408 and 429 are the transport's, not a refusal, as the outbox's dispositions read them.
    if (e instanceof ApiError && e.status === 429) return { kind: 'failed', message: errText(e) };
    if (e instanceof ApiError && e.status < 500 && e.status !== 408) {
      return { kind: 'refused', message: errText(e), reason: e.reason };
    }
    // A 5xx, a timeout or a body that isn't JSON: answered too, never thrown, so Try again shows.
    return { kind: 'failed', message: CANT_ADD_TIME };
  }
}

/** The bell as the page shows it beside the grid, "9:30 AM", in the viewer's locale and zone. */
export function bellTime(endsAt: string, { locale, timeZone }: RecapFormat = {}): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(
    new Date(endsAt),
  );
}

/**
 * The later of two bells. A session's window never shrinks (`extendSession` only moves `ends_at`
 * later), so a snapshot read before an extend and answered after it never takes the bell back.
 */
export function laterBell(current: string | null, next: string): string {
  return current !== null && Date.parse(current) >= Date.parse(next) ? current : next;
}
