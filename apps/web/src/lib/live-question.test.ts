import type { QuestionResults, TeacherQuestion } from '@bali/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ApiClient,
  ApiError,
  createApiClient,
  NetworkError,
  POLL_TIMEOUT_MS,
} from './api-client';
import {
  closeAttemptFor,
  closeQuestion,
  DONE_CHANNEL,
  doneChannel,
  type DoneNews,
  LONGEST_WAIT_MS,
  openAttemptFor,
  openQuestion,
  type PageVisibility,
  pollResults,
  questionAfter,
  type QuestionDraft,
  POLL_EVERY_MS,
  type ResultsState,
} from './live-question';
import { keepUnanswered } from './session-controls';

const SESSION = '01924b2c-0000-7000-8000-000000000001';
const QUESTION = '01924b2c-0000-7000-8000-000000000003';
const EVENT = '0192a3b4-c5d6-7e7f-8a9b-0c1d2e3f4a5b';
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const question = (over: Partial<TeacherQuestion> = {}): TeacherQuestion => ({
  id: QUESTION,
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  correctOption: 1,
  revealed: false,
  open: true,
  ...over,
});
const draft = { prompt: 'Which?', options: ['x = 1', 'x = 2'], correctOption: 1 };

/** The API client over a fetch that answers `status` with `body`, every request recorded. */
function api(status: number, body: unknown, headers: Record<string, string> = {}) {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'tok',
    fetchImpl: (url, init) => {
      sent.push({ url: url as string, init });
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        }),
      );
    },
  });
  return { client, sent };
}
const unreachable = createApiClient({
  baseUrl: 'http://api',
  getToken: () => 'tok',
  fetchImpl: () => Promise.reject(new Error('offline')),
});
const refusal = (status: number, reason?: string, headers: Record<string, string> = {}) =>
  api(status, { error: { code: 'x', reason, message: 'a log line' } }, headers).client;

describe('openAttemptFor and closeAttemptFor', () => {
  let minted = 0;
  const mint = () => `event-${++minted}`;

  it('mint a fresh UUIDv7 for a new question and a new close', () => {
    expect(openAttemptFor(null, SESSION, draft).eventId).toMatch(V7);
    expect(closeAttemptFor(null, QUESTION, true).eventId).toMatch(V7);
  });

  it('resend the attempt whose answer never came for the same words, never a second question', () => {
    const unanswered = openAttemptFor(null, SESSION, draft, mint);
    expect(unanswered).toEqual({ ...draft, sessionId: SESSION, eventId: 'event-1' });
    expect(openAttemptFor(unanswered, SESSION, { ...draft, options: ['x = 1', 'x = 2'] })).toBe(
      unanswered,
    );
    const close = closeAttemptFor(null, QUESTION, false, mint);
    expect(closeAttemptFor(close, QUESTION, false, mint)).toBe(close);
  });

  it('send other words, another choice, question or session as a new attempt', () => {
    const unanswered = openAttemptFor(null, SESSION, draft, mint);
    const others: [string, QuestionDraft][] = [
      [SESSION, { ...draft, prompt: 'Which one?' }],
      [SESSION, { ...draft, options: ['x = 2', 'x = 1'] }],
      [SESSION, { ...draft, options: ['x = 1', 'x = 2', 'x = 4'] }],
      [SESSION, { ...draft, correctOption: null }],
      ['01924b2c-0000-7000-8000-000000000009', draft],
    ];
    for (const [sessionId, other] of others) {
      expect(openAttemptFor(unanswered, sessionId, other, mint).eventId).not.toBe(
        unanswered.eventId,
      );
    }
    const close = closeAttemptFor(null, QUESTION, false, mint);
    expect(closeAttemptFor(close, QUESTION, true, mint).eventId).not.toBe(close.eventId);
    expect(closeAttemptFor(close, SESSION, false, mint).eventId).not.toBe(close.eventId);
  });

  it('keep their own copy of the options, so an edit after sending is a new question', () => {
    const options = ['x = 1', 'x = 2'];
    const attempt = openAttemptFor(null, SESSION, { ...draft, options }, mint);
    options[0] = 'x = 3';
    expect(attempt.options).toEqual(['x = 1', 'x = 2']);
    expect(openAttemptFor(attempt, SESSION, { ...draft, options }, mint)).not.toBe(attempt);
  });

  it('stay unanswered only while no answer came, never after the question or a refusal', () => {
    const attempt = openAttemptFor(null, SESSION, draft, mint);
    expect(keepUnanswered(attempt, { kind: 'failed', status: 500, retryAfter: undefined })).toBe(
      attempt,
    );
    expect(keepUnanswered(attempt, { kind: 'opened', question: question() })).toBeNull();
    expect(
      keepUnanswered(attempt, { kind: 'refused', status: 409, reason: 'session_not_running' }),
    ).toBeNull();
  });
});

