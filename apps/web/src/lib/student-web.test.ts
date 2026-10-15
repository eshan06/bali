import type {
  AnswerRequest,
  AnswerResponse,
  MeResponse,
  Presentation,
  StudentPhone,
  StudentQuestion,
} from '@bali/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ApiClient,
  ApiError,
  createApiClient,
  NetworkError,
  UnauthorizedError,
} from './api-client';
import { newEventId } from './event-id';
import { type PageVisibility, POLL_EVERY_MS } from './live-question';
import {
  type AnswerResult,
  followLesson,
  homeClasses,
  homeFor,
  type LessonState,
  nextBell,
  phoneChip,
} from './student-web';

const SESSION = '01924b2c-0000-7000-8000-000000000001';
const QUESTION = '01924b2c-0000-7000-8000-000000000003';
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** 9:41 in the morning, by this computer's clock in each test. */
const AT = Date.UTC(2026, 9, 12, 14, 41);
/** An answer's id minted at `ms`, its random bits `fill`; and the millisecond an id begins with. */
const idAt = (ms: number, fill = 0) => newEventId(ms, new Uint8Array(16).fill(fill));
const timeOf = (id: string) => parseInt(id.replace('-', '').slice(0, 12), 16);

const question = (over: Partial<StudentQuestion> = {}): StudentQuestion => ({
  id: QUESTION,
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  open: true,
  correctOption: null,
  answer: null,
  ...over,
});
const lesson = (over: Partial<Presentation> = {}): Presentation => ({
  running: true,
  question: null,
  slide: null,
  phone: { state: 'focused', lastSeenAt: null },
  ...over,
});

/** The API client over a fetch answering each path from `routes`, every path asked recorded. */
function client(routes: Record<string, () => Promise<Response>>) {
  const asked: string[] = [];
  const onUnauthorized = vi.fn();
  const api = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'tok',
    onUnauthorized,
    fetchImpl: (url) => {
      const path = (url as string).replace('http://api', '');
      asked.push(path);
      return routes[path]?.() ?? Promise.reject(new Error(`no route for ${path}`));
    },
  });
  return { api, asked, onUnauthorized };
}
const json = (status: number, body: unknown) => () =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
const offline = () => Promise.reject(new Error('offline'));

