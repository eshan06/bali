import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient, NetworkError } from './api-client';
import { errText, NOT_AN_INVITE_CODE, TOO_MANY_TRIES, TOO_MANY_TRIES_MINUTE } from './errors';
import { attemptFor, CODE_REFUSALS, codeProblem, redeemInvite, typedCode } from './invite';

// A code as the owner's command prints it (T1a), and its symbols as minted.
const SHOWN = 'ABCDE-FGHJK-MNPQR-STUVW-XYZ23';
const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23';

/** The field after typing `typed` with the caret at its end. */
const typed = (before: string, text: string) => typedCode(before, text, text.length);

describe('typedCode', () => {
  it('groups the code in fives as it is typed, upper case, the caret after the last symbol', () => {
    expect(typed('', 'a')).toEqual({ value: 'A', caret: 1 });
    expect(typed('ABCD', 'ABCDe')).toEqual({ value: 'ABCDE', caret: 5 });
    expect(typed('ABCDE', 'ABCDEf')).toEqual({ value: 'ABCDE-F', caret: 7 });
    expect(typed('ABCDE-FGHJK', 'ABCDE-FGHJK-')).toEqual({ value: 'ABCDE-FGHJK', caret: 11 });
  });

  it('takes a pasted code in any case, with or without its dashes and spaces, as the mint printed it', () => {
    for (const pasted of [
      SHOWN,
      SHOWN.toLowerCase(),
      CODE,
      SHOWN.replaceAll('-', ' '),
      SHOWN.replaceAll('-', ' – '),
      `\t${SHOWN}\n`,
    ]) {
      expect(typed('', pasted), pasted).toEqual({ value: SHOWN, caret: 29 });
    }
  });

  it('keeps what can’t be a code’s in view, a 26th symbol and an O included, for the check to say', () => {
    expect(typed(SHOWN, `${SHOWN}a`).value).toBe(`${SHOWN}-A`);
    expect(typed('', 'abcdo').value).toBe('ABCDO');
  });

  it('keeps the caret after the same symbols when one is typed or deleted inside the code', () => {
    // An X typed after the E, before the first dash.
    expect(typedCode('ABCDE-FGHJK', 'ABCDEX-FGHJK', 6)).toEqual({
      value: 'ABCDE-XFGHJ-K',
      caret: 7,
    });
    // The G deleted with Backspace.
    expect(typedCode('ABCDE-FGHJK', 'ABCDE-FHJK', 7)).toEqual({ value: 'ABCDE-FHJK', caret: 7 });
    // A code pasted over the start of another.
    expect(typedCode('ABCDE', 'zzABCDE', 2)).toEqual({ value: 'ZZABC-DE', caret: 2 });
  });

  it('takes the symbol past a dash when Backspace or Delete takes only the dash', () => {
    // Backspace after the dash: the E goes, and the caret with it.
    expect(typedCode('ABCDE-FGHJK', 'ABCDEFGHJK', 5, 'deleteContentBackward')).toEqual({
      value: 'ABCDF-GHJK',
      caret: 4,
    });
    // Delete before the dash: the F goes, and the caret stays.
    expect(typedCode('ABCDE-FGHJK', 'ABCDEFGHJK', 5, 'deleteContentForward')).toEqual({
      value: 'ABCDE-GHJK',
      caret: 5,
    });
  });

  it('eats nothing when an edit only seems to take a dash: the code pasted over itself, a dash cut', () => {
    // Select all, and paste the same code without its dashes: 25 characters over 29 (#198's review).
    expect(typedCode(SHOWN, CODE, 25)).toEqual({ value: SHOWN, caret: 29 });
    expect(typedCode(SHOWN, CODE.toLowerCase(), 25, 'insertFromPaste')).toEqual({
      value: SHOWN,
      caret: 29,
    });
    // A dash cut on its own comes back, and nothing else goes.
    expect(typedCode('ABCDE-FGHJK', 'ABCDEFGHJK', 5, 'deleteByCut')).toEqual({
      value: 'ABCDE-FGHJK',
      caret: 5,
    });
  });
});

describe('codeProblem', () => {
  it('finds none in a whole code, however it was typed', () => {
    for (const code of [SHOWN, SHOWN.toLowerCase(), CODE, SHOWN.replaceAll('-', ' ')]) {
      expect(codeProblem(code), code).toBeNull();
    }
  });

  it('says what an invite code is for anything else, so no try is spent on it', () => {
    for (const code of ['', CODE.slice(1), `${CODE}A`, `${CODE.slice(1)}O`, `${CODE.slice(1)}0`]) {
      expect(codeProblem(code), code).toBe(NOT_AN_INVITE_CODE);
    }
    for (const symbol of ['1', 'I', 'L', 'i', 'l', 'o']) {
      expect(codeProblem(`${CODE.slice(1)}${symbol}`), symbol).toBe(NOT_AN_INVITE_CODE);
    }
  });
});

