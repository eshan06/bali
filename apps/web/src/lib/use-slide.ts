'use client';

import type { Deck, FeedEvent, SessionSnapshot, Slide } from '@bali/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from './api-client';
import { type DeckFailure, loadDeck, type OpenDeck, watchStall } from './deck-pdf';
import { readDecks } from './decks';
import { POLL_EVERY_MS } from './live-question';
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

/** The class page's slide, held for one session. */
export interface SlideLesson {
  /** What the session shows, as last heard: null for nothing. */
  slide: Slide | null;
  /** Its deck's title, once the teacher's decks are read. */
  title: string | null;
  deck: DeckState;
  /** A slide change on its way: every slide control holds until it is answered. */
  changing: boolean;
  said: ChangeSaid | null;
  /** Previous (−1) and Next (+1); nothing past either end. */
  turn: (by: -1 | 1) => void;
  /** Stop showing; true once Bali answered with what the session shows now. */
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
 * A slide change's answer: what the session shows now (this change, its replay, or a later one
 * from another tab), or what to say.
 */
export function changeEnd(answer: SlideAnswer): { shown: Shown } | { said: ChangeSaid } {
  if (answer.kind === 'shown') return { shown: { slide: answer.slide, eventId: answer.eventId } };
  return { said: answer.kind === 'over' || answer.kind === 'gone' ? answer.kind : 'failed' };
}

type Held = { session: string | null; shown: Shown };

/**
 * What `sessionId` shows (null: none running), and changing it. Heard from the session's read, the
 * question's own (`useLiveQuestion`'s `snapshot`), so a slide shown before a reload is found; from
 * the stream (`onEvent`), so one shown in another tab is, a change it can't name reading the
 * session again (`reread`); and from this tab's own changes' answers: only ever a later change, by
 * the server's order (`newer`). Its deck loaded (`loadShown`) for each deck shown and each Try
 * again, closed once the session shows another, or none, or is gone; its title from the teacher's
 * decks, read while the deck shown isn't among them, again every 2 s while Bali gives no answer.
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
  const [tries, setTries] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; state: DeckState } | null>(null);
  const unanswered = useRef<SlideAttempt | null>(null);
  const last = useRef<SlideChange | null>(null);
  const sending = useRef(false);
  const [changing, setChanging] = useState(false);
  const [said, setSaid] = useState<ChangeSaid | null>(null);

  const put = useCallback((session: string, next: Shown) => {
    const shown = newer(now.current.shown, next);
    if (now.current.session !== session || shown === now.current.shown) return;
    now.current = { session, shown };
    setHeld(now.current);
  }, []);

  // A new session starts with nothing shown, then takes what its read says.
  useEffect(() => {
    now.current = { session: sessionId, shown: NOTHING_SHOWN };
    setHeld(now.current);
  }, [sessionId]);
  useEffect(() => {
    if (snapshot !== null) put(snapshot.session, shownIn(snapshot.snap));
  }, [snapshot, put]);

  const shown = held.session === sessionId ? held.shown : NOTHING_SHOWN;
  const deckId = shown.slide?.deckId ?? null;
  const sha256 = shown.slide?.sha256 ?? null;

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
      } else if (answer.kind === 'failed') timer = setTimeout(() => void read(), POLL_EVERY_MS);
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
    };
  }, [api, deckId, sha256, key]);

  // One change at a time: one whose answer never came is resent under its id (2a).
  const change = useCallback(
    async (to: SlideChange): Promise<boolean> => {
      const { session, shown: at } = now.current;
      if (session === null || sending.current) return false;
      sending.current = true;
      last.current = to;
      setChanging(true);
      setSaid(null);
      const attempt = slideAttemptFor(unanswered.current, session, at.eventId, to);
      const answer = await showSlide(api, attempt);
      sending.current = false;
      setChanging(false);
      if (now.current.session !== session) return false;
      unanswered.current = keepUnanswered(attempt, answer);
      const end = changeEnd(answer);
      if ('shown' in end) {
        put(session, end.shown);
        return true;
      }
      setSaid(end.said);
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
    deck: loaded?.key === key ? loaded.state : { kind: 'loading' },
    changing,
    said,
    turn,
    stop: () => change({ deckId: null, page: null }),
    again: () => {
      if (last.current) void change(last.current);
    },
    reload: () => setTries((n) => n + 1),
  };
  return { slides, onEvent };
}
