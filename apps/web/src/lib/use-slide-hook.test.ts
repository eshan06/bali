import type { Deck, FeedEvent, SessionSnapshot, Slide, SlideResponse } from '@bali/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, NetworkError } from './api-client';
import type { OpenDeck } from './deck-pdf';
import { useSlide } from './use-slide';

/*
 * useSlide as it runs (M6, part 2b-1): no DOM here, so a stand-in for the four React hooks it uses
 * (useState, useRef, useCallback, useEffect) runs it, each render a call and each commit's effects
 * as React runs them, every cleanup before any setup. Its deck loads, the teacher's decks and the
 * API are stand-ins, answered by each test.
 */

const fake = vi.hoisted(() => {
  const s = {
    slots: [] as unknown[],
    effects: new Set<number>(),
    queued: [] as { k: number; run: () => unknown; deps?: readonly unknown[] }[],
    i: 0,
    dirty: false,
  };
  const same = (a?: readonly unknown[], b?: readonly unknown[]) =>
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((x, n) => Object.is(x, b[n]));
  const react = {
    useState(initial: unknown) {
      const k = s.i++;
      if (!(k in s.slots)) s.slots[k] = initial;
      const set = (next: unknown) => {
        const value =
          typeof next === 'function' ? (next as (cur: unknown) => unknown)(s.slots[k]) : next;
        if (Object.is(value, s.slots[k])) return;
        s.slots[k] = value;
        s.dirty = true;
      };
      return [s.slots[k], set];
    },
    useRef(initial: unknown) {
      const k = s.i++;
      if (!(k in s.slots)) s.slots[k] = { current: initial };
      return s.slots[k];
    },
    useCallback(fn: unknown, deps: readonly unknown[]) {
      const k = s.i++;
      const held = s.slots[k] as { fn: unknown; deps: readonly unknown[] } | undefined;
      if (held && same(held.deps, deps)) return held.fn;
      s.slots[k] = { fn, deps };
      return fn;
    },
    useEffect(run: () => unknown, deps?: readonly unknown[]) {
      const k = s.i++;
      s.effects.add(k);
      const held = s.slots[k] as { deps?: readonly unknown[] } | undefined;
      if (held && same(held.deps, deps)) return;
      s.queued.push({ k, run, deps });
    },
  };
  return { s, react };
});
vi.mock('react', () => fake.react);

/** What the hook reaches: its deck loads, the teacher's decks, and the API's `post`. */
const io = vi.hoisted(() => {
  const post = vi.fn<(path: string, body: unknown) => Promise<unknown>>();
  return {
    loads: [] as { slide: unknown; resolve: (end: unknown) => void }[],
    decks: [] as unknown[],
    post,
    // One client for the page's life, as `useApi` memoizes it.
    api: { post },
  };
});
vi.mock('./deck-pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./deck-pdf')>()),
  loadDeck: (_api: unknown, slide: unknown) =>
    new Promise((resolve) => io.loads.push({ slide, resolve })),
}));
vi.mock('./decks', () => ({
  readDecks: () => Promise.resolve({ kind: 'read', decks: io.decks }),
}));
vi.mock('./use-api', () => ({ useApi: () => io.api }));
vi.mock('./monitoring', () => ({ captureApiFailure: vi.fn() }));

type Args = Parameters<typeof useSlide>;

/** `useSlide` mounted: rendered with `args`, again after each change of its state, and unmounted. */
function mount(...first: Args) {
  fake.s.slots = [];
  fake.s.effects = new Set();
  fake.s.queued = [];
  let args = first;
  let result = undefined as unknown as ReturnType<typeof useSlide>;
  const commit = () => {
    const queued = fake.s.queued;
    fake.s.queued = [];
    for (const { k } of queued)
      (fake.s.slots[k] as { cleanup?: () => void } | undefined)?.cleanup?.();
    for (const { k, run, deps } of queued) {
      const cleanup = run();
      fake.s.slots[k] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
    }
  };
  const render = (...next: Args) => {
    args = next;
    for (let n = 0; n === 0 || fake.s.dirty; n += 1) {
      if (n > 50) throw new Error('renders without end');
      fake.s.i = 0;
      fake.s.dirty = false;
      result = useSlide(...args);
      commit();
    }
  };
  render(...first);
  return {
    render,
    /** Lets every answer due land, rendering again while the state changes. */
    settle: async () => {
      for (let n = 0; n < 50; n += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!fake.s.dirty) return;
        render(...args);
      }
    },
    unmount: () => {
      for (const k of fake.s.effects) {
        (fake.s.slots[k] as { cleanup?: () => void } | undefined)?.cleanup?.();
      }
    },
    get slides() {
      return result.slides;
    },
    get onEvent() {
      return result.onEvent;
    },
  };
}

