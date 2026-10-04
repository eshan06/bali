import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

import { requireAuth } from './auth/plugin.js';
import { ApiError } from './errors.js';

/*
 * The rate limits (ISSUES #1; API decision 4's 429). A school's 600 phones share one internet
 * address, so a signed-in request is budgeted by its verified account, never its address
 * (`authenticate` spends it once the token checks out), and only a request no one is signed in on
 * — no token, or one the pool refused — by address, with a budget for a whole school. Guessing a
 * code — a join code, or a teacher invite's (T1b) — gets a tighter budget per account and, as
 * accounts are free while self sign-up is on, a backstop on misses per address. Over a budget is a
 * 429 in the one error shape, `Retry-After` saying when one more passes: a throttle that refills,
 * never a block. The sizes and why: docs/DECISIONS.md, 2026-10-04 (L1, T1b).
 *
 * Each budget is a token bucket per key, in this process's memory — no Redis, no new
 * infrastructure: N instances of the API are N times each budget.
 */

/** Up to `burst` requests at once, refilled at `perMinute` a minute. */
export interface Budget {
  burst: number;
  perMinute: number;
}

export interface Budgets {
  /** Each signed-in account, on every `/v1` route: keyed by the verified Cognito `sub`. */
  account: Budget;
  /** Each address, for a request no one is signed in on: no token, or one the pool refused. */
  unsigned: Budget;
  /** Each account's tries on the join-code preview and the join. */
  joinTries: Budget;
  /** Each address's misses there (`404 class_not_found`), whatever the account. */
  joinMisses: Budget;
  /** Each account's tries at redeeming a teacher invite (T1b). */
  inviteTries: Budget;
  /** Each address's misses there (`404 invite_not_found`), whatever the account. */
  inviteMisses: Budget;
}

export const BUDGETS: Budgets = {
  // The load gate caps its flooder at this budget (scripts/load/gate.js): change both together.
  account: { burst: 120, perMinute: 120 },
  unsigned: { burst: 1_200, perMinute: 600 },
  joinTries: { burst: 20, perMinute: 2 },
  joinMisses: { burst: 100, perMinute: 6 },
  inviteTries: { burst: 5, perMinute: 1 },
  inviteMisses: { burst: 20, perMinute: 2 },
};

/** What a guess is at: a join code (the preview and the join), or a teacher invite (its redeem). */
export type Guess = 'join' | 'invite';

/** Budgets to change from `BUDGETS`, and the clock they refill by (ms): tests drive both. */
export interface LimitOptions extends Partial<Budgets> {
  now?: () => number;
}

/**
 * The caller's address: `X-Real-IP`, which Railway's edge sets on every request to the client's
 * own address, overwriting any a client sends (docs.railway.com, Public Networking, Specs &
 * Limits). Never `X-Forwarded-For`: Railway documents no hop count for it, its staff say the
 * count varies, and Fastify 5.12 ignores a numeric `trustProxy` — so that stays off, and no entry
 * a client adds there picks a bucket. With none (local runs, tests), the socket's peer.
 */
export function clientAddress(request: FastifyRequest): string {
  const real = request.headers['x-real-ip'];
  return typeof real === 'string' && isIP(real) !== 0 ? real : request.ip;
}

export interface Bucket {
  /** Spend one when `key` can: 0, or the seconds to wait, with nothing spent. */
  take(key: string): number;
  /** Give `key` back one it spent. */
  refund(key: string): void;
  /** How many keys it holds an entry for: never more than its `maxKeys`. */
  size(): number;
}

/**
 * The most keys one budget holds at once (Phase 6 S3). Without a cap, a flood of distinct keys —
 * addresses, say — would grow the map until the next sweep, a full refill's time away. A key
 * takes well under a kilobyte, so six budgets at the cap stay within tens of megabytes.
 */
export const MAX_KEYS = 100_000;

