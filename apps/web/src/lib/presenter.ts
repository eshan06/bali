import type { Deck, FeedEvent, SessionSnapshot, Slide, SlideResponse } from '@bali/shared';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { type ApiClient, ApiError } from './api-client';
import { eventIdAfter } from './event-id';
import { type Failure, failureOf } from './live-question';

/*
 * The presenter's logic (Phase 7, M6 part 2a; ARCHITECTURE, "Live lesson", decisions 4, 6
 * and 8): what a running session shows, as the class page and Present hold it, changed by its
 * teacher a page at a time; the decks a teacher can show; and a page of an open deck
 * (`loadDeck`) drawn on a canvas. Tested and holding no words: the screens say each answer as
 * the approved canvas does (2b, 2c).
 */

/**
 * What a session shows, as this tab last heard it: the page (null: nothing), and the id of the
 * slide change that set it (null: none heard yet).
 */
export interface Shown {
  slide: Slide | null;
  eventId: string | null;
}

/** Nothing shown, and no slide change heard. */
export const NOTHING_SHOWN: Shown = { slide: null, eventId: null };

/** A UUIDv7 as the server orders them, by their bytes: their hex, lower-cased (#319). */
const key = (id: string) => id.toLowerCase();

/** Whether `id` names a slide change made after the one `held` names (none held: any). */
const after = (id: string, held: string | null) => held === null || key(id) > key(held);

/**
 * `next` if the slide change that set it came after the one `held` names, else `held`: the
 * server's own order (M3a: a change applies only when its id sorts after the one held), so a
 * read or an answer landing after a later change never puts back an older page. One with no
 * change names none.
 */
export const newer = (held: Shown, next: Shown): Shown =>
  next.eventId !== null && after(next.eventId, held.eventId) ? next : held;

/**
 * What a session's snapshot (`GET /v1/sessions/{id}`, M3b) says it shows: none before its first
 * slide change, once it is not running by the server's clock, and from an older server.
 */
export const shownIn = (snapshot: Pick<SessionSnapshot, 'presentation'>): Shown =>
  snapshot.presentation
    ? { slide: snapshot.presentation.slide, eventId: snapshot.presentation.eventId }
    : NOTHING_SHOWN;

/**
 * What the session shows after a streamed event. A `slide_shown` (M3a; its `eventId` is the
 * slide change's) made after the change held sets it: the page its payload names, or nothing
 * once presenting stopped. The payload names the deck and the page alone, so the SHA-256 and the
 * page count come from the deck held or one of `decks`; a deck neither holds, or a payload of
 * another shape, is `'unknown'`, and the page reads the snapshot again (`shownIn`). Any other
 * event, or an older one (the stream's overlap brings some again), leaves it as it was.
 */
export function slideAfter(
  held: Shown,
  e: Pick<FeedEvent, 'type' | 'eventId' | 'payload'>,
  decks: readonly Pick<Deck, 'id' | 'sha256' | 'pageCount'>[] = [],
): Shown | 'unknown' {
  if (e.type !== 'slide_shown' || !after(e.eventId, held.eventId)) return held;
  const { deck_id: deckId, page } = (e.payload ?? {}) as Record<string, unknown>;
  if (deckId === null) return { slide: null, eventId: e.eventId };
  if (typeof deckId !== 'string' || typeof page !== 'number') return 'unknown';
  const listed = decks.find((d) => d.id === deckId);
  const facts =
    held.slide?.deckId === deckId
      ? held.slide
      : listed && listed.pageCount !== null
        ? { sha256: listed.sha256, pageCount: listed.pageCount }
        : null;
  if (facts === null) return 'unknown';
  const { sha256, pageCount } = facts;
  return { slide: { deckId, sha256, page, pageCount }, eventId: e.eventId };
}

/** The decks a teacher can show (`GET /v1/decks`'s): the ready ones, newest first, as listed. */
export const readyDecks = (decks: readonly Deck[]): Deck[] =>
  decks.filter((deck) => deck.status === 'ready');

