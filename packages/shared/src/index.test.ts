import { describe, expect, it } from 'vitest';

import { API_VERSION } from './index.js';

describe('@bali/shared', () => {
  it('exports the API version prefix', () => {
    expect(API_VERSION).toBe('v1');
  });
});
