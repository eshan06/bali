import { describe, expect, it } from 'vitest';

import type { TapOutcome } from './api.js';
import {
  readMayReconcile,
  type ReconcileStamp,
  STATE_CHANGE_OUTCOMES,
  stateChangeDisposition,
  type StateChangeDisposition,
  type StateChangeOutcome,
  TAP_OUTCOMES,
  tapDisposition,
  type TapDisposition,
} from './outbox-contract.js';

const SESSION = { id: 's', classId: 'c', endsAt: '2026-09-24T09:50:00.000Z' };

/*
 * The expected disposition of every outcome, typed over the whole union: an
 * outcome added to TapResponse or to either state-change response fails to
 * compile here until its disposition is decided, rather than falling through
 * to 'retry' unnoticed.
 */
const TAP_EXPECTED: Record<TapOutcome, { session: TapDisposition; none: TapDisposition }> = {
  joined: { session: 'apply_session', none: 'reread' },
  switched: { session: 'apply_session', none: 'reread' },
  replay: { session: 'apply_session', none: 'reread' },
  armed: { session: 'wait_for_start', none: 'wait_for_start' },
  already_armed: { session: 'wait_for_start', none: 'wait_for_start' },
};
const STATE_CHANGE_EXPECTED: Record<
  StateChangeOutcome,
  { session: StateChangeDisposition; none: StateChangeDisposition }
> = {
  applied: { session: 'apply_session', none: 'reread' },
  replay: { session: 'apply_session', none: 'reread' },
  recorded: { session: 'reread', none: 'reread' },
};

/** Statuses the API or its transport can answer that are not a server's refusal. */
const TRANSIENT = ['network_error', 408, 429, 500, 502, 503, 504] as const;
/** Every other 4xx: what the routes refuse with (400, 404, 409), Fastify's own (413, 415), and 403. */
const REFUSALS = [400, 403, 404, 409, 413, 415] as const;
/** Prototype keys a naive `outcome in table` lookup would mistake for an outcome. */
const UNKNOWN_OUTCOMES = ['weird', '', 'toString', '__proto__', 'constructor', null, undefined];

describe('tapDisposition (the tap outbox)', () => {
  it('lists every tap outcome', () => {
    expect([...TAP_OUTCOMES].sort()).toEqual(Object.keys(TAP_EXPECTED).sort());
  });

  it('every outcome on any 2xx deletes the record, and the session decides the window', () => {
    for (const status of [200, 201, 204]) {
      for (const outcome of TAP_OUTCOMES) {
        const expected = TAP_EXPECTED[outcome];
        expect(tapDisposition(status, { outcome, session: SESSION }), outcome).toBe(
          expected.session,
        );
        expect(tapDisposition(status, { outcome, session: null }), outcome).toBe(expected.none);
        expect(tapDisposition(status, { outcome }), outcome).toBe(expected.none);
      }
    }
  });

  it('a replay with no session is recorded: delete it and re-read the truth, never shield', () => {
    // Today: the retry of a tap that landed, with nothing running. After A4:
    // every retry recorded but no longer current. One answer for both.
    expect(tapDisposition(200, { outcome: 'replay', session: null })).toBe('reread');
    // Only an object is a session; anything else names none.
    for (const session of ['s', 1, true]) {
      expect(tapDisposition(200, { outcome: 'replay', session })).toBe('reread');
    }
  });

  it('a 2xx without a known outcome is not treated as recorded — it retries', () => {
    for (const outcome of UNKNOWN_OUTCOMES) {
      expect(tapDisposition(200, { outcome, session: SESSION }), String(outcome)).toBe('retry');
    }
    expect(tapDisposition(200)).toBe('retry');
    expect(tapDisposition(204)).toBe('retry');
  });

  it('a 401 means refresh the token and retry', () => {
    expect(tapDisposition(401)).toBe('reauth');
  });

  it('no response, 408, 429 and a 5xx are transient retries', () => {
    for (const status of TRANSIENT) expect(tapDisposition(status), String(status)).toBe('retry');
  });

  it('every other 4xx keeps the record, keeps retrying and surfaces it', () => {
    for (const status of REFUSALS) {
      expect(tapDisposition(status), String(status)).toBe('retry_and_surface');
    }
  });

  it('the status gate wins: a recorded body on a failure status never deletes', () => {
    const joined = { outcome: 'joined', session: SESSION };
    expect(tapDisposition(500, joined)).toBe('retry');
    expect(tapDisposition('network_error', joined)).toBe('retry');
    expect(tapDisposition(409, joined)).toBe('retry_and_surface');
    expect(tapDisposition(401, joined)).toBe('reauth');
  });
});

