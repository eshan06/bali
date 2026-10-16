import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Deck, FeedEvent, Slide } from '@bali/shared';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from './api-client';
import { newEventId } from './event-id';
import {
  drawPage,
  newer,
  NOTHING_SHOWN,
  readyDecks,
  type Shown,
  showSlide,
  shownIn,
  SLIDE_TIMEOUT_MS,
  slideAfter,
  type SlideAnswer,
  type SlideAttempt,
  slideAttemptFor,
  turned,
} from './presenter';
import { keepUnanswered } from './session-controls';

/*
 * The presenter's logic (M6 part 2a): what a running session shows, as the class page and Present
 * hold it, from its snapshot, its stream and the teacher's own slide changes, always the latest
 * change by the server's order (M3a); the changes themselves; the decks a teacher can show; and a
 * page drawn on a canvas. Against a fake API, and stand-ins for PDF.js, a canvas and its window.
 */

const SESSION = '0199b000-0000-7000-8000-000000000051';
const DECK_A = '0199b000-0000-7000-8000-0000000000da';
const DECK_B = '0199b000-0000-7000-8000-0000000000db';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AT = Date.UTC(2026, 9, 16, 15, 5);
/** A slide change's id, minted `ms` after `AT`. */
const idAt = (ms: number) => newEventId(AT + ms, new Uint8Array(16).fill(0x11));
const timeOf = (id: string) => parseInt(id.replace(/-/g, '').slice(0, 12), 16);

const slide = (over: Partial<Slide> = {}): Slide => ({
  deckId: DECK_A,
  sha256: SHA_A,
  page: 4,
  pageCount: 12,
  ...over,
});
const shown = (ms: number, s: Slide | null = slide()): Shown => ({ slide: s, eventId: idAt(ms) });
const deck = (over: Partial<Deck>): Deck => ({
  id: DECK_B,
  title: 'Graphing parabolas',
  status: 'ready',
  bytes: 4_400_000,
  sha256: SHA_B,
  pageCount: 9,
  rejection: null,
  createdAt: '2026-10-02T15:00:00.000Z',
  ...over,
});

describe('newer: the latest slide change by the server’s order (M3a)', () => {
  it('takes a change made after the one held, and keeps one made before it or the same', () => {
    const held = shown(1_000);
    const later = shown(2_000, slide({ page: 5 }));
    expect(newer(held, later)).toBe(later);
    expect(newer(later, held)).toBe(later);
    expect(newer(held, { ...held })).toBe(held);
  });

  it('takes any change once none is held, and never one that names no change', () => {
    const first = shown(1_000);
    expect(newer(NOTHING_SHOWN, first)).toBe(first);
    expect(newer(first, NOTHING_SHOWN)).toBe(first);
    expect(newer(first, { slide: null, eventId: null })).toBe(first);
  });

  it('orders ids by their hex whatever their case, as Postgres orders uuids (#319)', () => {
    const held = shown(2_000);
    const older = { ...shown(1_000), eventId: idAt(1_000).toUpperCase() };
    expect(newer(held, older)).toBe(held);
    const later = { ...shown(3_000), eventId: idAt(3_000).toUpperCase() };
    expect(newer(held, later)).toBe(later);
  });
});

describe('shownIn: what the session’s snapshot says it shows (M3b)', () => {
  it('reads its page and the id of the change that set it', () => {
    const presentation = { slide: slide(), eventId: idAt(0) };
    expect(shownIn({ presentation })).toEqual({ slide: slide(), eventId: idAt(0) });
    // Presenting stopped: no page, the change that stopped it held.
    expect(shownIn({ presentation: { slide: null, eventId: idAt(5) } })).toEqual({
      slide: null,
      eventId: idAt(5),
    });
  });

  it('reads none before the first change, once the session is over, and from an older server', () => {
    expect(shownIn({ presentation: null })).toBe(NOTHING_SHOWN);
    expect(shownIn({})).toBe(NOTHING_SHOWN);
  });
});