describe('openQuestion', () => {
  const attempt = { ...draft, sessionId: SESSION, eventId: EVENT };

  it('sends the words under the eventId and answers the question, a replay’s as it is now', async () => {
    const { client, sent } = api(200, { outcome: 'opened', question: question() });
    expect(await openQuestion(client, attempt)).toEqual({ kind: 'opened', question: question() });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`http://api/v1/sessions/${SESSION}/questions`);
    expect(sent[0]?.init?.method).toBe('POST');
    expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({ ...draft, eventId: EVENT });
    // The open's retry after the bell: the question it opened, closed since.
    const closed = question({ open: false });
    const replay = api(200, { outcome: 'replay', question: closed });
    expect(await openQuestion(replay.client, attempt)).toEqual({
      kind: 'opened',
      question: closed,
    });
  });

  it('types a refusal by its reason: the session ended first, a spent id, words refused', async () => {
    expect(await openQuestion(refusal(409, 'session_not_running'), attempt)).toEqual({
      kind: 'refused',
      status: 409,
      reason: 'session_not_running',
    });
    expect(await openQuestion(refusal(409, 'event_id_conflict'), attempt)).toEqual({
      kind: 'refused',
      status: 409,
      reason: 'event_id_conflict',
    });
    expect(await openQuestion(refusal(400), attempt)).toEqual({
      kind: 'refused',
      status: 400,
      reason: undefined,
    });
  });

  it('answers no answer, a timeout, a server error and the budget’s 429 as failed, its wait kept', async () => {
    const failed = (status: number | undefined, retryAfter?: number) => ({
      kind: 'failed',
      status,
      retryAfter,
    });
    expect(await openQuestion(unreachable, attempt)).toEqual(failed(undefined));
    expect(await openQuestion(refusal(500), attempt)).toEqual(failed(500));
    expect(await openQuestion(refusal(408), attempt)).toEqual(failed(408));
    expect(await openQuestion(refusal(429, undefined, { 'retry-after': '7' }), attempt)).toEqual(
      failed(429, 7),
    );
    // A 200 whose body isn't JSON (a proxy's page): answered, never thrown.
    expect(await openQuestion(api(200, '<html>').client, attempt)).toEqual(failed(undefined));
  });
});

