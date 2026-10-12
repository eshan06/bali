import type { CompleteDeckInput, DeckRow } from '@bali/db';
import { DECK_MAX_BYTES, DECK_MAX_PAGES, type DeckRejection } from '@bali/shared';
import { subtle } from 'node:crypto';
import { Worker } from 'node:worker_threads';

import type { DeckStorage } from './deck-storage.js';

/*
 * A deck's upload checked before any student can see it (Phase 7, M2b; ARCHITECTURE, "Live lesson",
 * decision 6 and Settled): the bytes read no further than 25 MB, then PDF.js's parse in a thread
 * of its own under a hard time limit, so a hostile file stalls only that thread and the API keeps
 * answering.
 */

export type Verdict = CompleteDeckInput['verdict'];

/** What a parse found: the PDF's pages, or why it can be no deck. */
export type Parsed = { pages: number } | { rejection: 'not_pdf' | 'encrypted' | 'too_slow' };
export type ParsePdf = (bytes: Uint8Array) => Promise<Parsed>;

/** How long a parse may run, and how large a heap it may grow, before its thread is stopped. */
export const PARSE_TIME_LIMIT_MS = 10_000;
export const PARSE_HEAP_MB = 256;
const PARSER = new URL('./deck-check.worker.mjs', import.meta.url);

/**
 * The PDF's pages, read by PDF.js in a worker thread (`deck-check.worker.mjs`), stopped at the
 * time limit or once it outgrows its heap: either is `too_slow`. The answer comes once the thread
 * has stopped, so none outlives its check. A parser that fails to start, or stops with no answer,
 * is the server's failure, thrown.
 */
export function parsePdf(
  bytes: Uint8Array,
  parser = PARSER,
  limitMs = PARSE_TIME_LIMIT_MS,
): Promise<Parsed> {
  return new Promise((resolve, reject) => {
    // No `--import tsx` from the API's own process: the worker is plain JavaScript.
    const worker = new Worker(parser, {
      workerData: bytes,
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: PARSE_HEAP_MB },
    });
    let settled = false;
    const settle = (answer: Parsed | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker
        .terminate()
        .then(() => (answer instanceof Error ? reject(answer) : resolve(answer)), reject);
    };
    const timer = setTimeout(() => settle({ rejection: 'too_slow' }), limitMs);
    worker.once('message', (answer: Parsed) => settle(answer));
    worker.once('error', (err: NodeJS.ErrnoException) =>
      settle(err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? { rejection: 'too_slow' } : err),
    );
    worker.once('exit', (code) => settle(new Error(`the PDF parser stopped (${code}), no answer`)));
  });
}

const MAGIC = Buffer.from('%PDF-');

/**
 * Checks this process runs at once, each its 25 MB read and its parse's worker; the rest wait their
 * turn, in order, so many hostile files at once cost the check's speed, never the API's memory.
 */
export const CHECKS_AT_ONCE = 2;
let checking = 0;
const waiting: (() => void)[] = [];

/**
 * A pending deck's upload checked (decision 6), in order: the bucket's read, capped at 25 MB, so
 * nothing larger is ever read; the `%PDF-` magic; the length and SHA-256 its teacher declared; then
 * the parse, at most 200 pages and not encrypted. The first that fails is the verdict. A failure of
 * the bucket's, or of the parser's own, is thrown: the deck stays pending for the next complete.
 */
export async function checkDeck(
  storage: DeckStorage,
  deck: DeckRow,
  parse: ParsePdf,
): Promise<Verdict> {
  if (checking < CHECKS_AT_ONCE) checking += 1;
  else await new Promise<void>((turn) => waiting.push(turn));
  try {
    return await check(storage, deck, parse);
  } finally {
    // The slot passes to the next in line, or is freed.
    const next = waiting.shift();
    if (next) next();
    else checking -= 1;
  }
}

async function check(storage: DeckStorage, deck: DeckRow, parse: ParsePdf): Promise<Verdict> {
  const rejected = (rejection: DeckRejection): Verdict => ({ status: 'rejected', rejection });
  const bytes = await storage.read(deck.storageKey, DECK_MAX_BYTES);
  if (bytes === 'missing') return rejected('unfinished');
  if (bytes === 'too_large') return rejected('too_large');
  if (!MAGIC.equals(bytes.subarray(0, MAGIC.length))) return rejected('not_pdf');
  if (bytes.byteLength !== deck.bytes) return rejected('mismatch');
  // WebCrypto's digest runs on libuv's pool, off the event loop: 25 MB is tens of milliseconds.
  const sha256 = Buffer.from(await subtle.digest('SHA-256', bytes)).toString('hex');
  if (sha256 !== deck.sha256) return rejected('mismatch');
  const parsed = await parse(bytes);
  if ('rejection' in parsed) return rejected(parsed.rejection);
  if (parsed.pages > DECK_MAX_PAGES) return rejected('too_many_pages');
  return { status: 'ready', pageCount: parsed.pages };
}
