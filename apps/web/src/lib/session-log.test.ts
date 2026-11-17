import type { EventsPage, EventType, FeedEvent } from '@bali/shared';
import { EVENT_PAGE_LIMIT } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { ApiError, NetworkError } from './api-client';
import { CANT_REACH, TOO_MANY_TRIES } from './errors';
import { type LogLine, logLines, readLog, withStreamed } from './session-log';

/*
 * The session's log on the class page (LO6): read once, whole, for the session list and every
 * student's panel; the stream's events folded in; and the list's lines, as ClassLive and
 * LiveListStates draw them. Times are the server's (UTC here: a lesson from 09:05).
 */

const at = (minute: number, second = 0) =>
  new Date(Date.UTC(2026, 10, 17, 9, minute, second)).toISOString();

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

const FEED = (after: number) => `/v1/sessions/s1/events?after=${after}`;
/** An event of the feed at `n`, the same event wherever it is read (its id is its seq's). */
const feed = (
  n: number,
  userId: string | null = 'ana',
  type: EventType = 'came_back',
): FeedEvent => ({
  seq: n,
  eventId: `f${n}`,
  type,
  userId,
  occurredAt: at(10),
  payload: null,
});
/** A page of the catch-up feed, as the API answers it. */
const page = (events: FeedEvent[], after = 0): EventsPage => ({
  events,
  nextAfter: events.at(-1)?.seq ?? after,
});

describe('readLog', () => {
  it('reads every page of the session’s feed from its start, every student’s', async () => {
    const first = Array.from({ length: EVENT_PAGE_LIMIT }, (_, i) =>
      feed(i + 1, i % 3 === 0 ? 'ana' : 'ben'),
    );
    const rest = [feed(201, 'ana'), feed(202, null, 'session_extended')];
    const api = fakeApi({
      [FEED(0)]: page(first),
      [FEED(EVENT_PAGE_LIMIT)]: page(rest),
      [FEED(202)]: page([], 202),
    });
    expect(await readLog(api, 's1')).toEqual({ kind: 'ready', events: [...first, ...rest] });
    expect(api.asked).toEqual([FEED(0), FEED(EVENT_PAGE_LIMIT), FEED(202)]);
  });

  it('says a failed read for Try again, never a part of the log as the whole', async () => {
    const unreached = fakeApi({ [FEED(0)]: new NetworkError() });
    expect(await readLog(unreached, 's1')).toEqual({ kind: 'error', message: CANT_REACH });
    // Its first page read, its second refused.
    const busy = new ApiError(429, 'rate_limited', 'too many requests from this account');
    const halfway = fakeApi({ [FEED(0)]: page([feed(1)]), [FEED(1)]: busy });
    expect(await readLog(halfway, 's1')).toEqual({ kind: 'error', message: TOO_MANY_TRIES });
    // Try again reads it again, whole, from the start.
    const again = fakeApi({ [FEED(0)]: page([feed(1)]), [FEED(1)]: page([], 1) });
    expect(await readLog(again, 's1')).toEqual({ kind: 'ready', events: [feed(1)] });
  });

  it('puts the session id in the path as one segment', async () => {
    const api = fakeApi({ '/v1/sessions/a%2Fb/events?after=0': page([]) });
    expect(await readLog(api, 'a/b')).toEqual({ kind: 'ready', events: [] });
  });
});

describe('withStreamed', () => {
  const read = [feed(5), feed(9, 'ben')];

  it('folds in the stream’s events, each once by its id, in the order the engine recorded them', () => {
    // One the read holds (the overlap), one committed late under a lower seq, and a new one.
    const next = withStreamed(read, [feed(9, 'ben'), feed(7), feed(12, 'cal')]);
    expect(next.map((e) => e.seq)).toEqual([5, 7, 9, 12]);
  });

  it('gives back the read itself when the stream brought nothing new', () => {
    expect(withStreamed(read, [])).toBe(read);
    expect(withStreamed(read, [feed(9, 'ben'), feed(5)])).toBe(read);
  });
});

