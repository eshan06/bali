'use client';

import type { Deck, FeedEvent, SessionSnapshot, Slide } from '@bali/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from './api-client';
import { type DeckFailure, loadDeck, type OpenDeck, watchStall } from './deck-pdf';
import { readDecks } from './decks';
import { type Failure, LONGEST_WAIT_MS, POLL_EVERY_MS } from './live-question';
import {
  newer,
  NOTHING_SHOWN,
  readyDecks,
  type Shown,
  shownIn,
  showSlide,
  slideAfter,
  type SlideAnswer,
  type SlideAttempt,
  slideAttemptFor,
  type SlideChange,
  turned,
} from './presenter';
import { keepUnanswered } from './session-controls';
import { useApi } from './use-api';

/*
 * The class page's slide (Phase 7, M6 part 2b-1; ARCHITECTURE, "Live lesson", decisions 4, 6 and
 * 8): what a running session shows, its deck loaded, and its teacher's changes, held for one
 * session through 2a's logic (`presenter.ts`). Tested and holding no words: the slide card (2b-2)
 * says each state as LessonSlide and LessonSlideStates draw it.
 */

/**
 * Why the shown deck isn't open: it didn't load (a download stopped as stalled included), its bytes
 * aren't the ones Bali checked (`mismatch`), or PDF.js didn't open them (`unopened`, most often a
 * page left open while the portal was updated).
 */
export type DeckUnopened = 'unloaded' | 'mismatch' | 'unopened';

/** Where the shown deck stands on this page: loading, open, or why not. */
export type DeckState =
  { kind: 'loading' } | { kind: 'open'; deck: OpenDeck } | { kind: 'failed'; why: DeckUnopened };

/**
 * What a slide change left to say: it didn't go through (no answer, or a refusal: Try again sends
 * it again), the session ended first, or the deck is no ready deck of the teacher's any more.
 */
export type ChangeSaid = 'failed' | 'over' | 'gone';

/** What the last slide change left to say, and that change: said where it was made. */
export interface Said {
  why: ChangeSaid;
  change: SlideChange;
}

/** The class page's slide, held for one session. */
export interface SlideLesson {
  /** What the session shows, as last heard: null for nothing. */
  slide: Slide | null;
  /** Its deck's title, once the teacher's decks are read. */
  title: string | null;
  deck: DeckState;
  /** The slide change on its way, its button busy: every slide control holds until its answer. */
  changing: SlideChange | null;
  /** Said where its change was made: the card, Present, or under its deck in the side panel. */
  said: Said | null;
  /** Previous (−1) and Next (+1); nothing past either end. */
  turn: (by: -1 | 1) => void;
  /** Show a deck from its first page (the side panel's Show); true once it is on screen. */
  show: (deckId: string) => Promise<boolean>;
  /**
   * Stop showing; true once what the session shows now is on screen: Bali's answer, or the stream
   * showing it before an answer that gave up.
   */
  stop: () => Promise<boolean>;
  /** Try again: the last change, under its id while its answer never came. */
  again: () => void;
  /** Try again: the deck, loaded afresh. */
  reload: () => void;
}

/** How a deck that didn't open is said: its bytes changed, PDF.js didn't open it, or else. */
export const unopenedAs = (end: DeckFailure): DeckUnopened =>
  end.kind === 'mismatch' || end.kind === 'unopened' ? end.kind : 'unloaded';

/**
 * The shown deck, loaded under `stop` (`loadDeck`): open, or why not; null once `stop` stopped it
 * (the page moved on), a deck that opened as it was stopped closed. A download that goes
 * `STALL_MS` with nothing arriving is stopped too (`watchStall`), and is one that didn't load.
 */
export async function loadShown(
  api: Pick<ApiClient, 'get'>,
  slide: Pick<Slide, 'deckId' | 'sha256'>,
  stop: AbortController,
  { load = loadDeck, fetchImpl = fetch }: { load?: typeof loadDeck; fetchImpl?: typeof fetch } = {},
): Promise<DeckState | null> {
  let settled = false;
  let stalled = false;
  const watched = watchStall(() => {
    if (settled) return;
    stalled = true;
    stop.abort();
  }, fetchImpl);
  const end = await load(api, slide, { signal: stop.signal, fetchImpl: watched });
  settled = true;
  if (end.kind !== 'loaded') {
    return stalled || !stop.signal.aborted ? { kind: 'failed', why: unopenedAs(end) } : null;
  }
  if (!stop.signal.aborted) return { kind: 'open', deck: end.deck };
  void end.deck.close();
  return null;
}

