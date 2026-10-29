import { type Database, eventSeqHandedOut, eventWriters } from '@bali/db';

/** The two reads a settled point is made of (`@bali/db`). */
export interface SettledReads {
  /** The newest seq the events table's counter has given out, its row committed or not. */
  handedOut(): Promise<number>;
  /** The transactions writing events now: each holds the table's write lock until it ends. */
  writers(): Promise<readonly string[]>;
}

/**
 * A live stream's settled point (ARCHITECTURE, Live updates): a seq every write handed one at or
 * below it has finished, so each of those events shows now or never will. A row's seq is given out
 * as its insert runs, but the row shows only once its transaction commits, and one transaction can
 * take a great many (a Start joining every waiting tap of a class), so an event can show long after
 * others with higher seqs were sent. A stream re-reads from below its settled point, and the grid's
 * read names one for its first connect, so such an event is still sent, and sent once.
 */
export interface SettledCursor {
  /** The settled point after one look at who is writing; never lower than one it gave before. */
  now(): Promise<number>;
  /**
   * The same, once the writes on their way as it is asked have finished, or a moment
   * (`freshWaitMs`) has passed with one still open: the grid's read takes this one, so a grid
   * loaded beside a short write resumes no further back than that write.
   */
  fresh(): Promise<number>;
}

export interface SettledCursorOptions {
  /** How long `fresh` waits for the writes on their way as it is asked (250 ms). */
  freshWaitMs?: number;
  /** How often `fresh` looks again meanwhile (25 ms). */
  freshPollMs?: number;
}

/** Seqs kept waiting at once while a write stays open; past it, a newer one takes the last place. */
const WAITING_KEPT = 8;

/** A seq read as the newest given out, and the writes that may still hold one up to it. */
interface Waiting {
  seq: number;
  /** Who was writing just after `seq` was read: any write with a seq up to it is among them. */
  writers: ReadonlySet<string>;
}

interface Look {
  /** The newest seq given out, as this look read it. */
  seq: number;
  /** The settled point after it. */
  settled: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One process's settled point, from `reads`. A look reads the newest seq given out, and then who
 * is writing. The lock comes before the seq, so any write with a seq up to that one is among those
 * writers, or has already ended; once each of them has ended, that seq is settled. A write that
 * began after the look took only higher seqs, so it never holds it back.
 */
export function createSettledCursor(
  reads: SettledReads,
  options: SettledCursorOptions = {},
): SettledCursor {
  const freshWaitMs = options.freshWaitMs ?? 250;
  const freshPollMs = options.freshPollMs ?? 25;
  let settled = 0;
  const waiting: Waiting[] = []; // oldest first
  let looking: Promise<Look> | null = null;

  async function look(): Promise<Look> {
    const seq = await reads.handedOut();
    const writing = new Set(await reads.writers());
    if (seq > (waiting.at(-1)?.seq ?? settled)) {
      const next = { seq, writers: writing };
      if (waiting.length < WAITING_KEPT) waiting.push(next);
      else waiting[waiting.length - 1] = next;
    }
    // In order: a later seq's writers take in every earlier seq's that are still writing, so a
    // later one is never settled first.
    while (waiting[0] && ![...waiting[0].writers].some((w) => writing.has(w))) {
      settled = Math.max(settled, waiting.shift()!.seq);
    }
    return { seq, settled };
  }

  /**
   * Asks made while a look is on its way share it: what it settles was settled before any of them
   * reads on.
   */
  function once(): Promise<Look> {
    looking ??= look().finally(() => {
      looking = null;
    });
    return looking;
  }

  async function now(): Promise<number> {
    return (await once()).settled;
  }

  async function fresh(): Promise<number> {
    const deadline = Date.now() + freshWaitMs;
    const first = await once();
    let at = first.settled;
    while (at < first.seq && Date.now() < deadline) {
      await sleep(freshPollMs);
      at = (await once()).settled;
    }
    return at;
  }

  return { now, fresh };
}

/** The settled point of `db`'s events, read from Postgres. */
export function settledCursorFor(db: Database, options?: SettledCursorOptions): SettledCursor {
  return createSettledCursor(
    { handedOut: () => eventSeqHandedOut(db), writers: () => eventWriters(db) },
    options,
  );
}
