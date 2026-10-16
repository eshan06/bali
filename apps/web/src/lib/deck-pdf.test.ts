import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DECK_MAX_BYTES } from '@bali/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyPdfjsAssets, PDFJS_ASSETS, pdfjsDist } from '../../scripts/pdfjs-assets.mjs';
import { type ApiClient, ApiError, NetworkError, POLL_TIMEOUT_MS } from './api-client';
import { PDFJS_DIR, PDFJS_SCRIPTS } from './csp';
import {
  CLOSE_WAIT_MS,
  loadDeck,
  type LoadOptions,
  PDF_OPTIONS,
  PDFJS_WORKER,
  type Pdfjs,
} from './deck-pdf';
import { captureApiFailure } from './monitoring';

vi.mock('./monitoring', () => ({ captureApiFailure: vi.fn() }));

/*
 * A deck's PDF for the presenter and the student web (M6): its URL from the download route, its
 * bytes from the bucket, checked against the slide's SHA-256 before PDF.js ever sees them, and PDF.js
 * opened in a worker from the portal's own origin, with eval and WebAssembly off. Against a fake API,
 * a fake bucket, and stand-ins for PDF.js and its Worker; the PDF.js the portal ships, read from disk.
 */

const DECK_ID = '0199b000-0000-7000-8000-0000000000d2';
const URL_GET = `https://bali-decks-dev.s3.us-east-1.amazonaws.com/decks/${DECK_ID}.pdf?X-Amz-Signature=abc`;
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const SHA = createHash('sha256').update(PDF).digest('hex');
const SLIDE = { deckId: DECK_ID, sha256: SHA };
/** The portal's package.json: its dependencies and its scripts. */
const WEB_PACKAGE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { dependencies: Record<string, string>; scripts: Record<string, string> };

afterEach(() => {
  vi.mocked(captureApiFailure).mockClear();
  vi.useRealTimers();
});

/**
 * The download route: each path asked, with its time limit, each answered by `answer` (a value, or an
 * error thrown).
 */
function fakeApi(answer: () => unknown = () => ({ url: URL_GET })) {
  const asked: string[] = [];
  const limits: (number | undefined)[] = [];
  const api: Pick<ApiClient, 'get'> = {
    // Async, so an answer thrown is the call's rejection.
    // eslint-disable-next-line @typescript-eslint/require-await
    get: async <T>(path: string, limitMs?: number): Promise<T> => {
      asked.push(path);
      limits.push(limitMs);
      return answer() as T;
    },
  };
  return { api, asked, limits };
}

/** The bucket: each GET recorded with its options, each answered by `answer`. */
function fakeBucket(answer: () => Response | Promise<Response> = () => new Response(PDF)) {
  const asked: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    asked.push({ url, init });
    return Promise.resolve().then(answer);
  }) as typeof fetch;
  return { fetchImpl, asked };
}

/** A stand-in Worker: how it was made, whether it was ended; `fail()` is a worker that never started. */
class FakeWorker extends EventTarget {
  static made: FakeWorker[] = [];
  terminated = false;
  constructor(
    readonly url: string,
    readonly options: WorkerOptions,
  ) {
    super();
    FakeWorker.made.push(this);
  }
  terminate() {
    this.terminated = true;
  }
  fail() {
    this.dispatchEvent(new Event('error'));
  }
}

/**
 * A stand-in PDF.js: whether it was imported, the worker it wrapped, what `getDocument` was given,
 * and its task, whose open resolves with a document, rejects (`unreadable`) or never answers.
 */