/**
 * How long a read that got no answer waits before the next: 2 s, or a `429`'s `Retry-After`, from
 * 2 s to a minute, none or a date the minute (L5's rule, as the polls wait: `pollTagged`).
 */
export const waitAfter = ({ status, retryAfter }: Extract<Failure, { kind: 'failed' }>) =>
  status === 429
    ? Math.min(Math.max((retryAfter ?? Infinity) * 1000, POLL_EVERY_MS), LONGEST_WAIT_MS)
    : POLL_EVERY_MS;

/**
 * A slide change's answer: what the session shows now (this change, its replay, or a later one
 * from another tab), or what to say.
 */
export function changeEnd(answer: SlideAnswer): { shown: Shown } | { said: ChangeSaid } {
  if (answer.kind === 'shown') return { shown: { slide: answer.slide, eventId: answer.eventId } };
  return { said: answer.kind === 'over' || answer.kind === 'gone' ? answer.kind : 'failed' };
}

/**
 * The deck `slide` names, loaded (`loadShown`) for each deck shown and each Try again (`reload`),
 * and closed once another deck, or none, is shown, or the page goes; one that opened as the page
 * moved on is closed too. A page turn loads nothing. The class page's slide (`useSlide`) and the
 * student's (W5) alike.
 */
export function useShownDeck(
  api: Pick<ApiClient, 'get'>,
  slide: Pick<Slide, 'deckId' | 'sha256'> | null,
): { deck: DeckState; reload: () => void } {
  const deckId = slide?.deckId ?? null;
  const sha256 = slide?.sha256 ?? null;
  const [tries, setTries] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; state: DeckState } | null>(null);
  const key = `${deckId}:${sha256}:${tries}`;
  useEffect(() => {
    if (deckId === null || sha256 === null) return;
    const stop = new AbortController();
    let gone = false;
    let open: OpenDeck | null = null;
    void loadShown(api, { deckId, sha256 }, stop).then((state) => {
      // Opened as the page moved on: closed, never left with its worker running.
      if (gone && state?.kind === 'open') void state.deck.close();
      if (gone || state === null) return;
      if (state.kind === 'open') open = state.deck;
      setLoaded({ key, state });
    });
    return () => {
      gone = true;
      stop.abort();
      void open?.close();
      // Never handed back once closed, nor a failure said again: the same deck shown again, after
      // another or none, loads afresh under the same key (santa's review).
      setLoaded(null);
    };
  }, [api, deckId, sha256, key]);
  const reload = useCallback(() => setTries((n) => n + 1), []);
  return { deck: loaded?.key === key ? loaded.state : { kind: 'loading' }, reload };
}

type Held = { session: string | null; shown: Shown };

/**
 * What `sessionId` shows (null: none running), and changing it. Heard from the session's read, the
 * question's own (`useLiveQuestion`'s `snapshot`), so a slide shown before a reload is found; from
 * the stream (`onEvent`), so one shown in another tab is, a change it can't name reading the
 * session again (`reread`); and from this tab's own changes' answers: only ever a later change, by
 * the server's order (`newer`). Its deck loaded (`useShownDeck`) for each deck shown and each Try
 * again, closed once the session shows another, or none, or is gone; its title from the teacher's
 * decks, read while the deck shown isn't among them, again while Bali gives no answer
 * (`waitAfter`).
 */