describe('attemptFor', () => {
  let minted = 0;
  const mint = () => `event-${++minted}`;

  it('sends a fresh code as a fresh attempt, its symbols and a new eventId', () => {
    expect(attemptFor(null, SHOWN, mint)).toEqual({ code: CODE, eventId: 'event-1' });
    expect(attemptFor(null, SHOWN).eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resends the attempt whose answer never came, however its code is typed now', () => {
    const unanswered = { code: CODE, eventId: 'event-sent' };
    for (const code of [SHOWN, CODE.toLowerCase(), SHOWN.replaceAll('-', ' ')]) {
      expect(attemptFor(unanswered, code, mint)).toBe(unanswered);
    }
  });

  it('sends another code as a new attempt', () => {
    const unanswered = { code: CODE, eventId: 'event-sent' };
    expect(attemptFor(unanswered, `${CODE.slice(1)}A`, mint).eventId).not.toBe('event-sent');
  });
});

describe('redeemInvite', () => {
  const attempt = { code: CODE, eventId: '0192a3b4-c5d6-7e7f-8a9b-0c1d2e3f4a5b' };

  /** The API client over a fetch that answers `status` with `body`, every request recorded. */
  function api(status: number, body: unknown, headers: Record<string, string> = {}) {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: (url, init) => {
        sent.push({ url: url as string, init });
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json', ...headers },
          }),
        );
      },
    });
    return { client, sent };
  }
  const user = { id: 'u1', role: 'teacher', displayName: 'Ms. Rivera' };

  it('sends the code and its eventId, and a redeem or its replay makes the account a teacher', async () => {
    for (const outcome of ['redeemed', 'replay']) {
      const { client, sent } = api(200, { outcome, user });
      expect(await redeemInvite(client, attempt)).toEqual({ kind: 'teacher' });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toBe('http://api/v1/teacher-invites/redeem');
      expect(sent[0]?.init?.method).toBe('POST');
      expect(JSON.parse(sent[0]?.init?.body as string)).toEqual(attempt);
    }
  });

  it('says each refusal in its words, keyed on its reason, and nothing to resend', async () => {
    for (const [status, code, reason] of [
      [400, 'bad_input', 'invite_code_invalid'],
      [404, 'not_found', 'invite_not_found'],
      [409, 'conflict', 'invite_used'],
      [409, 'conflict', 'invite_expired'],
      [409, 'conflict', 'already_teacher'],
      [409, 'conflict', 'student_in_class'],
    ] as const) {
      const { client } = api(status, { error: { code, reason, message: 'a log line' } });
      const message = errText(new ApiError(status, code, 'a log line', reason));
      expect(message, reason).not.toBe('a log line');
      expect(await redeemInvite(client, attempt), reason).toEqual({
        kind: 'refused',
        message,
        reason,
      });
    }
  });

  it('puts the code’s own refusals, and only those, back in the field', () => {
    expect([...CODE_REFUSALS].sort()).toEqual([
      'invite_code_invalid',
      'invite_expired',
      'invite_not_found',
      'invite_used',
    ]);
  });

  it('keeps an answer that never came, a timeout, a server error or the budget’s 429, to try again', async () => {
    const unreachable = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () => Promise.reject(new Error('offline')),
    });
    expect(await redeemInvite(unreachable, attempt)).toEqual({
      kind: 'failed',
      message: new NetworkError().message,
    });
    const busy = api(429, {
      error: { code: 'rate_limited', message: 'too many invite-code tries' },
    });
    expect(await redeemInvite(busy.client, attempt)).toEqual({
      kind: 'failed',
      message: TOO_MANY_TRIES,
    });
    // The invite budget's tries come back one a minute, and its Retry-After says so (S4a).
    const spent = api(
      429,
      { error: { code: 'rate_limited', message: 'too many invite-code tries' } },
      { 'retry-after': '60' },
    );
    expect(await redeemInvite(spent.client, attempt)).toEqual({
      kind: 'failed',
      message: TOO_MANY_TRIES_MINUTE,
    });
    const broken = api(500, { error: { code: 'internal', message: 'internal error' } });
    expect(await redeemInvite(broken.client, attempt)).toEqual({
      kind: 'failed',
      message: 'internal error',
    });
    // A proxy's timeout is the transport's, as the outbox reads it (#198's review): resend it.
    const slow = api(408, { message: 'request timeout' });
    expect((await redeemInvite(slow.client, attempt)).kind).toBe('failed');
  });
});
