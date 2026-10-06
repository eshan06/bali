import { type ClassDetail, type ExtendSessionResponse, MAX_SESSION_MINUTES } from '@bali/shared';

import { type ApiClient, ApiError, NetworkError } from './api-client';
import { CANT_ADD_TIME, CANT_MAKE_CODE, CANT_REACH, errText } from './errors';
import { newEventId } from './event-id';
import type { RecapFormat } from './recap';

/*
 * The class page's controls, tested: the session's length and adding time (P10), a new code (P11),
 * and Present kept for the tab.
 */

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

/**
 * The browser's localStorage (this computer's) or sessionStorage (this tab's), or none: reading
 * either can throw (a private window, site data blocked).
 */
function store(kind: 'localStorage' | 'sessionStorage' = 'localStorage'): Storage | null {
  try {
    return typeof globalThis[kind] === 'undefined' ? null : globalThis[kind];
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

/** Where a class's Present is kept for the tab: a key of its own, so classes share none. */
const presentKey = (classId: string) => `bali.present.${classId}`;

/**
 * Whether this tab left the class's page in Present (DESIGN.md §5), so a reload or a return from
 * Reports comes back in it; off when none is kept or it can't be read.
 */
export function rememberedPresent(classId: string, storage = store('sessionStorage')): boolean {
  try {
    return storage?.getItem(presentKey(classId)) === 'on';
  } catch {
    return false;
  }
}

/**
 * Keep Present for this tab alone (sessionStorage), so a new tab or window opens in the teacher's
 * view; a storage that refuses loses only the memory.
 */
export function rememberPresent(
  classId: string,
  on: boolean,
  storage = store('sessionStorage'),
): void {
  try {
    if (on) storage?.setItem(presentKey(classId), 'on');
    else storage?.removeItem(presentKey(classId));
  } catch {
    // The page works without it: a reload opens off, as before.
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

/** A new join code's answer, as the control acts on it (P11). */
export type NewCodeAnswer =
  /** The class with its new code; the old one stopped working as the answer came. */
  | { kind: 'made'; klass: ClassDetail }
  /** No new code to show (no answer, or a refusal): Try again sends it again. */
  | { kind: 'failed'; message: string };

/**
 * Mint the class a new join code (`PATCH /v1/classes/{id}`, `regenerateCode`); `shown` is the code
 * on screen. The route takes no `eventId`, so a resend mints once more, and any failure may be sent
 * again as it was. An answer that never came may still be a new code, minted before the answer was
 * lost: the class is read again then (#247's review, `codeMoved`), and a code other than `shown` is
 * the one Bali holds now, answered as made. A read that fails too, or reaches the server before the
 * mint commits, leaves the failure said; the control reads once more if the teacher cancels then.
 */
export async function regenerateCode(
  api: Pick<ApiClient, 'patch' | 'get'>,
  classId: string,
  shown: string,
): Promise<NewCodeAnswer> {
  let message: string;
  try {
    const klass = await api.patch<ClassDetail>(`/v1/classes/${classId}`, { regenerateCode: true });
    return { kind: 'made', klass };
  } catch (e) {
    // Refused (a 4xx, the budget's 429 included): nothing was minted, so nothing to read again.
    if (e instanceof ApiError && e.status < 500 && e.status !== 408) {
      return { kind: 'failed', message: errText(e) };
    }
    message = e instanceof NetworkError ? CANT_REACH : CANT_MAKE_CODE;
  }
  const klass = await codeMoved(api, classId, shown);
  return klass ? { kind: 'made', klass } : { kind: 'failed', message };
}

/**
 * The class as Bali holds it, when its code is no longer `shown` (a mint landed, this tab's or
 * another's); null while it still is, or when the read fails, which is never thrown.
 */
export async function codeMoved(
  api: Pick<ApiClient, 'get'>,
  classId: string,
  shown: string,
): Promise<ClassDetail | null> {
  try {
    const klass = await api.get<ClassDetail>(`/v1/classes/${classId}`);
    return klass.joinCode === shown ? null : klass;
  } catch {
    return null;
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
