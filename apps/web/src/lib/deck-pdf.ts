import { DECK_MAX_BYTES, type DeckDownload, type Slide } from '@bali/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { type ApiClient, POLL_TIMEOUT_MS } from './api-client';
import { PDFJS_DIR } from './csp';
import { sha256Hex } from './decks';
import { type Failure, failureOf } from './live-question';
import { captureApiFailure } from './monitoring';

/*
 * A deck's PDF for the presenter (Phase 7, M6) and the student web (W5): ARCHITECTURE, "Live
 * lesson", decisions 6 and 8. Its bytes come from the bucket by the download route's presigned GET,
 * are checked against the slide's SHA-256 before PDF.js ever reads them, and are opened by PDF.js in
 * a worker the portal serves from its own origin. Tested and holding no words: the screens say each
 * answer as the approved canvas does.
 *
 * PDF.js is its legacy build: the modern one runs only in the newest browsers (it calls, unguarded,
 * methods older ones lack, `Map.prototype.getOrInsertComputed` among them), and the legacy one in
 * Chrome 125+, Safari 18+ and Firefox ESR, by PDF.js's own list. Imported on first use, so it is its
 * own chunk, loaded only by a page that shows a deck.
 */

/** PDF.js's worker, from the portal's own origin (`PDFJS_DIR`, the CSP's `worker-src 'self'`). */
export const PDFJS_WORKER = `${PDFJS_DIR}pdf.worker.min.mjs`;

/**
 * How PDF.js opens a deck.
 * - `isEvalSupported: false` (decision 8, after CVE-2024-4367). PDF.js 5.7 removed the option with
 *   the last `eval` it guarded, so the version installed has none to turn off (its test reads the
 *   files for one); kept so the rule holds for any version that still reads it.
 * - `useWasm: false`. Since 5.7 PDF.js compiles a PDF's PostScript functions to WebAssembly, and
 *   decodes JBIG2, CCITT and JPEG 2000 images with it, which the CSP would have to allow
 *   (`'wasm-unsafe-eval'`). Off, it interprets those functions and decodes those images with the
 *   JavaScript builds of the same decoders, from `wasmUrl`.
 */
export const PDF_OPTIONS = { isEvalSupported: false, useWasm: false, wasmUrl: PDFJS_DIR } as const;

/** What a deck's bytes are checked against: the SHA-256 the server checked, lowercase hex. */
const SHA256 = /^[0-9a-f]{64}$/;

/** Why a deck isn't open; never thrown. */
export type DeckFailure =
  /** The slide names no SHA-256 to check the bytes against (none, or not 64 lowercase hex): nothing is fetched. */
  | { kind: 'unverifiable' }
  /** The download route gave no URL: refused (`deck_not_found` once it is removed), or failed. */
  | Failure
  /** The bucket gave no bytes: no answer (`status` undefined), or not a 2xx. */
  | { kind: 'unfetched'; status: number | undefined }
  /**
   * Not the bytes the server checked: another SHA-256, or more than a deck can hold. Refused unread:
   * PDF.js never sees them.
   */
  | { kind: 'mismatch' }
  /** PDF.js didn't open them: its code didn't load, its worker didn't start, or it can't read them. */
  | { kind: 'unopened' }
  /** `signal` stopped it. */
  | { kind: 'cancelled' };

/** A deck open in PDF.js, and its own worker. */
export interface OpenDeck {
  pdf: PDFDocumentProxy;
  /** Ends it: the document, then its worker. Not `pdf.destroy()`, which leaves the worker running. */
  close: () => Promise<void>;
}

/** The parts of PDF.js the loader uses. */
export type Pdfjs = Pick<
  typeof import('pdfjs-dist/legacy/build/pdf.mjs'),
  'getDocument' | 'PDFWorker'
>;

export interface LoadOptions {
  /**
   * Stops it before it is open (the page moved on to another deck, or closed), a deck PDF.js was
   * opening closed with it; one already open is its caller's to `close`. A download that stalls is
   * its caller's to stop: no limit fits both 25 MB on a slow link and a stalled one.
   */
  signal?: AbortSignal;
  /** The bucket's fetch; a test's stand-in. */
  fetchImpl?: typeof fetch;
  /** PDF.js, imported on first use; a test's stand-in. */
  pdfjs?: () => Promise<Pdfjs>;
  /** The browser's Worker; a test's stand-in. */
  Worker?: new (url: string, options: WorkerOptions) => Worker;
}

/**
 * A slide's deck, open: its URL from `GET /v1/decks/{id}/download` (its own teacher, or a student
 * while a running session of their class shows it), its bytes from the bucket, checked against the
 * slide's SHA-256, then opened by PDF.js. A `Deck` the presenter picks loads as
 * `{ deckId: deck.id, sha256: deck.sha256 }`. Try again loads it again from the start: the URL lives
 * five minutes, and nothing is kept between tries.
 */
export async function loadDeck(
  api: Pick<ApiClient, 'get'>,
  slide: Pick<Slide, 'deckId' | 'sha256'>,
  opts: LoadOptions = {},
): Promise<{ kind: 'loaded'; deck: OpenDeck } | DeckFailure> {
  const fetched = await fetchChecked(api, slide, opts);
  return fetched instanceof Uint8Array ? open(fetched, opts) : fetched;
}

