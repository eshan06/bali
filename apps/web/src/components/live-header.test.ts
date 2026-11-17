import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bellTime } from '../lib/session-controls';
import { Countdown, LiveHead, nextTick, PresentClock, shareLeft, timeLeft } from './live-header';

/*
 * The time left to a session's bell, rendered where it shows: the class page's live header in the
 * lock-only look (LO5; ClassLive, LiveTopStates), Present's band (LO9; Present, PresentStates), and
 * the student's lesson page's countdown (W4), each on this computer's clock to the server's bell.
 */
const STARTED = '2026-10-12T14:05:00.000Z';
const BELL = '2026-10-12T14:55:00.000Z';
/** 23:14 before the bell, as ClassLive draws it. */
const NOW = Date.parse(BELL) - (23 * 60 + 14) * 1000;
/** A no-break space, as the countdown holds its line's place with one. */
const NBSP = String.fromCharCode(0xa0);

afterEach(() => vi.useRealTimers());

describe('the time left', () => {
  it('reads minutes and seconds, hours once past one, rounded up so the bell reads 0:00', () => {
    expect(timeLeft((23 * 60 + 14) * 1000)).toBe('23:14');
    expect(timeLeft((23 * 60 + 13) * 1000 + 1)).toBe('23:14');
    expect(timeLeft((9 * 60 + 5) * 1000)).toBe('9:05');
    expect(timeLeft(65 * 60 * 1000)).toBe('1:05:00');
    expect(timeLeft(8 * 3600 * 1000)).toBe('8:00:00');
    expect(timeLeft(1)).toBe('0:01');
    expect(timeLeft(0)).toBe('0:00');
    // Past the bell, until the server marks the session over: never a negative time.
    expect(timeLeft(-5000)).toBe('0:00');
  });

  it('is read again just after each whole second turns over, and no more past the bell', () => {
    // 23:14.400 left: in 410 ms it reads 23:14, then every second on the bell's own milliseconds.
    expect(nextTick((23 * 60 + 14) * 1000 + 400)).toBe(410);
    expect(nextTick((23 * 60 + 14) * 1000)).toBe(10);
    expect(nextTick(999)).toBe(1009);
    // Each reading lands past the second it waited for, so the next is a whole second on.
    const left = (23 * 60 + 14) * 1000 + 400;
    const after = left - (nextTick(left) ?? 0);
    expect(timeLeft(after)).toBe('23:14');
    expect(nextTick(after)).toBe(1000);
    expect(timeLeft(after - (nextTick(after) ?? 0))).toBe('23:13');
    expect(nextTick(0)).toBeNull();
    expect(nextTick(-250)).toBeNull();
  });

  it('is a share of the session for the ring: whole at the start, none at the bell', () => {
    expect(shareLeft(STARTED, BELL, NOW)).toBeCloseTo(1394 / 3000);
    expect(shareLeft(STARTED, BELL, Date.parse(STARTED) - 1000)).toBe(1);
    expect(shareLeft(STARTED, BELL, Date.parse(BELL) + 1000)).toBe(0);
    expect(shareLeft(BELL, BELL, NOW)).toBe(0);
  });
});

describe('the class page’s live header in the lock-only look (LO5; ClassLive, LiveTopStates)', () => {
  const head = (endsAt: string | null) =>
    renderToStaticMarkup(
      createElement(LiveHead, {
        name: 'Biology, period 3',
        joinCode: 'VMAF7E',
        startedAt: endsAt ? STARTED : null,
        endsAt,
        children: createElement('button', { type: 'button' }, 'End session'),
      }),
    );

  it('says the time left over "left", when it ends beside the join code', () => {
    vi.useFakeTimers({ now: NOW });
    const html = head(BELL);
    expect(html).toContain(
      `<span class="text-home-countdown tabular-nums">23:14</span><span class="text-countdown-sub text-text-tertiary">left</span>`,
    );
    expect(html).toContain(`<span>Ends <time dateTime="${BELL}">${bellTime(BELL)}</time></span>`);
    expect(html).toMatch(/48" height="48"[^]*class="shrink-0 max-\[760px\]:size-11"/);
  });

  it('says … until the bell is known, and when it ends waits, its ring the track alone (LiveTopStates)', () => {
    vi.useFakeTimers({ now: NOW });
    const html = head(null);
    expect(html).toContain('<span class="text-home-countdown text-text-tertiary">…</span>');
    expect(html).not.toMatch(/Ends|<time/);
    expect(html).not.toContain('stroke-arc-fill');
    expect(html).toContain('Join code');
  });
});

describe('Present’s time (LO9; Present, PresentStates)', () => {
  const clock = (endsAt: string | null) =>
    renderToStaticMarkup(createElement(PresentClock, { startedAt: STARTED, endsAt }));
  const around = 2 * Math.PI * 37;

  it('draws the ring at 84 px stroked 10, the time left at 64/64 over "left, until" the bell at 20/26', () => {
    vi.useFakeTimers({ now: NOW });
    const html = clock(BELL);
    expect(html).toMatch(
      /^<div class="flex items-center gap-5"><svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true" class="shrink-0">/,
    );
    expect(html).toContain(
      '<circle cx="42" cy="42" r="37" fill="none" stroke-width="10" class="stroke-arc-track"></circle>',
    );
    expect(html).toContain(
      `stroke-linecap="round" stroke-dasharray="${((1394 / 3000) * around).toFixed(1)} ${around.toFixed(1)}" transform="rotate(-90 42 42)" class="stroke-arc-fill"`,
    );
    expect(html).toMatch(
      new RegExp(
        `<p class="flex flex-col gap-2"><span class="text-present-clock tabular-nums">23:14</span><span class="text-present-until text-text-secondary">left(<!-- -->)?, until <time dateTime="${BELL}">${bellTime(BELL)}</time></span></p></div>$`,
      ),
    );
  });

  it('says … over "left" until the bell is known, its ring the track alone', () => {
    vi.useFakeTimers({ now: NOW });
    const html = clock(null);
    expect(html).toContain(
      '<span class="text-present-clock text-text-tertiary">…</span><span class="text-present-until text-text-secondary">left</span>',
    );
    expect(html).not.toMatch(/, until|<time|stroke-arc-fill/);
  });
});

describe('the student’s lesson countdown (W4)', () => {
  const countdown = (endsAt: string | null) =>
    renderToStaticMarkup(createElement(Countdown, { endsAt, now: NOW }));

  it('sets the time left apart by a hairline, the bell under it, at the right with none on a phone', () => {
    const html = countdown(BELL);
    expect(html).toContain(
      `<span class="font-num text-data-lg tabular-nums">23:14</span><span class="text-countdown-sub text-text-secondary">ends <time dateTime="${BELL}">${bellTime(BELL)}</time></span>`,
    );
    expect(/^<p class="([^"]*)">/.exec(html)?.[1]?.split(' ')).toEqual(
      expect.arrayContaining([
        'border-l',
        'border-border-default',
        'pl-4.5',
        'max-sm:border-l-0',
        'max-sm:pl-0',
        'max-sm:text-right',
      ]),
    );
  });

  it('says … until the bell is known, its line’s place held', () => {
    expect(countdown(null)).toContain(
      `<span class="font-num text-data-lg text-text-tertiary">…</span><span class="text-countdown-sub">${NBSP}</span>`,
    );
  });
});
