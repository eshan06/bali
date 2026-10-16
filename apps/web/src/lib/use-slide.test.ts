import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Slide } from '@bali/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from './api-client';
import {
  type DeckFailure,
  type loadDeck,
  type LoadOptions,
  type OpenDeck,
  STALL_MS,
} from './deck-pdf';
import { LONGEST_WAIT_MS, POLL_EVERY_MS } from './live-question';
import { type SlideAnswer } from './presenter';
import { changeEnd, loadShown, unopenedAs, waitAfter } from './use-slide';

/*
 * The class page's slide (M6, part 2b-1): the deck shown loaded and watched for a stall, a slide
 * change's answer read for the card, and the hook that holds them for one session. The loader
 * against a stand-in `loadDeck`; the hook, which the slide card (2b-2) renders, read from its
 * source, as the question card's hook is (question-card.test.ts).
 */
const source = readFileSync(fileURLToPath(new URL('./use-slide.ts', import.meta.url)), 'utf8');
const hook = source.slice(source.indexOf('export function useSlide'));

const DECK_ID = '0199b000-0000-7000-8000-0000000000d2';
const SLIDE = { deckId: DECK_ID, sha256: 'a'.repeat(64) };
const URL_GET = `https://bali-decks-dev.s3.us-east-1.amazonaws.com/decks/${DECK_ID}.pdf?X-Amz-Signature=abc`;
const api: Pick<ApiClient, 'get'> = { get: vi.fn() };

type LoadEnd = Awaited<ReturnType<typeof loadDeck>>;

/** A deck open in PDF.js, its close recorded. */
const openDeck = (): OpenDeck => ({
  pdf: {} as OpenDeck['pdf'],
  close: vi.fn(() => Promise.resolve()),
});

/** A stand-in `loadDeck`: each call's slide and options recorded, answered by `answer`. */
function fakeLoad(answer: (opts: LoadOptions) => Promise<LoadEnd>) {
  const calls: { slide: unknown; opts: LoadOptions }[] = [];
  const load = ((_api: unknown, slide: unknown, opts: LoadOptions = {}) => {
    calls.push({ slide, opts });
    return answer(opts);
  }) as typeof loadDeck;
  return { load, calls };
}

/** Resolves once `signal` aborts. */
const aborted = (signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));

afterEach(() => {
  vi.useRealTimers();
});

describe('loadShown: the deck shown, loaded for the card', () => {
  it('opens it, its download watched for a stall and stopped with the page', async () => {
    const deck = openDeck();
    const { load, calls } = fakeLoad(() => Promise.resolve({ kind: 'loaded', deck }));
    const base = vi.fn() as unknown as typeof fetch;
    const stop = new AbortController();
    expect(await loadShown(api, SLIDE, stop, { load, fetchImpl: base })).toEqual({
      kind: 'open',
      deck,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slide).toEqual(SLIDE);
    expect(calls[0]?.opts.signal).toBe(stop.signal);
    // The bucket's GET through the watch, never the bare one.
    expect(calls[0]?.opts.fetchImpl).toBeTypeOf('function');
    expect(calls[0]?.opts.fetchImpl).not.toBe(base);
    expect(deck.close).not.toHaveBeenCalled();
  });

  it('says why one didn’t open as the card says it: changed, unopened, or not loaded', async () => {
    const ends: [DeckFailure, string][] = [
      [{ kind: 'mismatch' }, 'mismatch'],
      [{ kind: 'unopened' }, 'unopened'],
      [{ kind: 'unverifiable' }, 'unloaded'],
      [{ kind: 'unfetched', status: 503 }, 'unloaded'],
      [{ kind: 'refused', status: 404, reason: 'deck_not_found' }, 'unloaded'],
      [{ kind: 'failed', status: undefined, retryAfter: undefined }, 'unloaded'],
    ];
    for (const [end, why] of ends) {
      expect(unopenedAs(end)).toBe(why);
      const { load } = fakeLoad(() => Promise.resolve(end));
      expect(await loadShown(api, SLIDE, new AbortController(), { load })).toEqual({
        kind: 'failed',
        why,
      });
    }
  });

  it('says nothing once the page stopped it, and closes a deck that opened as it did', async () => {
    const stop = new AbortController();
    const { load } = fakeLoad(async (opts) => {
      await aborted(opts.signal);
      return { kind: 'cancelled' };
    });
    const loading = loadShown(api, SLIDE, stop, { load });
    stop.abort();
    expect(await loading).toBeNull();

    const late = new AbortController();
    const deck = openDeck();
    const opened = fakeLoad(() => {
      late.abort();
      return Promise.resolve({ kind: 'loaded', deck });
    });
    expect(await loadShown(api, SLIDE, late, { load: opened.load })).toBeNull();
    expect(deck.close).toHaveBeenCalledOnce();
  });

  it('stops a download with nothing arriving for 20 s, and says it didn’t load, for Try again', async () => {
    vi.useFakeTimers();
    const stop = new AbortController();
    const silent = (() => new Promise<Response>(() => {})) as typeof fetch;
    const { load } = fakeLoad(async (opts) => {
      void opts.fetchImpl?.(URL_GET, { signal: opts.signal });
      await aborted(opts.signal);
      return { kind: 'cancelled' };
    });
    let state: unknown = 'loading';
    void loadShown(api, SLIDE, stop, { load, fetchImpl: silent }).then((s) => (state = s));
    await vi.advanceTimersByTimeAsync(STALL_MS - 1);
    expect(stop.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stop.signal.aborted).toBe(true);
    await vi.waitFor(() => expect(state).toEqual({ kind: 'failed', why: 'unloaded' }));
  });

  it('never stops a load once it has ended, its download’s watch left running', async () => {
    vi.useFakeTimers();
    const stop = new AbortController();
    // An answer whose body is never read to its end: the load said its bytes are too many.
    const endless = (() =>
      Promise.resolve(new Response(new ReadableStream({ start: () => {} })))) as typeof fetch;
    const { load } = fakeLoad(async (opts) => {
      await opts.fetchImpl?.(URL_GET);
      return { kind: 'mismatch' };
    });
    expect(await loadShown(api, SLIDE, stop, { load, fetchImpl: endless })).toEqual({
      kind: 'failed',
      why: 'mismatch',
    });
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);
    expect(stop.signal.aborted).toBe(false);
  });
});