describe('logLines (ClassLive, LiveListStates)', () => {
  let seq = 0;
  /** One event of the session, the next `seq`, at 9:`minute`. */
  function event(
    type: EventType,
    userId: string | null,
    minute: number,
    payload: Record<string, unknown> | null = null,
  ): FeedEvent {
    seq += 1;
    return { seq, eventId: `e${seq}`, type, userId, occurredAt: at(minute), payload };
  }
  /** Each line as the list reads it, newest first: when, what, and who. */
  const said = (lines: LogLine[]) =>
    lines.map(
      (l) => `${l.at.toISOString().slice(14, 16)} ${l.kind}${l.studentId ? ` ${l.studentId}` : ''}`,
    );

  it('lists the session’s start, each unlock, each phone gone silent, each return to focus and each protection off, newest first', () => {
    const lines = logLines([
      event('session_started', null, 5),
      event('tap_in', 'amara', 6),
      event('tap_in', 'jaylen', 6),
      event('tap_in', 'tomas', 7),
      event('protection_off', 'amara', 9),
      event('protection_on', 'amara', 11),
      event('unlock', 'jaylen', 18, { reason: 'bathroom' }),
      event('refocus', 'jaylen', 24),
      event('went_silent', 'tomas', 27),
      event('unlock', 'ethan', 31, { reason: 'nurse' }),
    ]);
    // ClassLive's own list, Ethan's unlock before he tapped in too: every unlock is on the record.
    expect(said(lines)).toEqual([
      '31 unlock ethan',
      '27 silent tomas',
      '24 focus jaylen',
      '18 unlock jaylen',
      '11 focus amara',
      '09 off amara',
      '05 started',
    ]);
  });

  it('says a tap of the block after an unlock or protection off is back in focus, and a first tap-in is no line', () => {
    const lines = logLines([
      event('tap_in', 'ana', 6),
      event('unlock', 'ana', 10),
      event('tap_in', 'ana', 12),
      event('protection_off', 'ben', 13),
      event('tap_in', 'ben', 15),
      // Tapping again while focused is no return.
      event('tap_in', 'ana', 16),
    ]);
    expect(said(lines)).toEqual(['15 focus ben', '13 off ben', '12 focus ana', '10 unlock ana']);
  });

  it('says no return where Screen Time back on leaves the student unlocked, or a return the engine never applied', () => {
    const lines = logLines([
      event('tap_in', 'ana', 6),
      event('unlock', 'ana', 10),
      event('protection_off', 'ana', 11),
      // Back to the unlocked their latest turn left them in (#167): still unlocked.
      event('protection_on', 'ana', 12),
      // A late refocus (A13): recorded, never applied, so the unlock stands.
      event('refocus', 'ana', 13, { recorded_as: 'superseded' }),
    ]);
    expect(said(lines)).toEqual(['11 off ana', '10 unlock ana']);
  });

  it('lists every unlock, a late one and one under protection off too, as the report does', () => {
    const lines = logLines([
      event('tap_in', 'ana', 6),
      event('refocus', 'ana', 9),
      event('protection_off', 'ana', 10),
      event('unlock', 'ana', 11, { recorded_as: 'protection_off' }),
      event('unlock', 'ana', 8, { recorded_as: 'superseded' }),
    ]);
    expect(said(lines)).toEqual(['11 unlock ana', '10 off ana', '08 unlock ana']);
  });

  it('lists nothing else: a tap-in, a phone back, a leave, time added, a reason changed', () => {
    const lines = logLines([
      event('tap_in', 'ana', 6),
      event('came_back', 'ana', 8),
      event('unlock', 'ben', 9),
      event('unlock_reason_changed', 'ben', 10, { unlock_event_id: 'e3', reason: 'nurse' }),
      event('session_extended', null, 11),
      event('enrollment_left', 'ana', 12),
      event('left_for_other_session', 'cal', 13),
      event('armed_tap_skipped', 'dan', 14),
    ]);
    expect(said(lines)).toEqual(['09 unlock ben']);
  });

  it('places each line at its time on the record, at one instant the engine’s later first', () => {
    // An unlock that reached the server late, held to when the phone made it, slots in at its time;
    // two at one instant, the one recorded later first.
    const late = event('unlock', 'ben', 7);
    const lines = logLines([
      event('session_started', null, 5),
      event('unlock', 'ana', 10),
      { ...event('went_silent', 'cal', 10), occurredAt: at(10) },
      { ...late, seq: 99 },
    ]);
    expect(said(lines)).toEqual(['10 silent cal', '10 unlock ana', '07 unlock ben', '05 started']);
  });

  it('reads each event once in the engine’s order, however the log hands them over', () => {
    const tap = event('tap_in', 'ana', 6);
    const unlock = event('unlock', 'ana', 9);
    const refocus = event('refocus', 'ana', 12);
    expect(said(logLines([refocus, unlock, tap]))).toEqual(['12 focus ana', '09 unlock ana']);
  });
});
