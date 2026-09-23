import { describe, expect, it } from 'vitest';

import { API_VERSION, isUnlockReason, UNLOCK_REASONS } from './index.js';

describe('@bali/shared', () => {
  it('exports the API version prefix', () => {
    expect(API_VERSION).toBe('v1');
  });

  it('recognises the unlock reasons and nothing else', () => {
    for (const reason of UNLOCK_REASONS) expect(isUnlockReason(reason)).toBe(true);
    for (const other of ['Bathroom', 'toString', '', null, undefined, 1, {}, ['nurse']]) {
      expect(isUnlockReason(other)).toBe(false);
    }
  });
});