describe('waitAfter: how long a read with no answer waits', () => {
  const failed = (status: number | undefined, retryAfter?: number) =>
    ({ kind: 'failed', status, retryAfter }) as const;

  it('waits 2 s, or a 429’s Retry-After from 2 s to a minute, none the minute', () => {
    expect(waitAfter(failed(undefined))).toBe(POLL_EVERY_MS);
    expect(waitAfter(failed(503))).toBe(POLL_EVERY_MS);
    expect(waitAfter(failed(429, 30))).toBe(30_000);
    expect(waitAfter(failed(429, 0))).toBe(POLL_EVERY_MS);
    expect(waitAfter(failed(429, 3600))).toBe(LONGEST_WAIT_MS);
    expect(waitAfter(failed(429))).toBe(LONGEST_WAIT_MS);
  });
});

describe('changeEnd: a slide change’s answer, for the card', () => {
  const slide: Slide = { deckId: DECK_ID, sha256: SLIDE.sha256, page: 5, pageCount: 12 };
  const ID = '0199e0b0-0000-7000-8000-000000000005';

  it('takes what the session shows now, presenting stopped included', () => {
    expect(changeEnd({ kind: 'shown', slide, eventId: ID })).toEqual({
      shown: { slide, eventId: ID },
    });
    expect(changeEnd({ kind: 'shown', slide: null, eventId: ID })).toEqual({
      shown: { slide: null, eventId: ID },
    });
  });

  it('says the session ended first, the deck gone, and anything else as a change that didn’t go through', () => {
    const answers: [SlideAnswer, string][] = [
      [{ kind: 'over' }, 'over'],
      [{ kind: 'gone' }, 'gone'],
      [{ kind: 'failed', status: undefined, retryAfter: undefined }, 'failed'],
      [{ kind: 'failed', status: 429, retryAfter: 30 }, 'failed'],
      [{ kind: 'refused', status: 400, reason: 'page_out_of_range' }, 'failed'],
      [{ kind: 'refused', status: 409, reason: 'event_id_conflict' }, 'failed'],
    ];
    for (const [answer, said] of answers) expect(changeEnd(answer)).toEqual({ said });
  });
});

