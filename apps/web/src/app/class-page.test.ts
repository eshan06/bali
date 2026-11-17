import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/*
 * The class page's reads and sends, read from its source: the class and its roster read, each
 * failure said until its own read answers (ClassRetryStates), the roster read again as a session
 * ends, and a Start within a save's limit. The page before a session is driven in
 * classes/[id]/before.test.tsx since LO4 (ClassPage, ClassStates), which took this file's pins of
 * its look. And the page while a session runs (PV7; ClassLive, ClassStale, ClassStates' lines
 * during a session), read from the source too; its header and counts are rendered in
 * live-header.test.ts, and Present's page (PV9) is pinned in present.test.ts.
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
describe('the class page before its class is read', () => {
  const html = renderToStaticMarkup(createElement(ClassDetailPage));

  it('keeps each failure said while Try again reads the class again, focus then on its name (ClassRetryStates)', () => {
    // Never cleared as the read starts, which dropped Try again, and focus with it, to the page:
    // each goes with its own read's answer, and Try again holds while `load`'s promise runs.
    const load = page.slice(page.indexOf('const load = useCallback('));
    expect(load).toMatch(
      /^const load = useCallback\(async \(\) => \{\s*const mine = \+\+reads\.current\.klass;\s*setClassReading\(true\);\s*const read = api\.get<ClassDetail>\(`\/v1\/classes\/\$\{classId\}`\)\.then\(\s*\(c\) => \{\s*if \(reads\.current\.klass !== mine\) return;\s*setClassReading\(false\);\s*setError\(null\);\s*setKlass\(c\);/,
    );
    expect(load).toMatch(
      /\(e: unknown\) => \{\s*if \(reads\.current\.klass !== mine\) return;\s*setClassReading\(false\);\s*setError\(errText\(e\)\);\s*\},\s*\);\s*await Promise\.all\(\[read, readRoster\(\)\]\);\s*\}, \[api, classId, readRoster\]\);/,
    );
    expect(page.match(/setError\(null\)/g)).toHaveLength(1);
    expect(page.match(/setRosterError\(null\)/g)).toHaveLength(2);
    // Read, focus on the page's own heading, the class's name, whichever page it then draws.
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(live).toMatch(/<LiveHeader\s+name=\{klass\.name\}/);
  });

  it('draws only the newest read’s answer, so two Try agains for one failure never leave a stale one (santa’s review)', () => {
    // The roster's failure is said under the header and in the recap, each with its Try again,
    // and neither holds the other: pressed both, a slow read's failure could land after a later
    // read's roster. Each read takes a turn; an answer not the newest's is dropped, the class's
    // and the roster's alike, the read a session's end starts too.
    expect(page).toMatch(/const reads = useRef\(\{ klass: 0, roster: 0 \}\);/);
    expect(page).toMatch(
      /const readRoster = useCallback\(async \(\) => \{\s*const mine = \+\+reads\.current\.roster;/,
    );
    expect(page.match(/reads\.current\.roster (!|=)== mine/g)).toHaveLength(3);
    expect(page.match(/reads\.current\.klass (!|=)== mine/g)).toHaveLength(2);
  });

  it('holds a failure’s Try again while a read of it is on its way, whichever Try again sent it (ClassRetryStates)', () => {
    // The class's Try again in the session's place reads its roster too. The class answering first,
    // the roster's earlier failure was said under the header with a Try again not held until the
    // roster's read answered (#429's review): each line holds while a read of what it says runs,
    // the class's or else its roster's, and so does the recap's, the roster's other Try again.
    expect(page).toMatch(
      /<TryAgain onRetry=\{load\} held=\{error !== null \? classReading : rosterReading\} then=\{\[\]\}>/,
    );
    const [recap] = before.match(/<RecapCard\b[^]*?\/>/) ?? [];
    expect(recap).toMatch(/rosterReading=\{rosterReading\}/);
    // Each on its way from its start to its newest read's answer, never an older one's.
    expect(page).toMatch(
      /const readRoster = useCallback\(async \(\) => \{\s*const mine = \+\+reads\.current\.roster;\s*setRosterReading\(true\);\s*try \{[^]*?\} finally \{\s*if \(reads\.current\.roster === mine\) setRosterReading\(false\);\s*\}\s*\}, \[api, classId\]\);/,
    );
    const load = page.slice(page.indexOf('const load = useCallback('));
    expect(load).toMatch(
      /^const load = useCallback\(async \(\) => \{\s*const mine = \+\+reads\.current\.klass;\s*setClassReading\(true\);/,
    );
    expect(load).toMatch(
      /\(c\) => \{\s*if \(reads\.current\.klass !== mine\) return;\s*setClassReading\(false\);/,
    );
    expect(load).toMatch(
      /\(e: unknown\) => \{\s*if \(reads\.current\.klass !== mine\) return;\s*setClassReading\(false\);\s*setError\(errText\(e\)\);\s*\},/,
    );
    expect(page.match(/set(Class|Roster)Reading\(true\)/g)).toHaveLength(2);
  });
});

describe('the class page while no session runs', () => {
  it('reads the roster again as its session ends, so Didn’t join counts who enrolled during it', () => {
    // A student who joins the class with the code mid-session and never taps in is someone who
    // didn't join; one removed meanwhile is not (santa's review). The roster the page opened with
    // knows neither, so the recap waits for a fresh one.
    expect(page).toMatch(
      /const over = grid\?\.over \?\? false;\s*useEffect\(\(\) => \{\s*if \(!over\) return;\s*setRoster\(null\);\s*setRosterError\(null\);\s*void readRoster\(\);\s*\}, \[over, readRoster\]\);/,
    );
    // One read of the roster, the class's load's and this one's.
    expect(page).toMatch(
      /const readRoster = useCallback\(async \(\) => \{\s*const mine = \+\+reads\.current\.roster;\s*setRosterReading\(true\);\s*try \{\s*const next = await api\.get<RosterResponse>/,
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

  it('draws none of it while a session runs: no length picker, no join code’s card', () => {
    expect(live).not.toMatch(/<JoinCode|TRACK|SEGMENT|READY|columns-/);
  });
});

describe('the class page while a session runs (ClassLive)', () => {
  // Its header, its controls, Present's and the lines said under them are driven in
  // classes/[id]/page.test.tsx since LO5.

  it('counts Present’s grid by the live grid’s own session', () => {
    // The live grid's own counts, never another session's (a Start after an end).
    expect(page).toMatch(
      /const counts = grid !== null && counted\?\.session === grid\.id \? counted\.counts : null;/,
    );
    expect(page).toMatch(/onCounts=\{onCounts\}/);
  });

  it('shows no roster and no New code: the grid names every student, and ClassLive draws none', () => {
    expect(live).not.toMatch(/Roster|roster\.students|<JoinCode|All classes/);
  });

  it('says a roster that didn’t load only after the bell, where a roster shows', () => {
    expect(live).not.toMatch(/rosterError/);
  });

  // An extend's Try again (ClassRetryStates) is driven in classes/[id]/page.test.tsx since A3b.

  it('keeps the session’s start for the ring, from the Start’s answer or the first snapshot', () => {
    expect(page).toMatch(/startedAt: res\.session\.startedAt,\s*endsAt: res\.session\.endsAt,/);
    expect(page).toMatch(/const startedAt = cur\.startedAt \?\? session\.startedAt \?\? null;/);
    // A reload knows neither until the grid's snapshot says them.
    expect(page).toMatch(/\{ id: c\.liveSessionId, over: false, startedAt: null, endsAt: null \}/);
  });
});

// End's, asked first in its confirm since GA6, is driven in classes/[id]/page.test.tsx.
describe('the class page’s Start, within a save’s limit (the owner, 2026-10-16)', () => {
  it('sends a Start within SAVE_TIMEOUT_MS, its failure said under the lengths, Start sending the same again', () => {
    // No `eventId` on the route: a Start sent again while one runs is answered with that session
    // (`existing`, the API's own tests), so one cut here that landed is never two sessions.
    expect(page).toMatch(
      /const res = await api\.post<StartSessionResponse>\(\s*`\/v1\/classes\/\$\{classId\}\/sessions`,\s*\{ durationMinutes: minutes \},\s*SAVE_TIMEOUT_MS,\s*\);/,
    );
    // No answer to go by (a timeout, no connection, a 5xx): the class read again before anything
    // is said, so a Start that landed shows its session, as a reload would, never a failure over a
    // class in session (santa's review); a refusal, or no session running, says the failure.
    expect(page).toMatch(
      /\} catch \(err\) \{[^]*?const noAnswer = failureOf\(err\)\.kind === 'failed';\s*const running = noAnswer \? await sessionRunning\(api, classId\) : null;\s*if \(running === null\) \{[^}]*?return setStartSaid\(errText\(err\)\);\s*\}\s*setSaid\(null\);\s*setGrid\(\(cur\) =>\s*cur\?\.id === running \? cur : \{ id: running, over: false, startedAt: null, endsAt: null \},\s*\);\s*\}/,
    );
  });

  it('says a session was already running, but not of its own Start that got no answer, sent again (#432’s Left)', () => {
    // A Start that landed with no answer, its class read failing too, then pressed again, is
    // answered `existing` with the session it made: "the length you picked wasn't used" was
    // false there. Its minutes are kept until a Start is answered (`lostStart`), and a session of
    // those minutes, picked again, says nothing (`saysAlreadyRunning`); any other `existing`
    // still says it, another tab's of the same length too (santa's review).
    expect(page).toMatch(/const lostStart = useRef<number \| null>\(null\);/);
    expect(page).toMatch(/const lost = lostStart\.current;\s*lostStart\.current = null;/);
    expect(page).toMatch(
      /setSaid\(\s*saysAlreadyRunning\(res, minutes, lost\)\s*\? \{ kind: 'note', message: SESSION_ALREADY_RUNNING \}\s*: null,\s*\);/,
    );
    expect(page).toMatch(
      /if \(running === null\) \{[^}]*?if \(noAnswer\) lostStart\.current = minutes;\s*return setStartSaid\(errText\(err\)\);\s*\}/,
    );
    expect(page.match(/SESSION_ALREADY_RUNNING/g)).toHaveLength(2);
    // Settled once a session shows, by an answer or a read: its minutes never outlive it.
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*lostStart\.current = null;\s*\}, \[grid\?\.id\]\);/,
    );
    expect(page.match(/lostStart\.current = /g)).toHaveLength(3);
  });
});
