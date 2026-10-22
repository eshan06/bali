import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SessionReportSummary } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { sessionWhen } from '../lib/recap';
import { FIRST_READ, type SessionList } from '../lib/reports';
import { FocusBars, focusBar, ReportsView, SessionsTable } from './reports-list';

/*
 * Reports (PV13) as Bali portal in v2's look draws it on Reports and ReportStates: the heading
 * and its framing line in italic, the class picked with pills, the sessions as a table in a box
 * that scrolls sideways, newest first, each a link to its own page (PV14), with Show earlier, each
 * session's average focus as a bar out of its length, and every state ReportStates draws. Rendered,
 * each state given as the page holds it; the page's own wiring and the old URL's redirect from
 * their sources.
 */
const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));
const { default: ClassReports } = await import('../app/classes/[id]/reports/page');
const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

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
// Ended early, at 9:41 for a 9:05 start: 36 minutes long.
const FRI = lesson('s2', 2, { endedAt: '2026-10-02T14:41:00.000Z', averageFocusMinutes: 35 });
const NOBODY = lesson('s1', 1, {
  joinedCount: 0,
  focusMinutes: 0,
  averageFocusMinutes: null,
  silentMinutes: 0,
  unlockCount: 0,
  protectionOffCount: 0,
});

const CLASSES = [
  { id: 'c1', name: 'Biology, period 3' },
  { id: 'c2', name: 'Period 1 Biology' },
];
const LOADED: SessionList = {
  ...FIRST_READ,
  className: 'Biology, period 3',
  sessions: [TUE, FRI, NOBODY],
  nextBefore: 's1',
  loaded: true,
  reading: null,
};

const view = (over: Partial<Parameters<typeof ReportsView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ReportsView, {
      classes: CLASSES,
      classId: 'c1',
      list: LOADED,
      onRead: () => undefined,
      ...over,
    }),
  ).replace(/\s/g, ' ');
const table = (sessions = [TUE, FRI, NOBODY]) =>
  renderToStaticMarkup(createElement(SessionsTable, { classId: 'c1', sessions })).replace(
    /\s/g,
    ' ',
  );