describe('closeQuestion', () => {
  it('sends the choice under the eventId and answers the question now', async () => {
    const closed = question({ open: false, revealed: true });
    const { client, sent } = api(200, { outcome: 'closed', question: closed });
    const attempt = { questionId: QUESTION, reveal: true, eventId: EVENT };
    expect(await closeQuestion(client, attempt)).toEqual({ kind: 'closed', question: closed });
    expect(sent[0]?.url).toBe(`http://api/v1/questions/${QUESTION}/close`);
    expect(sent[0]?.init?.method).toBe('POST');
    expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({ reveal: true, eventId: EVENT });
  });

  it('answers a question the bell or another tab closed first as it is, revealing nothing', async () => {
    const closed = question({ open: false });
    const { client } = api(200, { outcome: 'replay', question: closed });
    const attempt = { questionId: QUESTION, reveal: true, eventId: EVENT };
    expect(await closeQuestion(client, attempt)).toEqual({ kind: 'closed', question: closed });
  });

  it('types its failures as an open’s are', async () => {
    const attempt = { questionId: QUESTION, reveal: false, eventId: EVENT };
    expect(await closeQuestion(refusal(404, 'question_not_found'), attempt)).toEqual({
      kind: 'refused',
      status: 404,
      reason: 'question_not_found',
    });
    expect(await closeQuestion(unreachable, attempt)).toEqual({
      kind: 'failed',
      status: undefined,
      retryAfter: undefined,
    });
    expect(await closeQuestion(refusal(502), attempt)).toMatchObject({
      kind: 'failed',
      status: 502,
    });
  });
});

describe('questionAfter', () => {
  const closedEvent = (revealed: boolean, id = QUESTION) => ({
    type: 'question_closed' as const,
    payload: { question_id: id, revealed, closed_by: 'teacher' },
  });

  it('closes the question the stream says closed, revealed as its close was', () => {
    expect(questionAfter(question(), closedEvent(true))).toEqual(
      question({ open: false, revealed: true }),
    );
    expect(questionAfter(question(), closedEvent(false))).toEqual(question({ open: false }));
  });

  it('leaves the question for another’s close, one closed already, and any other event', () => {
    const open = question();
    expect(questionAfter(open, closedEvent(true, SESSION))).toBe(open);
    const closed = question({ open: false });
    expect(questionAfter(closed, closedEvent(true))).toBe(closed);
    expect(questionAfter(null, closedEvent(true))).toBeNull();
    expect(questionAfter(open, { type: 'tap_in', payload: null })).toBe(open);
    expect(questionAfter(open, { type: 'slide_shown', payload: { deck_id: null } })).toBe(open);
  });

  it('says unknown once another question opened, whose words only the snapshot carries', () => {
    const open = question();
    const opened = (id: unknown) => ({
      type: 'question_opened' as const,
      payload: { question_id: id },
    });
    expect(questionAfter(open, opened(QUESTION))).toBe(open);
    expect(questionAfter(open, opened(SESSION))).toBe('unknown');
    expect(questionAfter(null, opened(QUESTION))).toBe('unknown');
    expect(questionAfter(question({ open: false }), opened(SESSION))).toBe('unknown');
  });

  it('reads a payload it can’t use as naming no question', () => {
    const open = question();
    expect(questionAfter(open, { type: 'question_closed', payload: null })).toBe(open);
    expect(questionAfter(open, { type: 'question_closed', payload: 'x' })).toBe(open);
    expect(questionAfter(open, { type: 'question_opened', payload: null })).toBe('unknown');
    // Held or not (#332's review): an open naming no question is one only the snapshot knows.
    expect(questionAfter(null, { type: 'question_opened', payload: null })).toBe('unknown');
    expect(questionAfter(null, { type: 'question_opened', payload: {} })).toBe('unknown');
  });
});

