import { describe, expect, it } from 'vitest';

import { backdateLastSeen, backdateSessionEnd } from '../src/testing.js';
import type { Database } from '../src/types.js';

/*
 * `@bali/db/testing` is a public subpath and the production image runs this
 * package's TypeScript straight from source, so "only tests call it" is a
 * convention, not a mechanism. These helpers write `participations` and
 * `sessions` behind the transition engine, so each carries its own guard —
 * these pin them.
 */
describe('backdateLastSeen', () => {
  // An unusable handle: the guard must reject before anything touches the
  // database, so no query can be attempted on it.
  const unusable = {} as Database;
  const where = { sessionId: 'session', studentId: 'student' };

  it('refuses to run with NODE_ENV=production', async () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await expect(backdateLastSeen(unusable, where, new Date())).rejects.toThrow(
        /test-only helper/,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it('refuses to run with NODE_ENV unset — the image default, so it denies by default', async () => {
    const saved = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      await expect(backdateLastSeen(unusable, where, new Date())).rejects.toThrow(
        /test-only helper/,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});

describe('backdateSessionEnd', () => {
  const unusable = {} as Database;
  const where = { sessionId: 'session' };

  it('refuses to run with NODE_ENV=production', async () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await expect(backdateSessionEnd(unusable, where, new Date())).rejects.toThrow(
        /test-only helper/,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it('refuses to run with NODE_ENV unset — the image default, so it denies by default', async () => {
    const saved = process.env.NODE_ENV;
    try {
      delete process.env.NODE_ENV;
      await expect(backdateSessionEnd(unusable, where, new Date())).rejects.toThrow(
        /test-only helper/,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it('names the table it writes, so the guard message stays specific', async () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await expect(backdateSessionEnd(unusable, where, new Date())).rejects.toThrow(/sessions/);
      await expect(
        backdateLastSeen(unusable, { sessionId: 's', studentId: 'x' }, new Date()),
      ).rejects.toThrow(/participations/);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});
