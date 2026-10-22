import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ClassDetail } from '@bali/shared';
import { describe, expect, it, vi } from 'vitest';

import { createApiClient, SAVE_TIMEOUT_MS } from './api-client';
import {
  CLASS_NAME_MAX,
  createClass,
  daysBefore,
  lastOf,
  liveNow,
  nextBell,
  type TaughtClass,
} from './classes';
import * as errors from './errors';
import {
  ACCOUNT_DELETED,
  CANT_CREATE,
  CANT_REACH,
  TOO_MANY_TRIES,
  TOO_MANY_TRIES_MINUTE,
} from './errors';

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

const klass: ClassDetail = {
  id: '01924b2c-0000-7000-8000-000000000002',
  name: 'Period 4 Biology',
  joinCode: 'KWX49Q',
  createdAt: '2026-10-05T14:00:00.000Z',
  liveSessionId: null,
};

describe('createClass', () => {
  it('sends the name and answers with the class the server made', async () => {
    const { client, sent } = api(200, klass);
    expect(await createClass(client, 'Period 4 Biology')).toEqual({ kind: 'created', klass });
    expect(sent[0]?.url).toBe('http://api/v1/classes');
    expect(sent[0]?.init?.method).toBe('POST');
    expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({ name: 'Period 4 Biology' });
  });

  it('answers every failure in words, never the API’s log line for a 5xx or a timeout', async () => {
    const unreachable = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(await createClass(unreachable, 'Period 4')).toEqual({
      kind: 'failed',
      message: CANT_REACH,
    });
    const busy = api(429, { error: { code: 'rate_limited', message: 'too many requests' } });
    expect(await createClass(busy.client, 'Period 4')).toEqual({
      kind: 'failed',
      message: TOO_MANY_TRIES,
    });
    const waiting = api(
      429,
      { error: { code: 'rate_limited', message: 'too many requests' } },
      { 'retry-after': '30' },
    );
    expect(await createClass(waiting.client, 'Period 4')).toEqual({
      kind: 'failed',
      message: TOO_MANY_TRIES_MINUTE,
    });
    for (const status of [500, 502, 408]) {
      const broken = api(status, { error: { code: 'internal', message: 'internal error' } });
      expect(await createClass(broken.client, 'Period 4'), String(status)).toEqual({
        kind: 'failed',
        message: CANT_CREATE,
      });
    }
    // An answer that isn't JSON (a proxy's page): no class to show, so the same words.
    const garbled = api(200, '<html>');
    expect(await createClass(garbled.client, 'Period 4')).toEqual({
      kind: 'failed',
      message: CANT_CREATE,
    });
  });

  it('says a refusal with no reason as the create’s own words, the no-school 409 included (PB3)', async () => {
    // A teacher with no school: no account reaches it (a redeemed invite always sets one), and no
    // one can add an account to a school, so it has no words of its own, never the API's log line.
    for (const [status, code, message] of [
      [409, 'conflict', 'teacher is not assigned to a school'],
      [403, 'forbidden', 'teacher access required'],
    ] as const) {
      const refused = api(status, { error: { code, message } });
      expect(await createClass(refused.client, 'Period 4'), String(status)).toEqual({
        kind: 'failed',
        message: CANT_CREATE,
      });
    }
    expect(Object.keys(errors)).not.toContain('NO_SCHOOL');
    // The route's other 409 carries its reason, and is said in Bali's words, never the API's
    // own sentence, written for a log (PB3's review). It is final: sending the name again can't
    // undo a deleted account, so the form offers no Try again (PB5's review).
    const gone = api(409, {
      error: { code: 'conflict', reason: 'account_deleted', message: 'this account was deleted' },
    });
    expect(await createClass(gone.client, 'Period 4')).toEqual({
      kind: 'final',
      message: ACCOUNT_DELETED,
    });
    expect(ACCOUNT_DELETED).toBe(
      'This account was deleted, so nothing changed. Sign out, then sign in again.',
    );
    expect(ACCOUNT_DELETED).not.toMatch(/[—–!]/);
  });

  it('holds a name to the API’s own limit, so its 400 for a longer one is never met', () => {
    const route = readFileSync(
      fileURLToPath(new URL('../../../api/src/routes/classes.ts', import.meta.url)),
      'utf8',
    );
    expect(route).toContain(
      `const CreateBody = z.object({ name: z.string().trim().min(1).max(${CLASS_NAME_MAX}) });`,
    );
  });

  it('holds the form’s words (D2e): no em-dash, no exclamation mark, a way on', () => {
    expect(CANT_CREATE).toBe(
      "Bali couldn't finish creating the class. If it isn't in your list above, try again.",
    );
    expect(CANT_CREATE).not.toMatch(/[—–!]/);
  });

  it('waits for the create’s answer however long it takes, unlike every other save: it takes no eventId, so a Try again after a limit would make a second class (the owner, 2026-10-16)', async () => {
    vi.useFakeTimers();
    try {
      const klass: ClassDetail = {
        id: 'c1',
        name: 'Period 4 Biology',
        joinCode: 'ABCDEF',
        createdAt: '2026-10-01T12:00:00.000Z',
        liveSessionId: null,
      };
      const client = createApiClient({
        baseUrl: 'http://api',
        getToken: () => 'tok',
        fetchImpl: (_url, init) =>
          new Promise((answer, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
            setTimeout(() => answer(Response.json(klass)), 6 * SAVE_TIMEOUT_MS);
          }),
      });
      const created = createClass(client, 'Period 4 Biology');
      const settled = vi.fn();
      void created.then(settled);
      await vi.advanceTimersByTimeAsync(6 * SAVE_TIMEOUT_MS - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await created).toEqual({ kind: 'created', klass });
    } finally {
      vi.useRealTimers();
    }
  });
});

