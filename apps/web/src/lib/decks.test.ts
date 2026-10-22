import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Deck, DECK_MAX_BYTES, DECK_TITLE_MAX_LENGTH } from '@bali/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ApiClient,
  ApiError,
  createApiClient,
  NetworkError,
  SAVE_TIMEOUT_MS,
} from './api-client';
import {
  inUseClasses,
  judgePick,
  newUpload,
  type PutEnd,
  putPdf,
  type PutOptions,
  readDecks,
  removeAttemptFor,
  removeDeck,
  REMOVE_TIMEOUT_MS,
  runUpload,
  titleOf,
  type Upload,
  uploadAgain,
  UPLOAD_ANSWER_MS,
  type UploadEnd,
  UPLOAD_LIMIT_MS,
  UPLOAD_STALL_MS,
  type UploadStep,
  type XhrClass,
} from './decks';
import { captureApiFailure } from './monitoring';

vi.mock('./monitoring', () => ({ captureApiFailure: vi.fn() }));

/*
 * Your slides' logic (M5): the decks read, a picked file judged before anything is sent, the
 * upload (its SHA-256, the create, the PUT with its progress, Cancel, its stop once nothing is sent
 * for 30 s and the 25-minute limit of #326, then the check), Try again going on from where it
 * stopped, and a removal, the in-use refusal naming its classes (M5a), each against a fake API and a
 * fake XMLHttpRequest.
 */

const ID = '0199b000-0000-7000-8000-0000000000d1';
const URL_PUT =
  'https://bali-decks-dev.s3.us-east-1.amazonaws.com/decks/0199b000-0000-7000-8000-0000000000d1.pdf?X-Amz-Signature=abc';
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const SHA = createHash('sha256').update(PDF).digest('hex');

const deck = (over: Partial<Deck> = {}): Deck => ({
  id: ID,
  title: 'Unit 3 review',
  status: 'pending',
  bytes: PDF.byteLength,
  sha256: SHA,
  pageCount: null,
  rejection: null,
  createdAt: '2026-10-15T14:00:00.000Z',
  ...over,
});

/** A fake API: each call recorded, each answered by `answer` (a value, or an error to throw). */
function fakeApi(answer: (method: string, path: string, body: unknown) => unknown) {
  const calls: [string, string, unknown][] = [];
  const call =
    (method: string) =>
    // Async, so an answer thrown is the call's rejection.
    // eslint-disable-next-line @typescript-eslint/require-await
    async (path: string, body?: unknown): Promise<never> => {
      calls.push([method, path, body]);
      return answer(method, path, body) as never;
    };
  const api: Pick<ApiClient, 'get' | 'post' | 'del'> = {
    get: call('GET'),
    post: call('POST'),
    del: call('DELETE'),
  };
  return { api, calls };
}
const refusal = (status: number, reason?: string, details?: unknown) =>
  new ApiError(status, 'conflict', 'refused', reason, undefined, details);