describe('slideAfter: what the stream’s slide_shown says (M3a)', () => {
  const event = (ms: number, payload: unknown, type: FeedEvent['type'] = 'slide_shown') => ({
    type,
    eventId: idAt(ms),
    payload,
  });

  it('turns to the page a later change shows of the deck held, its SHA-256 and page count kept', () => {
    const held = shown(1_000);
    expect(slideAfter(held, event(2_000, { deck_id: DECK_A, page: 5 }))).toEqual({
      slide: slide({ page: 5 }),
      eventId: idAt(2_000),
    });
  });

  it('shows nothing once a later change stopped presenting', () => {
    expect(slideAfter(shown(1_000), event(2_000, { deck_id: null, page: null }))).toEqual({
      slide: null,
      eventId: idAt(2_000),
    });
  });

  it('shows another deck from the teacher’s ready decks, its facts from the list', () => {
    const decks = [deck({ id: DECK_A, sha256: SHA_A, pageCount: 12 }), deck({})];
    expect(slideAfter(shown(1_000), event(2_000, { deck_id: DECK_B, page: 1 }), decks)).toEqual({
      slide: { deckId: DECK_B, sha256: SHA_B, page: 1, pageCount: 9 },
      eventId: idAt(2_000),
    });
    // Nothing shown yet: the list alone names it.
    expect(slideAfter(NOTHING_SHOWN, event(2_000, { deck_id: DECK_B, page: 3 }), decks)).toEqual({
      slide: { deckId: DECK_B, sha256: SHA_B, page: 3, pageCount: 9 },
      eventId: idAt(2_000),
    });
  });

  it('says unknown for a deck it can’t name the SHA-256 and page count of: the page reads the snapshot', () => {
    expect(slideAfter(shown(1_000), event(2_000, { deck_id: DECK_B, page: 1 }))).toBe('unknown');
    expect(slideAfter(NOTHING_SHOWN, event(2_000, { deck_id: DECK_B, page: 1 }))).toBe('unknown');
    // Listed, but not checked yet: no page count to go by.
    const pending = deck({ status: 'pending', pageCount: null });
    expect(slideAfter(shown(1_000), event(2_000, { deck_id: DECK_B, page: 1 }), [pending])).toBe(
      'unknown',
    );
  });

  it('says unknown for a payload of another shape', () => {
    const held = shown(1_000);
    for (const payload of [
      null,
      undefined,
      {},
      { deck_id: DECK_A },
      { deck_id: DECK_A, page: '5' },
      { deck_id: 7, page: 5 },
      'deck',
    ]) {
      expect(slideAfter(held, event(2_000, payload))).toBe('unknown');
    }
  });

  it('leaves it as it was for an older change, the same one again, and any other event', () => {
    const held = shown(2_000);
    // The stream's overlap brings this change's own event again, and one before it.
    expect(slideAfter(held, event(2_000, { deck_id: DECK_A, page: 9 }))).toBe(held);
    expect(slideAfter(held, event(1_000, { deck_id: null, page: null }))).toBe(held);
    expect(slideAfter(held, event(3_000, { question_id: 'q' }, 'question_opened'))).toBe(held);
    expect(slideAfter(held, event(3_000, { deck_id: DECK_B, page: 1 }, 'unlock'))).toBe(held);
  });
});

describe('readyDecks: the decks a teacher can show', () => {
  it('keeps the ready ones, in the order the API lists them, newest first', () => {
    const one = deck({ id: '0199b000-0000-7000-8000-0000000000d1', title: 'Factoring quadratics' });
    const pending = deck({ id: '0199b000-0000-7000-8000-0000000000d2', status: 'pending' });
    const refused = deck({
      id: '0199b000-0000-7000-8000-0000000000d3',
      status: 'rejected',
      rejection: 'encrypted',
      pageCount: null,
    });
    const two = deck({ id: '0199b000-0000-7000-8000-0000000000d4', title: 'Unit 2 review' });
    expect(readyDecks([one, pending, refused, two])).toEqual([one, two]);
    expect(readyDecks([pending, refused])).toEqual([]);
  });
});

describe('turned: Previous and Next', () => {
  it('is the page before or after, of the same deck', () => {
    expect(turned(slide({ page: 4 }), -1)).toEqual({ deckId: DECK_A, page: 3 });
    expect(turned(slide({ page: 4 }), 1)).toEqual({ deckId: DECK_A, page: 5 });
  });

  it('is none before the first page or after the last', () => {
    expect(turned(slide({ page: 1 }), -1)).toBeNull();
    expect(turned(slide({ page: 12 }), 1)).toBeNull();
    expect(turned(slide({ page: 1, pageCount: 1 }), 1)).toBeNull();
    expect(turned(slide({ page: 11 }), 1)).toEqual({ deckId: DECK_A, page: 12 });
  });
});