function fakePdfjs(
  open: 'opens' | 'unreadable' | 'silent' = 'opens',
  destroy: 'answers' | 'silent' = 'answers',
) {
  const pdf = { numPages: 3 } as unknown as PDFDocumentProxy;
  const state = {
    imported: 0,
    ports: [] as unknown[],
    workerDestroyed: 0,
    params: [] as Record<string, unknown>[],
    taskDestroyed: 0,
    pdfWorker: null as unknown,
  };
  const pdfWorker = {
    destroy: () => {
      state.workerDestroyed += 1;
    },
  };
  Object.assign(state, { pdfWorker });
  const lib = {
    PDFWorker: {
      create: ({ port }: { port: unknown }) => {
        state.ports.push(port);
        return pdfWorker;
      },
    },
    getDocument: (params: Record<string, unknown>) => {
      state.params.push(params);
      return {
        promise:
          open === 'opens'
            ? Promise.resolve(pdf)
            : open === 'unreadable'
              ? Promise.reject(new Error('Invalid PDF structure.'))
              : new Promise<never>(() => {}),
        destroy: () => {
          state.taskDestroyed += 1;
          return destroy === 'answers' ? Promise.resolve() : new Promise<never>(() => {});
        },
      };
    },
  } as unknown as Pdfjs;
  const pdfjs = () => {
    state.imported += 1;
    return Promise.resolve(lib);
  };
  return { pdf, pdfjs, state };
}

const options = (over: Partial<LoadOptions> = {}): LoadOptions => ({
  fetchImpl: fakeBucket().fetchImpl,
  pdfjs: fakePdfjs().pdfjs,
  Worker: FakeWorker as unknown as LoadOptions['Worker'],
  ...over,
});