/** A stand-in XMLHttpRequest: what was sent, and the browser's events, raised by the test. */
class FakeXhr {
  static made: FakeXhr[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = undefined;
  timeout = 0;
  status = 0;
  aborted = false;
  upload: {
    onprogress: ((e: Partial<ProgressEvent>) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    FakeXhr.made.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  /** As the browser does: the request ends with `timeout` once that much has passed since send. */
  send(body: unknown) {
    this.body = body;
    if (this.timeout > 0) this.timer = setTimeout(() => this.ontimeout?.(), this.timeout);
  }
  abort() {
    this.aborted = true;
    clearTimeout(this.timer);
    this.onabort?.();
  }
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({ loaded, total, lengthComputable });
  }
  /** The whole file sent, as the browser says it: its last progress, then the upload's `load`. */
  sentAll(total: number) {
    this.progress(total, total);
    this.upload.onload?.();
  }
  answer(status: number) {
    clearTimeout(this.timer);
    this.status = status;
    this.onload?.();
  }
  fail() {
    clearTimeout(this.timer);
    this.onerror?.();
  }
}
const Xhr = FakeXhr as unknown as XhrClass;
const lastXhr = () => FakeXhr.made.at(-1);

/**
 * A slow link on the fake clock: a byte more of `total` sent every `every` ms, never 30 s apart,
 * until the clock reads `until`. Answers how many bytes it sent.
 */
async function trickle(
  xhr: FakeXhr,
  until: number,
  every = UPLOAD_STALL_MS - 1_000,
  total = 1_000_000,
): Promise<number> {
  let loaded = 0;
  while (Date.now() < until) {
    xhr.progress((loaded += 1), total);
    await vi.advanceTimersByTimeAsync(Math.min(every, until - Date.now()));
  }
  return loaded;
}

afterEach(() => {
  FakeXhr.made = [];
  vi.useRealTimers();
  vi.mocked(captureApiFailure).mockClear();
});

describe('the decks (Your slides)', () => {
  it('reads them from `GET /v1/decks`, as the API orders them', async () => {
    const decks = [deck(), deck({ id: 'd0', status: 'ready', pageCount: 12 })];
    const { api, calls } = fakeApi(() => ({ decks }));
    expect(await readDecks(api)).toEqual({ kind: 'read', decks });
    expect(calls).toEqual([['GET', '/v1/decks', undefined]]);
  });

  it('says why a read failed, for the page to say with Try again', async () => {
    const offline = fakeApi(() => {
      throw new NetworkError();
    });
    expect(await readDecks(offline.api)).toEqual({
      kind: 'failed',
      status: undefined,
      retryAfter: undefined,
    });
    const off = fakeApi(() => {
      throw new ApiError(503, 'unavailable', 'slides are off', 'deck_storage_off');
    });
    expect(await readDecks(off.api)).toMatchObject({ kind: 'failed', status: 503 });
  });
});

describe('a deck’s title, from its file’s name', () => {
  it('is the name without its .pdf, as the canvas shows one', () => {
    expect(titleOf('Unit 3 review.pdf')).toBe('Unit 3 review');
    expect(titleOf('Lab safety.PDF')).toBe('Lab safety');
    expect(titleOf('Midterm review (scanned).pdf')).toBe('Midterm review (scanned)');
    // Only the last .pdf goes; a name with none keeps all of it.
    expect(titleOf('notes.pdf.pdf')).toBe('notes.pdf');
    expect(titleOf('Chapter 4')).toBe('Chapter 4');
  });

  it('is held to the create’s checks: trimmed, nothing it can’t show, 200 code points', () => {
    expect(titleOf('  Unit 3  .pdf')).toBe('Unit 3');
    const LRM = String.fromCodePoint(0x200e);
    const TAB = String.fromCharCode(9);
    expect(titleOf(`${LRM}Unit${TAB}3.pdf`)).toBe('Unit3');
    // 150 emoji are 300 UTF-16 units: kept whole, never cut inside one.
    const long = '😀'.repeat(DECK_TITLE_MAX_LENGTH + 50);
    expect([...titleOf(`${long}.pdf`)]).toHaveLength(DECK_TITLE_MAX_LENGTH);
    expect(titleOf(`${long}.pdf`)).toBe('😀'.repeat(DECK_TITLE_MAX_LENGTH));
  });

  it('keeps the whole name when nothing else is left of it', () => {
    expect(titleOf('.pdf')).toBe('.pdf');
    expect(titleOf('   .pdf')).toBe('.pdf');
    expect(titleOf(`${String.fromCodePoint(0x200b)}.pdf`)).toBe('.pdf');
  });
});

/** A picked file as the browser gives one, its size as said: no 25 MB held in memory. */
function picked(name: string, head: Uint8Array<ArrayBuffer> | 'unreadable', size?: number): File {
  const blob = head === 'unreadable' ? new Blob([]) : new Blob([head]);
  return {
    name,
    size: size ?? blob.size,
    slice: (start?: number, end?: number) =>
      head === 'unreadable'
        ? ({ text: () => Promise.reject(new Error('NotReadableError')) } as unknown as Blob)
        : blob.slice(start, end),
  } as unknown as File;
}

describe('a picked file, judged before anything is sent', () => {
  it('is too large past 25 MB, before anything of it is read', async () => {
    const big = picked('Chapter 4 scan.pdf', 'unreadable', DECK_MAX_BYTES + 1);
    expect(await judgePick(big)).toEqual({ kind: 'too_large' });
    expect(await judgePick(picked('At the limit.pdf', PDF, DECK_MAX_BYTES))).toEqual({
      kind: 'deck',
      title: 'At the limit',
    });
  });

  it('is no PDF without the check’s %PDF- at its start, whatever its name says', async () => {
    const pptx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(await judgePick(picked('Unit 3.pptx', pptx))).toEqual({ kind: 'not_pdf' });
    expect(await judgePick(picked('Unit 3.pdf', pptx))).toEqual({ kind: 'not_pdf' });
    expect(await judgePick(picked('Empty.pdf', new Uint8Array()))).toEqual({ kind: 'not_pdf' });
    expect(await judgePick(picked('Lab safety', PDF))).toEqual({
      kind: 'deck',
      title: 'Lab safety',
    });
  });

  it('lets a file it can’t read through: its upload reads it whole and says it stopped', async () => {
    expect(await judgePick(picked('Offline.pdf', 'unreadable'))).toEqual({
      kind: 'deck',
      title: 'Offline',
    });
  });
});

describe('the PUT to the bucket (XMLHttpRequest, for its progress)', () => {
  const put = (over: Partial<PutOptions> = {}) => {
    const progress: number[] = [];
    const controller = new AbortController();
    const ended = putPdf(URL_PUT, new Blob([PDF]), {
      deadline: 1_000 + UPLOAD_LIMIT_MS,
      now: () => 1_000,
      onProgress: (f) => progress.push(f),
      signal: controller.signal,
      Xhr,
      ...over,
    });
    return { ended, progress, controller };
  };

  it('sends the PDF as it was signed, and says how much is sent', async () => {
    const { ended, progress } = put();
    const xhr = lastXhr()!;
    expect([xhr.method, xhr.url, xhr.headers]).toEqual([
      'PUT',
      URL_PUT,
      { 'Content-Type': 'application/pdf' },
    ]);
    expect(xhr.body).toBeInstanceOf(Blob);
    xhr.progress(10, 40);
    xhr.progress(5, 40, false);
    xhr.progress(40, 40);
    xhr.answer(200);
    expect(await ended).toBe('uploaded');
    expect(progress).toEqual([0.25, 1]);
  });

  it('gives the browser the time left until the deadline, measured on the clock given', async () => {
    const { ended } = put({ deadline: 5_000 + UPLOAD_LIMIT_MS, now: () => 65_000 });
    expect(lastXhr()!.timeout).toBe(UPLOAD_LIMIT_MS - 60_000);
    lastXhr()!.answer(200);
    await ended;
  });

  it('ends on the bucket’s refusal, no answer, the browser’s timeout or Cancel', async () => {
    const refused = put();
    lastXhr()!.answer(403);
    expect(await refused.ended).toEqual({ failed: 403 });

    const offline = put();
    lastXhr()!.fail();
    expect(await offline.ended).toEqual({ failed: undefined });

    const slow = put();
    lastXhr()!.ontimeout?.();
    expect(await slow.ended).toBe('too_slow');

    const cancelled = put();
    cancelled.controller.abort();
    expect(lastXhr()!.aborted).toBe(true);
    expect(await cancelled.ended).toBe('cancelled');
  });

  it('reports the bucket’s 5xx and no answer as an API call’s, by the key alone, never a 4xx', async () => {
    const failing = put();
    lastXhr()!.answer(503);
    await failing.ended;
    const offline = put();
    lastXhr()!.fail();
    await offline.ended;
    const refused = put();
    lastXhr()!.answer(403);
    await refused.ended;
    const key = '/bucket/decks/0199b000-0000-7000-8000-0000000000d1.pdf';
    // No query: the presigned URL's signature never leaves.
    expect(vi.mocked(captureApiFailure).mock.calls).toEqual([
      ['PUT', key, 503],
      ['PUT', key, 'network'],
    ]);
  });

  it('sends nothing once cancelled, or past its deadline', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await put({ signal: controller.signal }).ended).toBe('cancelled');
    expect(await put({ deadline: 1_000 }).ended).toBe('too_slow');
    expect(FakeXhr.made).toHaveLength(0);
  });
});