describe('homeFor', () => {
  const me = (role: 'teacher' | 'student'): MeResponse => ({
    user: { id: 'u1', role, displayName: 'Ana' },
    classes: [],
    session: null,
    armed: false,
  });

  it('sends a teacher to their classes and a student who said 13+ to theirs, the check read first', async () => {
    for (const role of ['teacher', 'student'] as const) {
      const { api, asked } = client({
        '/v1/me/age-check': json(200, { passed: true }),
        '/v1/me': json(200, me(role)),
      });
      expect(await homeFor(api)).toEqual({ kind: role, me: me(role) });
      expect(asked).toEqual(['/v1/me/age-check', '/v1/me']);
    }
  });

  it('sends anyone else to the invite page, never reading /v1/me, which would make an account', async () => {
    const { api, asked } = client({ '/v1/me/age-check': json(200, { passed: false }) });
    expect(await homeFor(api)).toEqual({ kind: 'invite' });
    expect(asked).toEqual(['/v1/me/age-check']);
  });

  it('throws a read that failed, for the page to say in its words, never a guess (PV15)', async () => {
    const down = client({ '/v1/me/age-check': offline, '/v1/me': json(200, me('teacher')) });
    await expect(homeFor(down.api)).rejects.toBeInstanceOf(NetworkError);
    // Never /v1/me after a check that didn't answer: it could make an account the check never let.
    expect(down.asked).toEqual(['/v1/me/age-check']);
    const failing = client({
      '/v1/me/age-check': json(200, { passed: true }),
      '/v1/me': json(503, { error: { code: 'unavailable', message: 'a log line' } }),
    });
    await expect(homeFor(failing.api)).rejects.toMatchObject({ status: 503 });
    expect(down.onUnauthorized).not.toHaveBeenCalled();
    expect(failing.onUnauthorized).not.toHaveBeenCalled();
  });

  it('signs out only on a 401, and reads nothing after it', async () => {
    const { api, asked, onUnauthorized } = client({ '/v1/me/age-check': json(401, {}) });
    await expect(homeFor(api)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(asked).toEqual(['/v1/me/age-check']);
  });
});

describe('the student’s home: who is in class now, and when to look again (W3)', () => {
  const minutes = (n: number) => new Date(AT + n * 60_000).toISOString();
  /** A class as `/v1/me` lists it for a student, in session from `from` to `to` minutes, or not. */
  const klass = (id: string, live?: [number, number]): MeResponse['classes'][number] => ({
    id,
    name: `Class ${id}`,
    teacher: { displayName: 'Ms. Rivera' },
    enrollmentId: `e-${id}`,
    liveSession: live
      ? { id: `s-${id}`, startedAt: minutes(live[0]), endsAt: minutes(live[1]) }
      : null,
  });
  const me = (...classes: MeResponse['classes']): MeResponse => ({
    user: { id: 'u1', role: 'student', displayName: 'Ana Rodríguez' },
    classes,
    session: null,
    armed: false,
  });
  const ids = (list: { id: string }[]) => list.map((c) => c.id);

  it('puts a class in session first, by the read, the rest after it in /v1/me’s order', () => {
    const { inSession, others } = homeClasses(
      me(klass('a'), klass('b', [-26, 24]), klass('c')),
      AT,
    );
    expect(ids(inSession)).toEqual(['b']);
    expect(ids(others)).toEqual(['a', 'c']);
    // Each whole, as the read gave it: its teacher and its session's start and bell.
    expect(inSession[0]?.liveSession).toEqual({
      id: 's-b',
      startedAt: minutes(-26),
      endsAt: minutes(24),
    });
  });

  it('keeps a class in session until its bell by this computer’s clock, then lists it with the rest', () => {
    const read = me(klass('a', [-26, 24]), klass('b'));
    const bell = AT + 24 * 60_000;
    expect(ids(homeClasses(read, bell - 1).inSession)).toEqual(['a']);
    // At the bell itself the class is over (A17), whatever a read said before it.
    expect(ids(homeClasses(read, bell).inSession)).toEqual([]);
    expect(ids(homeClasses(read, bell).others)).toEqual(['a', 'b']);
  });

  it('lists every class in session, each in /v1/me’s order, and none when none is', () => {
    const both = me(klass('a', [-10, 40]), klass('b'), klass('c', [-5, 20]));
    expect(ids(homeClasses(both, AT).inSession)).toEqual(['a', 'c']);
    expect(homeClasses(me(klass('a'), klass('b')), AT)).toEqual({
      inSession: [],
      others: [klass('a'), klass('b')],
    });
    expect(homeClasses(me(), AT)).toEqual({ inSession: [], others: [] });
  });

  it('looks again at the first bell still to ring, and at none once every bell has rung', () => {
    const read = me(klass('a', [-10, 40]), klass('b'), klass('c', [-5, 20]));
    expect(nextBell(read, AT)).toBe(AT + 20 * 60_000);
    // Past c's bell, a's is next; past both, none: a read showing them still in session (a clock
    // ahead of the server's) waits for the page to open again, never reads again and again.
    expect(nextBell(read, AT + 20 * 60_000)).toBe(AT + 40 * 60_000);
    expect(nextBell(read, AT + 40 * 60_000)).toBeNull();
    expect(nextBell(me(klass('a')), AT)).toBeNull();
  });

  it('keeps a class whose teacher added minutes in session to its new bell, once read again', () => {
    // Read at 9:41 with its bell at 9:55; the teacher adds 5 minutes; at 9:55 the page reads again.
    const before = me(klass('a', [-26, 14]));
    const bell = nextBell(before, AT);
    expect(bell).toBe(AT + 14 * 60_000);
    const after = me(klass('a', [-26, 19]));
    expect(ids(homeClasses(after, bell ?? 0).inSession)).toEqual(['a']);
    expect(nextBell(after, bell ?? 0)).toBe(AT + 19 * 60_000);
  });
});

describe('followLesson', () => {
  type Got = { body: Presentation; etag: string | null } | null;
  const tagged = (etag: string, body: Presentation): Got => ({ body, etag });

  /**
   * A presentation route answering `replies` in turn, then `304`s, each read's time and tag kept;
   * and an answers route that takes each answer as sent, but those `answers` script.
   */
  function server(...replies: (Got | Error | (() => Promise<Got>))[]) {
    const reads: { at: number; etag: string | null }[] = [];
    const posts: { path: string; body: AnswerRequest }[] = [];
    const answers: (AnswerResponse | Error)[] = [];
    const api: Pick<ApiClient, 'getTagged' | 'post'> = {
      getTagged: <T>(path: string, etag: string | null) => {
        expect(path).toBe(`/v1/sessions/${SESSION}/presentation`);
        reads.push({ at: Date.now() - AT, etag });
        const reply = replies.length > 0 ? replies.shift() : null;
        const got =
          typeof reply === 'function'
            ? reply()
            : reply instanceof Error
              ? Promise.reject(reply)
              : Promise.resolve(reply);
        return got as Promise<{ body: T; etag: string | null } | null>;
      },
      post: <T>(path: string, body?: unknown) => {
        const sent = body as AnswerRequest;
        posts.push({ path, body: sent });
        const scripted = answers.shift();
        if (scripted instanceof Error) return Promise.reject(scripted);
        const taken = {
          outcome: 'answered',
          answer: { option: sent.option, eventId: sent.eventId },
        };
        return Promise.resolve((scripted ?? taken) as T);
      },
    };
    return { api, reads, posts, answers };
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

  /** A read held on its way until the test lets it go. */
  function held() {
    let release!: (reply: Got) => void;
    const promise = new Promise<Got>((resolve) => {
      release = resolve;
    });
    return { reply: () => promise, release };
  }

  const states: LessonState[] = [];
  const onChange = (state: LessonState) => states.push(state);
  const last = () => states.at(-1);
  const shownAnswer = () => last()?.presentation?.question?.answer;
  const after = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers({ now: AT });
    states.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads at once, then 2 s after each answer with the tag it kept; a 304 keeps what it read', async () => {
    const asked = lesson({ question: question() });
    const { api, reads } = server(tagged('"a"', lesson()), null, tagged('"b"', asked));
    const followed = followLesson(api, SESSION, onChange, page().doc);
    await after(0);
    expect(reads).toEqual([{ at: 0, etag: null }]);
    expect(last()).toEqual({ presentation: lesson(), problem: null, asOf: null });
    await after(POLL_EVERY_MS);
    expect(reads[1]).toEqual({ at: 2000, etag: '"a"' });
    expect(states).toHaveLength(1);
    await after(POLL_EVERY_MS);
    expect(reads[2]).toEqual({ at: 4000, etag: '"a"' });
    expect(last()?.presentation).toEqual(asked);
    followed.stop();
  });

  it('stops for good at the first read saying the session isn’t running', async () => {
    const over = lesson({ running: false, phone: null });
    const { api, reads } = server(tagged('"a"', lesson()), tagged('"b"', over));
    followLesson(api, SESSION, onChange, page().doc);
    await after(0);
    await after(POLL_EVERY_MS);
    expect(last()).toEqual({ presentation: over, problem: null, asOf: null });
    await after(10 * POLL_EVERY_MS);
    expect(reads).toHaveLength(2);
  });

  it('keeps the last good read through a failure, as of when it came, and reads again in 2 s', async () => {
    const { api, reads } = server(
      tagged('"a"', lesson()),
      new NetworkError(),
      new ApiError(503, 'unavailable', 'down'),
      null,
    );
    const followed = followLesson(api, SESSION, onChange, page().doc);
    await after(0);
    await after(POLL_EVERY_MS);
    expect(last()).toEqual({
      presentation: lesson(),
      problem: { kind: 'failed', status: undefined, retryAfter: undefined },
      asOf: AT,
    });
    await after(POLL_EVERY_MS);
    expect(last()).toMatchObject({ problem: { kind: 'failed', status: 503 }, asOf: AT });
    await after(POLL_EVERY_MS); // a 304: what it kept is current again
    expect(last()).toEqual({ presentation: lesson(), problem: null, asOf: null });
    expect(reads.map((read) => read.at)).toEqual([0, 2000, 4000, 6000]);
    followed.stop();
  });

  it('stops at a 429 until its Retry-After', async () => {
    const busy = new ApiError(429, 'rate_limited', 'too many requests', undefined, 7);
    const { api, reads } = server(busy, tagged('"a"', lesson()));
    const followed = followLesson(api, SESSION, onChange, page().doc);
    await after(0);
    expect(last()).toEqual({
      presentation: null,
      problem: { kind: 'failed', status: 429, retryAfter: 7 },
      asOf: null,
    });
    await after(6999);
    expect(reads).toHaveLength(1);
    await after(1);
    expect(reads.map((read) => read.at)).toEqual([0, 7000]);
    expect(last()).toEqual({ presentation: lesson(), problem: null, asOf: null });
    followed.stop();
  });

  it('stops at a 401: the client signed out once, and no read signs out again (#332’s review)', async () => {
    const { api, asked, onUnauthorized } = client({
      [`/v1/sessions/${SESSION}/presentation`]: json(401, {}),
    });
    followLesson(api, SESSION, onChange, page().doc);
    await after(0);
    expect(last()?.problem).toEqual({ kind: 'refused', status: 401, reason: undefined });
    await after(10 * POLL_EVERY_MS);
    expect(asked).toHaveLength(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('reads nothing while the tab is hidden, and reads at once back in view', async () => {
    const { doc, turn } = page('hidden');
    const { api, reads } = server(tagged('"a"', lesson()));
    const followed = followLesson(api, SESSION, onChange, doc);
    await after(10_000);
    expect(reads).toHaveLength(0);
    turn('visible');
    await after(0);
    expect(reads.map((read) => read.at)).toEqual([10_000]);
    followed.stop();
  });

  it('keeps the answer whose id sorts last: a read made before an answer landed never takes it back', async () => {
    const before = { option: 0, eventId: idAt(AT - 60_000) };
    const crossing = held();
    const phone = { option: 3, eventId: idAt(AT + 5_000) };
    const { api, posts } = server(
      tagged('"a"', lesson({ question: question({ answer: before }) })),
      crossing.reply,
      tagged('"c"', lesson({ question: question({ answer: phone }) })),
    );
    const followed = followLesson(api, SESSION, onChange, page().doc);
    await after(0);
    await after(POLL_EVERY_MS); // a read on its way
    const sent = await followed.answer(QUESTION, 1);
    const mine = { option: 1, eventId: posts[0]?.body.eventId };
    expect(sent).toEqual({ kind: 'answered', answer: mine });
    expect(shownAnswer()).toEqual(mine);
    crossing.release(tagged('"b"', lesson({ question: question({ answer: before }) })));
    await after(0);
    expect(shownAnswer()).toEqual(mine);
    // The phone's pick since, minted later: the answer Bali holds now, shown as it is.
    await after(POLL_EVERY_MS);
    expect(shownAnswer()).toEqual(phone);
    followed.stop();
  });

  it('mints each answer after the one held from a clock a minute behind it, and after the last it minted', async () => {
    // The phone answered with its clock a minute ahead of this computer's.
    const phone = { option: 0, eventId: idAt(AT + 60_000, 0xff) };
    const { api, posts, answers } = server(
      tagged('"a"', lesson({ question: question({ answer: phone }) })),
    );
    const followed = followLesson(api, SESSION, onChange, page().doc);
    await after(0);
    answers.push(new NetworkError()); // the first's answer is lost: it may have landed
    expect(await followed.answer(QUESTION, 2)).toMatchObject({ kind: 'failed' });
    expect(shownAnswer()).toEqual(phone);
    await followed.answer(QUESTION, 3);
    const [first, second] = posts.map((post) => post.body);
    expect(posts.map((post) => post.path)).toEqual([
      `/v1/questions/${QUESTION}/answers`,
      `/v1/questions/${QUESTION}/answers`,
    ]);
    expect(first).toEqual({ eventId: expect.stringMatching(V7) as string, option: 2 });
    expect((first?.eventId ?? '') > phone.eventId).toBe(true);
    expect((second?.eventId ?? '') > (first?.eventId ?? '')).toBe(true);
    // Each a millisecond past the last, never left to the random bits of one millisecond.
    expect([first, second].map((sent) => timeOf(sent?.eventId ?? ''))).toEqual([
      AT + 60_001,
      AT + 60_002,
    ]);
    expect(shownAnswer()).toEqual({ option: 3, eventId: second?.eventId });
    followed.stop();
  });

  it('types an answer’s failures by reason, the answer shown left as it was', async () => {
    const { api, answers } = server(tagged('"a"', lesson({ question: question() })));
    const followed = followLesson(api, SESSION, onChange, page().doc);
    await after(0);
    answers.push(
      new ApiError(409, 'conflict', 'a log line', 'question_closed'),
      new ApiError(400, 'bad_request', 'a log line', 'invalid_option'),
      new ApiError(409, 'conflict', 'a log line', 'event_id_conflict'),
      new ApiError(409, 'conflict', 'a log line', 'account_deleted'),
      new NetworkError(),
      new ApiError(429, 'rate_limited', 'a log line', undefined, 3),
    );
    const said: AnswerResult[] = [];
    for (let i = 0; i < 6; i += 1) said.push(await followed.answer(QUESTION, 1));
    expect(said).toEqual([
      { kind: 'refused', status: 409, reason: 'question_closed' },
      { kind: 'refused', status: 400, reason: 'invalid_option' },
      { kind: 'refused', status: 409, reason: 'event_id_conflict' },
      { kind: 'refused', status: 409, reason: 'account_deleted' },
      { kind: 'failed', status: undefined, retryAfter: undefined },
      { kind: 'failed', status: 429, retryAfter: 3 },
    ]);
    expect(shownAnswer()).toBeNull();
    followed.stop();
  });

  it('hands nothing on once stopped: neither a read on its way nor an answer', async () => {
    const inFlight = held();
    const { api, reads } = server(tagged('"a"', lesson({ question: question() })), inFlight.reply);
    const followed = followLesson(api, SESSION, onChange, page().doc);
    await after(0);
    await after(POLL_EVERY_MS);
    followed.stop();
    inFlight.release(tagged('"b"', lesson({ question: question({ open: false }) })));
    expect(await followed.answer(QUESTION, 1)).toMatchObject({ kind: 'answered' });
    await after(10 * POLL_EVERY_MS);
    expect(reads).toHaveLength(2);
    expect(states).toHaveLength(1);
  });
});

describe('phoneChip', () => {
  const now = new Date(AT);
  const read = (phone: StudentPhone | null, over: Partial<Presentation> = {}): LessonState => ({
    presentation: lesson({ phone, ...over }),
    problem: null,
    asOf: null,
  });

  it('is the chip of the state the read says, the teacher’s grid’s', () => {
    expect(phoneChip(read({ state: 'focused', lastSeenAt: null }), now)).toEqual({
      kind: 'focused',
    });
    expect(phoneChip(read({ state: 'unlocked', lastSeenAt: null }), now)).toEqual({
      kind: 'unlocked',
    });
    expect(phoneChip(read({ state: 'protection_off', lastSeenAt: null }), now)).toEqual({
      kind: 'protection_off',
    });
    // No live participation here: not tapped in, or gone to another class.
    expect(phoneChip(read(null), now)).toEqual({ kind: 'not_in' });
  });

  it('says Silent with the whole minutes since Bali last heard from the phone, as the grid counts', () => {
    const since = new Date(AT - 3 * 60_000 - 20_000).toISOString();
    expect(phoneChip(read({ state: 'silent', lastSeenAt: since }), now)).toEqual({
      kind: 'silent',
      minutes: 3,
      since,
    });
    // Silent from 90 s: a minute by then.
    const first = new Date(AT - 90_000).toISOString();
    expect(phoneChip(read({ state: 'silent', lastSeenAt: first }), now)).toMatchObject({
      minutes: 1,
    });
  });

  it('says a state it has no chip for as unknown, never a calmer one', () => {
    const newer = { state: 'charging', lastSeenAt: null } as unknown as StudentPhone;
    expect(phoneChip(read(newer), now)).toEqual({ kind: 'unknown' });
  });

  it('is none before the first good read, and once the session is over', () => {
    expect(phoneChip({ presentation: null, problem: null, asOf: null }, now)).toBeNull();
    expect(phoneChip(read(null, { running: false }), now)).toBeNull();
  });

  it('keeps the last good read’s state while a read fails, as of then', () => {
    const failing: LessonState = {
      ...read({ state: 'unlocked', lastSeenAt: null }),
      problem: { kind: 'failed', status: undefined, retryAfter: undefined },
      asOf: AT - 30_000,
    };
    expect(phoneChip(failing, now)).toEqual({ kind: 'unlocked' });
  });
});