describe('loadDeck: the bytes checked before PDF.js sees them', () => {
  it('opens a deck whose bytes are the ones the server checked', async () => {
    FakeWorker.made = [];
    const { api, asked, limits } = fakeApi();
    const bucket = fakeBucket();
    const { pdf, pdfjs, state } = fakePdfjs();
    const loaded = await loadDeck(api, SLIDE, options({ fetchImpl: bucket.fetchImpl, pdfjs }));
    expect(loaded.kind).toBe('loaded');
    if (loaded.kind !== 'loaded') return;
    expect(loaded.deck.pdf).toBe(pdf);
    // Within a poll's limit, so an answer the network swallows fails for Try again (#334).
    expect(asked).toEqual([`/v1/decks/${DECK_ID}/download`]);
    expect(limits).toEqual([POLL_TIMEOUT_MS]);
    // Fetched once, never kept by the browser (decision 13), with no cookie.
    expect(bucket.asked.map((a) => a.url)).toEqual([URL_GET]);
    expect(bucket.asked[0]?.init).toMatchObject({ cache: 'no-store', credentials: 'omit' });
    // PDF.js got exactly the checked bytes, in its own worker from the portal's origin.
    expect(FakeWorker.made.map((w) => [w.url, w.options])).toEqual([
      ['/pdfjs/pdf.worker.min.mjs', { type: 'module' }],
    ]);
    expect(state.ports).toEqual([FakeWorker.made[0]]);
    expect(state.params).toHaveLength(1);
    const [params] = state.params;
    expect(params).toMatchObject(PDF_OPTIONS);
    expect(params.worker).toBe(state.pdfWorker);
    expect(Array.from(params.data as Uint8Array)).toEqual(Array.from(PDF));
  });

  it('refuses a tampered deck: its SHA-256 differs, so PDF.js is never loaded and no worker starts', async () => {
    FakeWorker.made = [];
    const tampered = PDF.slice();
    tampered[10] ^= 1;
    const { pdfjs, state } = fakePdfjs();
    const loaded = await loadDeck(
      fakeApi().api,
      SLIDE,
      options({ fetchImpl: fakeBucket(() => new Response(tampered)).fetchImpl, pdfjs }),
    );
    expect(loaded).toEqual({ kind: 'mismatch' });
    expect(state.imported).toBe(0);
    expect(FakeWorker.made).toEqual([]);
  });

  it('refuses another deck’s bytes, and an empty answer, the same way', async () => {
    const other = new TextEncoder().encode('%PDF-1.7\n% another deck\n%%EOF\n');
    for (const body of [other, new Uint8Array(0)]) {
      const { pdfjs, state } = fakePdfjs();
      const loaded = await loadDeck(
        fakeApi().api,
        SLIDE,
        options({ fetchImpl: fakeBucket(() => new Response(body)).fetchImpl, pdfjs }),
      );
      expect(loaded).toEqual({ kind: 'mismatch' });
      expect(state.imported).toBe(0);
    }
  });

  it('refuses a missing or odd SHA-256 before anything is fetched', async () => {
    for (const sha256 of [
      undefined,
      null,
      '',
      SHA.slice(1),
      `${SHA}0`,
      SHA.toUpperCase(),
      ` ${SHA}`,
      `${SHA.slice(0, 63)}g`,
      42,
    ]) {
      const { api, asked } = fakeApi();
      const bucket = fakeBucket();
      const { pdfjs, state } = fakePdfjs();
      const loaded = await loadDeck(
        api,
        { deckId: DECK_ID, sha256: sha256 as unknown as string },
        options({ fetchImpl: bucket.fetchImpl, pdfjs }),
      );
      expect(loaded, String(sha256)).toEqual({ kind: 'unverifiable' });
      expect(asked).toEqual([]);
      expect(bucket.asked).toEqual([]);
      expect(state.imported).toBe(0);
    }
  });

  it('stops at a deck’s limit: an answer that says it is larger is never read', async () => {
    let pulled = false;
    // No queue to fill ahead: the body is pulled only when something reads it.
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const { pdfjs, state } = fakePdfjs();
    const loaded = await loadDeck(
      fakeApi().api,
      SLIDE,
      options({
        fetchImpl: fakeBucket(
          () => new Response(body, { headers: { 'content-length': String(DECK_MAX_BYTES + 1) } }),
        ).fetchImpl,
        pdfjs,
      }),
    );
    expect(loaded).toEqual({ kind: 'mismatch' });
    expect(pulled).toBe(false);
    expect(state.imported).toBe(0);
  });

  it('stops reading one that runs past the limit without saying its length', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const loaded = await loadDeck(
      fakeApi().api,
      SLIDE,
      options({ fetchImpl: fakeBucket(() => new Response(body)).fetchImpl }),
    );
    expect(loaded).toEqual({ kind: 'mismatch' });
    expect(cancelled).toBe(true);
    // Never much past the limit: the read stops at the first chunk over it.
    expect(sent).toBeLessThanOrEqual(DECK_MAX_BYTES + 3 * chunk.byteLength);
  });

  it('reads a deck at the limit exactly', async () => {
    const big = new Uint8Array(DECK_MAX_BYTES);
    big.set(PDF);
    const sha256 = createHash('sha256').update(big).digest('hex');
    const loaded = await loadDeck(
      fakeApi().api,
      { deckId: DECK_ID, sha256 },
      options({ fetchImpl: fakeBucket(() => new Response(big)).fetchImpl }),
    );
    expect(loaded.kind).toBe('loaded');
  });

  it('refuses bytes it has no way to check (no Web Crypto): PDF.js never sees them', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('no crypto'));
    try {
      const { pdfjs, state } = fakePdfjs();
      expect(await loadDeck(fakeApi().api, SLIDE, options({ pdfjs }))).toEqual({
        kind: 'unverifiable',
      });
      expect(state.imported).toBe(0);
    } finally {
      digest.mockRestore();
    }
  });
});

