import type { FeedEvent } from '@bali/shared';
import { EVENT_PAGE_LIMIT } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { NetworkError } from './api-client';
import { placement, readEvents } from './recap';

/*
 * What the recap's marks stand on (PB5's timeline until PV14, ClassEnded's rows since PV12b): the
 * session's events, every page of them, and where each moment falls on the session's own time.
 * The recap's groups and their axis: recap-groups.test.ts.
 */

const at = (minute: number) => `2026-10-04T13:${String(minute).padStart(2, '0')}:00.000Z`;

/** A fake API: each path answers its value, or throws its error; every path asked is recorded. */
function fakeApi(answers: Record<string, unknown>) {
  const asked: string[] = [];
  return {
    asked,
    get<T>(path: string): Promise<T> {
      asked.push(path);
      if (!(path in answers)) return Promise.reject(new Error(`unexpected ${path}`));
      const answer = answers[path];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer as T);
    },
  };
}

describe('readEvents', () => {
  const FEED = '/v1/sessions/s1/events?after=0';
  const many = (from: number, n: number): FeedEvent[] =>
    Array.from({ length: n }, (_, i) => ({
      seq: from + i,
      eventId: `m${from + i}`,
      type: 'tap_in',
      userId: 'u1',
      occurredAt: at(5),
      payload: {},
    }));

  it('reads every page of the feed, oldest first, until one comes back empty', async () => {
    // A short page ends nothing: a server paging by fewer than this build's 200 loses no event.
    const first = many(1, EVENT_PAGE_LIMIT);
    const rest = many(EVENT_PAGE_LIMIT + 1, 3);
    const api = fakeApi({
      [FEED]: { events: first, nextAfter: EVENT_PAGE_LIMIT },
      [`/v1/sessions/s1/events?after=${EVENT_PAGE_LIMIT}`]: { events: rest, nextAfter: 203 },
      '/v1/sessions/s1/events?after=203': { events: [], nextAfter: 203 },
    });
    expect(await readEvents(api, 's1')).toEqual([...first, ...rest]);
    expect(api.asked).toHaveLength(3);
  });

  it('stops at a page that leaves its cursor where it was, never reading it again', async () => {
    const api = fakeApi({ [FEED]: { events: many(1, EVENT_PAGE_LIMIT), nextAfter: 0 } });
    expect(await readEvents(api, 's1')).toHaveLength(EVENT_PAGE_LIMIT);
    expect(api.asked).toEqual([FEED]);
  });

  it('fails as its read fails, and puts the session id in the path as one segment', async () => {
    const api = fakeApi({ '/v1/sessions/a%2Fb/events?after=0': new NetworkError() });
    await expect(readEvents(api, 'a/b')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('placement', () => {
  it('places a moment by its time on the session’s own: the start at 0, the end at 100', () => {
    // A 25-minute lesson at 9:05.
    const start = Date.parse(at(5));
    const end = Date.parse(at(30));
    expect(placement(start, start, end)).toBe(0);
    expect(placement(end, start, end)).toBe(100);
    expect(placement(Date.parse(at(10)), start, end)).toBe(20);
    expect(placement(Date.parse(at(17)) + 30_000, start, end)).toBe(50);
    // Held to the axis, and a session with no length puts everything at its start.
    expect(placement(start - 60_000, start, end)).toBe(0);
    expect(placement(end + 60_000, start, end)).toBe(100);
    expect(placement(start, start, start)).toBe(0);
  });
});