describe('a PUT that sends nothing for 30 s stops; 25 minutes stay the outer limit (the owner, 2026-10-22)', () => {
  /** The key as monitoring is told it: no query, so the URL's signature never leaves. */
  const KEY = '/bucket/decks/0199b000-0000-7000-8000-0000000000d1.pdf';

  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** A PUT on the fake clock, how it ended and how long after its start kept as it ends. */
  function watched() {
    const start = Date.now();
    const controller = new AbortController();
    const seen: { end?: PutEnd; after?: number } = {};
    void putPdf(URL_PUT, new Blob([PDF]), {
      deadline: start + UPLOAD_LIMIT_MS,
      now: () => Date.now(),
      onProgress: () => undefined,
      signal: controller.signal,
      Xhr,
    }).then((end) => {
      seen.end = end;
      seen.after = Date.now() - start;
    });
    return { xhr: lastXhr()!, seen, controller, start };
  }

  it('waits the owner’s 30 s while bytes remain, 2 minutes for the answer once all is sent (the conductor’s call), and #326’s 25 minutes at most', () => {
    expect([UPLOAD_STALL_MS, UPLOAD_ANSWER_MS, UPLOAD_LIMIT_MS]).toEqual([
      30_000,
      2 * 60_000,
      25 * 60_000,
    ]);
  });

  it('stops one that sends nothing for 30 s from its start: no connection, no first byte', async () => {
    const { xhr, seen } = watched();
    await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS - 1);
    expect(seen.end).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual({ end: { failed: undefined }, after: UPLOAD_STALL_MS });
    // Stopped for good, and reported as the bucket's no answer is, by the key alone.
    expect(xhr.aborted).toBe(true);
    expect(vi.mocked(captureApiFailure).mock.calls).toEqual([['PUT', KEY, 'network']]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts the 30 s again from each byte sent: stuck halfway, it stops 30 s after the last', async () => {
    const { xhr, seen } = watched();
    // The connection, TLS and the browser's CORS check, then the first bytes.
    await vi.advanceTimersByTimeAsync(4_000);
    xhr.progress(16_384, 1_000_000);
    await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS - 1);
    // A browser that sends the file again from its start (a connection it opened again) is sending.
    xhr.progress(8_192, 1_000_000);
    await vi.advanceTimersByTimeAsync(10_000);
    // An event that says nothing more was sent is no progress.
    xhr.progress(8_192, 1_000_000);
    await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS - 10_000 - 1);
    expect(seen.end).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual({ end: { failed: undefined }, after: 4_000 + 2 * UPLOAD_STALL_MS - 1 });
    expect(xhr.aborted).toBe(true);
    expect(vi.mocked(captureApiFailure).mock.calls).toEqual([['PUT', KEY, 'network']]);
  });

  it('never stops a slow PUT that keeps sending: a little every 29 s for 24 minutes, then the bucket’s answer', async () => {
    const { xhr, seen, start } = watched();
    await trickle(xhr, start + 24 * 60_000);
    expect(seen.end).toBeUndefined();
    xhr.sentAll(1_000_000);
    xhr.answer(200);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual({ end: 'uploaded', after: 24 * 60_000 });
    expect(captureApiFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives the bucket UPLOAD_ANSWER_MS to answer once the whole file is sent, not the 30 s', async () => {
    const { xhr, seen } = watched();
    xhr.progress(500_000, 1_000_000);
    await vi.advanceTimersByTimeAsync(10_000);
    xhr.sentAll(1_000_000);
    await vi.advanceTimersByTimeAsync(UPLOAD_ANSWER_MS - 1);
    expect(seen.end).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual({ end: { failed: undefined }, after: 10_000 + UPLOAD_ANSWER_MS });
    expect(xhr.aborted).toBe(true);
    expect(vi.mocked(captureApiFailure).mock.calls).toEqual([['PUT', KEY, 'network']]);
  });

  it('still ends one at its 25 minutes, `too_slow`, however steadily it sends', async () => {
    const { xhr, seen, start } = watched();
    await trickle(xhr, start + UPLOAD_LIMIT_MS - 1);
    expect(seen.end).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual({ end: 'too_slow', after: UPLOAD_LIMIT_MS });
    // The browser's own stop, said in its own words: no stuck upload to report.
    expect(captureApiFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('watches nothing once it has ended: a Cancel, a refusal, the bucket’s answer', async () => {
    const cancelled = watched();
    const refused = watched();
    const uploaded = watched();
    cancelled.controller.abort();
    refused.xhr.answer(403);
    uploaded.xhr.sentAll(1_000_000);
    uploaded.xhr.answer(200);
    await vi.advanceTimersByTimeAsync(UPLOAD_LIMIT_MS);
    expect([cancelled.seen.end, refused.seen.end, uploaded.seen.end]).toEqual([
      'cancelled',
      { failed: 403 },
      'uploaded',
    ]);
    expect(captureApiFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** A fake API answering the create with a fresh URL each time, and the check with `verdict`. */
function deckApi(
  verdict: () => unknown = () => ({
    outcome: 'checked',
    deck: deck({ status: 'ready', pageCount: 12 }),
  }),
) {
  let urls = 0;
  return fakeApi((method, path) => {
    if (path === '/v1/decks')
      return { outcome: 'created', deck: deck(), uploadUrl: `${URL_PUT}&n=${++urls}` };
    if (path === `/v1/decks/${ID}/complete`) return verdict();
    throw new Error(`unexpected ${method} ${path}`);
  });
}

/** An upload run with the fake XMLHttpRequest, its steps recorded. */
function run(api: Pick<ApiClient, 'post'>, upload: Upload, now = () => 0) {
  const steps: UploadStep[] = [];
  const controller = new AbortController();
  const ended = runUpload(api, upload, {
    signal: controller.signal,
    onStep: (step) => steps.push(step),
    now,
    put: (url, body, opts) => putPdf(url, body, { ...opts, Xhr }),
  });
  return { ended, steps, controller };
}
/** Until the PUT is sent: the file read and hashed, the create answered. */
async function untilPut(count = 1) {
  await vi.waitFor(() => expect(FakeXhr.made).toHaveLength(count));
  return lastXhr()!;
}

describe('an upload, from the file to the server’s verdict', () => {
  const file = () => new Blob([PDF]);

  it('creates the deck with its SHA-256, sends it with its progress, then asks for the check', async () => {
    const { api, calls } = deckApi();
    const upload = newUpload(file(), 'Unit 3 review');
    const { ended, steps } = run(api, upload);
    const xhr = await untilPut();
    expect(xhr.url).toBe(`${URL_PUT}&n=1`);
    xhr.progress(31, 50);
    xhr.answer(200);
    expect(await ended).toEqual({
      kind: 'checked',
      deck: deck({ status: 'ready', pageCount: 12 }),
    });
    expect(calls).toEqual([
      [
        'POST',
        '/v1/decks',
        { eventId: upload.createId, title: 'Unit 3 review', bytes: PDF.byteLength, sha256: SHA },
      ],
      ['POST', `/v1/decks/${ID}/complete`, { eventId: upload.completeId }],
    ]);
    expect(steps).toEqual([
      { step: 'uploading', fraction: 0 },
      { step: 'uploading', fraction: 0.62 },
      { step: 'checking' },
    ]);
  });

  it('says its deck as the create answers it, before anything is sent to the bucket', async () => {
    const { api } = deckApi();
    const created: Deck[] = [];
    const ended = runUpload(api, newUpload(file(), 'Unit 3 review'), {
      signal: new AbortController().signal,
      onStep: () => undefined,
      onCreated: (made) => created.push(made),
      now: () => 0,
      put: (url, body, opts) => putPdf(url, body, { ...opts, Xhr }),
    });
    const xhr = await untilPut();
    expect(created).toEqual([deck()]);
    xhr.answer(200);
    await ended;
    expect(created).toHaveLength(1);
  });

  it('answers a rejection as the server’s verdict, with why', async () => {
    const rejected = deck({ status: 'rejected', rejection: 'encrypted' });
    const { api } = deckApi(() => ({ outcome: 'checked', deck: rejected }));
    const { ended } = run(api, newUpload(file(), 'Midterm review (scanned)'));
    (await untilPut()).answer(200);
    expect(await ended).toEqual({ kind: 'checked', deck: rejected });
  });

  it('stops an upload still running 25 minutes after its create, however steadily it sends, on a fake clock', async () => {
    vi.useFakeTimers();
    let createdAt = 0;
    const { api, calls } = fakeApi((_method, path) => {
      if (path !== '/v1/decks') throw new Error(`unexpected ${path}`);
      createdAt = Date.now();
      return { outcome: 'created', deck: deck(), uploadUrl: URL_PUT };
    });
    const { ended, steps } = run(api, newUpload(file(), 'Unit 3 review'), () => Date.now());
    const seen: { end?: UploadEnd } = {};
    void ended.then((end) => (seen.end = end));
    const xhr = await untilPut();
    // A little more every 29 s: slow, never stuck (`UPLOAD_STALL_MS`).
    const sent = await trickle(xhr, createdAt + UPLOAD_LIMIT_MS - 1);
    expect(seen.end).toBeUndefined();
    expect(steps.at(-1)).toEqual({ step: 'uploading', fraction: sent / 1_000_000 });
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.end).toMatchObject({
      kind: 'too_slow',
      upload: { deck: deck(), uploaded: false },
    });
    // No check is asked for an upload that never arrived.
    expect(calls.map(([, path]) => path)).toEqual(['/v1/decks']);
  });

  it('stops a stuck upload as one with no answer, for Try again to go on from (the owner, 2026-10-22)', async () => {
    vi.useFakeTimers();
    const { api, calls } = deckApi();
    const { ended } = run(api, newUpload(file(), 'Unit 3 review'), () => Date.now());
    const seen: { end?: UploadEnd } = {};
    void ended.then((end) => (seen.end = end));
    const xhr = await untilPut();
    xhr.progress(1, 50);
    await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS - 1);
    expect(seen.end).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.end).toMatchObject({
      kind: 'stopped',
      failure: { kind: 'failed', status: undefined },
      upload: { deck: deck(), uploaded: false },
    });
    // Not refused: Try again goes on under the same ids, its create replayed for a fresh URL
    // (M2b2); and no check is asked for a file that never arrived.
    if (seen.end?.kind !== 'stopped') return;
    expect(uploadAgain(seen.end)).toBe(seen.end.upload);
    expect(calls.map(([, path]) => path)).toEqual(['/v1/decks']);
  });

  it('counts the 25 minutes from before the create, so a slow create leaves the PUT less', async () => {
    let clock = 0;
    const slowApi = fakeApi((_method, path) => {
      if (path !== '/v1/decks') throw new Error('unexpected');
      clock += 120_000;
      return { outcome: 'created', deck: deck(), uploadUrl: URL_PUT };
    });
    const { ended } = run(slowApi.api, newUpload(file(), 'Unit 3 review'), () => clock);
    const xhr = await untilPut();
    expect(xhr.timeout).toBe(UPLOAD_LIMIT_MS - 120_000);
    xhr.fail();
    await ended;
  });

  it('is cancelled while it is sent, keeping its pending deck for the Cancel to remove', async () => {
    const { api, calls } = deckApi();
    const { ended, controller } = run(api, newUpload(file(), 'Unit 3 review'));
    const xhr = await untilPut();
    controller.abort();
    expect(xhr.aborted).toBe(true);
    expect(await ended).toMatchObject({ kind: 'cancelled', upload: { deck: deck() } });
    expect(calls).toHaveLength(1);
  });

  it('is cancelled before its create when Cancel comes while the file is read', async () => {
    const { api, calls } = deckApi();
    const { ended, controller } = run(api, newUpload(file(), 'Unit 3 review'));
    controller.abort();
    expect(await ended).toMatchObject({ kind: 'cancelled', upload: { deck: null } });
    expect(calls).toEqual([]);
  });

  it('stops on a file it can’t read, sending nothing', async () => {
    const { api, calls } = deckApi();
    const unreadable = {
      size: 10,
      arrayBuffer: () => Promise.reject(new Error('NotReadableError')),
    } as unknown as Blob;
    expect(await run(api, newUpload(unreadable, 'Offline')).ended).toMatchObject({
      kind: 'stopped',
      failure: { kind: 'failed', status: undefined },
      upload: { sha256: null, deck: null },
    });
    expect(calls).toEqual([]);
  });

  it('goes on from where it stopped: a failed create is sent again under its own id', async () => {
    let fail = true;
    const { api, calls } = fakeApi((_method, path) => {
      if (fail) {
        fail = false;
        throw new NetworkError();
      }
      return path === '/v1/decks'
        ? { outcome: 'replay', deck: deck(), uploadUrl: URL_PUT }
        : { outcome: 'checked', deck: deck({ status: 'ready', pageCount: 12 }) };
    });
    const first = await run(api, newUpload(file(), 'Unit 3 review')).ended;
    expect(first).toMatchObject({ kind: 'stopped', upload: { sha256: SHA, deck: null } });
    if (first.kind !== 'stopped') return;
    const again = run(api, first.upload);
    (await untilPut()).answer(200);
    expect(await again.ended).toMatchObject({ kind: 'checked' });
    expect(calls[1]).toEqual(calls[0]);
  });

  it('goes on from where it stopped: a failed PUT is sent again on a fresh URL, its create replayed', async () => {
    const { api, calls } = deckApi();
    const first = run(api, newUpload(file(), 'Unit 3 review'));
    (await untilPut()).answer(500);
    const stopped = await first.ended;
    expect(stopped).toMatchObject({
      kind: 'stopped',
      failure: { kind: 'failed', status: 500 },
      upload: { deck: deck(), uploaded: false },
    });
    if (stopped.kind !== 'stopped') return;
    const again = run(api, stopped.upload);
    const xhr = await untilPut(2);
    expect(xhr.url).toBe(`${URL_PUT}&n=2`);
    xhr.answer(200);
    expect(await again.ended).toMatchObject({ kind: 'checked' });
    expect(calls.map(([, path]) => path)).toEqual([
      '/v1/decks',
      '/v1/decks',
      `/v1/decks/${ID}/complete`,
    ]);
    expect(calls[1]).toEqual(calls[0]);
  });

  it('goes on from where it stopped: a failed check is asked again, the same check, nothing sent again', async () => {
    let fail = true;
    const { api, calls } = deckApi(() => {
      if (!fail) return { outcome: 'replay', deck: deck({ status: 'ready', pageCount: 12 }) };
      fail = false;
      throw new ApiError(500, 'internal', 'the parser stopped');
    });
    const first = run(api, newUpload(file(), 'Unit 3 review'));
    (await untilPut()).answer(200);
    const stopped = await first.ended;
    expect(stopped).toMatchObject({ kind: 'stopped', upload: { uploaded: true } });
    if (stopped.kind !== 'stopped') return;
    const steps: UploadStep[] = [];
    const again = await runUpload(api, stopped.upload, {
      signal: new AbortController().signal,
      onStep: (step) => steps.push(step),
    });
    expect(again).toMatchObject({ kind: 'checked', deck: { status: 'ready' } });
    expect(steps).toEqual([{ step: 'checking' }]);
    expect(FakeXhr.made).toHaveLength(1);
    expect(calls.slice(1)).toEqual([
      ['POST', `/v1/decks/${ID}/complete`, { eventId: stopped.upload.completeId }],
      ['POST', `/v1/decks/${ID}/complete`, { eventId: stopped.upload.completeId }],
    ]);
  });

  it('is gone when its deck was removed meanwhile, in another tab', async () => {
    const { api } = deckApi(() => {
      throw refusal(404, 'deck_not_found');
    });
    const { ended } = run(api, newUpload(file(), 'Unit 3 review'));
    (await untilPut()).answer(200);
    expect(await ended).toEqual({ kind: 'gone' });
  });

  it('starts afresh, under new ids, once the API refused it; else goes on from where it stopped', () => {
    const upload: Upload = {
      ...newUpload(file(), 'Unit 3 review'),
      sha256: SHA,
      deck: deck(),
    };
    const failed = { kind: 'failed', status: undefined, retryAfter: undefined } as const;
    expect(uploadAgain({ failure: failed, upload })).toBe(upload);
    // The sweep rejected its deck `unfinished`, its id still held: the same create is refused.
    const refused = { kind: 'refused', status: 409, reason: 'event_id_conflict' } as const;
    const again = uploadAgain({ failure: refused, upload });
    expect(again).toMatchObject({
      file: upload.file,
      title: 'Unit 3 review',
      sha256: SHA,
      deck: null,
      uploaded: false,
    });
    expect(again.createId).not.toBe(upload.createId);
    expect(again.completeId).not.toBe(upload.completeId);
  });

  it.each([
    ['no answer', new NetworkError()],
    ['a 503', new ApiError(503, 'unavailable', 'down')],
    ['a 429', new ApiError(429, 'too_many_requests', 'slow down', undefined, 1)],
  ])(
    'ends cancelled, never stopped, when Cancel came while the create was on its way and it got %s (santa’s review)',
    async (_, error) => {
      let fail: (e: unknown) => void = () => undefined;
      const { api, calls } = fakeApi(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
      const { ended, controller } = run(api, newUpload(file(), 'Unit 3 review'));
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      controller.abort();
      fail(error);
      expect(await ended).toMatchObject({ kind: 'cancelled', upload: { deck: null } });
      expect(FakeXhr.made).toHaveLength(0);
    },
  );

  it('ends cancelled when Cancel came as the PDF finished sending: no check is asked', async () => {
    const { api, calls } = deckApi();
    const controller = new AbortController();
    const end = await runUpload(api, newUpload(file(), 'Unit 3 review'), {
      signal: controller.signal,
      onStep: () => undefined,
      put: () => {
        // The bucket's answer and the Cancel at once: the PUT ended before its abort.
        controller.abort();
        return Promise.resolve('uploaded');
      },
    });
    expect(end).toMatchObject({ kind: 'cancelled', upload: { deck: deck(), uploaded: true } });
    expect(calls.map(([, path]) => path)).toEqual(['/v1/decks']);
  });

  it('ends cancelled when Cancel came while the check was on its way and it then failed', async () => {
    const controller = new AbortController();
    const { api } = deckApi(() => {
      controller.abort();
      throw new ApiError(500, 'internal', 'the parser stopped');
    });
    const end = await runUpload(
      api,
      { ...newUpload(file(), 'Unit 3 review'), sha256: SHA, deck: deck(), uploaded: true },
      {
        signal: controller.signal,
        onStep: () => undefined,
      },
    );
    expect(end).toMatchObject({ kind: 'cancelled', upload: { deck: deck(), uploaded: true } });
  });

  it('ends cancelled when Cancel came while the file was read and the read then failed', async () => {
    const { api, calls } = deckApi();
    const controller = new AbortController();
    const unreadable = {
      size: 10,
      arrayBuffer: () => {
        controller.abort();
        return Promise.reject(new Error('NotReadableError'));
      },
    } as unknown as Blob;
    const end = await runUpload(api, newUpload(unreadable, 'Offline'), {
      signal: controller.signal,
      onStep: () => undefined,
    });
    expect(end).toMatchObject({ kind: 'cancelled', upload: { deck: null } });
    expect(calls).toEqual([]);
  });

  it('stops on a refused create, the refusal typed for the page', async () => {
    const { api } = fakeApi(() => {
      throw new ApiError(429, 'too_many_requests', 'slow down', undefined, 2);
    });
    expect(await run(api, newUpload(file(), 'Unit 3 review')).ended).toMatchObject({
      kind: 'stopped',
      failure: { kind: 'failed', status: 429, retryAfter: 2 },
    });
  });
});

describe('the classes a deck in use names (M5a)', () => {
  const BIO = { id: 'c1', name: 'Biology, period 3' };
  const CHEM = { id: 'c2', name: 'Chemistry' };

  it('reads each class, in the order sent', () => {
    expect(inUseClasses({ classes: [BIO, CHEM] })).toEqual([BIO, CHEM]);
    expect(inUseClasses({ classes: [{ ...BIO, extra: 1 }] })).toEqual([BIO]);
  });

  it('reads none from a server before M5a, or any other shape', () => {
    for (const details of [undefined, null, {}, { classes: [] }, { classes: 'c1' }, [BIO]]) {
      expect(inUseClasses(details)).toBeNull();
    }
    expect(inUseClasses({ classes: [BIO, { id: 'c2' }] })).toBeNull();
  });
});

describe('a removal (Remove, and Cancel’s of its pending deck)', () => {
  it('sends the removal under its id, the unanswered one again, else a fresh one', async () => {
    const first = removeAttemptFor(undefined, ID);
    expect(removeAttemptFor(first, ID)).toBe(first);
    expect(removeAttemptFor(first, 'd2')).toMatchObject({ deckId: 'd2' });
    expect(removeAttemptFor(first, 'd2').eventId).not.toBe(first.eventId);
    const { api, calls } = fakeApi(() => ({ outcome: 'removed', deck: deck() }));
    expect(await removeDeck(api, first)).toEqual({ kind: 'removed' });
    expect(calls).toEqual([['DELETE', `/v1/decks/${ID}`, { eventId: first.eventId }]]);
  });

  it('counts a deck already gone as removed', async () => {
    const { api } = fakeApi(() => {
      throw refusal(404, 'deck_not_found');
    });
    expect(await removeDeck(api, removeAttemptFor(undefined, ID))).toEqual({ kind: 'removed' });
  });

  it('names the classes showing it, from the refusal’s details', async () => {
    const classes = [{ id: 'c1', name: 'Biology, period 3' }];
    const { api } = fakeApi(() => {
      throw refusal(409, 'deck_in_use', { classes });
    });
    expect(await removeDeck(api, removeAttemptFor(undefined, ID))).toEqual({
      kind: 'in_use',
      classes,
    });
  });

  it('reads an in-use refusal naming no class as refused, and no answer as failed', async () => {
    const bare = fakeApi(() => {
      throw refusal(409, 'deck_in_use');
    });
    expect(await removeDeck(bare.api, removeAttemptFor(undefined, ID))).toEqual({
      kind: 'refused',
      status: 409,
      reason: 'deck_in_use',
    });
    const offline = fakeApi(() => {
      throw new NetworkError();
    });
    expect(await removeDeck(offline.api, removeAttemptFor(undefined, ID))).toMatchObject({
      kind: 'failed',
    });
  });
});

describe('each write’s time limit (the owner, 2026-10-16)', () => {
  const file = () => new Blob([PDF]);
  // Its SHA-256 already read, so a fake clock moves nothing the file's read waits on.
  const hashed = () => ({ ...newUpload(file(), 'Unit 3 review'), sha256: SHA });

  /**
   * The API client over a fetch that swallows its first request (no answer until its limit gives up
   * on it) and answers each after it from `answer`, each request's method, path and body kept.
   */
  function swallowsFirst(answer: (path: string) => Response) {
    const sent: { method?: string; path: string; body: unknown }[] = [];
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: (url, init) => {
        const path = (url as string).replace('http://api', '');
        sent.push({
          method: init?.method,
          path,
          body: JSON.parse(init?.body as string) as unknown,
        });
        if (sent.length > 1) return Promise.resolve(answer(path));
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      },
    });
    return { client, sent };
  }

  afterEach(() => vi.useRealTimers());

  it('gives the create a save’s limit and the check none: a good upload’s check can take longer than any save waits', async () => {
    const given: [string, number | undefined][] = [];
    const api: Pick<ApiClient, 'post'> = {
      // eslint-disable-next-line @typescript-eslint/require-await
      post: async (path: string, _body?: unknown, limitMs?: number): Promise<never> => {
        given.push([path, limitMs]);
        return (
          path === '/v1/decks'
            ? { outcome: 'created', deck: deck(), uploadUrl: URL_PUT }
            : { outcome: 'checked', deck: deck({ status: 'ready', pageCount: 12 }) }
        ) as never;
      },
    };
    const { ended } = run(api, hashed());
    (await untilPut()).answer(200);
    expect(await ended).toMatchObject({ kind: 'checked' });
    expect(given).toEqual([
      ['/v1/decks', SAVE_TIMEOUT_MS],
      [`/v1/decks/${ID}/complete`, undefined],
    ]);
  });

  it('stops an upload whose create the network swallows at SAVE_TIMEOUT_MS; its Try again sends the create again under its id', async () => {
    vi.useFakeTimers();
    const { client, sent } = swallowsFirst(() =>
      Response.json({ error: { code: 'unavailable', message: 'down' } }, { status: 503 }),
    );
    const first = run(client, hashed()).ended;
    const settled = vi.fn();
    void first.then(settled);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const stopped = await first;
    expect(stopped).toMatchObject({
      kind: 'stopped',
      failure: { kind: 'failed', status: undefined },
      upload: { deck: null, uploaded: false },
    });
    if (stopped.kind !== 'stopped') return;
    // No answer, so not refused: Try again goes on under the same ids, a replay if it landed.
    const again = uploadAgain(stopped);
    expect(again).toBe(stopped.upload);
    await run(client, again).ended;
    expect(sent.map((s) => [s.method, s.path, (s.body as { eventId: string }).eventId])).toEqual([
      ['POST', '/v1/decks', again.createId],
      ['POST', '/v1/decks', again.createId],
    ]);
  });

  it('gives a removal a save’s 10 s past the API’s own delete of its object, its storage’s limit', () => {
    const storage = readFileSync(
      fileURLToPath(new URL('../../../api/src/deck-storage.ts', import.meta.url)),
      'utf8',
    );
    const limit = /export const STORAGE_TIMEOUT_MS = ([\d_]+);/.exec(storage)?.[1];
    expect(Number(limit?.replaceAll('_', ''))).toBe(30_000);
    expect(REMOVE_TIMEOUT_MS).toBe(30_000 + SAVE_TIMEOUT_MS);
  });

  it('fails a removal the network swallows at REMOVE_TIMEOUT_MS, never sooner, and its Remove sends it again under its id', async () => {
    vi.useFakeTimers();
    const { client, sent } = swallowsFirst(() =>
      Response.json({ outcome: 'replay', deck: deck() }),
    );
    const attempt = removeAttemptFor(undefined, ID);
    const first = removeDeck(client, attempt);
    const settled = vi.fn();
    void first.then(settled);
    await vi.advanceTimersByTimeAsync(REMOVE_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toEqual({ kind: 'failed', status: undefined, retryAfter: undefined });
    const again = removeAttemptFor(attempt, ID);
    expect(await removeDeck(client, again)).toEqual({ kind: 'removed' });
    expect(sent.map((s) => [s.method, s.path, s.body])).toEqual([
      ['DELETE', `/v1/decks/${ID}`, { eventId: attempt.eventId }],
      ['DELETE', `/v1/decks/${ID}`, { eventId: attempt.eventId }],
    ]);
  });
});