describe('loadDeck: why a deck isn’t open, typed for the screen', () => {
  it('says the download route’s refusal or failure, and asks the bucket nothing', async () => {
    const cases: [unknown, unknown][] = [
      [
        new ApiError(404, 'not_found', 'deck not found', 'deck_not_found'),
        { kind: 'refused', status: 404, reason: 'deck_not_found' },
      ],
      [new ApiError(403, 'forbidden', 'no'), { kind: 'refused', status: 403, reason: undefined }],
      [
        new ApiError(409, 'conflict', 'not checked', 'deck_not_ready'),
        { kind: 'refused', status: 409, reason: 'deck_not_ready' },
      ],
      [
        new ApiError(503, 'unavailable', 'off', 'deck_storage_off'),
        { kind: 'failed', status: 503, retryAfter: undefined },
      ],
      [
        new ApiError(429, 'busy', 'slow down', undefined, 30),
        { kind: 'failed', status: 429, retryAfter: 30 },
      ],
      [new NetworkError(), { kind: 'failed', status: undefined, retryAfter: undefined }],
    ];
    for (const [thrown, said] of cases) {
      const bucket = fakeBucket();
      const loaded = await loadDeck(
        fakeApi(() => {
          throw thrown;
        }).api,
        SLIDE,
        options({ fetchImpl: bucket.fetchImpl }),
      );
      expect(loaded).toEqual(said);
      expect(bucket.asked).toEqual([]);
    }
  });

  it('says the bucket’s refusal, reporting only its 5xx and no answer, by the object’s path alone', async () => {
    const statuses: [() => Promise<Response>, number | undefined][] = [
      [() => Promise.resolve(new Response('<Error/>', { status: 403 })), 403],
      [() => Promise.resolve(new Response('<Error/>', { status: 404 })), 404],
      [() => Promise.resolve(new Response('<Error/>', { status: 503 })), 503],
      [() => Promise.reject(new TypeError('Failed to fetch')), undefined],
    ];
    for (const [answer, status] of statuses) {
      const { pdfjs, state } = fakePdfjs();
      const loaded = await loadDeck(
        fakeApi().api,
        SLIDE,
        options({ fetchImpl: fakeBucket(answer).fetchImpl, pdfjs }),
      );
      expect(loaded).toEqual({ kind: 'unfetched', status });
      expect(state.imported).toBe(0);
    }
    // Never its query: that is its signature.
    expect(vi.mocked(captureApiFailure).mock.calls).toEqual([
      ['GET', `/bucket/decks/${DECK_ID}.pdf`, 503],
      ['GET', `/bucket/decks/${DECK_ID}.pdf`, 'network'],
    ]);
  });

  it('says an answer with no URL as one with no bytes', async () => {
    for (const answer of [{}, { url: 42 }, null]) {
      const bucket = fakeBucket();
      const loaded = await loadDeck(
        fakeApi(() => answer ?? {}).api,
        SLIDE,
        options({ fetchImpl: bucket.fetchImpl }),
      );
      expect(loaded).toEqual({ kind: 'unfetched', status: undefined });
      expect(bucket.asked).toEqual([]);
    }
  });

  it('names the deck in the route by its id, encoded', async () => {
    const { api, asked } = fakeApi();
    await loadDeck(api, { deckId: 'a/b?c', sha256: SHA }, options());
    expect(asked).toEqual(['/v1/decks/a%2Fb%3Fc/download']);
  });

  it('says a deck PDF.js can’t read, and ends its worker', async () => {
    FakeWorker.made = [];
    const { pdfjs, state } = fakePdfjs('unreadable');
    const loaded = await loadDeck(fakeApi().api, SLIDE, options({ pdfjs }));
    expect(loaded).toEqual({ kind: 'unopened' });
    expect(FakeWorker.made[0]?.terminated).toBe(true);
    expect(state.workerDestroyed).toBe(1);
  });

  it('says one whose worker never starts, rather than wait forever, and never parses on the page', async () => {
    FakeWorker.made = [];
    const { pdfjs, state } = fakePdfjs('silent');
    const loading = loadDeck(fakeApi().api, SLIDE, options({ pdfjs }));
    await vi.waitFor(() => expect(FakeWorker.made).toHaveLength(1));
    FakeWorker.made[0]?.fail();
    expect(await loading).toEqual({ kind: 'unopened' });
    expect(FakeWorker.made[0]?.terminated).toBe(true);
    // PDF.js's destroy waits on that worker's answer: it is never asked, so nothing hangs.
    expect(state.taskDestroyed).toBe(0);
    // Handed to PDF.js as its port: PDF.js has no worker of its own to fall back from.
    expect(state.ports).toEqual([FakeWorker.made[0]]);
  });

  it('says one whose worker the browser refuses at once, or whose code doesn’t load', async () => {
    const refused = function () {
      throw new DOMException('denied by the Content Security Policy', 'SecurityError');
    } as unknown as LoadOptions['Worker'];
    expect(await loadDeck(fakeApi().api, SLIDE, options({ Worker: refused }))).toEqual({
      kind: 'unopened',
    });
    const unloaded = () => Promise.reject(new Error('ChunkLoadError'));
    expect(await loadDeck(fakeApi().api, SLIDE, options({ pdfjs: unloaded }))).toEqual({
      kind: 'unopened',
    });
  });
});