describe('doneChannel: a Done told to every Bali window of this browser (L7, part 3)', () => {
  // Node's BroadcastChannel, as a browser's: every other channel of the name, never the teller.
  const NEWS: DoneNews = { sessionId: SESSION, questionId: QUESTION };
  const ends: { close(): void }[] = [];
  /** One window's end of the channel, closed after each test. */
  function aWindow() {
    const onDone = vi.fn<(news: DoneNews) => void>();
    const channel = doneChannel(onDone);
    ends.push(channel);
    return { channel, onDone };
  }
  afterEach(() => {
    for (const end of ends.splice(0)) end.close();
    vi.unstubAllGlobals();
  });

  it('tells every other window, never the one that told it', async () => {
    const [a, b, c] = [aWindow(), aWindow(), aWindow()];
    a.channel.tell(NEWS);
    await vi.waitFor(() => {
      expect(b.onDone).toHaveBeenCalledWith(NEWS);
      expect(c.onDone).toHaveBeenCalledWith(NEWS);
    });
    // Another window's Done after it: the first hears that one, and never heard its own.
    const later = { ...NEWS, questionId: EVENT };
    b.channel.tell(later);
    await vi.waitFor(() => expect(a.onDone).toHaveBeenCalledOnce());
    expect(a.onDone).toHaveBeenCalledWith(later);
    expect(b.onDone.mock.calls).toEqual([[NEWS]]);
    expect(c.onDone.mock.calls).toEqual([[NEWS], [later]]);
  });

  it('tells the two ids alone, and hears only news of that shape', async () => {
    const heard = aWindow();
    const other = new BroadcastChannel(DONE_CHANNEL);
    try {
      for (const junk of [
        'x',
        null,
        7,
        {},
        { sessionId: SESSION },
        { sessionId: 1, questionId: QUESTION },
        { sessionId: SESSION, questionId: [QUESTION] },
      ]) {
        other.postMessage(junk);
      }
      other.postMessage({ ...NEWS, student: 'Ana Rodríguez' });
      await vi.waitFor(() => expect(heard.onDone).toHaveBeenCalled());
      expect(heard.onDone.mock.calls).toEqual([[NEWS]]);
      // Whatever else a caller's news held, the channel carries the two ids.
      const carried = new Promise<unknown>((resolve) => {
        other.onmessage = (e: MessageEvent<unknown>) => resolve(e.data);
      });
      aWindow().channel.tell({ ...NEWS, student: 'Ana Rodríguez' } as DoneNews);
      expect(await carried).toEqual(NEWS);
    } finally {
      other.close();
    }
  });

  it('hears nothing once closed', async () => {
    const [gone, still, teller] = [aWindow(), aWindow(), aWindow()];
    gone.channel.close();
    teller.channel.tell(NEWS);
    await vi.waitFor(() => expect(still.onDone).toHaveBeenCalledOnce());
    expect(gone.onDone).not.toHaveBeenCalled();
  });

  it('is one channel for the browser, by its name', () => {
    const names: string[] = [];
    class Named {
      onmessage = null;
      constructor(name: string) {
        names.push(name);
      }
      postMessage() {}
      close() {}
    }
    doneChannel(vi.fn(), Named as unknown as typeof BroadcastChannel).close();
    expect(names).toEqual([DONE_CHANNEL]);
  });

  it('tells and hears nothing in a browser without one: Done stays the window’s own', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const onDone = vi.fn();
    const none = doneChannel(onDone);
    expect(() => {
      none.tell(NEWS);
      none.close();
    }).not.toThrow();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('pollResults', () => {
  type Reply = { body: QuestionResults; etag: string } | null | Error;
  const results = (over: Partial<QuestionResults> = {}): QuestionResults => ({
    answered: 2,
    eligible: 27,
    open: true,
    correctOption: 1,
    revealed: false,
    counts: null,
    ...over,
  });
  const tagged = (etag: string, over: Partial<QuestionResults> = {}) => ({
    body: results(over),
    etag,
  });

  /** A results route answering `replies` in turn, then `304`s; each read's time and tag kept. */
  function server(...replies: (Reply | (() => Promise<unknown>))[]) {
    const reads: { at: number; etag: string | null }[] = [];
    const api: Pick<ApiClient, 'getTagged'> = {
      getTagged: <T>(path: string, etag: string | null) => {
        expect(path).toBe(`/v1/questions/${QUESTION}/results`);
        reads.push({ at: Date.now() - t0, etag });
        const reply = replies.length > 0 ? replies.shift() : null;
        const answer =
          typeof reply === 'function'
            ? reply()
            : reply instanceof Error
              ? Promise.reject(reply)
              : Promise.resolve(reply);
        return answer as Promise<{ body: T; etag: string | null } | null>;
      },
    };
    return { api, reads };
  }

  /** A page whose visibility a test turns, as a browser does on a tab switch. */
  function page(visibilityState: DocumentVisibilityState = 'visible') {
    const doc = Object.assign(new EventTarget(), { visibilityState });
    const turn = (to: DocumentVisibilityState) => {
      doc.visibilityState = to;
      doc.dispatchEvent(new Event('visibilitychange'));
    };
    return { doc: doc as unknown as PageVisibility, turn };
  }

  /** A reply held until the test lets it go. */
  function held() {
    let release!: (reply: { body: QuestionResults; etag: string } | null) => void;
    const promise = new Promise<{ body: QuestionResults; etag: string } | null>((resolve) => {
      release = resolve;
    });
    return { reply: () => promise, release };
  }

  let t0 = 0;
  const states: ResultsState[] = [];
  const onChange = (state: ResultsState) => states.push(state);
  const last = () => states.at(-1);
  const after = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    t0 = Date.now();
    states.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads at once, then 2 s after each answer, sending the tag it kept', async () => {
    const { api, reads } = server(tagged('"a"'), null, tagged('"b"', { answered: 3 }));
    const poll = pollResults(api, QUESTION, onChange, page().doc);
    await after(0);
    expect(reads).toEqual([{ at: 0, etag: null }]);
    expect(last()).toEqual({ results: results(), final: false, problem: null });
    await after(POLL_EVERY_MS - 1);
    expect(reads).toHaveLength(1);
    await after(1);
    await after(POLL_EVERY_MS);
    expect(reads).toEqual([
      { at: 0, etag: null },
      { at: 2000, etag: '"a"' },
      { at: 4000, etag: '"a"' },
    ]);
    await after(POLL_EVERY_MS);
    expect(reads[3]).toEqual({ at: 6000, etag: '"b"' });
    poll.stop();
  });

  it('keeps the counts it read through a 304, saying nothing new until they change', async () => {
    const counted = { answered: 3, counts: [0, 2, 1, 0] };
    const { api } = server(tagged('"a"', counted), null, null, tagged('"b"', { answered: 4 }));
    const poll = pollResults(api, QUESTION, onChange, page().doc);
    await after(0);
    await after(2 * POLL_EVERY_MS);
    expect(states).toEqual([{ results: results(counted), final: false, problem: null }]);
    await after(POLL_EVERY_MS);
    expect(states).toHaveLength(2);
    expect(last()?.results).toEqual(results({ answered: 4 }));
    poll.stop();
  });

  it('stops after one more read once a read sees it closed: a read at the bell can be one short', async () => {
    const { api, reads } = server(
      tagged('"a"', { answered: 19 }),
      tagged('"b"', { answered: 20, open: false }),
      tagged('"c"', { answered: 21, open: false }),
    );
    pollResults(api, QUESTION, onChange, page().doc);
    await after(0);
    await after(POLL_EVERY_MS);
    expect(last()).toMatchObject({ results: { answered: 20, open: false }, final: false });
    await after(POLL_EVERY_MS);
    expect(last()).toEqual({
      results: results({ answered: 21, open: false }),
      final: true,
      problem: null,
    });
    await after(10 * POLL_EVERY_MS);
    expect(reads).toHaveLength(3);
  });

  it('takes the stream’s question_closed the same way, never counting a read begun before it', async () => {
    const inFlight = held();
    const { api, reads } = server(inFlight.reply, tagged('"b"', { answered: 21, open: false }));
    const poll = pollResults(api, QUESTION, onChange, page().doc);
    await after(0);
    poll.closed(); // while the first read is on its way: it began before the close was known
    inFlight.release(tagged('"a"', { answered: 20, open: false }));
    await after(0);
    expect(last()).toMatchObject({ results: { answered: 20 }, final: false });
    await after(POLL_EVERY_MS);
    expect(last()).toMatchObject({ results: { answered: 21 }, final: true });
    poll.closed(); // the stream again, after the stop: nothing more is read
    await after(10 * POLL_EVERY_MS);
    expect(reads).toHaveLength(2);
  });

  it('takes a 304 as the last read, the results it keeps saying closed', async () => {
    const { api, reads } = server(tagged('"a"', { answered: 21, open: false }), null);
    pollResults(api, QUESTION, onChange, page().doc);
    await after(0);
    await after(POLL_EVERY_MS);
    expect(reads[1]).toEqual({ at: 2000, etag: '"a"' });
    expect(last()).toEqual({
      results: results({ answered: 21, open: false }),
      final: true,
      problem: null,
    });
    await after(10 * POLL_EVERY_MS);
    expect(reads).toHaveLength(2);
  });

  it('after closed(), stops at the first good read saying closed, and only at one', async () => {
    const early = server(tagged('"a"', { open: false }));
    pollResults(early.api, QUESTION, onChange, page().doc).closed(); // before any read
    await after(0);
    expect(last()).toMatchObject({ final: true });
    expect(early.reads).toHaveLength(1);

    const stale = server(
      tagged('"a"'),
      tagged('"b"', { answered: 3 }),
      tagged('"c"', { open: false }),
    );
    const poll = pollResults(stale.api, QUESTION, onChange, page().doc);
    await after(0);
    poll.closed();
    await after(POLL_EVERY_MS); // a read still saying open is never the last
    expect(last()).toMatchObject({ results: { answered: 3, open: true }, final: false });
    await after(POLL_EVERY_MS);
    expect(last()).toMatchObject({ results: { open: false }, final: true });
    expect(stale.reads).toHaveLength(3);
  });

  it('never stops on a failed read: the problem is kept until a read works', async () => {
    const { api, reads } = server(
      tagged('"a"', { open: false }),
      new NetworkError(),
      new ApiError(503, 'unavailable', 'down'),
      null,
    );
    pollResults(api, QUESTION, onChange, page().doc);
    await after(0);
    await after(POLL_EVERY_MS);
    expect(last()).toEqual({
      results: results({ open: false }),
      final: false,
      problem: { kind: 'failed', status: undefined, retryAfter: undefined },
    });
    await after(POLL_EVERY_MS);
    expect(last()?.problem).toMatchObject({ kind: 'failed', status: 503 });
    await after(POLL_EVERY_MS);
    expect(last()).toEqual({ results: results({ open: false }), final: true, problem: null });
    expect(reads.map((read) => read.at)).toEqual([0, 2000, 4000, 6000]);
  });

  it('fails a read that never answers once POLL_TIMEOUT_MS is up, the counts kept, then reads on (#334)', async () => {
    const answering = (body: QuestionResults) => () =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    // A request the network swallows (a half-open connection): no answer until its signal gives up.
    const swallowed = (init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const replies = [answering(results()), swallowed, answering(results({ answered: 3 }))];
    const fetched = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      (replies.shift() ?? swallowed)(init),
    );
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: fetched,
    });
    const poll = pollResults(client, QUESTION, onChange, page().doc);
    await after(0);
    await after(POLL_EVERY_MS); // the second read: the network swallows it
    await after(POLL_TIMEOUT_MS - 1);
    expect(last()).toEqual({ results: results(), final: false, problem: null });
    await after(1);
    expect(last()).toEqual({
      results: results(),
      final: false,
      problem: { kind: 'failed', status: undefined, retryAfter: undefined },
    });
    await after(POLL_EVERY_MS); // the next read, as ever
    expect(last()).toEqual({ results: results({ answered: 3 }), final: false, problem: null });
    expect(fetched).toHaveBeenCalledTimes(3);
    poll.stop();
  });

  it('reads again in 2 s after a refusal, typed by its reason', async () => {
    const { api, reads } = server(
      new ApiError(404, 'not_found', 'gone', 'question_not_found'),
      tagged('"a"'),
    );
    const poll = pollResults(api, QUESTION, onChange, page().doc);
    await after(0);
    expect(last()?.problem).toEqual({ kind: 'refused', status: 404, reason: 'question_not_found' });
    await after(POLL_EVERY_MS);
    expect(reads).toHaveLength(2);
    expect(last()).toEqual({ results: results(), final: false, problem: null });
    poll.stop();
  });

  it('reads nothing while the tab is hidden, and back in view waits out the 2 s since the last', async () => {
    const { doc, turn } = page('hidden');
    const { api, reads } = server(tagged('"a"'));
    const poll = pollResults(api, QUESTION, onChange, doc);
    await after(10_000);
    expect(reads).toHaveLength(0);
    turn('visible');
    await after(0);
    expect(reads.map((read) => read.at)).toEqual([10_000]);
    turn('hidden');
    await after(30_000);
    expect(reads).toHaveLength(1);
    turn('visible'); // long past the 2 s: at once
    await after(0);
    expect(reads.map((read) => read.at)).toEqual([10_000, 40_000]);
    await after(500);
    turn('hidden');
    turn('visible'); // a quick switch away and back: the 2 s still run from the last read
    await after(POLL_EVERY_MS - 501);
    expect(reads).toHaveLength(2);
    await after(1);
    expect(reads.map((read) => read.at)).toEqual([10_000, 40_000, 42_000]);
    poll.stop();
  });

  it('waits a 429’s Retry-After, from 2 s to a minute, hidden or not', async () => {
    const busy = (retryAfter?: number) =>
      new ApiError(429, 'rate_limited', 'too many requests', undefined, retryAfter);
    const { doc, turn } = page();
    const { api, reads } = server(busy(5), busy(), busy(3600), busy(0), busy(1), busy(5), null);
    const poll = pollResults(api, QUESTION, onChange, doc);
    await after(0);
    expect(last()?.problem).toEqual({ kind: 'failed', status: 429, retryAfter: 5 });
    await after(4999);
    expect(reads).toHaveLength(1);
    await after(1); // 5 s
    await after(LONGEST_WAIT_MS); // none sent: a minute
    await after(LONGEST_WAIT_MS); // an hour asked: a minute
    await after(POLL_EVERY_MS); // none to wait: the 2 s
    await after(POLL_EVERY_MS); // a second: the 2 s
    turn('hidden');
    turn('visible'); // back in view inside the 5 s: still waits them out
    await after(4999);
    expect(reads).toHaveLength(6);
    await after(1);
    expect(reads.map((read) => read.at)).toEqual([
      0, 5000, 65_000, 125_000, 127_000, 129_000, 134_000,
    ]);
    expect(last()?.problem).toBeNull();
    poll.stop();
  });

  it('stops at a 401: the client signed out once, and no read signs out again (#332’s review)', async () => {
    const onUnauthorized = vi.fn();
    const fetched = vi.fn(() => Promise.resolve(new Response('', { status: 401 })));
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized,
      fetchImpl: fetched,
    });
    pollResults(client, QUESTION, onChange, page().doc);
    await after(0);
    expect(last()?.problem).toEqual({ kind: 'refused', status: 401, reason: undefined });
    await after(10 * POLL_EVERY_MS);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('stops when told: no more reads, and an answer on its way changes nothing', async () => {
    const inFlight = held();
    const { doc, turn } = page();
    const { api, reads } = server(inFlight.reply);
    const poll = pollResults(api, QUESTION, onChange, doc);
    await after(0);
    poll.stop();
    inFlight.release(tagged('"a"'));
    await after(10_000);
    turn('hidden');
    turn('visible');
    await after(10_000);
    expect(reads).toHaveLength(1);
    expect(states).toHaveLength(0);
  });
});