describe('stateChangeDisposition (refocus and protection off)', () => {
  it('lists every state-change outcome', () => {
    expect([...STATE_CHANGE_OUTCOMES].sort()).toEqual(Object.keys(STATE_CHANGE_EXPECTED).sort());
  });

  it('every outcome on any 2xx deletes the record; recorded never shields', () => {
    for (const status of [200, 201, 204]) {
      for (const outcome of STATE_CHANGE_OUTCOMES) {
        const expected = STATE_CHANGE_EXPECTED[outcome];
        expect(stateChangeDisposition(status, { outcome, session: SESSION }), outcome).toBe(
          expected.session,
        );
        expect(stateChangeDisposition(status, { outcome, session: null }), outcome).toBe(
          expected.none,
        );
      }
    }
  });

  it("protection off's recorded, and its replay, carry no session: delete and re-read", () => {
    // The A2c shape: `session` and `state` both null.
    expect(stateChangeDisposition(200, { outcome: 'recorded', session: null })).toBe('reread');
    expect(stateChangeDisposition(200, { outcome: 'replay', session: null })).toBe('reread');
  });

  it('a 2xx without a known outcome retries', () => {
    for (const outcome of UNKNOWN_OUTCOMES) {
      expect(stateChangeDisposition(200, { outcome, session: SESSION }), String(outcome)).toBe(
        'retry',
      );
    }
    expect(stateChangeDisposition(200)).toBe('retry');
  });

  it('a 401 means refresh the token and retry', () => {
    expect(stateChangeDisposition(401)).toBe('reauth');
  });

  it('no response, 408, 429 and a 5xx retry — a change the server never decided on is never dropped', () => {
    for (const status of TRANSIENT) {
      expect(stateChangeDisposition(status), String(status)).toBe('retry');
    }
  });

  it('a refusal is dropped, never resent: final for its event_id', () => {
    for (const status of REFUSALS) {
      expect(stateChangeDisposition(status), String(status)).toBe('drop');
    }
  });

  it('the status gate wins: an applied body on a failure status never deletes', () => {
    const applied = { outcome: 'applied', session: SESSION };
    expect(stateChangeDisposition(503, applied)).toBe('retry');
    expect(stateChangeDisposition(409, applied)).toBe('drop');
    expect(stateChangeDisposition(401, applied)).toBe('reauth');
  });
});

describe('readMayReconcile (a read never overrides a newer state change)', () => {
  /** The phone's two counters, kept the way ReconcileStamp describes. */
  function phone() {
    const c: ReconcileStamp = { changes: 0, awaiting: 0 };
    return {
      /** A tap, unlock, refocus or protection-off report, acted on at once and queued. */
      make: () => {
        c.changes += 1;
        c.awaiting += 1;
      },
      /** One of them answered (a disposition other than retry/reauth). */
      answer: () => {
        c.changes += 1;
        c.awaiting -= 1;
      },
      stamp: (): ReconcileStamp => ({ ...c }),
    };
  }

  it('a read sent and answered with nothing in between reconciles', () => {
    const p = phone();
    p.make();
    p.answer();
    const sent = p.stamp();
    expect(readMayReconcile(sent, p.stamp())).toBe(true);
  });

  it("#56's race: a refocus answered while a check-in is in flight wins", () => {
    // The check-in reads `unlocked` before the refocus commits and answers
    // after it, so its answer reaches the phone second and is the older one.
    const p = phone();
    const checkIn = p.stamp();
    p.make(); // the student refocuses
    p.answer(); // 200 applied, focused
    expect(readMayReconcile(checkIn, p.stamp())).toBe(false);
  });

  it('a change made while the read is in flight wins, answered or not', () => {
    const p = phone();
    const checkIn = p.stamp();
    p.make(); // an unlock, not answered yet
    expect(readMayReconcile(checkIn, p.stamp())).toBe(false);
  });

  it('a change still waiting when the read was sent wins, even if nothing moved since', () => {
    // An unlock queued offline, or in backoff: the server has not seen it, so
    // anything a read says is older than the phone's own truth.
    const p = phone();
    p.make();
    const checkIn = p.stamp();
    expect(readMayReconcile(checkIn, p.stamp())).toBe(false);
  });

  it('once the change is answered, the next read reconciles', () => {
    const p = phone();
    p.make();
    const stale = p.stamp();
    p.answer();
    expect(readMayReconcile(stale, p.stamp())).toBe(false);
    const next = p.stamp();
    expect(readMayReconcile(next, p.stamp())).toBe(true);
  });
});