describe('slideAttemptFor', () => {
  const next = { deckId: DECK_A, page: 5 };

  it('mints a fresh UUIDv7 after the change the session holds, whatever this computer’s clock says', () => {
    const held = idAt(60_000);
    // This computer's clock a minute behind the one that minted the held change.
    const attempt = slideAttemptFor(null, SESSION, held, next, AT);
    expect(attempt).toEqual({ sessionId: SESSION, ...next, eventId: attempt.eventId });
    expect(attempt.eventId).toMatch(V7);
    expect(attempt.eventId > held).toBe(true);
    // Its own millisecond when that is later; any, before any change is held.
    expect(timeOf(slideAttemptFor(null, SESSION, held, next, AT + 90_000).eventId)).toBe(
      AT + 90_000,
    );
    expect(timeOf(slideAttemptFor(null, SESSION, null, next, AT).eventId)).toBe(AT);
  });

  it('resends the change whose answer never came, under its id: its replay answers it', () => {
    const unanswered = slideAttemptFor(null, SESSION, idAt(0), next, AT + 1_000);
    expect(slideAttemptFor(unanswered, SESSION, idAt(0), { ...next }, AT + 9_000)).toBe(unanswered);
    // Its own change heard on the stream since: it landed, and its resend replays it.
    const landed = unanswered.eventId;
    expect(slideAttemptFor(unanswered, SESSION, landed, next, AT + 9_000)).toBe(unanswered);
    const stop = slideAttemptFor(null, SESSION, idAt(0), { deckId: null, page: null }, AT);
    expect(slideAttemptFor(stop, SESSION, idAt(0), { deckId: null, page: null })).toBe(stop);
  });

  it('sends the same change fresh once a later one is held: its resend could only replay that one', () => {
    // Next to page 5 went unanswered; Present, in another window, then turned to 5 and 6, and this
    // window heard 6: Previous asks for page 5 again, a press that must show.
    const unanswered = slideAttemptFor(null, SESSION, idAt(0), next, AT + 1_000);
    const later = idAt(5_000);
    const again = slideAttemptFor(unanswered, SESSION, later, next, AT + 9_000);
    expect(again).not.toBe(unanswered);
    expect(again).toEqual({ sessionId: SESSION, ...next, eventId: again.eventId });
    expect(again.eventId > later).toBe(true);
    // Uppercase or not, as the server orders them.
    const loud = slideAttemptFor(unanswered, SESSION, later.toUpperCase(), next, AT + 9_000);
    expect(loud).not.toBe(unanswered);
  });

  it('sends another change fresh, after both the change held and the unanswered one', () => {
    // The unanswered one minted by a clock ahead of this one's now: it may have landed, so the next
    // change must sort after it to show.
    const unanswered = slideAttemptFor(null, SESSION, idAt(0), next, AT + 30_000);
    const back = slideAttemptFor(unanswered, SESSION, idAt(0), { deckId: DECK_A, page: 4 }, AT);
    expect(back.eventId).not.toBe(unanswered.eventId);
    expect(back.eventId > unanswered.eventId).toBe(true);
    expect(back).toEqual({ sessionId: SESSION, deckId: DECK_A, page: 4, eventId: back.eventId });
    // Another deck, or stopping, is another change too.
    expect(slideAttemptFor(unanswered, SESSION, idAt(0), { deckId: DECK_B, page: 5 })).not.toBe(
      unanswered,
    );
    const stop = slideAttemptFor(unanswered, SESSION, idAt(0), { deckId: null, page: null }, AT);
    expect(stop).toEqual({ sessionId: SESSION, deckId: null, page: null, eventId: stop.eventId });
    expect(stop.eventId > unanswered.eventId).toBe(true);
  });

  it('sends a change to another session fresh, the other session’s unanswered one not counted', () => {
    const other = '0199b000-0000-7000-8000-000000000052';
    const unanswered = slideAttemptFor(null, other, null, next, AT + 30_000);
    const attempt = slideAttemptFor(unanswered, SESSION, null, next, AT);
    expect(attempt.sessionId).toBe(SESSION);
    expect(timeOf(attempt.eventId)).toBe(AT);
  });

  it('stays unanswered only while no answer came, never after an answer or a refusal', () => {
    const attempt = slideAttemptFor(null, SESSION, null, next, AT);
    const failed: SlideAnswer = { kind: 'failed', status: undefined, retryAfter: undefined };
    expect(keepUnanswered(attempt, failed)).toBe(attempt);
    const answered: SlideAnswer[] = [
      { kind: 'shown', slide: slide(), eventId: idAt(0) },
      { kind: 'over' },
      { kind: 'gone' },
      { kind: 'refused', status: 409, reason: 'event_id_conflict' },
    ];
    for (const answer of answered) expect(keepUnanswered(attempt, answer)).toBeNull();
  });
});

/** The API client over a fetch that answers `status` with `body`, every request recorded. */
function api(status: number, body: unknown, headers: Record<string, string> = {}) {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'tok',
    fetchImpl: (url, init) => {
      sent.push({ url: url as string, init });
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        }),
      );
    },
  });
  return { client, sent };
}
const refusal = (status: number, reason?: string, headers: Record<string, string> = {}) =>
  api(status, { error: { code: 'x', reason, message: 'a log line' } }, headers).client;
const unreachable = createApiClient({
  baseUrl: 'http://api',
  getToken: () => 'tok',
  fetchImpl: () => Promise.reject(new Error('offline')),
});