/** A slide change: a page of a deck, or nothing (`deckId` null, `page` null) to stop presenting. */
export interface SlideChange {
  deckId: string | null;
  /** From 1 to the deck's page count; null with no deck. */
  page: number | null;
}

/**
 * The page `by` pages on from the one `slide` shows (Previous −1, Next +1), or null past either
 * end: no page comes before the first or after the last.
 */
export function turned(slide: Slide, by: number): SlideChange | null {
  const page = slide.page + by;
  return page >= 1 && page <= slide.pageCount ? { deckId: slide.deckId, page } : null;
}

/** One slide change: the session it is sent to, what it shows, and its `eventId`. */
export interface SlideAttempt extends SlideChange {
  sessionId: string;
  eventId: string;
}

/**
 * The attempt to send `change` to `sessionId` as. The last one sent whose answer never came may
 * have landed, so the same change for the same session resends it, under its id, answered by its
 * replay, while no later change is held: under one (another window's, heard since), it could only
 * replay that one, and the press would change nothing. Else a fresh one, its id minted after the
 * change the session holds (`held`) and after that unanswered one, however far behind this
 * computer's clock stands: a change applies only when its id sorts after the one held (M3a), so
 * the teacher's last press is the one shown.
 */
export function slideAttemptFor(
  unanswered: SlideAttempt | null,
  sessionId: string,
  held: string | null,
  change: SlideChange,
  now = Date.now(),
): SlideAttempt {
  const mine = unanswered?.sessionId === sessionId ? unanswered : null;
  const same = mine?.deckId === change.deckId && mine.page === change.page;
  if (mine && same && (held === null || !after(held, mine.eventId))) return mine;
  const latest = [held, mine?.eventId]
    .flatMap((id) => (id ? [key(id)] : []))
    .sort()
    .at(-1);
  return { sessionId, ...change, eventId: eventIdAfter(latest ?? null, now) };
}

/**
 * A slide change's answer. `shown`: what the session shows now, and the id of the change that
 * set it: this one, its replay, or a later one from another tab under which this one changed
 * nothing (M3a's order). `over`: the session ended first (`409 session_not_running`), so nothing
 * changed. `gone`: the deck is no ready deck of the teacher's (removed meanwhile, `404
 * deck_not_found`; or `409 deck_not_ready`, `409 deck_rejected`). Else why not: a failure is
 * resent under its id (`keepUnanswered`), a refusal never.
 */
export type SlideAnswer =
  | { kind: 'shown'; slide: Slide | null; eventId: string }
  | { kind: 'over' }
  | { kind: 'gone' }
  | Failure;

/** The refusals that say a deck can't be shown. */
const GONE: readonly string[] = ['deck_not_found', 'deck_not_ready', 'deck_rejected'];

/**
 * How long a slide change waits for its whole answer before it fails as no answer, for Try again
 * to resend it under its id: as a student's answer does (#407's review), and about what a poll
 * waits (`POLL_TIMEOUT_MS`, #334). A half-open connection never fails by itself, and a page turned
 * in front of a class can't wait minutes for the browser to give up.
 */
export const SLIDE_TIMEOUT_MS = 10_000;

/** Send `attempt` (`POST /v1/sessions/{id}/slide`): show its page, or stop presenting. */
export async function showSlide(
  api: Pick<ApiClient, 'post'>,
  attempt: SlideAttempt,
): Promise<SlideAnswer> {
  const { sessionId, ...body } = attempt;
  try {
    const path = `/v1/sessions/${sessionId}/slide`;
    const res = await api.post<SlideResponse>(path, body, SLIDE_TIMEOUT_MS);
    return { kind: 'shown', slide: res.slide, eventId: res.eventId };
  } catch (e) {
    if (e instanceof ApiError && e.reason === 'session_not_running') return { kind: 'over' };
    if (e instanceof ApiError && GONE.includes(e.reason ?? '')) return { kind: 'gone' };
    return failureOf(e);
  }
}

