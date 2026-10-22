import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SavedQuestion } from '@bali/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ApiClient,
  ApiError,
  createApiClient,
  NetworkError,
  SAVE_TIMEOUT_MS,
} from './api-client';
import { newEventId } from './event-id';
import {
  oldestFirst,
  readDrafts,
  refusalsOf,
  removeAttemptFor,
  removeDraft,
  sameWords,
  saveAttemptFor,
  saveDraft,
  trimmed,
  withoutAnswer,
} from './saved-questions';

/*
 * A teacher's saved questions (L7b, part 1): the list oldest first, what Bali refuses before it
 * saves (decision 3's limits, as the server checks them), each save's `eventId` minted after the
 * draft's own (decision 12), a reply under another `eventId` read as not saved (#318), and a
 * removal, each against a fake API.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const TAB = String.fromCharCode(9);
const ZWSP = String.fromCodePoint(0x200b);
const ZWJ = String.fromCodePoint(0x200d);

/** The time a UUIDv7 begins with, in ms. */
const timeOf = (id: string) => parseInt(id.replace(/-/g, '').slice(0, 12), 16);
const T = Date.parse('2026-10-06T14:00:00.000Z');

const draft = (over: Partial<SavedQuestion> = {}): SavedQuestion => ({
  id: '0199b000-0000-7000-8000-000000000001',
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  correctOption: 1,
  eventId: newEventId(T),
  createdAt: '2026-10-06T14:00:00.000Z',
  updatedAt: '2026-10-06T14:00:00.000Z',
  ...over,
});
const words = (prompt: string, options: string[], correctOption: number | null = null) => ({
  prompt,
  options,
  correctOption,
});

/** A fake API: each call recorded, each answered by `answer` (a value, or an error to throw). */
function fakeApi(answer: (method: string, path: string, body: unknown) => unknown) {
  const calls: [string, string, unknown][] = [];
  // Async, so an answer thrown is the call's rejection.
  const call =
    (method: string) =>
    // eslint-disable-next-line @typescript-eslint/require-await
    async (path: string, body?: unknown): Promise<never> => {
      calls.push([method, path, body]);
      return answer(method, path, body) as never;
    };
  const api: Pick<ApiClient, 'get' | 'post' | 'put' | 'del'> = {
    get: call('GET'),
    post: call('POST'),
    put: call('PUT'),
    del: call('DELETE'),
  };
  return { api, calls };
}
const refusal = (status: number, reason?: string) =>
  new ApiError(status, status === 404 ? 'not_found' : 'conflict', 'refused', reason);

describe('the list, oldest first (Questions)', () => {
  const a = draft({
    id: '0199b000-0000-7000-8000-00000000000a',
    createdAt: '2026-10-06T14:00:00.000Z',
  });
  const b = draft({
    id: '0199b000-0000-7000-8000-00000000000b',
    createdAt: '2026-10-06T14:00:00.000Z',
  });
  const c = draft({
    id: '0199b000-0000-7000-8000-00000000000c',
    createdAt: '2026-10-07T09:30:00.000Z',
  });

  it('sorts by first write, then id, as the canvas lists them', () => {
    // The API's order, newest first by first write, then id.
    expect(oldestFirst([c, b, a]).map((d) => d.id)).toEqual([a.id, b.id, c.id]);
    expect(oldestFirst([b, c, a]).map((d) => d.id)).toEqual([a.id, b.id, c.id]);
  });

  it('reads them from `GET /v1/saved-questions`, oldest first', async () => {
    const { api, calls } = fakeApi(() => ({ savedQuestions: [c, b, a] }));
    expect(await readDrafts(api)).toEqual({ kind: 'read', drafts: [a, b, c] });
    expect(calls).toEqual([['GET', '/v1/saved-questions', undefined]]);
  });

  it('says why a read failed: no answer, or refused, for the page to say with Try again', async () => {
    const offline = fakeApi(() => {
      throw new NetworkError();
    });
    expect(await readDrafts(offline.api)).toEqual({
      kind: 'failed',
      status: undefined,
      retryAfter: undefined,
    });
    const busy = fakeApi(() => {
      throw new ApiError(503, 'unavailable', 'down');
    });
    expect(await readDrafts(busy.api)).toMatchObject({ kind: 'failed', status: 503 });
    const student = fakeApi(() => {
      throw new ApiError(403, 'forbidden', 'teacher access required');
    });
    expect(await readDrafts(student.api)).toEqual({
      kind: 'refused',
      status: 403,
      reason: undefined,
    });
  });
});

