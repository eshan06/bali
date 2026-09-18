import { describe, expect, it } from 'vitest';

import { isUnlockRecorded, unlockDisposition } from './unlock-contract.js';

describe('unlock durability contract (ISSUES #2)', () => {
  it('only a 200 carrying a recorded outcome deletes the record from the outbox', () => {
    for (const outcome of ['applied', 'recorded', 'replay']) {
      expect(unlockDisposition(200, { outcome })).toBe('recorded');
    }
  });

  it('a 401 means refresh the token and retry, never discard', () => {
    expect(unlockDisposition(401)).toBe('reauth');
  });

  it('transport and transient server failures retry', () => {
    expect(unlockDisposition('network_error')).toBe('retry');
    for (const status of [429, 500, 502, 503]) {
      expect(unlockDisposition(status)).toBe('retry');
    }
  });

  it('never discards: a 4xx that must not occur for an unlock still retries', () => {
    for (const status of [400, 403, 404, 409]) {
      expect(unlockDisposition(status)).toBe('retry');
    }
  });

  it('a 200 without a recorded outcome is not treated as saved', () => {
    expect(unlockDisposition(200, { outcome: 'weird' })).toBe('retry');
    expect(unlockDisposition(200, { outcome: null })).toBe('retry');
    expect(unlockDisposition(200)).toBe('retry');
  });

  it('isUnlockRecorded recognizes exactly the recorded outcomes', () => {
    expect(isUnlockRecorded('applied')).toBe(true);
    expect(isUnlockRecorded('recorded')).toBe(true);
    expect(isUnlockRecorded('replay')).toBe(true);
    expect(isUnlockRecorded('armed')).toBe(false);
    expect(isUnlockRecorded('')).toBe(false);
  });
});