describe('loadDeck: stopped, and closed', () => {
  it('stops while the URL is asked for: the bucket is never asked', async () => {
    const stop = new AbortController();
    const bucket = fakeBucket();
    const loading = loadDeck(
      fakeApi(() => {
        stop.abort();
        return { url: URL_GET };
      }).api,
      SLIDE,
      options({ fetchImpl: bucket.fetchImpl, signal: stop.signal }),
    );
    expect(await loading).toEqual({ kind: 'cancelled' });
    expect(bucket.asked).toEqual([]);
  });

  it('stops while the URL is asked for, though the ask then fails', async () => {
    const stop = new AbortController();
    const loaded = await loadDeck(
      fakeApi(() => {
        stop.abort();
        throw new NetworkError();
      }).api,
      SLIDE,
      options({ signal: stop.signal }),
    );
    expect(loaded).toEqual({ kind: 'cancelled' });
  });

  it('stops while the bytes come: no failure said or reported', async () => {
    const stop = new AbortController();
    const loaded = await loadDeck(
      fakeApi().api,
      SLIDE,
      options({
        signal: stop.signal,
        fetchImpl: fakeBucket(() => {
          stop.abort();
          return Promise.reject(new DOMException('aborted', 'AbortError'));
        }).fetchImpl,
      }),
    );
    expect(loaded).toEqual({ kind: 'cancelled' });
    expect(captureApiFailure).not.toHaveBeenCalled();
  });

  it('stops while PDF.js opens it: its worker is ended', async () => {
    FakeWorker.made = [];
    const stop = new AbortController();
    const { pdfjs } = fakePdfjs('silent');
    const loading = loadDeck(fakeApi().api, SLIDE, options({ pdfjs, signal: stop.signal }));
    await vi.waitFor(() => expect(FakeWorker.made).toHaveLength(1));
    stop.abort();
    expect(await loading).toEqual({ kind: 'cancelled' });
    expect(FakeWorker.made[0]?.terminated).toBe(true);
  });

  it('closes a deck: PDF.js’s own destroy first, which clears its fonts, then its worker', async () => {
    FakeWorker.made = [];
    const { pdfjs, state } = fakePdfjs();
    const loaded = await loadDeck(fakeApi().api, SLIDE, options({ pdfjs }));
    if (loaded.kind !== 'loaded') throw new Error(loaded.kind);
    expect(FakeWorker.made[0]?.terminated).toBe(false);
    await loaded.deck.close();
    expect(state.taskDestroyed).toBe(1);
    expect(state.workerDestroyed).toBe(1);
    expect(FakeWorker.made[0]?.terminated).toBe(true);
  });

  it('ends the worker of a deck whose destroy never answers, after a moment', async () => {
    FakeWorker.made = [];
    const { pdfjs } = fakePdfjs('opens', 'silent');
    const loaded = await loadDeck(fakeApi().api, SLIDE, options({ pdfjs }));
    if (loaded.kind !== 'loaded') throw new Error(loaded.kind);
    vi.useFakeTimers();
    const closing = loaded.deck.close();
    await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS - 1);
    expect(FakeWorker.made[0]?.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(FakeWorker.made[0]?.terminated).toBe(true);
  });
});