const AT = Date.parse('2026-10-12T14:30:00.000Z');
/** A teacher's class with its summary (PV2): running until `endsAt`, if given. */
function taught(id: string, endsAt?: string): TaughtClass {
  return {
    id,
    name: id,
    teacher: { displayName: 'Ms. Rivera' },
    enrollmentId: null,
    liveSession: null,
    summary: {
      studentCount: 28,
      runningSession: endsAt ? { id: `s-${id}`, endsAt } : null,
      lastSession: null,
    },
  };
}

describe('a class live on Classes, by this computer’s clock (PV16a)', () => {
  it('is its running session until its bell, and none from it', () => {
    const bell = new Date(AT + 60_000).toISOString();
    expect(liveNow(taught('a', bell), AT)).toEqual({ id: 's-a', endsAt: bell });
    expect(liveNow(taught('a', bell), AT + 59_999)).not.toBeNull();
    expect(liveNow(taught('a', bell), AT + 60_000)).toBeNull();
    expect(liveNow(taught('a'), AT)).toBeNull();
    // A class with no summary, as a student's is: never live here.
    expect(liveNow({ ...taught('a', bell), summary: undefined }, AT)).toBeNull();
  });

  it('reads the list again at the first bell still to ring, and none once every bell has', () => {
    const soon = new Date(AT + 60_000).toISOString();
    const later = new Date(AT + 600_000).toISOString();
    const gone = new Date(AT - 1).toISOString();
    const classes = [taught('a', later), taught('b'), taught('c', soon), taught('d', gone)];
    expect(nextBell(classes, AT)).toBe(AT + 60_000);
    expect(nextBell(classes, AT + 60_000)).toBe(AT + 600_000);
    expect(nextBell(classes, AT + 600_000)).toBeNull();
    expect(nextBell([], AT)).toBeNull();
  });
});

describe('lastOf: Home’s Last session, the last session over among the classes (PV17c)', () => {
  /** A class whose last session over ran `from` to `to` (ISO), as PV2 gives it. */
  const ran = (id: string, from: string, to: string): TaughtClass => ({
    ...taught(id),
    summary: {
      studentCount: 28,
      runningSession: null,
      lastSession: { id: `l-${id}`, startedAt: from, endedAt: to },
    },
  });
  const t = (hhmm: string) => `2026-10-12T${hhmm}:00.000Z`;

  it('is none until a class’s first session ends (PV1: no card before then)', () => {
    expect(lastOf([])).toBeNull();
    expect(lastOf([taught('a'), taught('b', t('15:00'))])).toBeNull();
    expect(lastOf([{ ...taught('a'), summary: undefined }])).toBeNull();
  });

  it('is the one that ended last, with its class, whatever the classes’ order', () => {
    const first = ran('Period 1 Biology', t('08:00'), t('08:50'));
    const third = ran('Biology, period 3', t('09:05'), t('09:55'));
    const friday = ran('Period 2 Biology', '2026-10-09T13:15:00.000Z', '2026-10-09T14:05:00.000Z');
    expect(lastOf([first, third, friday, taught('none')])).toEqual({
      classId: 'Biology, period 3',
      name: 'Biology, period 3',
      session: { id: 'l-Biology, period 3', startedAt: t('09:05'), endedAt: t('09:55') },
    });
    expect(lastOf([friday, third, first])?.classId).toBe('Biology, period 3');
  });

  it('of two that ended together, the one that started last; then the account’s order', () => {
    const long = ran('a', t('08:00'), t('09:00'));
    const short = ran('b', t('08:30'), t('09:00'));
    expect(lastOf([short, long])?.classId).toBe('b');
    expect(lastOf([long, short])?.classId).toBe('b');
    const twin = ran('c', t('08:30'), t('09:00'));
    expect(lastOf([short, twin])?.classId).toBe('b');
    expect(lastOf([twin, short])?.classId).toBe('c');
  });
});

describe('daysBefore, the calendar days between two moments, in a zone', () => {
  it('counts calendar days, never 24-hour spans', () => {
    const now = new Date('2026-10-12T14:30:00.000Z');
    expect(daysBefore(new Date('2026-10-12T00:00:00.000Z'), now, 'UTC')).toBe(0);
    expect(daysBefore(new Date('2026-10-11T23:59:00.000Z'), now, 'UTC')).toBe(1);
    expect(daysBefore(new Date('2026-10-05T14:30:00.000Z'), now, 'UTC')).toBe(7);
    expect(daysBefore(new Date('2025-12-18T09:00:00.000Z'), now, 'UTC')).toBe(298);
    // The same two moments in Chicago, where 01:00 UTC on the 12th is still the 11th.
    expect(daysBefore(new Date('2026-10-12T01:00:00.000Z'), now, 'America/Chicago')).toBe(1);
    expect(daysBefore(new Date('2026-10-12T01:00:00.000Z'), now, 'UTC')).toBe(0);
  });
});
