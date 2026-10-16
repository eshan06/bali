import type { ActivityEvent, ActivityResponse } from '@bali/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTIVITY_EVERY_MS, pollActivity, readActivity } from './activity';
import { ApiError, NetworkError, POLL_TIMEOUT_MS } from './api-client';
import { CANT_REACH, TOO_MANY_TRIES } from './errors';
import type { PageVisibility } from './live-question';

/*
 * Home's Recent activity (PV17c; Main): `GET /v1/me/activity`, read as Home shows it, again 15 s
 * after each answer while the page is in view, and at once as it comes back into view.
 */

const CLASS = { id: 'c1', name: 'Biology, period 3' };
const unlock: ActivityEvent = {
  eventId: 'e3',
  type: 'unlock',
  occurredAt: '2026-10-12T13:31:00.000Z',
  class: CLASS,
  student: { id: 'u1', displayName: 'Ethan Park' },
  reason: 'nurse',
};
const off: ActivityEvent = {
  ...unlock,
  eventId: 'e2',
  type: 'protection_off',
  occurredAt: '2026-10-12T13:22:00.000Z',
  student: { id: 'u2', displayName: 'Amara Okafor' },
  reason: null,
};
const start: ActivityEvent = {
  ...unlock,
  eventId: 'e1',
  type: 'session_started',
  occurredAt: '2026-10-12T13:05:00.000Z',
  student: null,
  reason: null,
};

/** A fake API: each read answers in turn, or throws; every read asked is recorded with its limit. */
function fakeApi(...answers: (ActivityResponse | Error)[]) {
  const asked: { path: string; limitMs: number | undefined }[] = [];
  return {
    asked,
    get<T>(path: string, limitMs?: number): Promise<T> {
      asked.push({ path, limitMs });
      const answer = answers.shift();
      if (answer === undefined) return Promise.reject(new Error(`unexpected ${path}`));
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as T);
    },
  };
}

describe('readActivity', () => {
  it('reads Recent activity as the server orders it, with a poll’s limit', async () => {
    const api = fakeApi({ events: [unlock, off, start] });
    expect(await readActivity(api)).toEqual({ kind: 'ready', events: [unlock, off, start] });
    // A read the network swallows fails in 10 s, for the next to try (#334).
    expect(api.asked).toEqual([{ path: '/v1/me/activity', limitMs: POLL_TIMEOUT_MS }]);
  });

  it('skips a kind this build doesn’t know, and an unlock or protection off naming no one', async () => {
    const newer = { ...unlock, eventId: 'e9', type: 'question_opened' } as unknown as ActivityEvent;
    const nobody = { ...unlock, eventId: 'e8', student: null };
    const api = fakeApi({ events: [newer, nobody, { ...off, student: null }, unlock, start] });
    expect(await readActivity(api)).toEqual({ kind: 'ready', events: [unlock, start] });
  });

  it('says why a read failed, never thrown, for its Try again', async () => {
    for (const [failure, said] of [
      [new NetworkError(), CANT_REACH],
      [new ApiError(429, 'rate_limited', 'too many requests', undefined, 1), TOO_MANY_TRIES],
    ] as const) {
      expect(await readActivity(fakeApi(failure))).toEqual({ kind: 'error', message: said });
    }
    const broke = await readActivity(fakeApi(new ApiError(500, 'internal', 'something broke')));
    expect(broke.kind).toBe('error');
  });
});

describe('pollActivity: Recent activity read again while Home is in view', () => {
  /** A page whose visibility a test turns, as a browser does on a tab switch. */
  function page(visibilityState: DocumentVisibilityState = 'visible') {
    const doc = Object.assign(new EventTarget(), { visibilityState });
    const turn = (to: DocumentVisibilityState) => {
      doc.visibilityState = to;
      doc.dispatchEvent(new Event('visibilitychange'));
    };
    return { doc: doc as unknown as PageVisibility, turn };
  }
  /** Reads whose answers land when the test says, each read's in turn. */
  function reads() {
    const pending: { resolve: (body: ActivityResponse) => void; reject: (e: Error) => void }[] = [];
    const get = vi.fn(
      () => new Promise<ActivityResponse>((resolve, reject) => pending.push({ resolve, reject })),
    );
    return {
      api: { get: get as unknown as <T>(path: string, limitMs?: number) => Promise<T> },
      get,
      answer: (i: number, events: ActivityEvent[]) => pending[i]?.resolve({ events }),
      fail: (i: number) => pending[i]?.reject(new NetworkError()),
    };
  }
  const after = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-10-12T13:40:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads at once, then every 15 s, each read 15 s after the one before answered, telling each answer', async () => {
    // The class page's grid reads its session as often.
    expect(ACTIVITY_EVERY_MS).toBe(15_000);
    const { api, get, answer } = reads();
    const shown = vi.fn();
    const poll = pollActivity(api, shown, page().doc);
    expect(get).toHaveBeenCalledOnce();
    answer(0, [start]);
    await after(0);
    expect(shown).toHaveBeenLastCalledWith({ kind: 'ready', events: [start] });
    await after(ACTIVITY_EVERY_MS - 1);
    expect(get).toHaveBeenCalledOnce();
    await after(1);
    expect(get).toHaveBeenCalledTimes(2);
    answer(1, [unlock, start]);
    await after(0);
    expect(shown).toHaveBeenLastCalledWith({ kind: 'ready', events: [unlock, start] });
    poll.stop();
  });

  it('says a read that failed, and the list again once a read works', async () => {
    const { api, answer, fail } = reads();
    const shown = vi.fn();
    const poll = pollActivity(api, shown, page().doc);
    answer(0, [start]);
    await after(ACTIVITY_EVERY_MS);
    fail(1);
    await after(0);
    expect(shown).toHaveBeenLastCalledWith({ kind: 'error', message: CANT_REACH });
    await after(ACTIVITY_EVERY_MS);
    answer(2, [off, start]);
    await after(0);
    expect(shown).toHaveBeenLastCalledWith({ kind: 'ready', events: [off, start] });
    poll.stop();
  });

  it('reads nothing while hidden, and at once as the page comes back into view', async () => {
    const { api, get, answer } = reads();
    const { doc, turn } = page();
    const poll = pollActivity(api, vi.fn(), doc);
    answer(0, [start]);
    await after(0);
    turn('hidden');
    await after(10 * ACTIVITY_EVERY_MS);
    expect(get).toHaveBeenCalledOnce();
    turn('visible');
    expect(get).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it('tells only the newest read’s answer: one that lands late never puts an older list back', async () => {
    const { api, answer } = reads();
    const { doc, turn } = page();
    const shown = vi.fn();
    const poll = pollActivity(api, shown, doc);
    // The first read hangs; back in view, a second goes, and answers first.
    turn('visible');
    answer(1, [unlock, start]);
    await after(0);
    answer(0, [start]);
    await after(0);
    expect(shown.mock.calls).toEqual([[{ kind: 'ready', events: [unlock, start] }]]);
    poll.stop();
  });

  it('stops: no more reads, and no answer told after it', async () => {
    const { api, get, answer } = reads();
    const shown = vi.fn();
    const { doc, turn } = page();
    const poll = pollActivity(api, shown, doc);
    poll.stop();
    answer(0, [start]);
    turn('hidden');
    turn('visible');
    await after(10 * ACTIVITY_EVERY_MS);
    expect(get).toHaveBeenCalledOnce();
    expect(shown).not.toHaveBeenCalled();
  });
});