describe('PDF.js as the portal runs it', () => {
  const dist = pdfjsDist();
  const read = (path: string) => readFileSync(join(dist, path), 'utf8');

  it('opens a deck with eval off, WebAssembly off, and its decoders from the portal’s origin', () => {
    expect(PDF_OPTIONS).toEqual({ isEvalSupported: false, useWasm: false, wasmUrl: '/pdfjs/' });
    expect(PDFJS_WORKER).toBe(`${PDFJS_DIR}pdf.worker.min.mjs`);
  });

  it('is pinned to one version, at or past the CVE-2024-4367 fix (4.2.67)', () => {
    const pinned = WEB_PACKAGE.dependencies['pdfjs-dist'];
    const installed = (JSON.parse(read('package.json')) as { version: string }).version;
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed).toBe(pinned);
    const [major = 0, minor = 0, patch = 0] = installed.split('.').map(Number);
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(4_002_067);
  });

  it('has no eval to turn on in what the page and the worker run', () => {
    for (const path of [
      'legacy/build/pdf.mjs',
      PDFJS_ASSETS['pdf.worker.min.mjs'],
      PDFJS_ASSETS['jbig2_nowasm_fallback.js'],
      PDFJS_ASSETS['openjpeg_nowasm_fallback.js'],
    ]) {
      const code = read(path);
      expect(code, path).not.toMatch(/(^|[^\w$.])eval\s*\(/);
      expect(code, path).not.toMatch(/new\s+Function\s*\(/);
      // The one `Function(` is core-js's last way to find the global object, after `globalThis`,
      // `window`, `self` and `this`: never reached in a browser, and refused by the CSP if it were.
      const calls = code.match(/(^|[^\w$.])Function\s*\(/g) ?? [];
      const fallback = code.match(/\|\|\s*Function\(["']return this["']\)\(\)/g) ?? [];
      expect(calls.length, path).toBe(fallback.length);
      expect(fallback.length, path).toBeLessThanOrEqual(1);
    }
  });

  it('serves the worker and every decoder file the worker imports with WebAssembly off', () => {
    const worker = read(PDFJS_ASSETS['pdf.worker.min.mjs']);
    expect(worker).toMatch(/pdfjsVersion = \d+\.\d+\.\d+/);
    const decoders = [...worker.matchAll(/_noWasmFilename\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(decoders.sort()).toEqual(['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']);
    for (const name of decoders) expect(Object.keys(PDFJS_ASSETS)).toContain(name);
    expect(Object.keys(PDFJS_ASSETS)).toContain(PDFJS_WORKER.slice(PDFJS_DIR.length));
    // The scripts the middleware gives the worker's CSP are exactly the ones served.
    expect([...PDFJS_SCRIPTS].sort()).toEqual(
      Object.keys(PDFJS_ASSETS)
        .filter((name) => /\.m?js$/.test(name))
        .sort(),
    );
  });

  it('copies them from pdfjs-dist as they are, and leaves nothing an older version served', () => {
    const to = mkdtempSync(join(tmpdir(), 'pdfjs-assets-'));
    try {
      writeFileSync(join(to, 'pdf.worker.old.mjs'), 'stale');
      copyPdfjsAssets(to);
      expect(readdirSync(to).sort()).toEqual(Object.keys(PDFJS_ASSETS).sort());
      for (const [name, path] of Object.entries(PDFJS_ASSETS)) {
        expect(readFileSync(join(to, name)).equals(readFileSync(join(dist, path))), name).toBe(
          true,
        );
      }
      expect(existsSync(join(to, 'pdf.worker.old.mjs'))).toBe(false);
    } finally {
      rmSync(to, { recursive: true, force: true });
    }
  });

  it('copies them before every dev server and every build', () => {
    const { scripts } = WEB_PACKAGE;
    expect(scripts.predev).toBe('node scripts/pdfjs-assets.mjs');
    expect(scripts.prebuild).toBe('node scripts/pdfjs-assets.mjs');
  });
});
