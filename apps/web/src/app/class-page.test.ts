import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/*
 * The class page while no session runs, in v2's look (PV6; ClassBefore, ClassStates' lines before a
 * session and its Loading and errors). Before its class is read, the session's place holds a
 * Loading card, never the Start form, which used to flash while the class loaded, even mid-lesson.
 * Rendered as the server first draws it, before any read; what needs a read is read from the
 * source. And the page while a session runs (PV7; ClassLive, ClassStale, ClassStates' lines during
 * a session), read from the source too; its header and counts are rendered in live-header.test.ts,
 * and Present's own page, kept until PV9, is pinned in present.test.ts.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
const { default: ClassDetailPage } = await import('./classes/[id]/page');
const page = readFileSync(
  fileURLToPath(new URL('./classes/[id]/page.tsx', import.meta.url)),
  'utf8',
);

/** The page while no session runs: the render's second branch, to the end. */
const before = page.slice(page.indexOf('// No session running (PV6)'));
/** The page while a session runs: the render's first branch, before the one above. */
const live = page.slice(
  page.indexOf('return klass !== null && grid !== null && !grid.over ? ('),
  page.indexOf('// No session running (PV6)'),
);
/** A constant's class list, by its name. */
const classes = (name: string) =>
  (new RegExp(`const ${name} =\\s*'([^']*)'`).exec(page)?.[1] ?? '').split(' ');

