import { describe, expect, it } from 'vitest';

import { createSettledCursor, type SettledReads } from '../src/sse/settled.js';

/*
 * The settled point a live stream resumes from (ARCHITECTURE, Live updates): a seq every write
 * handed one at or below it has finished, so each of those events shows now or never will. The
 * database's two reads are the test's to set here, `seq` (the newest seq given out) and `writing`
 * (the transactions holding the events table's write lock), so this is the bookkeeping alone;
 * stream.test.ts and settled.test.ts hold it to real Postgres.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The two reads, as the test sets them, each one counted. */
function scripted(seq = 0, writing: string[] = []) {
  const state = { seq, writing, looks: 0, fail: null as Error | null };
  const reads: SettledReads = {
    handedOut: () => {
      state.looks += 1;
      if (state.fail) {
        const failure = state.fail;
        state.fail = null;
        return Promise.reject(failure);
      }
      return Promise.resolve(state.seq);
    },
    writers: () => Promise.resolve([...state.writing]),
  };
  return { state, reads };
}

describe('the settled point', () => {
  it('is the newest seq handed out while nothing is writing', async () => {
    const { reads } = scripted(10);
    expect(await createSettledCursor(reads).now()).toBe(10);
  });

  it('waits for every write that held the table when the seq was read, and for no later one', async () => {
    const { state, reads } = scripted(10, ['a']);
    const cursor = createSettledCursor(reads);
    // `a` may hold any seq up to 10, so none of them is settled yet.
    expect(await cursor.now()).toBe(0);
    // More seqs go out while `a` writes, one of them to `b`.
    state.seq = 15;
    state.writing = ['a', 'b'];
    expect(await cursor.now()).toBe(0);
    // `a` is done: everything up to 10 is, but 15 waits for `b`. `c` began after 15 was read, so
    // it holds nothing at or below 15.
    state.writing = ['b', 'c'];
    expect(await cursor.now()).toBe(10);
    state.writing = ['c'];
    expect(await cursor.now()).toBe(15);
    state.writing = [];
    expect(await cursor.now()).toBe(15);
  });

  it('holds below a long write however many seqs go out meanwhile, then moves to the newest', async () => {
    const { state, reads } = scripted(5, []);
    const cursor = createSettledCursor(reads);
    expect(await cursor.now()).toBe(5);
    // A Start joining a class's waiting taps: one transaction, seq after seq, while short writes
    // come and go beside it.
    state.writing = ['start'];
    for (let i = 1; i <= 100; i += 1) {
      state.seq = 5 + i;
      state.writing = ['start', `tap-${i}`];
      expect(await cursor.now()).toBe(5);
    }
    state.writing = ['tap-101'];
    expect(await cursor.now()).toBe(105);
  });

  it('takes one look for every ask made while one is on its way', async () => {
    const { state, reads } = scripted(7);
    const cursor = createSettledCursor(reads);
    expect(await Promise.all([cursor.now(), cursor.now(), cursor.now()])).toEqual([7, 7, 7]);
    expect(state.looks).toBe(1);
    await cursor.now();
    expect(state.looks).toBe(2);
  });

  it('fails an ask whose read failed, and looks again on the next', async () => {
    const { state, reads } = scripted(3);
    const cursor = createSettledCursor(reads);
    state.fail = new Error('the database is out of reach');
    await expect(cursor.now()).rejects.toThrow('out of reach');
    expect(await cursor.now()).toBe(3);
  });

  it('fresh waits a moment for the writes in flight as it is asked', async () => {
    const { state, reads } = scripted(20, ['a']);
    const cursor = createSettledCursor(reads, { freshWaitMs: 2_000, freshPollMs: 5 });
    const asked = cursor.fresh();
    await sleep(40);
    state.writing = ['b']; // `a` is done; `b` began after the ask
    expect(await asked).toBe(20);
  });

  it('fresh answers what is settled once its wait is over, a long write still open', async () => {
    const { state, reads } = scripted(4);
    const cursor = createSettledCursor(reads, { freshWaitMs: 60, freshPollMs: 5 });
    expect(await cursor.now()).toBe(4);
    state.seq = 9;
    state.writing = ['start'];
    const began = Date.now();
    expect(await cursor.fresh()).toBe(4);
    expect(Date.now() - began).toBeGreaterThanOrEqual(55);
  });
});
