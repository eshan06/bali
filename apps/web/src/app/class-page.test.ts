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
 * and Present's page (PV9) is pinned in present.test.ts.
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
/** The page while a session runs: the render's first branch, before Present's after the bell. */
const live = page.slice(
  page.indexOf('return klass !== null && grid !== null && !grid.over ? ('),
  page.indexOf('// After the bell in Present'),
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
    // Reports in the menu, this class picked (PV13).
    const reports = /<a [^>]*href="\/reports\?class=c1"[^>]*>[^]*?<\/a>/.exec(html)?.[0] ?? '';
    expect(reports).toMatch(/\bh-8\.5\b/);
    expect(reports).toMatch(/\btext-button-sm\b/);
    expect(reports).toMatch(/<svg[^>]*\blucide-chart-bar\b[^>]*>[^]*<\/svg>Reports<\/a>$/);
    expect(html).not.toContain('All classes');
  });

  it('says a class that didn’t load in that place, with Try again, and shows no roster', () => {
    const start = before.indexOf('{klass === null ? (');
    const unread = before.slice(start, before.indexOf('<form', start));
    // The line under the header's own (`cantLoad`), in a card in the session's place.
    expect(unread).toMatch(
      /error \? \(\s*<section className=\{CARD_ALONE\}>\{cantLoad\(error\)\}<\/section>\s*\) : \(/,
    );
    expect(unread).not.toMatch(/<form|startSession|JoinCode|roster/);
  });

  it('keeps a roster that didn’t load out of the class’s card: said under the header', () => {
    // Only the class's own read sets `error`, so a roster failing first never says the class
    // failed while it is still on its way (santa's review).
    expect(page.match(/setError\(errText\(e\)\)/g)).toHaveLength(1);
    expect(page).toMatch(
      /setRoster\(await api\.get<RosterResponse>\(`\/v1\/classes\/\$\{classId\}\/roster`\)\);\s*setRosterError\(null\);\s*\} catch \(e\) \{\s*setRosterError\(errText\(e\)\);/,
    );
    expect(before).toMatch(/\{klass \? cantLoad\(error \?\? rosterError\) : null\}/);
    expect(page).toMatch(
      /const cantLoad = \(message: string \| null\) =>\s*message === null \? null : \(\s*<div className="flex flex-wrap items-center gap-x-4 gap-y-3">\s*<TryAgain onRetry=\{load\} then=\{\[\]\}>\s*<p role="alert" className="text-body">\s*Couldn&apos;t load this class\. \{message\}\s*<\/p>\s*<\/TryAgain>/,
    );
  });

  it('keeps each failure said while Try again reads the class again, focus then on its name (ClassRetryStates)', () => {
    // Never cleared as the read starts, which dropped Try again, and focus with it, to the page:
    // each goes with its own read's answer, and Try again holds while `load`'s promise runs.
    const load = page.slice(page.indexOf('const load = useCallback('));
    expect(load).toMatch(
      /^const load = useCallback\(async \(\) => \{\s*const read = api\.get<ClassDetail>\(`\/v1\/classes\/\$\{classId\}`\)\.then\(\s*\(c\) => \{\s*setError\(null\);\s*setKlass\(c\);/,
    );
    expect(load).toMatch(
      /await Promise\.all\(\[read, readRoster\(\)\]\);\s*\}, \[api, classId, readRoster\]\);/,
    );
    expect(page.match(/setError\(null\)/g)).toHaveLength(1);
    expect(page.match(/setRosterError\(null\)/g)).toHaveLength(2);
    // Read, focus on the page's own heading, the class's name, whichever page it then draws.
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(live).toMatch(/<LiveHeader\s+name=\{klass\.name\}/);
  });
});

describe('the class page while no session runs (ClassBefore)', () => {
  it('heads it with the name over "28 students · no session running", Reports at the end', () => {
    expect(before).toMatch(
      /className=\{`text-page-title text-balance wrap-anywhere max-sm:text-h3 /,
    );
    expect(page).toMatch(
      /const noSession = roster\s*\?\s*`\$\{students\(roster\.students\.length\)\} · no session running`\s*:\s*'No session running';/,
    );
    expect(before).toMatch(/\{klass === null \? '\\u00a0' : headLine\}/);
    // On a phone the name takes the card titles' size and Reports a line of its own (v2.css).
    expect(before).toMatch(/max-sm:ml-0 max-sm:basis-full/);
    expect(before).toMatch(/buttonClass\('secondary', '', 'sm'\)[^]*<ChartBar size=\{16\}/);
  });

  it('says "28 students · the session ended at 9:55 AM" after the bell, as ClassEnded does', () => {
    // The end the recap found, as the server marked it, for a session that ended today
    // (`endedToday`, recap-card.test.ts); else, and in Present, "no session running" (PV9's).
    expect(page).toMatch(
      /const endedAt = endedToday\(last\);\s*const headLine =\s*endedAt === null\s*\? noSession\s*: roster\s*\? `\$\{students\(roster\.students\.length\)\} · the session ended at \$\{endedAt\}`\s*: `The session ended at \$\{endedAt\}`;/,
    );
    expect(page).toMatch(/useState<SessionReportSummary \| null>\(null\)/);
    expect(before).toMatch(/<RecapCard[^>]*\bonFound=\{setLast\}/);
  });

  it('reads the roster again as its session ends, so Didn’t join counts who enrolled during it', () => {
    // A student who joins the class with the code mid-session and never taps in is someone who
    // didn't join; one removed meanwhile is not (santa's review). The roster the page opened with
    // knows neither, so the recap waits for a fresh one.
    expect(page).toMatch(
      /const over = grid\?\.over \?\? false;\s*useEffect\(\(\) => \{\s*if \(!over\) return;\s*setRoster\(null\);\s*setRosterError\(null\);\s*void readRoster\(\);\s*\}, \[over, readRoster\]\);/,
    );
    // One read of the roster, the class's load's and this one's.
    expect(page).toMatch(
      /const readRoster = useCallback\(async \(\) => \{\s*try \{\s*setRoster\(await api\.get<RosterResponse>/,
    );
    expect(page.match(/\/roster`\)/g)).toHaveLength(1);
  });

  it('shows the recap with the roster, whose failure it says too, and no How it ended', () => {
    const [recap] = before.match(/<RecapCard\b[^]*?\/>/) ?? [];
    expect(recap).toMatch(/roster=\{roster\?\.students \?\? null\}/);
    expect(recap).toMatch(/rosterError=\{rosterError\}/);
    expect(recap).toMatch(/onRetryRoster=\{load\}/);
    // ClassEnded draws no How it ended (it repeated the list) and no Present after the bell.
    expect(page).not.toMatch(/How it ended<|-ended`/);
    expect(before).not.toMatch(/presentToggle|<LiveGrid/);
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
      /flex-\[999_1_520px\][^]*\{roster \? `Roster · \$\{students\(roster\.students\.length\)\}` : 'Roster'\}[^]*<ul className="columns-3 gap-x-8">[^]*flex-\[1_1_320px\][^]*Join code[^]*<JoinCode classId=\{classId\} code=\{klass\.joinCode\} onClass=\{setKlass\} \/>/,
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
    expect(live).not.toMatch(/<JoinCode|TRACK|SEGMENT|columns-3 gap-x-8/);
  });
});

describe('the class page while a session runs (ClassLive)', () => {
  it('heads it with ClassLive’s header: the ring, the line, the countdown, then +5, +10 and End', () => {
    expect(live).toMatch(
      /<LiveHeader\s+name=\{klass\.name\}\s+joinCode=\{klass\.joinCode\}\s+counts=\{counts\}\s+startedAt=\{grid\.startedAt\}\s+endsAt=\{grid\.endsAt\}\s+present=\{present\}\s*>\s*\{extend\}\s*\{end\('ml-2'\)\}\s*\{present \? presentToggle\(false, 'ml-2'\) : null\}\s*<\/LiveHeader>/,
    );
    // Its parts 22 px apart, as v2.css's page; `relative` places the reconnect pill over it.
    expect(live).toMatch(/: 'relative flex flex-col gap-5\.5'\}>/);
  });

  it('counts the class over the grid, beside a small Present that a phone never shows', () => {
    expect(live).toMatch(
      /\{counts \? <LiveCounts counts=\{counts\} present=\{present\} \/> : null\}\s*\{present \? null : presentToggle\(true\)\}/,
    );
    // The live grid's own counts, never another session's (a Start after an end).
    expect(page).toMatch(
      /const counts = grid !== null && counted\?\.session === grid\.id \? counted\.counts : null;/,
    );
    expect(page).toMatch(/onCounts=\{onCounts\}/);
    const toggle = page.slice(page.indexOf('const presentToggle'));
    expect(toggle).toMatch(/size=\{beside \? 'sm' : 'md'\}/);
    expect(toggle).toMatch(/className=\{beside \? 'ml-auto max-sm:hidden' : className\}/);
  });

  it('shows no roster and no New code: the grid names every student, and ClassLive draws none', () => {
    expect(live).not.toMatch(/Roster|roster\.students|<JoinCode|All classes/);
  });

  it('says a roster that didn’t load only after the bell, where a roster shows', () => {
    expect(live).toMatch(/\{cantLoad\(error\)\}/);
    expect(live).not.toMatch(/rosterError/);
  });

  it('says its lines as ClassStates does: right under the header, Try again small', () => {
    // A failed read again of the class (`cantLoad`), and an extend's failure, refusal or note:
    // `TryAgain`'s small button, the same size in Present.
    expect(live).toMatch(
      /\{said \? \(\s*<div className="flex flex-wrap items-center gap-x-4 gap-y-3">\s*\{said\.kind === 'failed' \? \(\s*<TryAgain\b[^]*?>\s*\{saidLine\}\s*<\/TryAgain>\s*\) : \(\s*saidLine\s*\)\}\s*<\/div>\s*\) : null\}/,
    );
    expect(page).toMatch(
      /const saidLine = said && \(\s*<p role=\{said\.kind === 'note' \? 'status' : 'alert'\} className="text-body">\s*\{said\.message\}\s*<\/p>\s*\);/,
    );
    expect(live).not.toMatch(/size=\{present/);
  });

  it('keeps an extend’s failure said while its Try again sends it again, every control held (ClassRetryStates)', () => {
    // The same one again, under its id; held, as every control is while any send is under way,
    // so focus stays on it. Answered: the time added or a refusal in the line's place, focus on
    // the class's name (the page's heading, `then` none); failed again, said again.
    expect(live).toMatch(
      /<TryAgain\s+onRetry=\{\(\) => \{\s*const again = unanswered\.current;\s*if \(again\) addTime\(again, true\);\s*\}\}\s+held=\{busy !== null\}\s+then=\{\[\]\}\s*>/,
    );
    const add = page.slice(page.indexOf('function addTime('));
    expect(add).toMatch(
      /^function addTime\(attempt: ExtendAttempt, again = false\) \{[^]*?void once\('extend', async \(\) => \{\s*if \(!again\) setSaid\(null\);\s*const answer = await extendSession\(api, session, attempt\);\s*unanswered\.current = keepUnanswered\(attempt, answer\);\s*if \(answer\.kind === 'extended'\) \{\s*setSaid\(null\);\s*onSession\(\{ id: session, classId, endsAt: answer\.endsAt \}\);\s*\} else setSaid\(answer\);/,
    );
    // +5 and +10 send afresh, their line going as they do: their own buttons keep focus.
    expect(page).toMatch(
      /onClick=\{\(\) => addTime\(extendAttemptFor\(unanswered\.current, add\)\)\}/,
    );
  });

  it('keeps the session’s start for the ring, from the Start’s answer or the first snapshot', () => {
    expect(page).toMatch(/startedAt: res\.session\.startedAt,\s*endsAt: res\.session\.endsAt,/);
    expect(page).toMatch(/const startedAt = cur\.startedAt \?\? session\.startedAt \?\? null;/);
    // A reload knows neither until the grid's snapshot says them.
    expect(page).toMatch(/\{ id: c\.liveSessionId, over: false, startedAt: null, endsAt: null \}/);
  });
});
