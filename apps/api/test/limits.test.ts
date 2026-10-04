import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/errors.js';
import { BUDGETS, createLimiter, type Limiter, type LimitOptions } from '../src/limits.js';

/*
 * The production budgets (`BUDGETS`) against the clients' real cadence, the
 * reasoning in docs/DECISIONS.md (2026-10-04, L1): never a 429 for an honest
 * phone, a teacher's portal or a school joining its classes, and a flood or a
 * guesser held to its budget. On a clock the test drives, so an hour runs in
 * milliseconds. L2b's load gate proves the same against the real app.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SCHOOL = '203.0.113.10';

/** A request by `sub` from `address`, as `authenticate` leaves it. */
const request = (sub: string, address = SCHOOL) =>
  ({
    auth: { sub, claims: {} },
    headers: { 'x-real-ip': address },
    ip: '100.64.0.7',
  }) as unknown as FastifyRequest;

/** A lookup by `student` answered `status` — or 429, as the app answers a guess over budget. */
function lookUp(limiter: Limiter, student: FastifyRequest, status: number): void {
  try {
    limiter.guess(student);
  } catch (err) {
    limiter.settle(student, 429);
    throw err;
  }
  limiter.settle(student, status);
}

/** A limiter on a clock the test sets, and how many of its calls it refused. */
function driven(budgets: Omit<LimitOptions, 'now'> = {}) {
  const clock = { ms: 0 };
  const limiter = createLimiter({ ...budgets, now: () => clock.ms });
  let refused = 0;
  const count = (spend: (limiter: Limiter) => void): boolean => {
    try {
      spend(limiter);
      return true;
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'rate_limited') throw err;
      refused += 1;
      return false;
    }
  };
  return { clock, limiter, count, refused: () => refused };
}

describe('BUDGETS never refuses an honest client', () => {
  it('a phone: its read or check-in every 30 s through a school day, a backlog sent at once, its history paged', () => {
    const { clock, count, refused } = driven();
    for (clock.ms = 0; clock.ms <= 8 * HOUR; clock.ms += 30_000) {
      count((l) => l.signedIn('phone'));
      // Back online after a morning offline: 40 records in its outbox, each
      // answer's read of GET /v1/me, then History's first five pages.
      if (clock.ms === HOUR) {
        for (let i = 0; i < 40 * 2 + 5; i += 1) count((l) => l.signedIn('phone'));
      }
    }
    expect(refused()).toBe(0);
  });

  it('a teacher with five portal tabs: each loading at once, then a snapshot every 15 s and its stream back every 10 s', () => {
    const { clock, count, refused } = driven();
    const tabs = 5;
    for (let i = 0; i < tabs * 5; i += 1) count((l) => l.signedIn('teacher'));
    for (clock.ms = 0; clock.ms <= HOUR; clock.ms += 5_000) {
      const due = Number(clock.ms % 15_000 === 0) + Number(clock.ms % 10_000 === 0);
      for (let i = 0; i < tabs * due; i += 1) count((l) => l.signedIn('teacher'));
    }
    expect(refused()).toBe(0);
  });

  it('a school of 600 behind one address at the bell: each phone its tap and a read, in the same second', () => {
    const { count, refused } = driven();
    for (let i = 0; i < 600; i += 1) {
      count((l) => l.signedIn(`student-${i}`));
      count((l) => l.signedIn(`student-${i}`));
    }
    expect(refused()).toBe(0);
  });

  it('a school of 600 joining its classes from one address in ten minutes, every tenth student mistyping a code first', () => {
    const { clock, count, refused } = driven();
    for (let i = 0; i < 600; i += 1) {
      clock.ms = i * 1_000;
      const student = request(`student-${i}`);
      if (i % 10 === 0) count((l) => lookUp(l, student, 404));
      count((l) => lookUp(l, student, 200)); // the preview
      count((l) => lookUp(l, student, 200)); // the join
    }
    expect(refused()).toBe(0);
  });

  it('a whole school whose tokens all fail at once, from one address', () => {
    const { count, refused } = driven();
    for (let i = 0; i < 600; i += 1) count((l) => l.unsigned(request(`student-${i}`)));
    expect(refused()).toBe(0);
  });
});