export function useSlide(
  sessionId: string | null,
  snapshot: { session: string; snap: Pick<SessionSnapshot, 'presentation'> } | null,
  reread: () => void,
) {
  const api = useApi();
  const [held, setHeld] = useState<Held>({ session: null, shown: NOTHING_SHOWN });
  const now = useRef<Held>(held);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const decksNow = useRef<Deck[]>([]);
  const unanswered = useRef<SlideAttempt | null>(null);
  const last = useRef<SlideChange | null>(null);
  const sending = useRef(false);
  const [changing, setChanging] = useState<SlideChange | null>(null);
  const [said, setSaid] = useState<Said | null>(null);

  const put = useCallback((session: string, next: Shown) => {
    const shown = newer(now.current.shown, next);
    if (now.current.session !== session || shown === now.current.shown) return;
    now.current = { session, shown };
    setHeld(now.current);
  }, []);

  // A new session starts with nothing shown and nothing said, then takes what its read says: a
  // Show the last one refused is no line of this one's, though no change was ever heard in either
  // (santa's review).
  useEffect(() => {
    now.current = { session: sessionId, shown: NOTHING_SHOWN };
    setHeld(now.current);
    setSaid(null);
  }, [sessionId]);
  useEffect(() => {
    if (snapshot !== null) put(snapshot.session, shownIn(snapshot.snap));
  }, [snapshot, put]);

  const shown = held.session === sessionId ? held.shown : NOTHING_SHOWN;
  const deckId = shown.slide?.deckId ?? null;

  const named = decks?.some((d) => d.id === deckId) ?? false;
  useEffect(() => {
    if (deckId === null || named) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      const answer = await readDecks(api);
      if (gone) return;
      if (answer.kind === 'read') {
        decksNow.current = answer.decks;
        setDecks(answer.decks);
      } else if (answer.kind === 'failed') timer = setTimeout(() => void read(), waitAfter(answer));
    };
    void read();
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [api, deckId, named]);

  const onEvent = useCallback(
    (e: FeedEvent) => {
      const { session, shown: at } = now.current;
      if (session === null || e.type !== 'slide_shown') return;
      const next = slideAfter(at, e, readyDecks(decksNow.current));
      if (next === 'unknown') reread();
      else put(session, next);
    },
    [put, reread],
  );

  const { deck, reload } = useShownDeck(api, shown.slide);

  // One change at a time: one whose answer never came is resent under its id (2a).
  const change = useCallback(
    async (to: SlideChange): Promise<boolean> => {
      const { session, shown: at } = now.current;
      if (session === null || sending.current) return false;
      sending.current = true;
      last.current = to;
      setChanging(to);
      setSaid(null);
      const attempt = slideAttemptFor(unanswered.current, session, at.eventId, to);
      const answer = await showSlide(api, attempt);
      sending.current = false;
      setChanging(null);
      if (now.current.session !== session) return false;
      unanswered.current = keepUnanswered(attempt, answer);
      const end = changeEnd(answer);
      if ('shown' in end) {
        put(session, end.shown);
        return true;
      }
      // Its answer gave up after the stream showed it, or a later change: the truth is on screen,
      // as when its answer says so.
      const heard = newer(now.current.shown, { slide: null, eventId: attempt.eventId });
      if (end.said === 'failed' && heard === now.current.shown) {
        unanswered.current = null;
        return true;
      }
      setSaid({ why: end.said, change: to });
      // Gone: the session read again, for what it shows now.
      if (end.said === 'gone') reread();
      return false;
    },
    [api, put, reread],
  );
  // A change heard since settles what the last one said: one whose answer never came landed, or
  // another tab's did, or the session read after a deck gone says what it shows now. Either way
  // the truth is on screen: the line goes, and the next press is a fresh one.
  useEffect(() => {
    unanswered.current = null;
    setSaid(null);
  }, [shown.eventId]);
  // One for the page's life, so the card's keys aren't listened for again at each render.
  const turn = useCallback(
    (by: -1 | 1) => {
      const at = now.current.shown.slide;
      const to = at && turned(at, by);
      if (to) void change(to);
    },
    [change],
  );

  const slides: SlideLesson = {
    slide: shown.slide,
    title: decks?.find((d) => d.id === deckId)?.title ?? null,
    deck,
    changing,
    said,
    turn,
    show: (deck) => change({ deckId: deck, page: 1 }),
    stop: () => change({ deckId: null, page: null }),
    again: () => {
      if (last.current) void change(last.current);
    },
    reload,
  };
  return { slides, onEvent };
}