/** The deck's bytes, checked; or why not. */
async function fetchChecked(
  api: Pick<ApiClient, 'get'>,
  { deckId, sha256 }: Pick<Slide, 'deckId' | 'sha256'>,
  { signal, fetchImpl = fetch }: LoadOptions,
): Promise<Uint8Array<ArrayBuffer> | DeckFailure> {
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return { kind: 'unverifiable' };
  let url: unknown;
  try {
    // Within a poll's limit (#334): an answer the network swallows fails, for Try again.
    const path = `/v1/decks/${encodeURIComponent(deckId)}/download`;
    ({ url } = await api.get<DeckDownload>(path, POLL_TIMEOUT_MS));
  } catch (e) {
    return signal?.aborted ? { kind: 'cancelled' } : failureOf(e);
  }
  if (signal?.aborted) return { kind: 'cancelled' };
  if (typeof url !== 'string') return { kind: 'unfetched', status: undefined };
  const href = url;
  // A failure the bucket answered with a 5xx, or none at all, is reported as the PUT's is (decks.ts),
  // by the object's template: the URL carries its signature, so it never leaves.
  const unfetched = (status: number | undefined): DeckFailure => {
    if (status === undefined || status >= 500) {
      captureApiFailure('GET', `/bucket${pathOf(href)}`, status ?? 'network');
    }
    return { kind: 'unfetched', status };
  };
  let bytes: Uint8Array<ArrayBuffer> | 'too_large';
  try {
    // `no-store`: the browser keeps no copy past the page (decision 13), whatever the bucket says.
    const res = await fetchImpl(href, { signal, cache: 'no-store', credentials: 'omit' });
    if (!res.ok) return unfetched(res.status);
    bytes = await readUpTo(res, DECK_MAX_BYTES);
  } catch {
    return signal?.aborted ? { kind: 'cancelled' } : unfetched(undefined);
  }
  if (bytes === 'too_large') return { kind: 'mismatch' };
  try {
    return (await sha256Hex(bytes)) === sha256 ? bytes : { kind: 'mismatch' };
  } catch {
    // No Web Crypto here (a page served without https): nothing can check the bytes.
    return { kind: 'unverifiable' };
  }
}

/** A URL's path, or none for one that doesn't parse. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/**
 * A body, read whole, unless it holds more than `max` bytes: no deck does (the check refuses one
 * past `DECK_MAX_BYTES`), so the read stops there whatever the answer claims, and the browser never
 * holds more.
 */
async function readUpTo(
  res: Response,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | 'too_large'> {
  if (Number(res.headers.get('content-length')) > max) return 'too_large';
  if (!res.body) {
    const whole = new Uint8Array(await res.arrayBuffer());
    return whole.byteLength > max ? 'too_large' : whole;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return 'too_large';
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * How long a close waits for PDF.js's own destroy, which clears the fonts a deck put on the page
 * once its worker answers: a worker gone meanwhile never answers, and is ended anyway.
 */
export const CLOSE_WAIT_MS = 2_000;

/**
 * Checked bytes, opened by PDF.js in a worker of their own, from the portal's origin (`PDFJS_WORKER`).
 * Handed to PDF.js as that worker's port, so PDF.js never falls back to parsing on the page's own
 * thread, where the access token lives: a worker that doesn't start is `unopened`. The bytes go to
 * the worker, so this side's copy is emptied.
 */
async function open(
  bytes: Uint8Array<ArrayBuffer>,
  {
    signal,
    pdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs'),
    Worker: WorkerOf = globalThis.Worker,
  }: LoadOptions,
): Promise<{ kind: 'loaded'; deck: OpenDeck } | DeckFailure> {
  const stoppedAs = (): DeckFailure =>
    signal?.aborted ? { kind: 'cancelled' } : { kind: 'unopened' };
  let lib: Pdfjs;
  try {
    lib = await pdfjs();
  } catch {
    return stoppedAs();
  }
  if (signal?.aborted) return { kind: 'cancelled' };
  let worker: Worker;
  try {
    // A worker the CSP refuses throws here in some browsers, and fails by its `error` in others.
    worker = new WorkerOf(PDFJS_WORKER, { type: 'module' });
  } catch {
    return { kind: 'unopened' };
  }
  let pdfWorker: InstanceType<Pdfjs['PDFWorker']> | null = null;
  // Not PDF.js's destroy, which waits on the worker's answer (to the open, then to its end), so it
  // would never return for a worker that never started: nothing is on the page yet to clear.
  const end = () => {
    pdfWorker?.destroy();
    worker.terminate();
  };
  let task: ReturnType<Pdfjs['getDocument']>;
  try {
    pdfWorker = lib.PDFWorker.create({ port: worker });
    task = lib.getDocument({ ...PDF_OPTIONS, data: bytes, worker: pdfWorker });
  } catch {
    end();
    return { kind: 'unopened' };
  }
  // A worker that never starts never answers either: its `error` ends the wait, as `signal` does.
  const listening = new AbortController();
  const stopped = new Promise<'stopped'>((resolve) => {
    worker.addEventListener('error', () => resolve('stopped'), { signal: listening.signal });
    signal?.addEventListener('abort', () => resolve('stopped'), { signal: listening.signal });
  });
  let pdf: PDFDocumentProxy | 'stopped';
  try {
    pdf = await Promise.race([task.promise, stopped]);
  } catch {
    pdf = 'stopped';
  } finally {
    listening.abort();
  }
  if (pdf === 'stopped' || signal?.aborted) {
    end();
    return stoppedAs();
  }
  const close = async () => {
    let waited: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      task.destroy().catch(() => undefined),
      new Promise((resolve) => (waited = setTimeout(resolve, CLOSE_WAIT_MS))),
    ]);
    clearTimeout(waited);
    end();
  };
  return { kind: 'loaded', deck: { pdf, close } };
}