const SESSION = '0199e0a0-0000-7000-8000-00000000000a';
const X: Deck = {
  id: '0199b000-0000-7000-8000-0000000000d1',
  title: 'Factoring quadratics',
  status: 'ready',
  bytes: 120_000,
  sha256: 'a'.repeat(64),
  pageCount: 12,
  rejection: null,
  createdAt: '2026-10-06T14:00:00.000Z',
};
/** Slide changes' ids, in the server's order. */
const id = (n: number) => `0199e0b0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const slideOf = (page: number): Slide => ({
  deckId: X.id,
  sha256: X.sha256,
  page,
  pageCount: 12,
});
const read = (slide: Slide | null, eventId: string) => ({
  session: SESSION,
  snap: { presentation: { slide, eventId } } as Pick<SessionSnapshot, 'presentation'>,
});
const shownEvent = (eventId: string, page: number | null) =>
  ({
    seq: 1,
    eventId,
    type: 'slide_shown',
    userId: null,
    occurredAt: '2026-10-16T14:05:00.000Z',
    payload: { deck_id: page === null ? null : X.id, page },
  }) as FeedEvent;
const openDeck = (): OpenDeck => ({
  pdf: {} as OpenDeck['pdf'],
  close: vi.fn(() => Promise.resolve()),
});

beforeEach(() => {
  io.loads = [];
  io.decks = [X];
  io.post.mockReset();
});

describe('useSlide: its deck', () => {
  it('never hands back a deck it closed: the same deck shown again loads afresh (santa’s review)', async () => {
    const h = mount(SESSION, read(slideOf(4), id(1)), vi.fn());
    await h.settle();
    expect(io.loads).toHaveLength(1);
    const first = openDeck();
    io.loads[0]?.resolve({ kind: 'loaded', deck: first });
    await h.settle();
    expect(h.slides.deck).toEqual({ kind: 'open', deck: first });

    // Presenting stops, from another tab: the deck closes.
    h.onEvent(shownEvent(id(2), null));
    await h.settle();
    expect(h.slides.slide).toBeNull();
    expect(first.close).toHaveBeenCalledOnce();

    // The same deck shown again: loading afresh, never the deck closed.
    h.onEvent(shownEvent(id(3), 2));
    await h.settle();
    expect(h.slides.slide).toEqual(slideOf(2));
    expect(h.slides.deck).toEqual({ kind: 'loading' });
    expect(io.loads).toHaveLength(2);
  });

  it('never says a failure its next load hasn’t made: shown again after it failed, it loads', async () => {
    const h = mount(SESSION, read(slideOf(4), id(1)), vi.fn());
    await h.settle();
    io.loads[0]?.resolve({ kind: 'mismatch' });
    await h.settle();
    expect(h.slides.deck).toEqual({ kind: 'failed', why: 'mismatch' });
    h.onEvent(shownEvent(id(2), null));
    await h.settle();
    h.onEvent(shownEvent(id(3), 4));
    await h.settle();
    expect(h.slides.deck).toEqual({ kind: 'loading' });
  });

  it('closes its deck when the page goes, and one that opens after', async () => {
    const h = mount(SESSION, read(slideOf(4), id(1)), vi.fn());
    await h.settle();
    const deck = openDeck();
    io.loads[0]?.resolve({ kind: 'loaded', deck });
    await h.settle();
    h.unmount();
    expect(deck.close).toHaveBeenCalledOnce();

    const late = mount(SESSION, read(slideOf(4), id(1)), vi.fn());
    await late.settle();
    late.unmount();
    const after = openDeck();
    io.loads[1]?.resolve({ kind: 'loaded', deck: after });
    await late.settle();
    expect(after.close).toHaveBeenCalledOnce();
  });

  it('loads it again on Try again', async () => {
    const h = mount(SESSION, read(slideOf(4), id(1)), vi.fn());
    await h.settle();
    io.loads[0]?.resolve({ kind: 'unopened' });
    await h.settle();
    expect(h.slides.deck).toEqual({ kind: 'failed', why: 'unopened' });
    h.slides.reload();
    await h.settle();
    expect(h.slides.deck).toEqual({ kind: 'loading' });
    expect(io.loads).toHaveLength(2);
  });
});

describe('useSlide: what the session shows', () => {
  it('takes the session’s read, then only later changes, its title from the teacher’s decks', async () => {
    const h = mount(SESSION, read(slideOf(4), id(5)), vi.fn());
    await h.settle();
    expect(h.slides.slide).toEqual(slideOf(4));
    expect(h.slides.title).toBe('Factoring quadratics');
    // The stream's overlap brings an older change again: kept as it was.
    h.onEvent(shownEvent(id(3), 9));
    await h.settle();
    expect(h.slides.slide).toEqual(slideOf(4));
    // A read that lands after a later change never brings an older page back.
    h.onEvent(shownEvent(id(6), 5));
    await h.settle();
    h.render(SESSION, read(slideOf(4), id(5)), vi.fn());
    await h.settle();
    expect(h.slides.slide).toEqual(slideOf(5));
  });

  it('reads the session again for a change the stream can’t name', async () => {
    io.decks = [];
    const reread = vi.fn();
    const h = mount(SESSION, null, reread);
    await h.settle();
    h.onEvent(shownEvent(id(2), 3));
    expect(reread).toHaveBeenCalledOnce();
  });

  it('starts a new session with nothing shown', async () => {
    const h = mount(SESSION, read(slideOf(4), id(1)), vi.fn());
    await h.settle();
    h.render('0199e0a0-0000-7000-8000-00000000000b', null, vi.fn());
    await h.settle();
    expect(h.slides.slide).toBeNull();
  });
});

describe('useSlide: its changes', () => {
  /** The slide change answered as the server would, a later page shown. */
  const shownAnswer = (slide: Slide | null, eventId: string): SlideResponse => ({
    outcome: 'shown',
    slide,
    eventId,
  });

  it('turns a page through Bali, holding its controls until the answer, minted after the change held', async () => {
    let answer!: (res: SlideResponse) => void;
    io.post.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const h = mount(SESSION, read(slideOf(4), id(1)), vi.fn());
    await h.settle();
    h.slides.turn(1);
    await h.settle();
    expect(h.slides.changing).toEqual({ deckId: X.id, page: 5 });
    const [path, body] = io.post.mock.calls[0] ?? [];
    expect(path).toBe(`/v1/sessions/${SESSION}/slide`);
    const sent = body as { eventId: string; deckId: string; page: number };
    expect(sent).toMatchObject({ deckId: X.id, page: 5 });
    expect(sent.eventId > id(1)).toBe(true);
    // A second press meanwhile sends nothing.
    h.slides.turn(1);
    expect(io.post).toHaveBeenCalledOnce();
    answer(shownAnswer(slideOf(5), sent.eventId));
    await h.settle();
    expect(h.slides.changing).toBeNull();
    expect(h.slides.slide).toEqual(slideOf(5));
  });

  it('turns no page past either end', async () => {
    const h = mount(SESSION, read(slideOf(12), id(1)), vi.fn());
    await h.settle();
    h.slides.turn(1);
    expect(io.post).not.toHaveBeenCalled();
  });

  it('says a change that didn’t go through, sends the same one again on Try again, and lets the line go once a later change is heard', async () => {
    io.post.mockRejectedValue(new NetworkError());
    const h = mount(SESSION, read(slideOf(4), id(1)), vi.fn());
    await h.settle();
    h.slides.turn(1);
    await h.settle();
    expect(h.slides.said).toBe('failed');
    h.slides.again();
    await h.settle();
    const [first, again] = io.post.mock.calls.map(([, body]) => body);
    expect(again).toEqual(first);
    // Another tab's change heard: the truth is on screen, and the line goes.
    h.onEvent(shownEvent(id(9), 7));
    await h.settle();
    expect(h.slides.said).toBeNull();
    expect(h.slides.slide).toEqual(slideOf(7));
  });

  it('says nothing failed of a change the stream already showed before its answer gave up', async () => {
    let fail!: (e: unknown) => void;
    io.post.mockImplementation(() => new Promise((_, reject) => (fail = reject)));
    const h = mount(SESSION, read(slideOf(4), id(1)), vi.fn());
    await h.settle();
    h.slides.turn(1);
    await h.settle();
    const sent = io.post.mock.calls[0]?.[1] as { eventId: string };
    // It landed: its own slide_shown comes, then its answer times out.
    h.onEvent(shownEvent(sent.eventId, 5));
    await h.settle();
    fail(new NetworkError());
    await h.settle();
    expect(h.slides.slide).toEqual(slideOf(5));
    expect(h.slides.said).toBeNull();

    // A stop the same way: done, as its answer would have said, so the card moves focus on.
    const stopping = h.slides.stop();
    await h.settle();
    const stop = io.post.mock.calls[1]?.[1] as { eventId: string };
    h.onEvent({ ...shownEvent(stop.eventId, null), seq: 2 });
    await h.settle();
    fail(new NetworkError());
    expect(await stopping).toBe(true);
    await h.settle();
    expect(h.slides.slide).toBeNull();
    expect(h.slides.said).toBeNull();
  });

  it('says the session ended first, and the deck gone, reading the session again', async () => {
    const reread = vi.fn();
    io.post.mockRejectedValueOnce(
      new ApiError(409, 'conflict', 'not running', 'session_not_running'),
    );
    const h = mount(SESSION, read(slideOf(4), id(1)), reread);
    await h.settle();
    h.slides.turn(1);
    await h.settle();
    expect(h.slides.said).toBe('over');
    expect(reread).not.toHaveBeenCalled();
    io.post.mockRejectedValueOnce(new ApiError(404, 'not_found', 'gone', 'deck_not_found'));
    h.slides.turn(1);
    await h.settle();
    expect(h.slides.said).toBe('gone');
    expect(reread).toHaveBeenCalledOnce();
  });

  it('stops showing, answered with nothing shown', async () => {
    io.post.mockImplementation((_path, body) =>
      Promise.resolve(shownAnswer(null, (body as { eventId: string }).eventId)),
    );
    const h = mount(SESSION, read(slideOf(4), id(1)), vi.fn());
    await h.settle();
    let stopped: boolean | undefined;
    void h.slides.stop().then((done) => (stopped = done));
    await h.settle();
    expect(io.post.mock.calls[0]?.[1]).toMatchObject({ deckId: null, page: null });
    expect(stopped).toBe(true);
    expect(h.slides.slide).toBeNull();
  });
});