describe('what Bali refuses before it saves (decision 3, as the server checks)', () => {
  it('passes a question as the canvas writes one', () => {
    expect(
      refusalsOf(words('What does the vertex tell you?', ['Lowest', 'Crosses', 'Both'])),
    ).toEqual({
      prompt: null,
      options: [null, null, null],
    });
  });

  it('refuses a question no one could see: empty, spaces, or only zero-width characters', () => {
    for (const prompt of ['', '   ', `${ZWSP}${ZWSP}`, '\n\n']) {
      expect(refusalsOf(words(prompt, ['a', 'b'])).prompt).toBe('empty');
    }
  });

  it('refuses a blank answer, each on its own', () => {
    expect(refusalsOf(words('Q', ['a', ' ', ''])).options).toEqual([null, 'empty', 'empty']);
  });

  it('refuses a tab or a hidden character pasted in, but keeps the question’s own line breaks', () => {
    expect(refusalsOf(words(`Line one${TAB}tab`, ['a', 'b'])).prompt).toBe('unshowable');
    expect(refusalsOf(words(`Soft${ZWSP}space`, ['a', 'b'])).prompt).toBe('unshowable');
    expect(refusalsOf(words('Line one\nLine two', ['a', 'b'])).prompt).toBeNull();
    expect(refusalsOf(words('Q', [`a${TAB}b`, 'c'])).options).toEqual(['unshowable', null]);
    // A joiner draws, inside an emoji: the server lets it through, and so does Bali.
    expect(refusalsOf(words(`Family 👨${ZWJ}👩${ZWJ}👧`, ['a', 'b'])).prompt).toBeNull();
  });

  it('holds each answer to 200 characters, counted in code points after trimming', () => {
    const at = 'x'.repeat(200);
    expect(refusalsOf(words('Q', [at, `  ${at}  `])).options).toEqual([null, null]);
    expect(refusalsOf(words('Q', ['x'.repeat(214), 'b'])).options).toEqual([
      { tooLong: 214 },
      null,
    ]);
    // 150 emoji are 300 UTF-16 units and 150 characters: within the limit.
    expect(refusalsOf(words('Q', ['😀'.repeat(150), 'b'])).options).toEqual([null, null]);
    expect(refusalsOf(words('Q', ['😀'.repeat(201), 'b'])).options[0]).toEqual({ tooLong: 201 });
  });

  it('checks with the server’s own patterns (display-name.ts) and its own order (questions.ts)', () => {
    const api = read('../../../api/src/display-name.ts');
    const mine = read('./saved-questions.ts');
    for (const name of ['UNPRINTABLE', 'INVISIBLE']) {
      const body = (source: string) => new RegExp(`const ${name} = /(.*)/g?u;`).exec(source)?.[1];
      expect(body(mine), name).toBeDefined();
      expect(body(mine), name).toBe(body(api));
    }
    // The server trims, keeps the question's line breaks, and counts code points.
    const text = read('../../../api/src/routes/questions.ts');
    expect(text).toMatch(/\.trim\(\)/);
    expect(text).toMatch(/\(lines \? s\.replaceAll\('\\n', ''\) : s\)\.search\(UNPRINTABLE\)/);
    expect(text).toMatch(/\[\.\.\.s\]\.length <= max/);
    expect(text).toMatch(/prompt: Text\(QUESTION_PROMPT_MAX_LENGTH, true\)/);
    expect(text).toMatch(
      /options: z\s*\.array\(Text\(QUESTION_OPTION_MAX_LENGTH\)\)\s*\.min\(QUESTION_OPTIONS_MIN\)\s*\.max\(QUESTION_OPTIONS_MAX\)/,
    );
  });

  it('is the portal’s one copy: the class page’s panel checks and says through it (#390’s review)', () => {
    // Every source file of the portal but its tests: only this one holds the server's patterns,
    // and only Your questions' form the words for what they refuse, so the panel that asks a
    // written question and the page that saves one can never drift apart.
    const src = fileURLToPath(new URL('..', import.meta.url));
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .map((f) => f.replaceAll('\\', '/'))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    const holding = (pattern: RegExp) =>
      files.filter((f) => pattern.test(readFileSync(`${src}/${f}`, 'utf8')));
    expect(holding(/\\p\{Cc\}|Default_Ignorable_Code_Point/)).toEqual(['lib/saved-questions.ts']);
    expect(
      holding(/Write the question first|Fill in this answer|Keep each answer to|hidden character/),
    ).toEqual(['components/saved-questions.tsx']);
    // Both ways in to asking go through it: the panel's form imports both, and copies neither.
    expect(read('../components/ask-panel.tsx')).toMatch(
      /import \{ readDrafts, refusalsOf, trimmed, withoutAnswer \} from '@\/lib\/saved-questions';/,
    );
  });
});

