import type { TeacherQuestion } from '@bali/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Failure, OpenAnswer, OpenAttempt, QuestionDraft } from '../lib/live-question';
import { useLiveQuestion } from './question-card';

/*
 * useLiveQuestion's ask as it runs (the owner's follow-up of 2026-10-16, part 3): no DOM here, so a
 * stand-in for the four React hooks it uses (useState, useRef, useCallback, useEffect) runs it,
 * each render a call and each commit's effects as React runs them, as use-slide-hook.test.ts does.
 * The API, the open, the results' poll and Done's channel are stand-ins, answered by each test.
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
// React's own for all but the hooks the live question runs on: its card's pieces import the rest.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  ...fake.react,
}));

/** What the hook reaches: the API (the session's read), the open, the poll and Done's channel. */
const io = vi.hoisted(() => {
  const open = vi.fn<(api: unknown, attempt: unknown) => Promise<unknown>>();
  const get = vi.fn(() => Promise.resolve({}));
  return { open, get, api: { get } };
});
vi.mock('../lib/use-api', () => ({ useApi: () => io.api }));
vi.mock('../lib/live-question', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/live-question')>()),
  openQuestion: io.open,
  pollResults: () => ({ stop: () => undefined, closed: () => undefined }),
  doneChannel: () => ({ tell: () => undefined, close: () => undefined }),
}));

/** The hook mounted on `session`: rendered again after each change of its state. */
function mount(session: string) {
  fake.s.slots = [];
  fake.s.effects = new Set();
  fake.s.queued = [];
  let result = undefined as unknown as ReturnType<typeof useLiveQuestion>;
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
  const render = () => {
    for (let n = 0; n === 0 || fake.s.dirty; n += 1) {
      if (n > 50) throw new Error('renders without end');
      fake.s.i = 0;
      fake.s.dirty = false;
      result = useLiveQuestion(session);
      commit();
    }
  };
  render();
  return {
    /** Lets every answer due land, rendering again while the state changes. */
    settle: async () => {
      for (let n = 0; n < 50; n += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!fake.s.dirty) return;
        render();
      }
    },
    get result() {
      return result;
    },
  };
}

const SESSION = '0199e0a0-0000-7000-8000-00000000000a';
const WRITTEN: QuestionDraft = {
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2'],
  correctOption: 1,
};
const SAVED = '0199b000-0000-7000-8000-000000000001';
const QUESTION: TeacherQuestion = {
  id: '0199e0c0-0000-7000-8000-000000000001',
  prompt: WRITTEN.prompt,
  options: WRITTEN.options,
  correctOption: 1,
  revealed: false,
  open: true,
};
/** An answer that never came, a new one each time: said anew, as each answer is. */
const lost = (): Failure => ({ kind: 'failed', status: undefined, retryAfter: undefined });

/** Each open, answered by the test as it comes. */
let answers: ((answer: OpenAnswer) => void)[] = [];
beforeEach(() => {
  answers = [];
  io.open.mockReset();
  io.open.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
  io.get.mockClear();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(() => vi.unstubAllGlobals());

describe('an ask that didn’t go through, asked again (LessonRetryStates)', () => {
  it('stays said while it is asked again, is said anew if it fails again, and goes once asked', async () => {
    const h = mount(SESSION);
    await h.settle();
    void h.result.ask(WRITTEN);
    await h.settle();
    expect(h.result.opening).toEqual({ busy: true, failure: null, from: null });
    answers[0]?.(lost());
    await h.settle();
    const said = h.result.opening.failure;
    expect(h.result.opening).toEqual({ busy: false, failure: lost(), from: null });

    // Try again: the same words again, under the same id, its line kept while it goes, so its Try
    // again holds in its place.
    void h.result.ask(WRITTEN);
    await h.settle();
    expect(h.result.opening.busy).toBe(true);
    expect(h.result.opening.failure).toBe(said);
    const [first, again] = io.open.mock.calls.map(([, attempt]) => attempt as OpenAttempt);
    expect(again).toEqual(first);

    // Failed again: said anew, a line of its own, so it is said again.
    answers[1]?.(lost());
    await h.settle();
    expect(h.result.opening).toEqual({ busy: false, failure: lost(), from: null });
    expect(h.result.opening.failure).not.toBe(said);

    // Asked again and opened: the line goes with its answer, never before.
    void h.result.ask(WRITTEN);
    await h.settle();
    expect(h.result.opening.failure).not.toBeNull();
    answers[2]?.({ kind: 'opened', question: QUESTION });
    await h.settle();
    expect(h.result.opening).toEqual({ busy: false, failure: null, from: null });
    expect(h.result.lesson.question).toEqual(QUESTION);
  });

  it('keeps one of your questions’ failure under it alone, and only while that one is asked again', async () => {
    const h = mount(SESSION);
    await h.settle();
    void h.result.ask(WRITTEN, SAVED);
    await h.settle();
    answers[0]?.(lost());
    await h.settle();
    const said = h.result.opening.failure;
    expect(h.result.opening).toEqual({ busy: false, failure: lost(), from: SAVED });

    // Its Ask, or its Try again: kept under it while it goes.
    void h.result.ask(WRITTEN, SAVED);
    await h.settle();
    expect(h.result.opening).toEqual({ busy: true, failure: said, from: SAVED });
    answers[1]?.(lost());
    await h.settle();

    // Another question asked: what it says is about that one, so the last line goes as it starts.
    void h.result.ask(WRITTEN, null);
    await h.settle();
    expect(h.result.opening).toEqual({ busy: true, failure: null, from: null });
  });

  it('forgets the written words’ failure on Cancel, one sent again on its way too', async () => {
    const h = mount(SESSION);
    await h.settle();
    void h.result.ask(WRITTEN);
    await h.settle();
    answers[0]?.(lost());
    await h.settle();
    void h.result.ask(WRITTEN);
    await h.settle();
    h.result.forgetAsk();
    await h.settle();
    expect(h.result.opening).toEqual({ busy: true, failure: null, from: null });
    answers[1]?.(lost());
    await h.settle();
    expect(h.result.opening).toEqual({ busy: false, failure: null, from: null });
  });
});
