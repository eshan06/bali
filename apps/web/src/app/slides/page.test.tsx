// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UPLOAD_LIMIT_MS, UPLOAD_STALL_MS } from '@/lib/decks';
import { captureApiFailure } from '@/lib/monitoring';

import SlidesPage from './page';

/*
 * Your slides' upload as a teacher meets it (the owner's decision of 2026-10-22): a PDF picked and
 * sent to the bucket by a stand-in XMLHttpRequest whose bytes the test moves, on a fake clock, Bali's
 * answers a stand-in API's. A stuck upload stops once nothing is sent for 30 s, its row saying so with
 * Try again (SlidesStates), which goes on from where it stopped (QuestionsSlidesRetryStates); a slow
 * one that keeps sending never stops; one still going at 25 minutes stops, in its own words.
 *
 * Pressed with `fireEvent`, never user-event, and waited on inside `act`: on a fake clock, Testing
 * Library's own waits (user-event's actions, `waitFor`, `findBy…`) hang on a timer it never runs.
 */

const bali = vi.hoisted(() => {
  const ID = '0199b000-0000-7000-8000-0000000000d1';
  const pending = {
    id: ID,
    title: 'Unit 3 review',
    status: 'pending',
    bytes: 1_000_000,
    sha256: 'a'.repeat(64),
    pageCount: null,
    rejection: null,
    createdAt: '2026-10-22T14:00:00.000Z',
  };
  const calls: [string, string, unknown][] = [];
  let urls = 0;
  /** Bali's answer to each call: no decks yet, a fresh upload URL for each create, a ready deck. */
  const answer = (method: string, path: string, body?: unknown): unknown => {
    calls.push([method, path, body]);
    if (method === 'GET' && path === '/v1/decks') return { decks: [] };
    if (method === 'POST' && path === '/v1/decks') {
      urls += 1;
      return {
        outcome: urls === 1 ? 'created' : 'replay',
        deck: pending,
        uploadUrl: `https://bali-decks-dev.s3.us-east-1.amazonaws.com/decks/${ID}.pdf?X-Amz-Signature=s${urls}`,
      };
    }
    if (method === 'POST' && path === `/v1/decks/${ID}/complete`) {
      return { outcome: 'checked', deck: { ...pending, status: 'ready', pageCount: 12 } };
    }
    if (method === 'DELETE' && path === `/v1/decks/${ID}`)
      return { outcome: 'removed', deck: pending };
    throw new Error(`unexpected ${method} ${path}`);
  };
  const call = (method: string) => (path: string, body?: unknown) =>
    Promise.resolve().then(() => answer(method, path, body));
  return {
    ID,
    calls,
    api: { get: call('GET'), post: call('POST'), del: call('DELETE') },
    router: { replace: () => undefined },
    reset: () => {
      calls.length = 0;
      urls = 0;
    },
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => bali.router }));
vi.mock('@/lib/auth', () => ({ getAccessToken: () => 'token' }));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.api }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

/** The browser's XMLHttpRequest to the bucket: each PUT kept, its bytes and answer the test's. */
class Bucket {
  static made: Bucket[] = [];
  url = '';
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
    Bucket.made.push(this);
  }
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  /** As the browser does: the request ends with `timeout` once that much has passed since send. */
  send() {
    if (this.timeout > 0) this.timer = setTimeout(() => this.ontimeout?.(), this.timeout);
  }
  abort() {
    this.aborted = true;
    clearTimeout(this.timer);
    this.onabort?.();
  }
}

/** The PDF a teacher picks: 1,000,000 bytes, a PDF's own `%PDF-` first. */
const SIZE = 1_000_000;
const pdf = () => {
  const bytes = new Uint8Array(SIZE);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  return new File([bytes], 'Unit 3 review.pdf', { type: 'application/pdf' });
};

/** The file picked in Upload a PDF's dialog, as the browser hands it to the page. */
function pick(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file picker');
  fireEvent.change(input, { target: { files: [file] } });
}

/** Until the page has sent its `n`th PUT: the file read for its SHA-256, the create answered. */
async function untilPut(n: number) {
  await act(() => vi.waitFor(() => expect(Bucket.made).toHaveLength(n)));
  return Bucket.made[n - 1];
}

/** Bytes sent, as the browser tells the page. */
const sent = (xhr: Bucket, loaded: number) =>
  act(() => xhr.upload.onprogress?.({ loaded, total: SIZE, lengthComputable: true }));

/** Time passing on the fake clock, what it set off drawn. */
const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