describe('showSlide', () => {
  const attempt: SlideAttempt = { sessionId: SESSION, deckId: DECK_A, page: 5, eventId: idAt(0) };
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the page under the eventId, and answers what the session shows now', async () => {
    const { client, sent } = api(200, {
      outcome: 'shown',
      slide: slide({ page: 5 }),
      eventId: idAt(0),
    });
    expect(await showSlide(client, attempt)).toEqual({
      kind: 'shown',
      slide: slide({ page: 5 }),
      eventId: idAt(0),
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`http://api/v1/sessions/${SESSION}/slide`);
    expect(sent[0]?.init?.method).toBe('POST');
    expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({
      eventId: idAt(0),
      deckId: DECK_A,
      page: 5,
    });
  });

  it('stops presenting with no deck and no page', async () => {
    const { client, sent } = api(200, { outcome: 'shown', slide: null, eventId: idAt(0) });
    const stop = { sessionId: SESSION, deckId: null, page: null, eventId: idAt(0) };
    expect(await showSlide(client, stop)).toEqual({ kind: 'shown', slide: null, eventId: idAt(0) });
    expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({
      eventId: idAt(0),
      deckId: null,
      page: null,
    });
  });

  it('answers a replay with what is shown now, a later change’s from another tab included', async () => {
    const later = { outcome: 'replay', slide: slide({ page: 9 }), eventId: idAt(7_000) };
    expect(await showSlide(api(200, later).client, attempt)).toEqual({
      kind: 'shown',
      slide: slide({ page: 9 }),
      eventId: idAt(7_000),
    });
    // Its retry past the bell: nothing shown outside a running session.
    const past = { outcome: 'replay', slide: null, eventId: idAt(0) };
    expect(await showSlide(api(200, past).client, attempt)).toEqual({
      kind: 'shown',
      slide: null,
      eventId: idAt(0),
    });
  });

  it('says the session ended first, and a deck that can’t be shown, by their reasons', async () => {
    expect(await showSlide(refusal(409, 'session_not_running'), attempt)).toEqual({ kind: 'over' });
    expect(await showSlide(refusal(404, 'deck_not_found'), attempt)).toEqual({ kind: 'gone' });
    expect(await showSlide(refusal(409, 'deck_not_ready'), attempt)).toEqual({ kind: 'gone' });
    expect(await showSlide(refusal(409, 'deck_rejected'), attempt)).toEqual({ kind: 'gone' });
  });

  it('types any other refusal by its reason: a page the deck lacks, a spent id, none', async () => {
    expect(await showSlide(refusal(400, 'page_out_of_range'), attempt)).toEqual({
      kind: 'refused',
      status: 400,
      reason: 'page_out_of_range',
    });
    expect(await showSlide(refusal(409, 'event_id_conflict'), attempt)).toEqual({
      kind: 'refused',
      status: 409,
      reason: 'event_id_conflict',
    });
    expect(await showSlide(refusal(403), attempt)).toEqual({
      kind: 'refused',
      status: 403,
      reason: undefined,
    });
  });

  it('answers no answer, a timeout, a server error and the budget’s 429 as failed, its wait kept', async () => {
    const failed = (status: number | undefined, retryAfter?: number) => ({
      kind: 'failed',
      status,
      retryAfter,
    });
    expect(await showSlide(unreachable, attempt)).toEqual(failed(undefined));
    expect(await showSlide(refusal(500), attempt)).toEqual(failed(500));
    expect(await showSlide(refusal(503, 'deck_storage_off'), attempt)).toEqual(failed(503));
    expect(await showSlide(refusal(408), attempt)).toEqual(failed(408));
    expect(await showSlide(refusal(429, undefined, { 'retry-after': '7' }), attempt)).toEqual(
      failed(429, 7),
    );
    // A 200 whose body isn't JSON (a proxy's page): answered, never thrown.
    expect(await showSlide(api(200, '<html>').client, attempt)).toEqual(failed(undefined));
  });

  it('fails a change whose answer never comes once SLIDE_TIMEOUT_MS is up, for Try again', async () => {
    vi.useFakeTimers();
    // A half-open connection: the request goes, and nothing ever answers it.
    const swallowing = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: (_, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    });
    const sent = showSlide(swallowing, attempt);
    const settled = vi.fn();
    void sent.then(settled);
    await vi.advanceTimersByTimeAsync(SLIDE_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledOnce();
    expect(await sent).toEqual({ kind: 'failed', status: undefined, retryAfter: undefined });
    // So it stays unanswered, and Try again resends it under its id.
    expect(keepUnanswered(attempt, await sent)).toBe(attempt);
  });
});

// ---- drawing a page ----

/**
 * A canvas as `drawPage` uses one, and its window's pixel ratio; what was copied onto it, kept. Its
 * page in view or hidden (a background tab), `show` and `hide` turning it, as the browser does.
 */
function fakeScreen(ratio = 1, visibility: DocumentVisibilityState = 'visible') {
  const scratches: { width: number; height: number }[] = [];
  const copies: { image: unknown; x: number; y: number; width: number; height: number }[] = [];
  let context = true;
  const listeners = new Set<() => void>();
  const doc = {
    defaultView: { devicePixelRatio: ratio },
    visibilityState: visibility,
    addEventListener: (type: string, listener: () => void) => {
      expect(type).toBe('visibilitychange');
      listeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      expect(type).toBe('visibilitychange');
      listeners.delete(listener);
    },
    createElement: (tag: string) => {
      expect(tag).toBe('canvas');
      const scratch = { width: 300, height: 150 };
      scratches.push(scratch);
      return scratch;
    },
  };
  const turn = (to: DocumentVisibilityState) => {
    doc.visibilityState = to;
    for (const listener of [...listeners]) listener();
  };
  const canvas = {
    width: 300,
    height: 150,
    ownerDocument: doc,
    getContext: (kind: string) => {
      expect(kind).toBe('2d');
      return context
        ? {
            drawImage: (image: unknown, x: number, y: number) =>
              copies.push({ image, x, y, width: canvas.width, height: canvas.height }),
          }
        : null;
    },
  };
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    scratches,
    copies,
    noContext: () => {
      context = false;
    },
    show: () => turn('visible'),
    hide: () => turn('hidden'),
    /** How many listen for the page's visibility now. */
    listening: () => listeners.size,
  };
}

