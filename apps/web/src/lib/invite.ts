import {
  formatInviteCode,
  INVITE_CODE_PATTERN,
  inviteCodeSymbols,
  type RedeemTeacherInviteResponse,
} from '@bali/shared';

import { type ApiClient, ApiError } from './api-client';
import { errText, NOT_AN_INVITE_CODE } from './errors';
import { newEventId } from './event-id';

/* The invite-code screen's logic (T2), tested: the field, the check before sending, the redeem. */

/**
 * The field after an edit: what it holds, grouped in fives as the owner's command prints a code
 * (`formatInviteCode`) whatever the case, spaces or dashes it was typed or pasted with, and where
 * the caret goes: after the same symbols as before. The dashes are the field's, so Backspace or
 * Delete taking only a dash takes the symbol past it too, as the key meant. Only those two keys
 * (the edit's `InputEvent.inputType`) ever eat a symbol: never a paste or a cut that leaves the
 * symbols as they were, such as the same code pasted over the field without its dashes.
 */
export function typedCode(
  before: string,
  typed: string,
  caret: number,
  inputType = '',
): { value: string; caret: number } {
  let symbols = inviteCodeSymbols(typed);
  let at = inviteCodeSymbols(typed.slice(0, caret)).length;
  const key = /^deleteContent(Backward|Forward)$/.exec(inputType)?.[1];
  if (key && before.length - typed.length === 1 && symbols === inviteCodeSymbols(before)) {
    if (key === 'Forward') symbols = symbols.slice(0, at) + symbols.slice(at + 1);
    else if (at > 0) {
      symbols = symbols.slice(0, at - 1) + symbols.slice(at);
      at -= 1;
    }
  }
  return { value: formatInviteCode(symbols), caret: at + Math.floor(Math.max(at - 1, 0) / 5) };
}

/** Why `code` can't be an invite's, by the redeem's own rule, so no try is spent on it; or null. */
export function codeProblem(code: string): string | null {
  return INVITE_CODE_PATTERN.test(inviteCodeSymbols(code)) ? null : NOT_AN_INVITE_CODE;
}

/** One redeem: the code's symbols, and the `eventId` it is sent under. */
export interface Attempt {
  code: string;
  eventId: string;
}

/**
 * The attempt to send `code` as. `unanswered` is the last one sent whose answer never came (it
 * failed): it may have landed, so sending its code again resends it, the same redeem, applied
 * once (rule 4). Any other code, or none unanswered, is a fresh attempt: a refusal changed
 * nothing, so a new `eventId` can redeem nothing twice.
 */
export function attemptFor(unanswered: Attempt | null, code: string, mint = newEventId): Attempt {
  const symbols = inviteCodeSymbols(code);
  return unanswered?.code === symbols ? unanswered : { code: symbols, eventId: mint() };
}

/** The redeem's answer, as the screen acts on it. */
export type RedeemAnswer =
  /** Redeemed, or this attempt's replay: the account teaches now. */
  | { kind: 'teacher' }
  /** Refused, nothing changed; `reason` says which, keyed on as `errText` is. */
  | { kind: 'refused'; message: string; reason: string | undefined }
  /** No answer to go by (unreachable, a timeout, a 5xx, over the budget): Try again resends it. */
  | { kind: 'failed'; message: string };

/** The refusals the code itself answers for, so the field is where the person puts it right. */
export const CODE_REFUSALS: ReadonlySet<string | undefined> = new Set([
  'invite_code_invalid',
  'invite_not_found',
  'invite_used',
  'invite_expired',
]);

/** Redeem `attempt` (T1b's `POST /v1/teacher-invites/redeem`), its answer in words. */
export async function redeemInvite(
  api: Pick<ApiClient, 'post'>,
  attempt: Attempt,
): Promise<RedeemAnswer> {
  try {
    await api.post<RedeemTeacherInviteResponse>('/v1/teacher-invites/redeem', attempt);
    return { kind: 'teacher' };
  } catch (e) {
    // 408 and 429 are the transport's, not a refusal, as the outbox's dispositions read them.
    if (e instanceof ApiError && e.status < 500 && e.status !== 408 && e.status !== 429) {
      return { kind: 'refused', message: errText(e), reason: e.reason };
    }
    return { kind: 'failed', message: errText(e) };
  }
}
