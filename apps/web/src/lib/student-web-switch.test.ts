import { afterEach, describe, expect, it, vi } from 'vitest';

import { studentWebOn } from './student-web-switch';

/*
 * The student web's switch (ARCHITECTURE, Web portal, decision 9; LO15): `NEXT_PUBLIC_STUDENT_WEB`,
 * off unless it says on. Each piece it changes is tested both ways where it is drawn.
 */
afterEach(() => vi.unstubAllEnvs());

describe('the student web’s switch', () => {
  it('is off when nothing sets it, so students are off the web with nothing to set', () => {
    vi.stubEnv('NEXT_PUBLIC_STUDENT_WEB', undefined);
    expect(studentWebOn()).toBe(false);
  });

  it('is on when it says on, its case and the spaces around it aside', () => {
    for (const said of ['on', 'ON', 'On', ' on ', 'on\n']) {
      vi.stubEnv('NEXT_PUBLIC_STUDENT_WEB', said);
      expect(studentWebOn(), JSON.stringify(said)).toBe(true);
    }
  });

  it('is off for anything else: only on turns it on', () => {
    for (const said of ['', 'off', 'OFF', 'true', 'yes', '1', 'o n', 'onn', 'no']) {
      vi.stubEnv('NEXT_PUBLIC_STUDENT_WEB', said);
      expect(studentWebOn(), JSON.stringify(said)).toBe(false);
    }
  });

  it('is read each time it is asked, never kept from the first', () => {
    vi.stubEnv('NEXT_PUBLIC_STUDENT_WEB', 'on');
    expect(studentWebOn()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_STUDENT_WEB', 'off');
    expect(studentWebOn()).toBe(false);
  });
});
