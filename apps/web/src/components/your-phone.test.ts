import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { bellTime } from '../lib/session-controls';
import type { PhoneChip } from '../lib/student-web';
import { CHIP, CHIP_PILL } from './live-grid';
import { YourPhone } from './your-phone';

/*
 * "Your phone" and its chip (W4), as StudentPhoneStates draws each state and StudentChipStates the
 * ones drawn first: the lesson page's head and the home's live card both draw it.
 */
const phone = (chip: PhoneChip | null, asOf: number | null = null, className?: string) =>
  renderToStaticMarkup(createElement(YourPhone, { chip, asOf, className }));
const words = (html: string) =>
  html
    .split(/<[^>]+>/)
    .filter((s) => s.trim() !== '')
    .join('|');
const SINCE = '2026-10-12T14:38:00.000Z';

describe('YourPhone', () => {
  it('says each state in the app’s words, in its tile’s own tint, icon and edge on the grid', () => {
    const cases: [PhoneChip, keyof typeof CHIP, string, string][] = [
      [{ kind: 'focused' }, 'focused', 'Focused', 'lucide-circle-check'],
      [{ kind: 'not_in' }, 'absent', 'Not in', 'class="lucide lucide-circle shrink-0"'],
      [{ kind: 'unlocked' }, 'unlocked', 'Unlocked', 'lucide-lock-open'],
      [{ kind: 'protection_off' }, 'protection_off', 'Screen Time off', 'lucide-shield-off'],
      [{ kind: 'silent', minutes: 3, since: SINCE }, 'silent', 'Silent · 3 min', 'lucide-wifi-off'],
      [{ kind: 'unknown' }, 'unknown', 'Unknown · refresh', 'lucide-circle-question-mark'],
    ];
    for (const [chip, grid, label, icon] of cases) {
      const html = phone(chip);
      expect(html).toContain(
        `<p role="status" class="inline-flex flex-wrap items-center gap-2"><span class="text-caption text-text-tertiary">Your phone</span><span class="${CHIP_PILL} ${CHIP[grid].tone}"><svg`,
      );
      expect(html).toContain(icon);
      expect(words(html)).toBe(`Your phone|${label}`);
    }
  });

  it('is a pill as v2’s `.chip-mini`: 3 × 10 px in, 13/18, its edge 1.5 px; Silent and Unknown dashed, never green', () => {
    expect(CHIP_PILL.split(' ')).toEqual(
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
    for (const chip of [
      { kind: 'silent', minutes: 3, since: SINCE },
      { kind: 'unknown' },
    ] satisfies PhoneChip[]) {
      const html = phone(chip);
      expect(html).toMatch(/border-dashed border-border-strong/);
      expect(html).not.toMatch(/focused/);
    }
  });

  it('says Checking… before Bali first answers, and nothing as of then', () => {
    expect(phone(null)).toBe(
      '<p role="status" class="inline-flex flex-wrap items-center gap-2"><span class="text-caption text-text-tertiary">Your phone</span><span class="text-caption text-text-secondary">Checking…</span></p>',
    );
    expect(phone(null, Date.parse(SINCE))).not.toContain('as of');
  });

  it('keeps the chip as of the last good read while the page can’t reach Bali', () => {
    const at = Date.parse('2026-10-12T14:41:00.000Z');
    const iso = new Date(at).toISOString();
    const html = phone({ kind: 'focused' }, at);
    expect(html).toContain(
      `<span class="text-caption text-text-tertiary">as of <time dateTime="${iso}">${bellTime(iso)}</time></span></p>`,
    );
    expect(words(html)).toBe(`Your phone|Focused|as of |${bellTime(iso)}`);
  });

  it('takes the place’s own margin: the home’s card puts it at the right', () => {
    expect(phone({ kind: 'focused' }, null, 'ml-auto')).toMatch(
      /^<p role="status" class="inline-flex flex-wrap items-center gap-2 ml-auto">/,
    );
  });
});