describe('the class page before its class is read', () => {
  const html = renderToStaticMarkup(createElement(ClassDetailPage));

  it('holds the session’s place with Loading…, never the Start form: a session may be live', () => {
    expect(html).toMatch(
      /<section aria-label="Session" class="[^"]*\bmin-h-29\.5\b[^"]*"><p role="status" class="[^"]*">Loading…<\/p><\/section>/,
    );
    expect(html).not.toMatch(/Session length|Start session|minute session/);
    // Nor the roster or the join code: only a class read as not live shows them.
    expect(html).not.toMatch(/Roster|Join code|columns-3/);
  });

  it('holds the name’s place in the captions’ ink and its line’s, so nothing moves as it lands', () => {
    expect(html).toMatch(/<h1 class="[^"]*\btext-text-tertiary\b[^"]*">…<\/h1>/);
    expect(html).toMatch(/<p class="mt-0\.5 text-meta text-text-secondary">\u00a0<\/p>/);
  });

  it('has Reports as a small button at the header’s end, and no All classes: the menu has Home', () => {
    const reports = /<a [^>]*href="\/classes\/c1\/reports"[^>]*>[^]*?<\/a>/.exec(html)?.[0] ?? '';
    expect(reports).toMatch(/\bh-8\.5\b/);
    expect(reports).toMatch(/\btext-button-sm\b/);
    expect(reports).toMatch(/<svg[^>]*\blucide-chart-bar\b[^>]*>[^]*<\/svg>Reports<\/a>$/);
    expect(html).not.toContain('All classes');
  });

  it('says a class that didn’t load in that place, with Try again, and shows no roster', () => {
    const start = before.indexOf('{klass === null ? (');
    const unread = before.slice(start, before.indexOf('<form', start));
    expect(unread).toMatch(
      /error \? \([^]*role="alert"[^]*Couldn&apos;t load this class\. \{error\}[^]*size="sm" onClick=\{load\}[^]*Try again[^]*\) : \(/,
    );
    expect(unread).not.toMatch(/<form|startSession|JoinCode|roster/);
  });

  it('keeps a roster that didn’t load out of the class’s card: said under the header', () => {
    // Only the class's own read sets `error`, so a roster failing first never says the class
    // failed while it is still on its way (santa's review).
    expect(page.match(/setError\(errText\(e\)\)/g)).toHaveLength(1);
    expect(page).toMatch(/\/roster`\)\s*\.then\(setRoster, \(e: unknown\) => setRosterError\(/);
    expect(before).toMatch(/\{klass && \(error \?\? rosterError\) \? \(/);
  });
});

describe('the class page while no session runs (ClassBefore)', () => {
  it('heads it with the name over "28 students · no session running", Reports at the end', () => {
    expect(before).toMatch(
      /className=\{`text-page-title text-balance wrap-anywhere max-sm:text-h3 /,
    );
    expect(before).toMatch(
      /roster\s*\?\s*`\$\{students\(roster\.students\.length\)\} · no session running`\s*:\s*'No session running'/,
    );
    // On a phone the name takes the card titles' size and Reports a line of its own (v2.css).
    expect(before).toMatch(/max-sm:ml-0 max-sm:basis-full/);
    expect(before).toMatch(/buttonClass\('secondary', '', 'sm'\)[^]*<ChartBar size=\{16\}/);
  });

  it('counts the students the roster already read: "1 student", "28 students"', () => {
    expect(page).toMatch(
      /const students = \(count: number\) => `\$\{count\} \$\{count === 1 \? 'student' : 'students'\}`;/,
    );
    // No read of its own: the count is the roster's.
    expect(page.match(/api\s*\.get/g)).toHaveLength(2);
  });

  it('picks the length on v2’s segmented control: a grey track, the pick white and raised, with a check', () => {
    expect(classes('TRACK')).toEqual(
      expect.arrayContaining(['bg-surface-sunken', 'rounded-sm', 'p-0.75', 'gap-0.5']),
    );
    expect(classes('SEGMENT')).toEqual(
      expect.arrayContaining([
        'rounded-item',
        'text-segment',
        'text-text-secondary',
        'has-checked:bg-surface-card',
        'has-checked:text-text-primary',
        'has-checked:shadow-1',
        // The radio is clipped away, so the focus ring is drawn on its segment.
        'has-focus-visible:outline-2',
      ]),
    );
    expect(before).toMatch(
      /<label key=\{option\} className=\{SEGMENT\}>[^]*type="radio"[^]*className="sr-only"[^]*\{pick === option \? <Check size=\{15\} aria-hidden="true" \/> : null\}/,
    );
  });

  it('says a Start that failed under the lengths, and a length it refused right under the help', () => {
    expect(before).toMatch(/\{startSaid \? \(\s*<p role="alert" className="mt-3\.5 text-body">/);
    expect(before).toMatch(/<p id=\{`\$\{id\}-said`\} role="alert" className="text-body">/);
  });

  it('lists the roster in three columns beside the join code’s card, each under its label', () => {
    const cols = before.slice(before.indexOf('<div className="flex flex-wrap items-start gap-5">'));
    // The roster first, at 999 1 520 px, then the card's rail at 1 1 320 px (v2.css's .cols).
    expect(cols).toMatch(
      /flex-\[999_1_520px\][^]*\{roster \? `Roster · \$\{students\(roster\.students\.length\)\}` : 'Roster'\}[^]*<ul className="columns-3 gap-x-8">[^]*flex-\[1_1_320px\][^]*Join code[^]*<JoinCode classId=\{classId\} code=\{klass\.joinCode\} onClass=\{setKlass\} card \/>/,
    );
    expect(classes('LABEL')).toEqual(
      expect.arrayContaining(['mb-3', 'text-section-label', 'text-text-tertiary', 'uppercase']),
    );
    // 32 px over its card as ClassBefore draws it: the label's 12 px and its section's 20 px gap
    // (PV6's review: its comment said 12).
    expect(page).toMatch(/32 px above its card[^]*its own 12 px and its section's 20 px gap/);
    expect(cols.match(/flex min-w-0 flex-\[[^\]]+\] flex-col gap-5"/g)).toHaveLength(2);
    // An empty roster says so in a plain line, never in a card (DESIGN.md §4).
    expect(cols).toMatch(
      /roster\.students\.length === 0 \? \(\s*<p className="text-body text-text-secondary">No students have joined yet\.<\/p>/,
    );
  });

  it('draws none of it while a session runs: no length picker, no join code’s card', () => {
    expect(live).not.toMatch(/\bcard\b \/>|TRACK|SEGMENT|columns-3 gap-x-8/);
  });
});

describe('the class page while a session runs (ClassLive)', () => {
  /** The page off Present: the live branch, Present's own nav, header and roster set aside. */
  const own = live
    .replace(/\{present \? \(\s*<(nav|section)\b[^]*?<\/\1>\s*\) : null\}/g, '')
    .replace(/\{present \? \(\s*\/\/[^]*?<\/header>\s*\) : \(/, '{(');

  it('heads it with ClassLive’s header: the ring, the line, the countdown, then +5, +10 and End', () => {
    expect(own).toMatch(
      /<LiveHeader\s+name=\{klass\.name\}\s+joinCode=\{klass\.joinCode\}\s+counts=\{counts\}\s+startedAt=\{grid\.startedAt\}\s+endsAt=\{grid\.endsAt\}\s*>\s*\{extend\}\s*\{end\('ml-2'\)\}\s*<\/LiveHeader>/,
    );
    // Its parts 22 px apart, as v2.css's page; `relative` places the reconnect pill over it.
    expect(own).toMatch(/: 'relative flex flex-col gap-5\.5'\}>/);
  });

  it('counts the class over the grid, beside a small Present that a phone never shows', () => {
    expect(own).toMatch(/\) : counts \? \(\s*<LiveCounts counts=\{counts\} \/>\s*\) : null\}/);
    // The live grid's own counts, never another session's (a Start after an end).
    expect(page).toMatch(
      /const counts = grid !== null && counted\?\.session === grid\.id \? counted\.counts : null;/,
    );
    expect(page).toMatch(/onCounts=\{onCounts\}/);
    const toggle = page.slice(page.indexOf('const presentToggle'));
    expect(toggle).toMatch(/size=\{beside \? 'sm' : 'md'\}/);
    expect(toggle).toMatch(/className=\{beside \? 'ml-auto max-sm:hidden' : ''\}/);
  });

  it('shows no roster and no New code: the grid names every student, and ClassLive draws none', () => {
    expect(own).not.toMatch(/Roster|roster\.students|<JoinCode|All classes/);
  });

  it('says its lines as ClassStates does: right under the header, Try again small', () => {
    // A failed read again of the class, and an extend's failure, refusal or note.
    expect(own.match(/size=\{present \? 'md' : 'sm'\}/g)).toHaveLength(2);
    expect(own).toMatch(/className=\{present \? undefined : 'contents'\}/);
  });

  it('keeps the session’s start for the ring, from the Start’s answer or the first snapshot', () => {
    expect(page).toMatch(/startedAt: res\.session\.startedAt,\s*endsAt: res\.session\.endsAt,/);
    expect(page).toMatch(/const startedAt = cur\.startedAt \?\? session\.startedAt \?\? null;/);
    // A reload knows neither until the grid's snapshot says them.
    expect(page).toMatch(/\{ id: c\.liveSessionId, over: false, startedAt: null, endsAt: null \}/);
  });
});