/** A size, in device pixels. */
interface Size {
  width: number;
  height: number;
}

/**
 * One draw PDF.js was asked for: its parameters, the size of the canvas it drew on then, whether
 * it was cancelled, and its ending.
 */
interface Render {
  params: { canvas: Size; viewport: Size };
  size: Size;
  cancelled: boolean;
  finish: () => void;
}

interface DeckOptions {
  /** Each page's size at scale 1, in points. */
  width?: number;
  height?: number;
  /** Each page's text, as PDF.js reads it. */
  items?: unknown[];
  /** Its draws finish at once, wait until `finish`ed or cancelled, or fail. */
  draws?: 'finish' | 'waits' | 'fail';
  /** Its pages come, or fail to. */
  page?: 'opens' | 'fails';
  /** Its text comes, fails to, or waits until `read`. */
  text?: 'reads' | 'fails' | 'waits';
}

/**
 * A stand-in open deck: its pages asked for, each draw PDF.js was asked for, each text read still
 * waiting, and how many times a page was let go (`cleanup`).
 */
function fakeDeck({
  width = 1600,
  height = 900,
  items = [],
  draws = 'finish',
  page = 'opens',
  text = 'reads',
}: DeckOptions = {}) {
  const renders: Render[] = [];
  const asked: number[] = [];
  const reads: (() => void)[] = [];
  const counts = { cleaned: 0 };
  const proxy = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    }),
    render: (params: Render['params']) => {
      let finish = () => {};
      let fail: (error: Error) => void = () => {};
      const promise = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const size = { width: params.canvas.width, height: params.canvas.height };
      const render: Render = { params, size, cancelled: false, finish };
      renders.push(render);
      if (draws === 'finish') finish();
      if (draws === 'fail') fail(new Error('Invalid PDF structure.'));
      return {
        promise,
        cancel: () => {
          render.cancelled = true;
          fail(new Error('Rendering cancelled, page 4'));
        },
      };
    },
    getTextContent: () =>
      text === 'reads'
        ? Promise.resolve({ items })
        : text === 'waits'
          ? new Promise((resolve) => reads.push(() => resolve({ items })))
          : Promise.reject(new Error('no text')),
    cleanup: () => {
      counts.cleaned += 1;
      return true;
    },
  };
  const pdf = {
    getPage: (n: number) => {
      asked.push(n);
      return page === 'opens' ? Promise.resolve(proxy) : Promise.reject(new Error('bad page'));
    },
  } as unknown as Pick<PDFDocumentProxy, 'getPage'>;
  return { pdf, renders, asked, reads, counts };
}