/** Where a page is drawn: a box of CSS pixels it fits inside, its shape kept. */
export interface Box {
  width: number;
  height: number;
}

/** How a draw ended. On any but `drawn`, the canvas still shows what it showed. */
export type DrawEnd =
  /** Drawn, and the page's text for the slide's label: empty for a page with none (decision 8). */
  | { kind: 'drawn'; text: string }
  /** A later draw on the same canvas, or `signal`, stopped it. */
  | { kind: 'cancelled' }
  /** PDF.js couldn't draw it. */
  | { kind: 'undrawn' };

/** The stop of the draw running on each canvas: the next draw there calls it. */
const drawing = new WeakMap<HTMLCanvasElement, () => void>();

/**
 * Page `page` of an open deck, drawn on `canvas` as large as fits in `box`, its shape kept, at
 * the screen's pixel ratio (the canvas's own window's), so it is sharp on a laptop's screen and a
 * projector alike. Drawn first on a canvas of its own, then copied whole, so a page turning never
 * shows a blank one. A draw still running on the same canvas is cancelled, so the last page asked
 * for is the one shown, never an older one that finished later; `signal` stops it too (the page
 * going). Its text comes back for the slide's label, empty when PDF.js reads none. What a draw
 * holds is let go once it ends, as PDF.js's own viewer lets go of pages it no longer shows: its
 * own canvas, emptied (Safari caps a tab's canvases), and the page's drawing instructions and
 * decoded images (`cleanup`), so paging through a deck of 200 photos never holds them all until
 * the deck closes; drawing the page again reads them again.
 */
export async function drawPage(
  pdf: Pick<PDFDocumentProxy, 'getPage'>,
  page: number,
  canvas: HTMLCanvasElement,
  box: Box,
  signal?: AbortSignal,
): Promise<DrawEnd> {
  drawing.get(canvas)?.();
  let stopped = false;
  let task: RenderTask | null = null;
  let proxy: PDFPageProxy | null = null;
  let scratch: HTMLCanvasElement | null = null;
  const stop = () => {
    stopped = true;
    task?.cancel();
  };
  drawing.set(canvas, stop);
  signal?.addEventListener('abort', stop);
  if (signal?.aborted) stop();
  try {
    proxy = await pdf.getPage(page);
    if (stopped) return { kind: 'cancelled' };
    const ratio = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const whole = proxy.getViewport({ scale: 1 });
    const scale = Math.min(box.width / whole.width, box.height / whole.height) * ratio;
    const viewport = proxy.getViewport({ scale });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    // A page whose size is no number (a crafted file's, read as Infinity), or a box that isn't
    // one: nothing to draw, and the canvas kept as it was.
    if (!Number.isFinite(width) || !Number.isFinite(height)) return { kind: 'undrawn' };
    scratch = canvas.ownerDocument.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    task = proxy.render({ canvas: scratch, viewport });
    const [, text] = await Promise.all([task.promise, textOf(proxy)]);
    const context = canvas.getContext('2d');
    if (stopped) return { kind: 'cancelled' };
    if (!context) return { kind: 'undrawn' };
    canvas.width = width;
    canvas.height = height;
    context.drawImage(scratch, 0, 0);
    return { kind: 'drawn', text };
  } catch {
    return stopped ? { kind: 'cancelled' } : { kind: 'undrawn' };
  } finally {
    // PDF.js waits while a draw of the page still runs, on this canvas or another.
    proxy?.cleanup();
    if (scratch) {
      scratch.width = 0;
      scratch.height = 0;
    }
    signal?.removeEventListener('abort', stop);
    if (drawing.get(canvas) === stop) drawing.delete(canvas);
  }
}

/**
 * A page's text as PDF.js reads it, its runs joined, a line's end a space; '' for none, or for a
 * read that failed.
 */
async function textOf(page: Pick<PDFPageProxy, 'getTextContent'>): Promise<string> {
  try {
    const { items } = await page.getTextContent();
    return items
      .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? ' ' : ''}` : ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}