describe('useSlide: what a session shows, held for one session (read from its source)', () => {
  it('takes only a later change, and only its own session’s, from every source', () => {
    expect(hook).toMatch(
      /const put = useCallback\(\(session: string, next: Shown\) => \{\s*const shown = newer\(now\.current\.shown, next\);\s*if \(now\.current\.session !== session \|\| shown === now\.current\.shown\) return;/,
    );
    // A new session starts with nothing shown, and nothing said (santa's review).
    expect(hook).toMatch(
      /useEffect\(\(\) => \{\s*now\.current = \{ session: sessionId, shown: NOTHING_SHOWN \};\s*setHeld\(now\.current\);\s*setSaid\(null\);\s*\}, \[sessionId\]\);/,
    );
    expect(hook).toMatch(
      /const shown = held\.session === sessionId \? held\.shown : NOTHING_SHOWN;/,
    );
  });

  it('takes the session’s read from the question’s own read of it, never a second GET', () => {
    expect(hook).toMatch(
      /if \(snapshot !== null\) put\(snapshot\.session, shownIn\(snapshot\.snap\)\);/,
    );
    expect(hook).not.toMatch(/api\.get|\/v1\/sessions/);
  });

  it('hears the stream’s slide changes, naming their deck from the ready decks, the session read again for one it can’t', () => {
    expect(hook).toMatch(
      /if \(session === null \|\| e\.type !== 'slide_shown'\) return;\s*const next = slideAfter\(at, e, readyDecks\(decksNow\.current\)\);\s*if \(next === 'unknown'\) reread\(\);\s*else put\(session, next\);/,
    );
  });

  it('reads the teacher’s decks while the deck shown isn’t among them, again every 2 s with no answer', () => {
    expect(hook).toMatch(/const named = decks\?\.some\(\(d\) => d\.id === deckId\) \?\? false;/);
    expect(hook).toMatch(/if \(deckId === null \|\| named\) return;/);
    expect(hook).toMatch(
      /const answer = await readDecks\(api\);\s*if \(gone\) return;\s*if \(answer\.kind === 'read'\) \{\s*decksNow\.current = answer\.decks;\s*setDecks\(answer\.decks\);\s*\} else if \(answer\.kind === 'failed'\) \{?\s*timer = setTimeout\(\(\) => void read\(\), waitAfter\(answer\)\);/,
    );
    expect(hook).toMatch(/title: decks\?\.find\(\(d\) => d\.id === deckId\)\?\.title \?\? null,/);
  });

  it('loads each deck shown and each Try again, closing it as the next starts, the page moves on or goes', () => {
    expect(hook).toMatch(/const key = `\$\{deckId\}:\$\{sha256\}:\$\{tries\}`;/);
    expect(hook).toMatch(
      /void loadShown\(api, \{ deckId, sha256 \}, stop\)\.then\(\(state\) => \{[^]*?if \(gone && state\?\.kind === 'open'\) void state\.deck\.close\(\);\s*if \(gone \|\| state === null\) return;\s*if \(state\.kind === 'open'\) open = state\.deck;\s*setLoaded\(\{ key, state \}\);/,
    );
    // Cleared as it closes, so the same deck shown again loads afresh (use-slide-hook.test.ts).
    expect(hook).toMatch(
      /return \(\) => \{\s*gone = true;\s*stop\.abort\(\);\s*void open\?\.close\(\);[^]*?setLoaded\(null\);\s*\};\s*\}, \[api, deckId, sha256, key\]\);/,
    );
    // Not open() but close(), which ends the worker too (#413).
    expect(hook).not.toMatch(/\.destroy\(/);
    expect(hook).toMatch(/deck: loaded\?\.key === key \? loaded\.state : \{ kind: 'loading' \},/);
    expect(hook).toMatch(/reload: \(\) => setTries\(\(n\) => n \+ 1\),/);
  });

  it('sends one change at a time through 2a, resent under its id while its answer never came', () => {
    expect(hook).toMatch(/if \(session === null \|\| sending\.current\) return false;/);
    expect(hook).toMatch(
      /const attempt = slideAttemptFor\(unanswered\.current, session, at\.eventId, to\);\s*const answer = await showSlide\(api, attempt\);/,
    );
    expect(hook).toMatch(
      /if \(now\.current\.session !== session\) return false;\s*unanswered\.current = keepUnanswered\(attempt, answer\);\s*const end = changeEnd\(answer\);/,
    );
    expect(hook).toMatch(
      /if \('shown' in end\) \{\s*put\(session, end\.shown\);\s*return true;\s*\}[^]*?setSaid\(\{ why: end\.said, change: to \}\);[^]*?if \(end\.said === 'gone'\) reread\(\);/,
    );
    // Its answer gave up after the stream showed it: nothing said, and done, as its answer would
    // have said (use-slide-hook.test.ts).
    expect(hook).toMatch(
      /const heard = newer\(now\.current\.shown, \{ slide: null, eventId: attempt\.eventId \}\);\s*if \(end\.said === 'failed' && heard === now\.current\.shown\) \{\s*unanswered\.current = null;\s*return true;\s*\}/,
    );
    // Try again: the last change again, through the same rule.
    expect(hook).toMatch(/again: \(\) => \{\s*if \(last\.current\) void change\(last\.current\);/);
    expect(hook).toMatch(/stop: \(\) => change\(\{ deckId: null, page: null \}\),/);
    // The side panel's Show (M6, part 2c): the deck's first page, through the same rule.
    expect(hook).toMatch(/show: \(deck\) => change\(\{ deckId: deck, page: 1 \}\),/);
  });

  it('settles what a change said once a later one is heard, and turns pages within the deck', () => {
    expect(hook).toMatch(
      /useEffect\(\(\) => \{\s*unanswered\.current = null;\s*setSaid\(null\);\s*\}, \[shown\.eventId\]\);/,
    );
    expect(hook).toMatch(
      /const at = now\.current\.shown\.slide;\s*const to = at && turned\(at, by\);\s*if \(to\) void change\(to\);/,
    );
  });

  it('holds no words: the card says each state', () => {
    const code = source.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const words = [...code.matchAll(/'([^'\n]*)'/g)].map((m) => m[1] ?? '');
    expect(words.filter((w) => w.includes(' ') && w !== 'use client')).toEqual([]);
  });
});