/** The text of some markup, its tags dropped. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '|')
    .replace(/\|+/g, '|')
    .replace(/&#x27;/g, "'");
const when = (session: SessionReportSummary) => {
  const { day, times } = sessionWhen(session);
  return `${day}|,|${times.replace(/\s/g, ' ')}`;
};
const classesOf = (html: string, tag: RegExp) =>
  /\bclass="([^"]*)"/.exec(tag.exec(html)?.[0] ?? '')?.[1]?.split(' ') ?? [];

describe('a session’s average focus as its bar', () => {
  it('is its average out of its length, start to end in whole minutes', () => {
    expect(focusBar(TUE)).toEqual({ words: '45 of 50 min', percent: 90 });
    // An early End counts to the End, as the table's times say it.
    expect(focusBar(FRI)).toEqual({ words: '35 of 36 min', percent: (35 / 36) * 100 });
    // Not marked over yet: to its bell.
    expect(focusBar({ ...TUE, endedAt: null })?.words).toBe('45 of 50 min');
    // Its exact length rounded, as R2 rounds the average: 35 min 20 s is 35.
    const seconds = { startedAt: '2026-10-02T14:05:50.000Z', endedAt: '2026-10-02T14:41:10.000Z' };
    expect(focusBar({ ...FRI, ...seconds })?.words).toBe('35 of 35 min');
  });

  it('has none for a session nobody joined, and never runs past its track', () => {
    expect(focusBar(NOBODY)).toBeNull();
    expect(focusBar({ ...TUE, endedAt: TUE.startedAt })).toEqual({
      words: '45 of 0 min',
      percent: 0,
    });
    expect(focusBar({ ...TUE, averageFocusMinutes: 51 })?.percent).toBe(100);
    expect(focusBar({ ...TUE, averageFocusMinutes: 1250 }, 'en-US')?.words).toBe('1,250 of 50 min');
  });
});

describe('the sessions’ table (Reports)', () => {
  it('names its columns in the grey head, then a row per session, newest first', () => {
    const html = table();
    expect(text(/<thead>.*<\/thead>/.exec(html)?.[0] ?? '')).toBe(
      '|Session|Joined|Focus time|Average|Silent|Unlocks|Protection off|',
    );
    expect(html.match(/<th scope="col" class="[^"]*\bbg-surface-sunken\b[^"]*">/g)).toHaveLength(7);
    expect(html).toMatch(/<table aria-label="Sessions, newest first"/);
    const rows = [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(([, row = '']) => text(row));
    expect(rows.slice(1)).toEqual([
      `|${when(TUE)}|27|${new Intl.NumberFormat().format(1214)} min|45 min|23 min|4|1|`,
      `|${when(FRI)}|27|${new Intl.NumberFormat().format(1214)} min|35 min|23 min|4|1|`,
      `|${when(NOBODY)}|Nobody joined|0|0|`,
    ]);
  });

  it('says nobody joined across the four figures, never zeros', () => {
    expect(table()).toMatch(
      /<td colSpan="4" class="[^"]*\btext-text-secondary\b[^"]*">Nobody joined<\/td>/i,
    );
  });

  it('scrolls sideways in its box, its figures on one line each (DESIGN.md §8)', () => {
    const html = table();
    expect(classesOf(html, /<div[^>]*>/)).toEqual(
      expect.arrayContaining(['overflow-x-auto', 'rounded-frame', 'border-border-default']),
    );
    for (const figure of html.match(/<td class="[^"]*"/g) ?? []) {
      expect(figure).toMatch(/\btext-right\b.*\bwhitespace-nowrap\b/);
    }
    // Its session too, its day and times one line each: on a phone the box scrolls, never wraps.
    for (const session of html.match(/<th scope="row" class="[^"]*"/g) ?? []) {
      expect(session).toMatch(/\bwhitespace-nowrap\b/);
    }
  });

  it('heads each row with its session, a link to its own page (PV14)', () => {
    const html = table();
    const links = [
      ...html.matchAll(/<th scope="row" class="[^"]*"><a class="([^"]*)" href="([^"]*)">/g),
    ];
    expect(links.map((m) => m[2])).toEqual(['/reports/c1/s3', '/reports/c1/s2', '/reports/c1/s1']);
    expect(links[0]?.[1]).toBe('group block rounded-sm text-left');
    // A row per session, none opening under it any more.
    expect(html.match(/<tr>/g)).toHaveLength(4);
    expect(html).not.toMatch(/<button|aria-expanded|bg-row-open|colSpan="7"/);
  });

  it('says a session’s day in semibold, underlined on hover, its times under it', () => {
    expect(table()).toMatch(
      /<span class="block font-semibold underline-offset-2 group-hover:underline">[^<]+<span class="sr-only">,<\/span><\/span><span class="block text-cell-sub text-text-tertiary">/,
    );
  });
});

describe('each session’s average focus, beside the table', () => {
  const bars = (sessions: SessionReportSummary[]) =>
    renderToStaticMarkup(createElement(FocusBars, { sessions })).replace(/\s/g, ' ');

  it('is a bar per session someone joined, out of its length, and the board’s caption', () => {
    const html = bars([TUE, NOBODY, FRI]);
    expect(text(html)).toBe(
      `|Average focus per session|${sessionWhen(TUE).day}|,|45 of 50 min|${sessionWhen(FRI).day}|,|35 of 36 min|Out of each session's length. Averages only: Bali never ranks students.|`,
    );
    expect(html).toMatch(/style="width:90%"/);
    // The track is grey, hidden from a screen reader: its words say the figure.
    expect(html).toMatch(
      /<span aria-hidden="true" class="[^"]*\bbg-surface-sunken\b[^"]*"><span class="[^"]*\bbg-surface-brand\b/,
    );
    expect(html).toMatch(
      /<ul class="grid grid-cols-\[116px_minmax\(0,1fr\)_minmax\(70px,max-content\)\]/,
    );
  });

  it('is nothing when no session has one', () => {
    expect(bars([NOBODY])).toBe('');
    expect(bars([])).toBe('');
  });
});

describe('the Reports page in each state (ReportStates)', () => {
  it('heads it Reports over its framing line, in the italic face alone (PV4)', () => {
    const html = view();
    expect(html).toMatch(
      /^<div class="flex flex-col gap-5\.5"><header><h1 class="text-page-title">Reports<\/h1><p class="[^"]*">Patterns are conversation starters, not verdicts\.<\/p><\/header>/,
    );
    const framing = classesOf(html, /<p class="[^"]*\bitalic\b[^"]*">/);
    expect(framing).toEqual(expect.arrayContaining(['italic', 'text-body', 'text-text-secondary']));
    // `font-sans` would set the upright face, slanted, over the italic one.
    expect(framing).not.toContain('font-sans');
  });

  it('picks the class with pills, one marked, filled and semibold, no "All classes"', () => {
    const html = view({ classId: 'c2' });
    const pills = [...html.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map(([, attrs = '', name]) => ({
      name,
      href: /href="([^"]*)"/.exec(attrs)?.[1],
      current: attrs.includes('aria-current="page"'),
    }));
    expect(pills).toEqual([
      { name: 'Biology, period 3', href: '/reports?class=c1', current: false },
      { name: 'Period 1 Biology', href: '/reports?class=c2', current: true },
    ]);
    expect(html).toMatch(/<nav aria-label="Class" class="flex flex-wrap gap-2">/);
    expect(classesOf(html, /<a [^>]*>/)).toEqual(
      expect.arrayContaining([
        'rounded-full',
        'text-pill',
        'aria-[current=page]:bg-surface-brand',
        'aria-[current=page]:font-semibold',
        'aria-[current=page]:text-text-on-brand',
      ]),
    );
    expect(html).not.toContain('All classes');
  });

  it('says it is loading the sessions under the pills, and nothing else', () => {
    const html = view({ list: FIRST_READ });
    expect(html).toMatch(
      /<\/nav><div><div role="status"><p class="text-body text-text-secondary">Loading sessions…<\/p><\/div><\/div><\/div>$/,
    );
  });

  it('says why the sessions couldn’t load, in a card, Try again reading them again', () => {
    const failed = {
      ...FIRST_READ,
      reading: null,
      failure: { at: 'newest' as const, message: 'x' },
    };
    const html = view({ list: failed });
    expect(html).toMatch(
      /<div class="[^"]*\bshadow-1\b[^"]*"><p role="alert" class="text-body"><span class="block font-semibold">Couldn(&#x27;|')t load the sessions\.<\/span><span class="text-text-secondary">x<\/span><\/p><button type="button" aria-disabled="false" aria-busy="false" class="[^"]*\bh-10\b[^"]*\bmt-3\.5\b[^"]*">Try again<\/button><\/div>/,
    );
    expect(html).not.toMatch(/No reports yet|Loading sessions/);
  });

  it('keeps the sessions’ failure said while Try again reads them, Try again held, no loading line (ReportRetryStates)', () => {
    // Its line kept and Try again held as Loading… until Bali answers, so focus stays on it; never
    // "Loading sessions…" in its place, which dropped Try again, and focus with it.
    const held = view({
      list: { ...FIRST_READ, reading: 'newest', failure: { at: 'newest', message: 'x' } },
    });
    expect(held).toMatch(
      /<span class="text-text-secondary">x<\/span><\/p><button type="button" aria-disabled="true" aria-busy="true" class="[^"]*">Loading…<\/button><\/div>/,
    );
    expect(held).not.toMatch(/Loading sessions/);
    // Read: focus on the sessions' label, or on Reports, the page's heading, while it has none.
    expect(source('./reports-list.tsx')).toMatch(
      /<TryAgain\s+size="md"\s+onRetry=\{\(\) => onRead\('newest'\)\}\s+held=\{list\.reading === 'newest'\}\s+then=\{\[sessionsId\]\}\s+className="mt-3\.5"\s*>/,
    );
  });

  it('says there are none yet over when one will show, for a class or an account with none', () => {
    const empty = { ...LOADED, sessions: [], nextBefore: null };
    const words =
      /<p class="flex flex-col text-body text-text-secondary"><span class="font-semibold text-text-primary">No reports yet\.<\/span><span>When a session ends, its report shows here\.<\/span><\/p>/;
    expect(view({ list: empty })).toMatch(words);
    // A teacher with no class yet: no pills, nothing loading, the same words.
    const none = view({ classes: [], classId: null, list: FIRST_READ });
    expect(none).toMatch(words);
    expect(none).not.toMatch(/<nav|Loading sessions/);
  });

  it('shows the sessions as a table beside their bars, under the class’s name', () => {
    const html = view();
    expect(html).toMatch(
      /<div class="flex flex-wrap items-start gap-5"><section aria-labelledby="([^"]+)" class="flex min-w-0 flex-\[999_1_520px\] flex-col gap-5"><h2 id="\1" class="mb-3 text-section-label text-text-tertiary uppercase">Sessions · Biology, period 3<\/h2><div class="overflow-x-auto/,
    );
    expect(html).toMatch(
      /<section aria-labelledby="([^"]+)" class="flex min-w-0 flex-\[1_1_320px\] flex-col gap-5"><h2 id="\1"[^>]*>Average focus per session<\/h2>/,
    );
  });

  it('offers Show earlier, small, held while it reads, gone at the end', () => {
    expect(view()).toMatch(
      /<div class="mt-3"><button type="button" aria-disabled="false" aria-busy="false" class="[^"]*\bh-8\.5\b[^"]*\bborder-border-strong\b[^"]*">Show earlier<\/button><\/div>/,
    );
    expect(view({ list: { ...LOADED, reading: 'earlier' } })).toMatch(
      /<div class="mt-3"><button type="button" aria-disabled="true" aria-busy="true" [^>]*>Loading…<\/button><\/div>/,
    );
    // Held in its own words while another read is on its way (the newest page's Try again), as
    // before: a press then sends nothing.
    expect(
      view({ list: { ...LOADED, reading: 'newest', failure: { at: 'newest', message: 'x' } } }),
    ).toMatch(
      /<div class="mt-3"><button type="button" aria-disabled="true" aria-busy="false" [^>]*>Show earlier<\/button><\/div>/,
    );
    expect(view({ list: { ...LOADED, nextBefore: null } })).not.toMatch(/Show earlier/);
  });

  it('says earlier sessions didn’t load in one line, a small Try again beside it', () => {
    const failed = { ...LOADED, failure: { at: 'earlier' as const, message: 'x' } };
    expect(view({ list: failed })).toMatch(
      /<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Couldn(&#x27;|')t load earlier sessions\. x<\/p><button type="button" aria-disabled="false" aria-busy="false" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/div>/,
    );
    expect(view({ list: failed })).not.toMatch(/Show earlier/);
  });

  it('keeps earlier sessions’ failure said while Try again reads them, focus then on Show earlier (ReportRetryStates)', () => {
    const held = view({
      list: { ...LOADED, reading: 'earlier', failure: { at: 'earlier', message: 'x' } },
    });
    expect(held).toMatch(
      /t load earlier sessions\. x<\/p><button type="button" aria-disabled="true" aria-busy="true" class="[^"]*\bh-8\.5\b[^"]*">Loading…<\/button><\/div>/,
    );
    expect(held).not.toMatch(/Show earlier/);
    // Read: on Show earlier, as after its own read, the same button saying it again; on the
    // sessions' label once none are left (the hand-off, above).
    const src = source('./reports-list.tsx');
    expect(src).toMatch(
      /<TryAgain\s+onRetry=\{\(\) => onRead\('earlier'\)\}\s+held=\{list\.reading === 'earlier'\}\s+blocked=\{list\.reading !== null\}\s+then=\{\[sessionsId\]\}/,
    );
    expect(src).toMatch(
      /const earlier = list\.failure\?\.at === 'earlier' \? list\.failure : null;/,
    );
    // The sessions' loading line only for a first read, never over a failure being read again.
    expect(src).toMatch(
      /const loading = classId !== null && list\.reading === 'newest' && list\.failure === null;/,
    );
  });

  it('hands focus on as Try again does once Show earlier goes with the last page: to the sessions’ label (ReportRetryStates)', () => {
    // Its own button went as the last page landed, and focus fell to the page's body (#429's
    // worker found it). Show earlier is `TryAgain`'s own button now, as a send's is: held as
    // Loading… while it reads and Try again once a read of it failed, one button throughout, so
    // focus stays on it; gone with the last page, it lands focus on the sessions' label, as its Try
    // again's does "once there are no earlier ones".
    const src = source('./reports-list.tsx');
    expect(src).toMatch(
      /<TryAgain\s+onRetry=\{\(\) => onRead\('earlier'\)\}\s+held=\{list\.reading === 'earlier'\}\s+blocked=\{list\.reading !== null\}\s+then=\{\[sessionsId\]\}\s+send=\{\{\s*words: 'Show earlier',\s*sending: 'Loading…',\s*failed: earlier !== null,\s*\}\}\s*>/,
    );
    // No button of its own beside it, which went with no hand-off; one read of earlier sessions.
    expect(src).not.toMatch(/<Button\b/);
    expect(src.match(/onRead\('earlier'\)/g)).toHaveLength(1);
  });

  it('says the place was lost in v2’s grey notice, over the sessions it read again', () => {
    expect(view({ list: { ...LOADED, restarted: true } })).toMatch(
      /<div role="status"><p class="mb-5\.5 rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body">Bali lost your place in the list, so it starts again from the newest session\.<\/p><\/div><div class="flex flex-wrap/,
    );
  });
});

describe('the page’s wiring (read from its source)', () => {
  const page = source('../app/reports/page.tsx');

  it('reads the class ?class= names, else the account’s first, and again as another is picked', () => {
    expect(page).toMatch(/const param = useSearchParams\(\)\.get\('class'\);/);
    expect(page).toMatch(/const classId = asked \?\? classes\?\.\[0\]\?\.id \?\? null;/);
    expect(page).toMatch(
      /if \(classId === null\) return;\s*void read\(FIRST_READ, 'newest'\);\s*return \(\) => \{\s*latest\.current \+= 1;\s*\};\s*\}, \[api, classId, router\]\);/,
    );
    // Only the newest read's answer counts.
    expect(page).toMatch(/if \(mine === latest\.current\) setList\(next\);/);
  });

  it('takes only a class id from ?class=, so no other path reaches the API (santa’s review)', () => {
    // `..` survives encodeURIComponent, and would read /v1/reports/sessions in the class's place:
    // `UUID` takes ids as the API mints them, and nothing else (lib/reports.test.ts).
    expect(page).toMatch(/const asked = param !== null && UUID\.test\(param\) \? param : null;/);
  });

  it('starts another class’s list afresh in the render that picks it (santa’s review)', () => {
    // A pick of no class kept the last failure; and, while a row opened under it (until PV14), the
    // last class's session was drawn, and read, under the new class's id.
    expect(page).toMatch(
      /if \(listed !== classId\) \{\s*setListed\(classId\);\s*setList\(FIRST_READ\);\s*\}/,
    );
  });

  it('takes the classes from the shell’s one read of the account', () => {
    expect(page).toMatch(/const \{ home \} = useMe\(\);/);
    expect(page).not.toContain("'/v1/me'");
    // None until it is read; none for an account the 13+ check never passed (PV15), read no
    // further, so it says "No reports yet." as one with no classes does.
    expect(page).toMatch(
      /const classes = home === null \? null : home\.kind === 'invite' \? \[\] : home\.me\.classes;/,
    );
  });
});

describe('a class’s old reports URL', () => {
  it('lands on Reports with that class picked', async () => {
    await ClassReports({ params: Promise.resolve({ id: 'c1' }) });
    expect(redirect).toHaveBeenLastCalledWith('/reports?class=c1');
    await ClassReports({ params: Promise.resolve({ id: 'a&b' }) });
    expect(redirect).toHaveBeenLastCalledWith('/reports?class=a%26b');
  });

  it('is gone from the class page, whose Reports opens Reports with its class picked', () => {
    expect(source('../app/classes/[id]/page.tsx')).toMatch(
      /href=\{`\/reports\?class=\$\{encodeURIComponent\(classId\)\}`\}/,
    );
  });
});