describe('the words as they change', () => {
  it('removes an answer, the correct one still marked, or none once it goes', () => {
    const four = words('Q', ['a', 'b', 'c', 'd'], 2);
    expect(withoutAnswer(four, 0)).toEqual(words('Q', ['b', 'c', 'd'], 1));
    expect(withoutAnswer(four, 3)).toEqual(words('Q', ['a', 'b', 'c'], 2));
    expect(withoutAnswer(four, 2)).toEqual(words('Q', ['a', 'b', 'd'], null));
    expect(withoutAnswer(words('Q', ['a', 'b', 'c']), 1)).toEqual(words('Q', ['a', 'c']));
  });

  it('keeps them trimmed, and knows the same words', () => {
    expect(trimmed(words(' Q \n', [' a', 'b '], 0))).toEqual(words('Q', ['a', 'b'], 0));
    expect(sameWords(words('Q', ['a', 'b'], 0), words('Q', ['a', 'b'], 0))).toBe(true);
    expect(sameWords(words('Q', ['a', 'b'], 0), words('Q', ['a', 'b'], null))).toBe(false);
    expect(sameWords(words('Q', ['a', 'b']), words('Q', ['a', 'b', 'c']))).toBe(false);
    expect(sameWords(words('Q', ['a', 'b']), words('Q!', ['a', 'b']))).toBe(false);
  });
});

