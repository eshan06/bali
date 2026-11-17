import { afterEach, describe, expect, it, vi } from 'vitest';

import { lessonsOn } from './lessons';

/*
 * The lessons switch (ARCHITECTURE, Web portal, decision 8; LO1): `NEXT_PUBLIC_LESSONS`, on unless
 * it says off. Each piece it hides is tested both ways where it is drawn.
 */
afterEach(() => vi.unstubAllEnvs());

describe('the lessons switch', () => {
  it('is on when nothing sets it, as every build before it shipped', () => {
    vi.stubEnv('NEXT_PUBLIC_LESSONS', undefined);
    expect(lessonsOn()).toBe(true);
  });

  it('is off when it says off, its case and the spaces around it aside', () => {
    for (const said of ['off', 'OFF', 'Off', ' off ', 'off\n']) {
      vi.stubEnv('NEXT_PUBLIC_LESSONS', said);
      expect(lessonsOn(), JSON.stringify(said)).toBe(false);
    }
  });

  it('is on for anything else: only off turns it off', () => {
    for (const said of ['', 'on', 'ON', 'true', 'false', '0', 'no', 'of', 'offf']) {
      vi.stubEnv('NEXT_PUBLIC_LESSONS', said);
      expect(lessonsOn(), JSON.stringify(said)).toBe(true);
    }
  });

  it('is read each time it is asked, never kept from the first', () => {
    vi.stubEnv('NEXT_PUBLIC_LESSONS', 'off');
    expect(lessonsOn()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_LESSONS', 'on');
    expect(lessonsOn()).toBe(true);
  });
});