describe('BUDGETS holds a flood or a guesser to its budget', () => {
  it('a flooding account: its burst, then its rate, each refusal saying when to come back', () => {
    const { clock, limiter, count } = driven();
    let passed = 0;
    // A hundred a second for a minute.
    for (clock.ms = 0; clock.ms < MINUTE; clock.ms += 10) {
      if (count((l) => l.signedIn('flood'))) passed += 1;
    }
    const { burst, perMinute } = BUDGETS.account;
    expect(passed).toBeLessThanOrEqual(burst + perMinute);
    expect(passed).toBeGreaterThan(burst);
    expect(() => limiter.signedIn('flood')).toThrow(
      expect.objectContaining({ code: 'rate_limited', retryAfter: 1 }),
    );
  });

  it('a guesser with a new free account for every guess, at one address: an hour of guessing is the misses’ budget', () => {
    const { clock, count } = driven();
    let looked = 0;
    for (clock.ms = 0; clock.ms < HOUR; clock.ms += 100) {
      const guess = request(`guesser-${clock.ms}`, '192.0.2.66');
      if (count((l) => lookUp(l, guess, 404))) looked += 1;
    }
    const { burst, perMinute } = BUDGETS.joinMisses;
    expect(looked).toBeLessThanOrEqual(burst + perMinute * 60);
  });
});

describe('the buckets', () => {
  it('hold a miss for each lookup in flight: guesses racing the backstop never outrun it', () => {
    const { limiter } = driven({ joinMisses: { burst: 2, perMinute: 6 } });
    const [a, b, c] = [request('racer-a'), request('racer-b'), request('racer-c')];
    // Two lookups in flight hold both misses: a third waits, whatever they answer.
    limiter.guess(a);
    limiter.guess(b);
    expect(() => limiter.guess(c)).toThrow(expect.objectContaining({ retryAfter: 10 }));
    limiter.settle(c, 429);
    // a's code opened a class: its miss back, for c. b and c miss: both kept.
    limiter.settle(a, 200);
    limiter.guess(c);
    limiter.settle(b, 404);
    limiter.settle(c, 404);
    expect(() => limiter.guess(request('racer-d'))).toThrow(
      expect.objectContaining({ retryAfter: 10 }),
    );
  });

  it('spend nothing on a refusal, so a client over budget is back as the budget refills', () => {
    const { clock, limiter } = driven({ account: { burst: 1, perMinute: 60 } });
    limiter.signedIn('eager');
    for (let i = 0; i < 50; i += 1) expect(() => limiter.signedIn('eager')).toThrow(ApiError);
    clock.ms = 1_000;
    expect(() => limiter.signedIn('eager')).not.toThrow();
  });

  it('forget a key only once it has refilled: a key that spent keeps what it spent', () => {
    // Two at one a second: a full refill takes 2 s, when the next spend forgets the refilled keys.
    const { clock, limiter } = driven({ account: { burst: 2, perMinute: 60 } });
    limiter.signedIn('a');
    limiter.signedIn('a');
    clock.ms = 1_900;
    limiter.signedIn('b');
    clock.ms = 2_000;
    limiter.signedIn('c');
    // b spent one at 1.9 s and holds 1.1: one more, then none, as if no key was forgotten.
    expect(() => limiter.signedIn('b')).not.toThrow();
    expect(() => limiter.signedIn('b')).toThrow(ApiError);
    // a refilled, forgotten, and whole.
    expect(() => limiter.signedIn('a')).not.toThrow();
    expect(() => limiter.signedIn('a')).not.toThrow();
  });

  it('give a held miss back once, for any answer but a 404 — an account out of tries included', () => {
    const { limiter } = driven({
      joinMisses: { burst: 2, perMinute: 1 },
      joinTries: { burst: 1, perMinute: 1 },
    });
    for (const status of [200, 400, 403, 409, 500]) {
      lookUp(limiter, request(`answered-${status}`), status);
    }
    // a spends its only try; its second guess holds a miss, then is out of tries.
    const a = request('settled-a');
    lookUp(limiter, a, 200);
    expect(() => lookUp(limiter, a, 200)).toThrow(expect.objectContaining({ retryAfter: 60 }));
    // Both misses are the address's still. Two in flight hold both, and one
    // settled twice gives back only the one it held.
    const [b, c] = [request('settled-b'), request('settled-c')];
    limiter.guess(b);
    limiter.guess(c);
    limiter.settle(b, 200);
    limiter.settle(b, 200);
    limiter.settle(c, 404);
    lookUp(limiter, request('settled-d'), 404);
    expect(() => limiter.guess(request('settled-e'))).toThrow(ApiError);
  });
});
