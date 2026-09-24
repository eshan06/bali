import { describe, expect, it } from 'vitest';

import { stateChangeDisposition, tapDisposition } from './outbox-contract.js';
import { isUnlockRecorded, unlockDisposition } from './unlock-contract.js';

describe('unlock durability contract (ISSUES #2)', () => {
  it('any 2xx carrying a recorded outcome deletes the record from the outbox', () => {
    for (const status of [200, 201, 204]) {
      for (const outcome of ['applied', 'recorded', 'replay']) {
        expect(unlockDisposition(status, { outcome })).toBe('recorded');
      }
    }
  });

  it('a 2xx without a recorded outcome is not treated as saved — it retries', () => {
    // The decision keys on the body outcome, not the exact 2xx code, so a 201
    // without a recorded outcome must not be mistaken for a saved record.
    expect(unlockDisposition(200, { outcome: 'weird' })).toBe('retry');
    expect(unlockDisposition(200, { outcome: null })).toBe('retry');
    expect(unlockDisposition(200)).toBe('retry');
    expect(unlockDisposition(204)).toBe('retry');
  });

  it('a 401 means refresh the token and retry, never discard', () => {
    expect(unlockDisposition(401)).toBe('reauth');
  });

  it('transport failures, a timeout, rate limiting, and 5xx are transient retries', () => {
    expect(unlockDisposition('network_error')).toBe('retry');
    expect(unlockDisposition(408)).toBe('retry');
    expect(unlockDisposition(429)).toBe('retry');
    for (const status of [500, 502, 503]) {
      expect(unlockDisposition(status)).toBe('retry');
    }
  });

  it('reads a timeout and rate limiting as the transport, as the tap and state-change tables do', () => {
    // A5: 408 was 'retry_and_surface' here alone — the record was kept either
    // way, but a timeout is never a refusal, so it is never shown as one.
    for (const status of [408, 429]) {
      expect(unlockDisposition(status)).toBe('retry');
      expect(tapDisposition(status)).toBe('retry');
      expect(stateChangeDisposition(status)).toBe('retry');
    }
  });

  it('never discards: a non-401 4xx that must not occur keeps the record AND surfaces it', () => {
    for (const status of [400, 403, 404, 409]) {
      expect(unlockDisposition(status)).toBe('retry_and_surface');
    }
  });

  it('a recorded outcome on a non-2xx status never deletes — the status gate wins', () => {
    // The body outcome is authoritative only on a 2xx; a stale recorded body on
    // a failure status must not be mistaken for a durable save. This fences off a
    // future refactor that hoisted the body check above the status gate.
    expect(unlockDisposition(500, { outcome: 'recorded' })).toBe('retry');
    expect(unlockDisposition('network_error', { outcome: 'recorded' })).toBe('retry');
    expect(unlockDisposition(400, { outcome: 'recorded' })).toBe('retry_and_surface');
    expect(unlockDisposition(401, { outcome: 'recorded' })).toBe('reauth');
  });

  it('isUnlockRecorded recognizes exactly the recorded outcomes', () => {
    expect(isUnlockRecorded('applied')).toBe(true);
    expect(isUnlockRecorded('recorded')).toBe(true);
    expect(isUnlockRecorded('replay')).toBe(true);
    expect(isUnlockRecorded('armed')).toBe(false);
    expect(isUnlockRecorded('')).toBe(false);
  });
});
