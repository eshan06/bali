import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bellTime } from '../lib/session-controls';
import type { GridDisplay } from '../lib/grid-state';
import { stateCounts } from './live-grid';
import { LiveCounts, LiveHeader, shareLeft, timeLeft } from './live-header';

/*
 * A class's header while a session runs and its counts over the grid (PV7; ClassLive, and
 * PhoneClassLive at 390 px), rendered: the ring, the name over "Live · 25 of 28 joined · join code
 * VMAF7E", the countdown on this computer's clock to the server's bell with the bell's time under
 * it, the controls at the end; then the six counts in their states' tints, icons and words.
 */
const STARTED = '2026-10-12T14:05:00.000Z';
const BELL = '2026-10-12T14:55:00.000Z';
/** 23:14 before the bell, as ClassLive draws it. */
const NOW = Date.parse(BELL) - (23 * 60 + 14) * 1000;

/** ClassLive's 28 tiles, by their states. */
const CLASS_LIVE: GridDisplay[] = [
  ...Array<GridDisplay>(17).fill('focused'),
  ...Array<GridDisplay>(3).fill('unlocked'),
  ...Array<GridDisplay>(2).fill('protection_off'),
  'silent',
  ...Array<GridDisplay>(3).fill('absent'),
  'ended',
  'left_unprotected',
];

const header = (props: Partial<Parameters<typeof LiveHeader>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(LiveHeader, {
      name: 'Biology, period 3',
      joinCode: 'VMAF7E',
      counts: stateCounts(CLASS_LIVE),
      startedAt: STARTED,
      endsAt: BELL,
      children: createElement('button', { type: 'button' }, 'End session'),
      ...props,
    }),
  );

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

  it('is a share of the session for the ring: whole at the start, none at the bell', () => {
    expect(shareLeft(STARTED, BELL, NOW)).toBeCloseTo(1394 / 3000);
    expect(shareLeft(STARTED, BELL, Date.parse(STARTED) - 1000)).toBe(1);
    expect(shareLeft(STARTED, BELL, Date.parse(BELL) + 1000)).toBe(0);
    expect(shareLeft(BELL, BELL, NOW)).toBe(0);
  });
});

describe('the live header (ClassLive)', () => {
  it('draws the ring, the name over its line, the countdown and the bell, then the controls', () => {
    vi.useFakeTimers({ now: NOW });
    const html = header();
    expect(html).toMatch(
      /^<header class="flex flex-wrap items-center gap-x-4\.5 gap-y-3\.5 max-sm:gap-x-3\.5"><svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" class="shrink-0">/,
    );
    expect(html).toMatch(
      /<h1 class="text-page-title text-balance wrap-anywhere max-sm:text-h3">Biology, period 3<\/h1>/,
    );
    expect(html).toMatch(
      /<p class="mt-0\.5 text-meta text-text-secondary">Live · 25 of 28 joined · (<!-- -->)?join\u00a0code\u00a0<span translate="no" class="font-mono font-medium">VMAF7E<\/span><\/p>/,
    );
    expect(html).toContain(
      `<span class="font-num text-data-lg">23:14</span><span class="text-countdown-sub text-text-secondary">ends <time dateTime="${BELL}">${bellTime(BELL)}</time></span>`,
    );
    // The controls at the end, on a line of their own on a phone.
    expect(html).toMatch(
      /<div class="ml-auto flex flex-wrap items-center gap-2 max-sm:ml-0 max-sm:basis-full"><button type="button">End session<\/button><\/div><\/header>$/,
    );
  });

  it('sets the countdown apart by a hairline, at the right with none on a phone', () => {
    vi.useFakeTimers({ now: NOW });
    const countdown = /<p class="([^"]*)"><span class="font-num/.exec(header())?.[1]?.split(' ');
    expect(countdown).toEqual(
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

  it('draws the time left as a green arc from the top on its track, stroked 5 as drawn', () => {
    vi.useFakeTimers({ now: NOW });
    const ring = /<svg[^]*?<\/svg>/.exec(header())?.[0] ?? '';
    expect(ring).toMatch(
      /<circle cx="22" cy="22" r="19\.5" fill="none" stroke-width="5" class="stroke-arc-track"><\/circle>/,
    );
    const around = 2 * Math.PI * 19.5;
    expect(ring).toContain(
      `stroke-linecap="round" stroke-dasharray="${((1394 / 3000) * around).toFixed(1)} ${around.toFixed(1)}" transform="rotate(-90 22 22)" class="stroke-arc-fill"`,
    );
    // At the bell, the track alone: a round cap would draw a dot for nothing left.
    vi.setSystemTime(Date.parse(BELL));
    expect(header()).not.toContain('stroke-arc-fill');
  });

  it('says "Live" and the code until the grid is counted, and "…" until the bell is known', () => {
    vi.useFakeTimers({ now: NOW });
    const html = header({ counts: null, startedAt: null, endsAt: null });
    expect(html).toMatch(/>Live · (<!-- -->)?join\u00a0code\u00a0<span translate="no"/);
    expect(html).toContain(
      '<span class="font-num text-data-lg text-text-tertiary">…</span><span class="text-countdown-sub">\u00a0</span>',
    );
    expect(html).not.toContain('stroke-arc-fill');
  });
});

describe('the counts over the grid (ClassLive)', () => {
  const html = renderToStaticMarkup(createElement(LiveCounts, { counts: stateCounts(CLASS_LIVE) }));
  const chips = [...html.matchAll(/<li class="([^"]*)">([^]*?)<\/li>/g)];

  it('counts each state in its words, as ClassLive does, in its order', () => {
    expect(html).toMatch(
      /^<ul aria-label="The class right now" class="flex flex-wrap items-center gap-2">/,
    );
    expect(chips.map((m) => m[2]?.replace(/<svg[^]*<\/svg>/, ''))).toEqual([
      '17 Focused',
      '3 Unlocked',
      '2 Protection off',
      '1 Silent',
      '3 Not here',
      '2 Left',
    ]);
  });

  it('draws each as a small chip in its state’s tint, with its icon, never colour alone', () => {
    for (const [, classes = '', inner = ''] of chips) {
      expect(classes.split(' ')).toEqual(
        expect.arrayContaining([
          'rounded-full',
          'border-[1.5px]',
          'px-2.5',
          'py-0.75',
          'gap-1.5',
          'text-caption',
          'font-medium',
          'whitespace-nowrap',
        ]),
      );
      expect(inner).toMatch(/^<svg[^>]*\bwidth="13"[^>]*\baria-hidden="true"/);
    }
    const tones = chips.map((m) => m[1]?.split(' ').find((c) => c.startsWith('bg-')));
    expect(tones).toEqual([
      'bg-state-focused-bg',
      'bg-state-emergency-bg',
      'bg-state-revoked-bg',
      'bg-state-ended-bg',
      'bg-state-notjoined-bg',
      'bg-state-ended-bg',
    ]);
    // Silent's dashed edge tells it from Left's, as on its tile.
    expect(chips[3]?.[1]).toMatch(/\bborder-dashed\b/);
    expect(chips[5]?.[1]).not.toMatch(/\bborder-dashed\b/);
  });

  it('shows a zero too, so no count comes and goes', () => {
    const none = renderToStaticMarkup(createElement(LiveCounts, { counts: stateCounts([]) }));
    expect(none.match(/<li /g)).toHaveLength(6);
    expect(none).toContain('0 Focused');
  });
});