describe('each save’s eventId, minted after the draft’s own (decision 12)', () => {
  it('a new question’s is a fresh UUIDv7 of now, its words trimmed', () => {
    const attempt = saveAttemptFor(null, null, words(' Q ', [' a ', 'b'], 1), T);
    expect(attempt).toMatchObject({
      draftId: null,
      prompt: 'Q',
      options: ['a', 'b'],
      correctOption: 1,
    });
    expect(attempt.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(timeOf(attempt.eventId)).toBe(T);
  });

  it('an edit’s sorts after the draft’s own, though this computer’s clock is behind it', () => {
    const ahead = draft({ eventId: newEventId(T + 3_600_000) });
    const attempt = saveAttemptFor(null, ahead, words('Q', ['a', 'b']), T);
    expect(attempt.draftId).toBe(ahead.id);
    expect(timeOf(attempt.eventId)).toBe(T + 3_600_001);
    expect(attempt.eventId > ahead.eventId).toBe(true);
    // With the clock ahead of the draft, now's.
    expect(timeOf(saveAttemptFor(null, draft(), words('Q', ['a', 'b']), T + 5).eventId)).toBe(
      T + 5,
    );
  });

  it('reads the draft’s id in any case (#319)', () => {
    const upper = draft({ eventId: newEventId(T + 60_000).toUpperCase() });
    expect(timeOf(saveAttemptFor(null, upper, words('Q', ['a', 'b']), T).eventId)).toBe(T + 60_001);
  });

  it('sends a save whose answer never came again, same words, same id; other words mint after it', () => {
    const held = draft();
    const first = saveAttemptFor(null, held, words('Q', ['a', 'b']), T + 10);
    expect(saveAttemptFor(first, held, words(' Q', ['a ', 'b']), T + 20)).toBe(first);
    // Other words: a fresh id, after the draft's and after that one's, whatever the clock says.
    const next = saveAttemptFor(first, held, words('Q2', ['a', 'b']), T);
    expect(next.eventId).not.toBe(first.eventId);
    expect(timeOf(next.eventId)).toBe(T + 11);
    // Another draft's unanswered save counts for nothing here.
    const other = saveAttemptFor(first, draft({ id: 'other' }), words('Q', ['a', 'b']), T + 30);
    expect(other).toMatchObject({ draftId: 'other' });
    expect(timeOf(other.eventId)).toBe(T + 30);
  });
});

describe('a save’s answer', () => {
  const held = draft();

  it('writes a new question with `POST`, saved under its id', async () => {
    const attempt = saveAttemptFor(null, null, words('Q', ['a', 'b'], 0), T);
    const made = draft({
      eventId: attempt.eventId,
      prompt: 'Q',
      options: ['a', 'b'],
      correctOption: 0,
    });
    const { api, calls } = fakeApi(() => ({ outcome: 'created', savedQuestion: made }));
    expect(await saveDraft(api, attempt)).toEqual({ kind: 'saved', draft: made });
    expect(calls).toEqual([
      [
        'POST',
        '/v1/saved-questions',
        { eventId: attempt.eventId, prompt: 'Q', options: ['a', 'b'], correctOption: 0 },
      ],
    ]);
  });

  it('replaces a draft whole with `PUT`, saved when answered under its id, in any case', async () => {
    const attempt = saveAttemptFor(null, held, words('Q2', ['a', 'b']), T + 10);
    const now = {
      ...held,
      prompt: 'Q2',
      options: ['a', 'b'],
      correctOption: null,
      eventId: attempt.eventId.toUpperCase(),
    };
    const { api, calls } = fakeApi(() => ({ outcome: 'replaced', savedQuestion: now }));
    expect(await saveDraft(api, attempt)).toEqual({ kind: 'saved', draft: now });
    expect(calls[0]?.slice(0, 2)).toEqual(['PUT', `/v1/saved-questions/${held.id}`]);
  });

  it('is not saved when answered under another id: a later save holds the draft (#318)', async () => {
    const attempt = saveAttemptFor(null, held, words('Mine', ['a', 'b']), T + 10);
    const theirs = { ...held, prompt: 'Theirs', eventId: newEventId(T + 20) };
    const { api } = fakeApi(() => ({ outcome: 'replay', savedQuestion: theirs }));
    const answer = await saveDraft(api, attempt);
    expect(answer).toEqual({ kind: 'not_saved', draft: theirs });
    // Saving again mints after the draft now, so it replaces theirs.
    const again = saveAttemptFor(null, theirs, words('Mine', ['a', 'b']), T + 10);
    expect(again.eventId > theirs.eventId).toBe(true);
  });

  it('says the draft is gone when it was removed meanwhile', async () => {
    const { api } = fakeApi(() => {
      throw refusal(404, 'saved_question_not_found');
    });
    expect(await saveDraft(api, saveAttemptFor(null, held, words('Q', ['a', 'b'])))).toEqual({
      kind: 'gone',
    });
  });

  it('says a save with no answer, over the budget, or refused, for Try again', async () => {
    const attempt = saveAttemptFor(null, held, words('Q', ['a', 'b']));
    const offline = fakeApi(() => {
      throw new NetworkError();
    });
    expect(await saveDraft(offline.api, attempt)).toMatchObject({
      kind: 'failed',
      status: undefined,
    });
    const budget = fakeApi(() => {
      throw new ApiError(429, 'too_many_requests', 'slow down', undefined, 2);
    });
    expect(await saveDraft(budget.api, attempt)).toEqual({
      kind: 'failed',
      status: 429,
      retryAfter: 2,
    });
    const spent = fakeApi(() => {
      throw refusal(409, 'event_id_conflict');
    });
    expect(await saveDraft(spent.api, attempt)).toEqual({
      kind: 'refused',
      status: 409,
      reason: 'event_id_conflict',
    });
  });
});

describe('a removal', () => {
  it('sends a removal whose answer never came again, under its id; else a fresh one', () => {
    const first = removeAttemptFor(undefined, 'q1', () => 'e1');
    expect(first).toEqual({ draftId: 'q1', eventId: 'e1' });
    expect(removeAttemptFor(first, 'q1', () => 'e2')).toBe(first);
    // Another draft's unanswered removal is never this one's (santa's review).
    expect(removeAttemptFor(first, 'q2', () => 'e3')).toEqual({ draftId: 'q2', eventId: 'e3' });
  });

  it('is `DELETE` with its eventId in the body, removed when answered', async () => {
    const { api, calls } = fakeApi(() => ({ outcome: 'removed', savedQuestion: draft() }));
    expect(await removeDraft(api, { draftId: 'q1', eventId: 'e1' })).toEqual({ kind: 'removed' });
    expect(calls).toEqual([['DELETE', '/v1/saved-questions/q1', { eventId: 'e1' }]]);
  });

  it('counts a draft already gone as removed, and says one with no answer, or refused', async () => {
    const gone = fakeApi(() => {
      throw refusal(404, 'saved_question_not_found');
    });
    expect(await removeDraft(gone.api, { draftId: 'q1', eventId: 'e1' })).toEqual({
      kind: 'removed',
    });
    const offline = fakeApi(() => {
      throw new NetworkError();
    });
    expect(await removeDraft(offline.api, { draftId: 'q1', eventId: 'e1' })).toMatchObject({
      kind: 'failed',
    });
    const other = fakeApi(() => {
      throw new ApiError(403, 'forbidden', 'not your question');
    });
    expect(await removeDraft(other.api, { draftId: 'q1', eventId: 'e1' })).toEqual({
      kind: 'refused',
      status: 403,
      reason: undefined,
    });
  });
});

describe('a save or a removal the network swallows (the owner, 2026-10-16)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * The API client over a fetch that swallows its first request (no answer until its limit gives up
   * on it) and answers each after it with `body`, each request's method, path and body kept.
   */
  function swallowsFirst(body: unknown) {
    const sent: { method?: string; path: string; body: unknown }[] = [];
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: (url, init) => {
        sent.push({
          method: init?.method,
          path: (url as string).replace('http://api', ''),
          body: JSON.parse(init?.body as string) as unknown,
        });
        if (sent.length > 1) return Promise.resolve(Response.json(body));
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      },
    });
    return { client, sent };
  }
  /** `run`'s answer once `ms` has passed, and whether it had come before then. */
  async function after<A>(ms: number, run: Promise<A>): Promise<{ early: boolean; answer: A }> {
    let early = false;
    void run.then(() => (early = true));
    await vi.advanceTimersByTimeAsync(ms - 1);
    const before = early;
    await vi.advanceTimersByTimeAsync(1);
    return { early: before, answer: await run };
  }

  it('fails a new question’s save at SAVE_TIMEOUT_MS; Try again sends it again under its id, never a second draft', async () => {
    const typed = words('Q', ['a', 'b'], 0);
    const attempt = saveAttemptFor(null, null, typed, T);
    const made = draft({ eventId: attempt.eventId, prompt: 'Q', options: ['a', 'b'] });
    const { client, sent } = swallowsFirst({ outcome: 'replay', savedQuestion: made });
    const first = await after(SAVE_TIMEOUT_MS, saveDraft(client, attempt));
    expect(first).toEqual({
      early: false,
      answer: { kind: 'failed', status: undefined, retryAfter: undefined },
    });
    // The same words: the same attempt, whose replay answers the draft the first one made.
    const again = saveAttemptFor(attempt, null, typed, T + SAVE_TIMEOUT_MS);
    expect(again).toBe(attempt);
    expect(await saveDraft(client, again)).toEqual({ kind: 'saved', draft: made });
    expect(sent.map((s) => [s.method, s.path, (s.body as { eventId: string }).eventId])).toEqual([
      ['POST', '/v1/saved-questions', attempt.eventId],
      ['POST', '/v1/saved-questions', attempt.eventId],
    ]);
  });

  it('fails an edit’s save the same way, sent again under its id', async () => {
    const held = draft();
    const attempt = saveAttemptFor(null, held, words('Q2', ['a', 'b']), T + 10);
    const now = { ...held, prompt: 'Q2', options: ['a', 'b'], eventId: attempt.eventId };
    const { client, sent } = swallowsFirst({ outcome: 'replay', savedQuestion: now });
    const first = await after(SAVE_TIMEOUT_MS, saveDraft(client, attempt));
    expect(first).toMatchObject({ early: false, answer: { kind: 'failed', status: undefined } });
    const again = saveAttemptFor(attempt, held, words('Q2', ['a', 'b']), T + 20);
    expect(again).toBe(attempt);
    expect(await saveDraft(client, again)).toEqual({ kind: 'saved', draft: now });
    expect(sent.map((s) => [s.method, (s.body as { eventId: string }).eventId])).toEqual([
      ['PUT', attempt.eventId],
      ['PUT', attempt.eventId],
    ]);
  });

  it('fails a removal the same way, sent again under its id by its Remove', async () => {
    const attempt = removeAttemptFor(undefined, 'q1', () => 'e1');
    const { client, sent } = swallowsFirst({ outcome: 'replay', savedQuestion: draft() });
    const first = await after(SAVE_TIMEOUT_MS, removeDraft(client, attempt));
    expect(first).toMatchObject({ early: false, answer: { kind: 'failed', status: undefined } });
    const again = removeAttemptFor(attempt, 'q1', () => 'e2');
    expect(await removeDraft(client, again)).toEqual({ kind: 'removed' });
    expect(sent.map((s) => [s.method, s.path, s.body])).toEqual([
      ['DELETE', '/v1/saved-questions/q1', { eventId: 'e1' }],
      ['DELETE', '/v1/saved-questions/q1', { eventId: 'e1' }],
    ]);
  });
});