/** A run of text as PDF.js reads one. */
const run = (str: string, hasEOL = false) => ({ str, hasEOL, dir: 'ltr', transform: [] });
/** Every promise ready to settle, settled. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('drawPage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws the page as large as fits the box, at the screen’s pixel ratio, then copies it whole', async () => {
    const { pdf, renders, asked } = fakeDeck();
    const screen = fakeScreen(2);
    // The class page's 420 px slide, 16:9, on a screen of 2 device pixels per CSS pixel.
    expect(await drawPage(pdf, 4, screen.canvas, { width: 420, height: 236.25 })).toEqual({
      kind: 'drawn',
      text: '',
    });
    expect(asked).toEqual([4]);
    expect(renders).toHaveLength(1);
    // Drawn first on a canvas of its own, 840 × 473 device pixels…
    const scratch = screen.scratches[0];
    expect(renders[0]?.params.canvas).toBe(scratch);
    expect(renders[0]?.params.viewport).toEqual({ width: 840, height: 472.5 });
    expect(renders[0]?.size).toEqual({ width: 840, height: 473 });
    // …then copied whole onto the page's canvas, sized to it.
    expect(screen.copies).toEqual([{ image: scratch, x: 0, y: 0, width: 840, height: 473 }]);
  });

  it('lets go of what a draw held, however it ended: its own canvas emptied, the page cleaned up', async () => {
    const box = { width: 420, height: 236 };
    const drawn = fakeDeck();
    const screen = fakeScreen();
    await drawPage(drawn.pdf, 4, screen.canvas, box);
    expect(screen.scratches[0]).toEqual({ width: 0, height: 0 });
    expect(drawn.counts.cleaned).toBe(1);
    // Cancelled mid-draw by a later one.
    const waiting = fakeDeck({ draws: 'waits' });
    const turning = fakeScreen();
    const first = drawPage(waiting.pdf, 4, turning.canvas, box);
    await settle();
    const second = drawPage(waiting.pdf, 5, turning.canvas, box);
    await settle();
    expect(await first).toEqual({ kind: 'cancelled' });
    expect(turning.scratches[0]).toEqual({ width: 0, height: 0 });
    waiting.renders[1]?.finish();
    await second;
    expect(waiting.counts.cleaned).toBe(2);
    // A draw PDF.js couldn't make.
    const failing = fakeDeck({ draws: 'fail' });
    const broken = fakeScreen();
    expect(await drawPage(failing.pdf, 4, broken.canvas, box)).toEqual({ kind: 'undrawn' });
    expect(broken.scratches[0]).toEqual({ width: 0, height: 0 });
    expect(failing.counts.cleaned).toBe(1);
  });

  it('draws nothing for a page whose size is no number, or a box that isn’t one: the canvas kept', async () => {
    // A crafted file's page box, read by PDF.js as Infinity.
    const endless = fakeDeck({ width: Infinity });
    const screen = fakeScreen();
    const box = { width: 420, height: 236 };
    expect(await drawPage(endless.pdf, 1, screen.canvas, box)).toEqual({ kind: 'undrawn' });
    const plain = fakeDeck();
    expect(await drawPage(plain.pdf, 1, screen.canvas, { width: NaN, height: 236 })).toEqual({
      kind: 'undrawn',
    });
    expect(endless.renders).toEqual([]);
    expect(plain.renders).toEqual([]);
    expect(screen.scratches).toEqual([]);
    expect(screen.copies).toEqual([]);
    expect(screen.canvas).toMatchObject({ width: 300, height: 150 });
  });

  it('keeps a page’s shape: one taller than the box fits by its height', async () => {
    // A letter-sized page, 612 × 792 points, in Present's 1351 × 760 frame.
    const { pdf, renders } = fakeDeck({ width: 612, height: 792 });
    const screen = fakeScreen(1);
    await drawPage(pdf, 1, screen.canvas, { width: 1351, height: 760 });
    expect(renders[0]?.params.viewport.height).toBeCloseTo(760);
    expect(renders[0]?.params.viewport.width).toBeCloseTo((612 * 760) / 792);
    expect(screen.copies[0]).toMatchObject({ width: 587, height: 760 });
  });

  it('reads the pixel ratio from the canvas’s own window, one with none at 1', async () => {
    const { pdf, renders } = fakeDeck();
    const screen = fakeScreen(1.25);
    await drawPage(pdf, 1, screen.canvas, { width: 800, height: 450 });
    expect(renders[0]?.params.viewport).toEqual({ width: 1000, height: 562.5 });
    const bare = fakeScreen();
    (bare.canvas.ownerDocument as { defaultView: unknown }).defaultView = null;
    await drawPage(pdf, 1, bare.canvas, { width: 800, height: 450 });
    expect(renders[1]?.params.viewport).toEqual({ width: 800, height: 450 });
  });

  it('answers the page’s text for its label: the runs joined, a line’s end a space', async () => {
    const items = [
      run('Factoring quadratics', true),
      run('x² − 7x + 12 = 0', true),
      { type: 'beginMarkedContent', id: 'm1' },
      run('(x − 3)'),
      run('(x − 4) = 0', true),
      run('  The roots  '),
    ];
    const { pdf } = fakeDeck({ items });
    expect(await drawPage(pdf, 4, fakeScreen().canvas, { width: 420, height: 236 })).toEqual({
      kind: 'drawn',
      text: 'Factoring quadratics x² − 7x + 12 = 0 (x − 3)(x − 4) = 0 The roots',
    });
  });

  it('draws a page with no text, or text PDF.js can’t read, answering none', async () => {
    const empty = fakeDeck({ items: [run(' '), run('', true)] });
    expect(await drawPage(empty.pdf, 1, fakeScreen().canvas, { width: 420, height: 236 })).toEqual({
      kind: 'drawn',
      text: '',
    });
    const unread = fakeDeck({ text: 'fails' });
    const screen = fakeScreen();
    expect(await drawPage(unread.pdf, 1, screen.canvas, { width: 420, height: 236 })).toEqual({
      kind: 'drawn',
      text: '',
    });
    expect(screen.copies).toHaveLength(1);
  });

  it('cancels the draw still running on the same canvas: the last page asked for is the one shown', async () => {
    const waiting = fakeDeck({ draws: 'waits' });
    const screen = fakeScreen();
    const box = { width: 420, height: 236 };
    const first = drawPage(waiting.pdf, 4, screen.canvas, box);
    await settle();
    expect(waiting.renders).toHaveLength(1);
    const second = drawPage(waiting.pdf, 5, screen.canvas, box);
    await settle();
    expect(waiting.renders).toHaveLength(2);
    expect(waiting.renders[0]?.cancelled).toBe(true);
    expect(await first).toEqual({ kind: 'cancelled' });
    waiting.renders[1]?.finish();
    expect(await second).toEqual({ kind: 'drawn', text: '' });
    expect(waiting.renders[1]?.cancelled).toBe(false);
    // Only the second page reached the canvas.
    expect(screen.copies).toHaveLength(1);
    expect(screen.copies[0]?.image).toBe(screen.scratches[1]);
  });

  it('never copies a draw stopped while its text was read, even one a later draw finished before', async () => {
    const reading = fakeDeck({ text: 'waits' });
    const screen = fakeScreen();
    const box = { width: 420, height: 236 };
    // Page 4 drawn, its text still on its way…
    const first = drawPage(reading.pdf, 4, screen.canvas, box);
    await settle();
    expect(reading.reads).toHaveLength(1);
    // …when page 5 is asked for, and finishes first.
    const second = drawPage(reading.pdf, 5, screen.canvas, box);
    await settle();
    reading.reads[1]?.();
    expect(await second).toEqual({ kind: 'drawn', text: '' });
    reading.reads[0]?.();
    expect(await first).toEqual({ kind: 'cancelled' });
    expect(screen.copies).toHaveLength(1);
    expect(screen.copies[0]?.image).toBe(screen.scratches[1]);
  });

  it('cancels a draw still asking for its page before it draws anything', async () => {
    const { pdf, renders } = fakeDeck();
    const screen = fakeScreen();
    const box = { width: 420, height: 236 };
    const first = drawPage(pdf, 4, screen.canvas, box);
    const second = drawPage(pdf, 5, screen.canvas, box);
    expect(await first).toEqual({ kind: 'cancelled' });
    expect(await second).toEqual({ kind: 'drawn', text: '' });
    expect(renders).toHaveLength(1);
    expect(screen.copies).toHaveLength(1);
  });

  it('leaves a draw on another canvas running', async () => {
    const waiting = fakeDeck({ draws: 'waits' });
    const one = fakeScreen();
    const two = fakeScreen();
    const box = { width: 420, height: 236 };
    const first = drawPage(waiting.pdf, 4, one.canvas, box);
    const second = drawPage(waiting.pdf, 4, two.canvas, box);
    await settle();
    expect(waiting.renders).toHaveLength(2);
    waiting.renders.forEach((r) => r.finish());
    expect(await first).toEqual({ kind: 'drawn', text: '' });
    expect(await second).toEqual({ kind: 'drawn', text: '' });
    expect(one.copies).toHaveLength(1);
    expect(two.copies).toHaveLength(1);
  });

  it('stops at its signal (the page going), its draw cancelled and nothing copied', async () => {
    const waiting = fakeDeck({ draws: 'waits' });
    const screen = fakeScreen();
    const going = new AbortController();
    const draw = drawPage(waiting.pdf, 4, screen.canvas, { width: 420, height: 236 }, going.signal);
    await settle();
    expect(waiting.renders).toHaveLength(1);
    going.abort();
    expect(await draw).toEqual({ kind: 'cancelled' });
    expect(waiting.renders[0]?.cancelled).toBe(true);
    expect(screen.copies).toEqual([]);
    // Stopped before it began: nothing drawn at all.
    const { pdf, renders } = fakeDeck();
    const gone = new AbortController();
    gone.abort();
    expect(await drawPage(pdf, 4, screen.canvas, { width: 420, height: 236 }, gone.signal)).toEqual(
      {
        kind: 'cancelled',
      },
    );
    expect(renders).toEqual([]);
    expect(screen.copies).toEqual([]);
  });

  it('answers undrawn when PDF.js can’t draw it, the canvas left as it was', async () => {
    const screen = fakeScreen();
    const box = { width: 420, height: 236 };
    const page = fakeDeck({ page: 'fails' });
    expect(await drawPage(page.pdf, 4, screen.canvas, box)).toEqual({ kind: 'undrawn' });
    const draw = fakeDeck({ draws: 'fail' });
    expect(await drawPage(draw.pdf, 4, screen.canvas, box)).toEqual({ kind: 'undrawn' });
    expect(screen.copies).toEqual([]);
    expect(screen.canvas.width).toBe(300);
    // A canvas with no 2D drawing to give.
    const plain = fakeDeck();
    screen.noContext();
    expect(await drawPage(plain.pdf, 4, screen.canvas, box)).toEqual({ kind: 'undrawn' });
    expect(screen.canvas.width).toBe(300);
  });

  it('answers undrawn once PDF.js gives no answer for 20 s, never a moment before: its page, its draw or its text', async () => {
    // A worker that stops answering after the deck opened (#416's review): its draw would
    // otherwise never end, and the slide stay on Loading… or the page before it, unsaid.
    vi.useFakeTimers();
    const box = { width: 420, height: 236 };
    const hung = {
      getPage: () => new Promise(() => {}),
    } as unknown as Pick<PDFDocumentProxy, 'getPage'>;
    const drawing = fakeDeck({ draws: 'waits' });
    const reading = fakeDeck({ text: 'waits' });
    for (const pdf of [hung, drawing.pdf, reading.pdf]) {
      const screen = fakeScreen();
      let end: unknown;
      void drawPage(pdf, 4, screen.canvas, box).then((e) => (end = e));
      await vi.advanceTimersByTimeAsync(20_000 - 1);
      expect(end).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      // Said apart from a page PDF.js failed to draw: Try again then opens the deck again.
      expect(end).toEqual({ kind: 'undrawn', unanswered: true });
      expect(screen.copies).toEqual([]);
      expect(screen.canvas).toMatchObject({ width: 300, height: 150 });
    }
    // The draw PDF.js never finished is cancelled, and what it held let go.
    expect(drawing.renders[0]?.cancelled).toBe(true);
    expect(drawing.counts.cleaned).toBe(1);
    expect(reading.counts.cleaned).toBe(1);
  });

  it('counts its 20 s only while the page is in view, since PDF.js draws on animation frames, which a hidden page never runs', async () => {
    // Santa's review: a page turned from Present's tab while the class page's tab was hidden, or a
    // deck that opened in a hidden tab, waited there for a frame; at 20 s it was said not drawn, and
    // its Try again downloaded the whole deck again.
    vi.useFakeTimers();
    const box = { width: 420, height: 236 };
    const drawing = fakeDeck({ draws: 'waits' });
    const screen = fakeScreen(1, 'hidden');
    let end: unknown;
    void drawPage(drawing.pdf, 4, screen.canvas, box).then((e) => (end = e));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(end).toBeUndefined();
    expect(drawing.renders[0]?.cancelled).toBe(false);
    // In view: its 20 s start; hidden again midway, the time hidden doesn't count either.
    screen.show();
    await vi.advanceTimersByTimeAsync(12_000);
    screen.hide();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(end).toBeUndefined();
    screen.show();
    await vi.advanceTimersByTimeAsync(8_000 - 1);
    expect(end).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(end).toEqual({ kind: 'undrawn', unanswered: true });
    expect(drawing.renders[0]?.cancelled).toBe(true);
    expect(screen.listening()).toBe(0);
  });

  it('draws a page that waited in a hidden page once its frames come, and keeps no clock or listener after', async () => {
    vi.useFakeTimers();
    const box = { width: 420, height: 236 };
    const drawing = fakeDeck({ draws: 'waits' });
    const screen = fakeScreen(1, 'hidden');
    const drawn = drawPage(drawing.pdf, 4, screen.canvas, box);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    screen.show();
    await vi.advanceTimersByTimeAsync(3_000);
    drawing.renders[0]?.finish();
    expect(await drawn).toEqual({ kind: 'drawn', text: '' });
    expect(screen.copies).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.listening()).toBe(0);
  });

  it('keeps no clock for a draw that ended, however it ended', async () => {
    vi.useFakeTimers();
    const box = { width: 420, height: 236 };
    await drawPage(fakeDeck().pdf, 4, fakeScreen().canvas, box);
    await drawPage(fakeDeck({ draws: 'fail' }).pdf, 4, fakeScreen().canvas, box);
    const waiting = fakeDeck({ draws: 'waits' });
    const screen = fakeScreen();
    const first = drawPage(waiting.pdf, 4, screen.canvas, box);
    await vi.advanceTimersByTimeAsync(0);
    void drawPage(waiting.pdf, 5, screen.canvas, box);
    expect(await first).toEqual({ kind: 'cancelled' });
    // The second still runs, its own clock alone left.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stops a draw still waiting for PDF.js at once: a later draw, or its signal', async () => {
    vi.useFakeTimers();
    const box = { width: 420, height: 236 };
    const hung = {
      getPage: () => new Promise(() => {}),
    } as unknown as Pick<PDFDocumentProxy, 'getPage'>;
    const screen = fakeScreen();
    const going = new AbortController();
    const first = drawPage(hung, 4, screen.canvas, box, going.signal);
    going.abort();
    expect(await first).toEqual({ kind: 'cancelled' });
    const second = drawPage(hung, 4, screen.canvas, box);
    void drawPage(hung, 5, screen.canvas, box);
    expect(await second).toEqual({ kind: 'cancelled' });
  });
});

describe('the module', () => {
  const source = readFileSync(fileURLToPath(new URL('./presenter.ts', import.meta.url)), 'utf8');

  it('imports PDF.js’s types alone, so a page that imports it loads no PDF.js', () => {
    const imports = [...source.matchAll(/^import (type )?[^;]*?from '([^']+)';/gms)];
    const pdfjs = imports.filter(([, , from]) => from?.startsWith('pdfjs-dist'));
    expect(pdfjs).toHaveLength(1);
    expect(pdfjs[0]?.[1]).toBe('type ');
    expect(source).not.toMatch(/import\(\s*'pdfjs-dist/);
  });
});
