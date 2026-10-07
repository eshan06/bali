import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SessionReportSummary } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { sessionWhen } from '../lib/recap';
import { Row } from './reports-list';

/*
 * A class's reports as the Recap & reports canvas draws them. Each session's card rendered: its
 * day over its times, its figures with "min" beside the minutes, a zero quiet, an unlock or
 * protection-off count in its state's ink with its icon, never colour alone, and opened, its
 * recap under a hairline. The page's own states, which need a read to answer, from its source.
 */
// An opened card's recap reads through the API, whose sign-out needs the router.
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
const { default: ReportsPage } = await import('../app/classes/[id]/reports/page');
const page = readFileSync(
  fileURLToPath(new URL('../app/classes/[id]/reports/page.tsx', import.meta.url)),
  'utf8',
);

function lesson(id: string, day: number, over: Partial<SessionReportSummary> = {}) {
  const at = (minute: number) =>
    `2026-10-${String(day).padStart(2, '0')}T14:${String(minute).padStart(2, '0')}:00.000Z`;
  return {
    id,
    startedAt: at(5),
    endsAt: at(55),
    endedAt: at(55),
    ended: true,
    joinedCount: 27,
    focusMinutes: 1214,
    averageFocusMinutes: 45,
    silentMinutes: 23,
    unlockCount: 4,
    protectionOffCount: 1,
    ...over,
  } satisfies SessionReportSummary;
}
const TUE = lesson('s3', 6);
const MON = lesson('s2', 5, { silentMinutes: 0, unlockCount: 0, protectionOffCount: 0 });
const NOBODY = lesson('s1', 1, {
  joinedCount: 0,
  focusMinutes: 0,
  averageFocusMinutes: null,
  silentMinutes: 0,
  unlockCount: 0,
  protectionOffCount: 0,
});

const render = (session: SessionReportSummary, open = false) =>
  renderToStaticMarkup(
    createElement(Row, { classId: 'c1', session, open, onToggle: () => undefined }),
  ).replace(/\s/g, ' ');
/** The text of a card, its tags dropped. */
const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
const when = (session: SessionReportSummary) => {
  const { day, times } = sessionWhen(session);
  return `${day}|,|${times.replace(/\s/g, ' ')}`;
};

describe('a session’s card in the reports', () => {
  it('says its day over its times, then its figures, the minutes with "min"', () => {
    const html = render(TUE);
    expect(text(html)).toBe(
      `|${when(TUE)}|Joined|27|Focus time|${new Intl.NumberFormat().format(1214)}| min|Average|45| min|Silent|23| min|Unlocks|4|Protection off|1|`,
    );
    // The unit in the secondary ink, at the regular weight.
    expect(html).toMatch(/<span class="font-normal text-text-secondary"> min<\/span>/);
    // Each figure's name for a screen reader on a wide row, for the eye on a narrow one.
    expect(html.match(/<dt class="[^"]*@4xl:sr-only[^"]*">/g)).toHaveLength(6);
  });

  it('says a count in its state’s ink and icon, and a zero quietly', () => {
    const tue = render(TUE);
    expect(tue).toMatch(
      /<span class="[^"]*\btext-state-emergency-fg\b[^"]*"><svg[^>]*lucide-lock-open/,
    );
    expect(tue).toMatch(
      /<span class="[^"]*\btext-state-revoked-fg\b[^"]*"><svg[^>]*lucide-shield-off/,
    );
    const mon = render(MON);
    expect(mon).not.toMatch(
      /text-state-emergency-fg|text-state-revoked-fg|lucide-lock|lucide-shield/,
    );
    // Silent 0 min, Unlocks 0 and Protection off 0: each quiet, the unit too.
    expect(mon.match(/<span class="text-text-tertiary dark:text-text-secondary">0/g)).toHaveLength(
      3,
    );
  });

  it('says nobody joined in the four figures’ place, never zeros', () => {
    expect(text(render(NOBODY))).toBe(
      `|${when(NOBODY)}|Joined|Nobody joined|Unlocks|0|Protection off|0|`,
    );
  });

  it('opens its recap under a hairline, the button saying so', () => {
    const open = render(MON, true);
    expect(open).toMatch(
      /<button type="button" aria-expanded="true" aria-controls="recap-s2"[^>]*><svg[^>]*lucide-chevron-down/,
    );
    expect(open).toMatch(/<div id="recap-s2" class="[^"]*\bborder-t\b[^"]*\bpt-4\b/);
    expect(render(MON)).toMatch(/aria-expanded="false"[^>]*><svg[^>]*lucide-chevron-right/);
  });
});

describe('the reports page', () => {
  it('says it is loading the sessions, under the way back and the heading', () => {
    const html = renderToStaticMarkup(createElement(ReportsPage));
    expect(html).toMatch(
      /Back to the class<\/a><h1[^>]*>Reports<\/h1><p role="status"[^>]*>Loading sessions…<\/p>/,
    );
  });

  it('says why the sessions couldn’t load, its reason on its own line, Try again under both', () => {
    expect(page).toMatch(
      /list\.failure\?\.at === 'newest' \? \(\s*<div className="mt-6">\s*<div role="alert" className="text-body">\s*<p className="font-semibold">Couldn&apos;t load the sessions\.<\/p>\s*<p className="text-text-secondary">\{list\.failure\.message\}<\/p>\s*<\/div>\s*<Button variant="secondary" onClick=\{\(\) => void read\(list, 'newest'\)\} className="mt-4">\s*Try again/,
    );
  });

  it('says there are none yet over when one will show', () => {
    expect(page).toMatch(
      /<span className="font-semibold text-text-primary">No reports yet\.<\/span>\s*<span>When a session ends, its report shows here\.<\/span>/,
    );
  });

  it('keeps the list 72 rem in the class page’s column, its column names quiet', () => {
    expect(page).toMatch(/const PAGE = 'mx-auto max-w-\[1400px\][^']*\*:max-w-6xl';/);
    expect(page).toMatch(/className=\{`hidden [^`]*\$\{QUIET\} \$\{ROW\}`\}/);
  });
});