/** The whole file sent and the bucket's 200: the page then asks for the check. */
const arrived = (xhr: Bucket) =>
  act(async () => {
    xhr.upload.onprogress?.({ loaded: SIZE, total: SIZE, lengthComputable: true });
    xhr.upload.onload?.();
    xhr.status = 200;
    xhr.onload?.();
    await vi.advanceTimersByTimeAsync(0);
  });

/** The upload's bar, while it is sending: how far, as a screen reader is told. */
const bar = () =>
  screen.queryByRole('progressbar', { name: 'Unit 3 review' })?.getAttribute('aria-valuenow');

/** A little more every 29 s, never 30 s apart, for `ms`. */
async function trickle(xhr: Bucket, ms: number, from = 0) {
  let loaded = from;
  for (let left = ms; left > 0; left -= UPLOAD_STALL_MS - 1_000) {
    loaded += 16_384;
    sent(xhr, loaded);
    await pass(Math.min(UPLOAD_STALL_MS - 1_000, left));
  }
  return loaded;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('XMLHttpRequest', Bucket);
});

afterEach(() => {
  // Focus off first, so no Try again unmounted here hands focus on in the next test's page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Bucket.made = [];
  bali.reset();
  vi.mocked(captureApiFailure).mockClear();
});

describe('Your slides’ upload, on a link that stops or slows (the owner, 2026-10-22)', () => {
  it('stops an upload that sends nothing for 30 s, says so in its row with Try again, which goes on from where it stopped', async () => {
    render(<SlidesPage />);
    await pass(0);
    expect(screen.getByText('No slides yet. Upload a PDF to show it in class.')).toBeDefined();
    pick(pdf());
    const xhr = await untilPut(1);
    expect(bar()).toBe('0');
    sent(xhr, 16_384);
    expect(bar()).toBe('1');
    // Nothing more for 29 s: still uploading, nothing said.
    await pass(UPLOAD_STALL_MS - 1_000);
    expect(bar()).toBe('1');
    expect(screen.queryByRole('alert')).toBeNull();
    await pass(1_000);
    // 30 s: stopped, its bar gone, said across its row's foot, as one with no answer.
    expect(bar()).toBeUndefined();
    expect(screen.getByRole('alert').textContent).toBe(
      'The upload stopped. Check your connection and try again.',
    );
    expect(
      screen.getByRole('button', { name: 'Cancel', description: 'Unit 3 review' }),
    ).toBeDefined();
    const again = screen.getByRole('button', { name: 'Try again', description: 'Unit 3 review' });
    expect(xhr.aborted).toBe(true);
    expect(vi.mocked(captureApiFailure).mock.calls).toEqual([
      ['PUT', `/bucket/decks/${bali.ID}.pdf`, 'network'],
    ]);
    // Try again, focused and pressed (Enter's click): on from where it stopped, its create sent
    // again under its id for a fresh URL (M2b2), its row uploading again, focus on its Cancel.
    again.focus();
    fireEvent.click(again);
    const next = await untilPut(2);
    await pass(16);
    expect(next.url).toMatch(/X-Amz-Signature=s2$/);
    const creates = bali.calls.filter(
      ([method, path]) => method === 'POST' && path === '/v1/decks',
    );
    expect(creates).toHaveLength(2);
    expect(creates[1]).toEqual(creates[0]);
    expect(bar()).toBe('0');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cancel', description: 'Unit 3 review' }),
    );
    // Through this time: checked, and the row turns into its deck.
    await arrived(next);
    expect(screen.getByText(/^12 pages · /)).toBeDefined();
  });

  it('never stops a slow upload that keeps sending: its bar moves on for 12 minutes, then it is checked', async () => {
    render(<SlidesPage />);
    pick(pdf());
    const xhr = await untilPut(1);
    const loaded = await trickle(xhr, 12 * 60_000);
    expect(bar()).toBe(String(Math.floor((loaded / SIZE) * 100)));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(xhr.aborted).toBe(false);
    await arrived(xhr);
    expect(screen.getByText(/^12 pages · /)).toBeDefined();
    expect(captureApiFailure).not.toHaveBeenCalled();
  });

  it('stops one still going at 25 minutes, in its own words, however steadily it sends', async () => {
    render(<SlidesPage />);
    pick(pdf());
    const xhr = await untilPut(1);
    await trickle(xhr, UPLOAD_LIMIT_MS - 1_000);
    expect(bar()).not.toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
    await pass(1_000);
    expect(bar()).toBeUndefined();
    expect(screen.getByRole('alert').textContent).toBe(
      'The upload was still going after 25 minutes, so Bali stopped it. Try again on a faster connection.',
    );
    expect(
      screen.getByRole('button', { name: 'Try again', description: 'Unit 3 review' }),
    ).toBeDefined();
    expect(captureApiFailure).not.toHaveBeenCalled();
  });
});
