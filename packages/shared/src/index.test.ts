import { describe, expect, it } from 'vitest';

import { API_VERSION, isUnlockReason, tidyDisplayName, UNLOCK_REASONS } from './index.js';

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

  it('tidies a display name: one space for each blank run, none at the ends', () => {
    // Blank is whitespace, the blank braille cell and the null notehead — the
    // symbols a name is compared without, so a stored one never keeps them at
    // an edge (a leading U+2800 was stored as sent).
    expect(tidyDisplayName('⠀Bea')).toBe('Bea');
    expect(tidyDisplayName('Bea\u{1D159}')).toBe('Bea');
    expect(tidyDisplayName('  Ana   Reyes\t')).toBe('Ana Reyes');
    expect(tidyDisplayName('Bea⠀⠀Ortiz')).toBe('Bea Ortiz');
    expect(tidyDisplayName('Bea \u{1D159} Ortiz')).toBe('Bea Ortiz');
    expect(tidyDisplayName('⠀ \u{1D159}')).toBe('');
    // Visible letters and the joiners names need are left alone.
    expect(tidyDisplayName('م‌ی')).toBe('م‌ی');
  });
});