export function bucket(
  { burst, perMinute }: Budget,
  now: () => number,
  maxKeys = MAX_KEYS,
): Bucket {
  const perMs = perMinute / 60_000;
  // A cap under one would evict nothing and let the map grow without bound.
  const cap = Math.max(1, maxKeys);
  // What each key holds and since when; a key with its whole burst has no entry. A Map keeps
  // insertion order, and each use re-inserts its key, so the first key is the one idle longest.
  const held = new Map<string, { tokens: number; at: number }>();
  let sweptAt = now();
  const tokens = (key: string, at: number): number => {
    const entry = held.get(key);
    return entry ? Math.min(burst, entry.tokens + Math.max(0, at - entry.at) * perMs) : burst;
  };
  const keep = (key: string, left: number, at: number): void => {
    held.delete(key);
    if (left >= burst) return;
    // Full: the key idle longest goes. It starts again with its whole burst — a throttle that
    // forgets one idle key early, never a map that grows without bound.
    if (held.size >= cap) held.delete(held.keys().next().value as string);
    held.set(key, { tokens: left, at });
  };
  const take = (key: string): number => {
    const at = now();
    // Once a full refill's time, forget the keys refilled since: memory follows who is active.
    if (at - sweptAt >= burst / perMs) {
      sweptAt = at;
      for (const k of held.keys()) if (tokens(k, at) >= burst) held.delete(k);
    }
    const left = tokens(key, at);
    if (left < 1) {
      // Refused, but in use: to the back of the line, so a key being hammered is never the idle one.
      const entry = held.get(key);
      if (entry) {
        held.delete(key);
        held.set(key, entry);
      }
      return Math.ceil((1 - left) / perMs / 1000);
    }
    keep(key, left - 1, at);
    return 0;
  };
  const refund = (key: string): void => {
    const at = now();
    keep(key, tokens(key, at) + 1, at);
  };
  return { take, refund, size: () => held.size };
}

/** Over budget: a 429 in the one error shape, with when to try again. */
function refuse(seconds: number, message: string): void {
  if (seconds > 0) throw ApiError.rateLimited(message, seconds);
}

export interface Limiter {
  /** A signed-in request: one of the account's budget. */
  signedIn(sub: string): void;
  /** A request no one is signed in on: one of its address's budget. */
  unsigned(request: FastifyRequest): void;
  /**
   * A signed-in request to look a code up (`at` says which kind), before the lookup, which is
   * what answers a guess: one of its address's misses held, so lookups in flight never outrun
   * the backstop, then one of the account's tries.
   */
  guess(request: FastifyRequest, at: Guess): void;
  /**
   * Its answer, `status`: a 404 — `class_not_found` or `invite_not_found`, and any 404 on a
   * lookup tells a guesser the code opens nothing — keeps the miss it held; any other answer
   * gives it back.
   */
  settle(request: FastifyRequest, status: number): void;
}

export function createLimiter({
  now = () => performance.now(),
  ...budgets
}: LimitOptions = {}): Limiter {
  const of = (name: keyof Budgets) => bucket(budgets[name] ?? BUDGETS[name], now);
  const account = of('account');
  const unsigned = of('unsigned');
  const guesses: Record<Guess, { tries: Bucket; misses: Bucket; tried: string; missed: string }> = {
    join: {
      tries: of('joinTries'),
      misses: of('joinMisses'),
      tried: 'too many join-code tries',
      missed: 'too many unknown join codes from here',
    },
    invite: {
      tries: of('inviteTries'),
      misses: of('inviteMisses'),
      tried: 'too many invite-code tries',
      missed: 'too many unknown invite codes from here',
    },
  };
  // The guesses holding one of their address's misses, and whose, until their answer settles it;
  // one whose answer never goes out (its client gone) keeps it, the safe side.
  const holding = new WeakMap<FastifyRequest, Bucket>();
  return {
    signedIn: (sub) => refuse(account.take(sub), 'too many requests from this account'),
    unsigned: (request) =>
      refuse(unsigned.take(clientAddress(request)), 'too many requests with no sign-in'),
    guess: (request, at) => {
      const { tries, misses, tried, missed } = guesses[at];
      refuse(misses.take(clientAddress(request)), missed);
      holding.set(request, misses);
      refuse(tries.take(requireAuth(request).sub), tried);
    },
    settle: (request, status) => {
      const misses = holding.get(request);
      holding.delete(request);
      if (misses && status !== 404) misses.refund(clientAddress(request));
    },
  };
}

/**
 * A route's hooks for a guess at a code (`at`): `authenticate`, then the guess, before the
 * handler; its answer settles the miss the guess held.
 */
export function guessing(app: FastifyInstance, limits: Limiter, at: Guess) {
  return {
    preHandler: async (request: FastifyRequest) => {
      await app.authenticate(request);
      limits.guess(request, at);
    },
    onResponse: (request: FastifyRequest, reply: FastifyReply, done: () => void) => {
      limits.settle(request, reply.statusCode);
      done();
    },
  };
}
