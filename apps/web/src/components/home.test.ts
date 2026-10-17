import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ActivityEvent, MeResponse, SessionReportResponse } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ActivityRead } from '../lib/activity';
import type { LastSession, TaughtClass } from '../lib/classes';
import { CANT_REACH } from '../lib/errors';
import type { Student, Students } from '../lib/grid-state';
import { sessionTimes } from '../lib/recap';
import type { ReportRead } from '../lib/reports';
import { DOT, type GridNow } from './live-grid';

/*
 * A teacher's Home in v2's look (PV17a): the greeting and the date (Main, HomeIdle, HomeNew,
 * HomeNoName; the evening and two classes live drawn first, HomeInterimStates), each class once with
 * Live and Open or Start… (Main, HomeIdle), a new teacher's first class card going to Classes' New
 * class (HomeNew to ClassesNew), the list's failure over the classes read before, and the block's
 * card beside them; Main's live card (PV17b), and the rail's Recent activity and Last session
 * (PV17c).
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
const {
  TeacherHome,
  dayLine,
  greeting,
  nextTurn,
  NEW_CLASS,
  LiveCardView,
  presentHref,
  RecentActivityView,
  LastSessionView,
  activityMoment,
} = await import('./home');
const source = readFileSync(fileURLToPath(new URL('./home.tsx', import.meta.url)), 'utf8');

const UTC = { locale: 'en-US', timeZone: 'UTC' };
/** Monday, October 12, 2026, 2:30 PM UTC. */
const NOW = Date.parse('2026-10-12T14:30:00.000Z');
const at = (time: string) => Date.parse(`2026-10-12T${time}Z`);
const clock = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
/** The page's words with React's escapes and its marks between text nodes undone. */
const plain = (html: string) =>
  html.replaceAll('<!-- -->', '').replaceAll('&#x27;', "'").replaceAll('&amp;', '&');

function taught(
  name: string,
  over: { count?: number; endsAt?: string; lastStart?: string } = {},
): TaughtClass {
  const { count = 26, endsAt, lastStart } = over;
  return {
    id: `c-${name.length}-${count}`,
    name,
    teacher: { displayName: 'Ms. Rivera' },
    enrollmentId: null,
    liveSession: null,
    summary: {
      studentCount: count,
      runningSession: endsAt ? { id: `s-${name.length}`, endsAt } : null,
      lastSession: lastStart
        ? { id: 's-last', startedAt: lastStart, endedAt: new Date(NOW).toISOString() }
        : null,
    },
  };
}

const BELL = '2026-10-12T14:55:00.000Z';
const LIVE = taught('Biology, period 3', { count: 28, endsAt: BELL });
const TODAY = taught('Period 1 Biology', { lastStart: '2026-10-12T08:00:00.000Z' });
const NONE = taught('Period 6 AP Biology', { count: 24 });
const CLASSES = [LIVE, TODAY, NONE];

const me = (classes: TaughtClass[], displayName: string | null = 'Ms. Rivera'): MeResponse => ({
  user: { id: 'u1', role: 'teacher', displayName },
  classes,
  session: null,
  armed: false,
});
const view = (over: Partial<Parameters<typeof TeacherHome>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(TeacherHome, {
      me: me(CLASSES),
      failed: null,
      now: NOW,
      onRead: () => undefined,
      onRetry: () => Promise.resolve(),
      ...over,
    }),
  );

/** Try again as `TryAgain` draws it: small, or full size; at rest, or held as Loading…. */
const tryAgain = ({ held = false, size = 'h-8\\.5', margin = '' } = {}) =>
  `<button type="button" aria-disabled="${held}" aria-busy="${held}" class="[^"]*\\b${size}\\b[^"]*${margin ? `\\b${margin}\\b[^"]*` : ''}">${held ? 'Loading…' : 'Try again'}<\\/button>`;

/** Each row: its classes, its words, its links (where each goes, its words, what describes it). */
const rows = (html: string) =>
  [...html.matchAll(/<li class="([^"]*)">(.*?)<\/li>/g)].map(([, classes = '', inner = '']) => ({
    classes: classes.split(' '),
    words: plain(inner)
      .split(/<[^>]+>/)
      .filter(Boolean),
    name: /<span id="([^"]+)" class="block text-tile-name wrap-anywhere">/.exec(inner)?.[1],
    links: [...inner.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map(([, attrs = '', text]) => ({
      href: /\bhref="([^"]*)"/.exec(attrs)?.[1],
      text,
      describedBy: /\baria-describedby="([^"]*)"/.exec(attrs)?.[1],
      classes: /\bclass="([^"]*)"/.exec(attrs)?.[1]?.split(' ') ?? [],
    })),
    inner,
  }));

describe('the greeting (Main, HomeIdle, HomeNoName; HomeInterimStates)', () => {
  it('is good morning until noon, good afternoon until 5 PM, then good evening, by the clock', () => {
    expect(greeting(at('00:30:00'), 'Ms. Rivera', UTC)).toBe('Good morning, Ms. Rivera');
    expect(greeting(at('11:59:59'), 'Ms. Rivera', UTC)).toBe('Good morning, Ms. Rivera');
    expect(greeting(at('12:00:00'), 'Ms. Rivera', UTC)).toBe('Good afternoon, Ms. Rivera');
    expect(greeting(at('16:59:59'), 'Ms. Rivera', UTC)).toBe('Good afternoon, Ms. Rivera');
    expect(greeting(at('17:00:00'), 'Ms. Rivera', UTC)).toBe('Good evening, Ms. Rivera');
    expect(greeting(at('23:59:59'), 'Ms. Rivera', UTC)).toBe('Good evening, Ms. Rivera');
  });

  it('drops the name on an account with none (HomeNoName)', () => {
    expect(greeting(at('14:30:00'), null, UTC)).toBe('Good afternoon');
  });

  it('turns next at noon, 5 PM or midnight, by this computer’s clock', () => {
    const local = (h: number, m = 0, d = 12) => new Date(2026, 9, d, h, m).getTime();
    expect(nextTurn(local(9))).toBe(local(12));
    expect(nextTurn(local(11, 59))).toBe(local(12));
    expect(nextTurn(local(12))).toBe(local(17));
    expect(nextTurn(local(16, 59))).toBe(local(17));
    expect(nextTurn(local(17))).toBe(local(0, 0, 13));
    expect(nextTurn(local(23, 59))).toBe(local(0, 0, 13));
    expect(nextTurn(local(0))).toBe(local(12));
  });
});

describe('the date’s line (Main, HomeIdle, HomeNew; HomeInterimStates)', () => {
  it('is the date alone for a teacher with no class yet', () => {
    expect(dayLine([], NOW, UTC)).toBe('Monday, October 12');
  });

  it('says no class is in session, or the one live and its bell', () => {
    expect(dayLine([TODAY, NONE], NOW, UTC)).toBe(`Monday, October 12${DOT}no class in session`);
    expect(dayLine(CLASSES, NOW, UTC)).toBe(
      `Monday, October 12${DOT}Biology, period 3 ends at 2:55 PM`,
    );
  });

  it('says how many when more than one is live', () => {
    const second = taught('Period 4 Biology', { endsAt: '2026-10-12T15:20:00.000Z' });
    expect(dayLine([...CLASSES, second], NOW, UTC)).toBe(
      `Monday, October 12${DOT}2 classes in session`,
    );
  });

  it('counts a class live only to its bell by this computer’s clock', () => {
    expect(dayLine(CLASSES, Date.parse(BELL), UTC)).toBe(
      `Monday, October 12${DOT}no class in session`,
    );
  });
});

describe('Home’s page (PV17a)', () => {
  it('greets the teacher at the greeting’s size, focusable for a redeem, the date under it', () => {
    const html = plain(view());
    expect(html).toMatch(
      /^<main class="flex flex-col gap-5\.5"><div><h1 tabindex="-1" class="text-greeting text-balance wrap-anywhere">Good (morning|afternoon|evening), Ms\. Rivera<\/h1><p class="mt-0\.75 text-meta text-text-secondary">[^<]+<\/p><\/div>/,
    );
    expect(plain(view({ me: me(CLASSES, null) }))).toMatch(
      /<h1 [^>]*>Good (morning|afternoon|evening)<\/h1>/,
    );
    expect(plain(view({ me: me(CLASSES, '  ') }))).toMatch(
      /<h1 [^>]*>Good (morning|afternoon|evening)<\/h1>/,
    );
  });

  it('lists each class once under Your classes, in the account’s order', () => {
    const html = view();
    expect(html).toMatch(
      /<section aria-labelledby="([^"]+)"><h2 id="\1" class="mb-3 text-section-label text-text-tertiary uppercase">Your classes<\/h2><ul class="flex flex-col gap-2\.5">/,
    );
    const list = rows(html);
    expect(list.map((r) => r.words[0])).toEqual(CLASSES.map((c) => c.name));
    // v2's `.schedrow`: 15 × 18 px in, 14 px corners, its hairline, 14 px between its parts; the
    // name 15/20 semibold over its line, in the row's own 15/22 line.
    for (const row of list) {
      expect(row.classes).toEqual(
        expect.arrayContaining([
          'flex',
          'items-center',
          'gap-3.5',
          'rounded-md',
          'border',
          'bg-surface-card',
          'px-4.5',
          'py-3.75',
          'text-body',
        ]),
      );
      expect(row.inner).toMatch(/<span class="text-countdown-sub text-text-tertiary">/);
    }
  });

  it('marks a live class with the live edge, its Live chip and Open, to its page', () => {
    const [live] = rows(view());
    expect(live?.classes).toContain('border-live-edge');
    expect(live?.words).toEqual([
      'Biology, period 3',
      '28 students',
      `Live${DOT}ends ${clock(BELL)}`,
      'Open',
    ]);
    expect(live?.inner).toMatch(
      /<span class="[^"]*\bbg-state-focused-bg\b[^"]*\btext-state-focused-fg\b[^"]*"><svg(?=[^>]*\bwidth="13")[^>]*\blucide-circle-check\b/,
    );
    expect(live?.links.map(({ href, text, describedBy }) => ({ href, text, describedBy }))).toEqual(
      [{ href: `/classes/${LIVE.id}`, text: 'Open', describedBy: live?.name }],
    );
    // v2's `quiet` link: 13/18 semibold in the brand's ink.
    expect(live?.links[0]?.classes).toEqual(
      expect.arrayContaining(['text-caption', 'font-semibold', 'text-text-brand']),
    );
  });

  it('gives every other class its line and Start…, a small secondary button to its page', () => {
    const [, today, none] = rows(view());
    expect(today?.classes).toContain('border-border-default');
    expect(today?.words).toEqual([
      'Period 1 Biology',
      `26 students${DOT}last session today, ${clock('2026-10-12T08:00:00.000Z')}`,
      'Start…',
    ]);
    expect(none?.words).toEqual([
      'Period 6 AP Biology',
      `24 students${DOT}no sessions yet`,
      'Start…',
    ]);
    for (const [row, c] of [
      [today, TODAY],
      [none, NONE],
    ] as const) {
      expect(
        row?.links.map(({ href, text, describedBy }) => ({ href, text, describedBy })),
      ).toEqual([{ href: `/classes/${c.id}`, text: 'Start…', describedBy: row?.name }]);
      // v2's small secondary button: 34 px tall, its 13.5/18 label, a strong edge.
      expect(row?.links[0]?.classes).toEqual(
        expect.arrayContaining(['h-8.5', 'text-button-sm', 'border-border-strong']),
      );
    }
    // Past the bell by this computer's clock the live class starts again too.
    const [after] = rows(view({ now: Date.parse(BELL) }));
    expect(after?.links.map((l) => l.text)).toEqual(['Start…']);
    expect(after?.classes).not.toContain('border-live-edge');
  });

  it('shows a new teacher the first class card, its Create a class going to Classes’ New class (HomeNew)', () => {
    const html = view({ me: me([]) });
    expect(NEW_CLASS).toBe('/classes?new');
    expect(html).toMatch(
      /<section aria-labelledby="([^"]+)" class="flex flex-col items-start gap-2\.5 rounded-md border border-border-default bg-surface-card p-8 shadow-1"><svg width="46" height="46"[^]*?<\/svg><h2 id="\1" class="text-entry-title">Set up your first class<\/h2><p class="max-w-144 text-body text-text-secondary">Name it, then put its join code on the board\. Students join with it in the Bali app\.<\/p><a class="[^"]*\bbg-action-primary-bg\b[^"]*\bmt-1\.5\b[^"]*" href="\/classes\?new">Create a class<\/a><\/section>/,
    );
    expect(html).not.toContain('Your classes');
    expect(html).not.toContain('<li');
  });

  it('says a list that didn’t load over the classes read before, with a small Try again (HomeInterimStates)', () => {
    const html = plain(view({ failed: CANT_REACH }));
    expect(html).toMatch(
      new RegExp(
        `<\\/div><div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Couldn't load your classes\\. ${CANT_REACH.replaceAll('.', '\\.')}<\\/p>${tryAgain()}<\\/div><div class="flex flex-wrap items-start gap-5">`,
      ),
    );
    expect(rows(html)).toHaveLength(3);
    expect(view()).not.toContain('role="alert"');
  });

  it('holds the list’s Try again until the account’s read again answers, then lands focus on Your classes (HomeRetryStates)', () => {
    // `onRetry`, the shell's `refresh`, keeps the line until the answer, so Try again stays, held
    // as Loading… (`TryAgain`); `load` cleared it first, which dropped focus to the page. Read,
    // focus on Your classes; for a new teacher, whose list has none, on the page's heading.
    expect(source).toMatch(
      /<TryAgain onRetry=\{onRetry\} then=\{\[yours\]\}>\s*<p role="alert" className="text-body">\s*Couldn&apos;t load your classes\. \{failed\}/,
    );
    expect(view()).toMatch(/<h2 id="([^"]+)" [^>]*>Your classes<\/h2>/);
  });

  it('sets the block’s card beside the classes, v2’s columns: 520 px and 320 px, 20 px apart', () => {
    for (const html of [view(), view({ me: me([]) })]) {
      expect(html).toContain(
        '<div class="flex flex-wrap items-start gap-5"><div class="flex min-w-0 grow-999 basis-130 flex-col gap-5">',
      );
      expect(html).toMatch(
        /<div class="flex min-w-0 grow basis-80 flex-col gap-5"><section aria-labelledby="[^"]+" class="[^"]*">.*Your block<\/h2>/,
      );
    }
  });

  it('sets Recent activity over the block’s card while a class is live, never Last session (Main)', () => {
    const html = plain(view());
    expect(html).toMatch(
      /<div class="flex min-w-0 grow basis-80 flex-col gap-5"><section aria-labelledby="([^"]+)" class="[^"]*"><h2 id="\1" class="[^"]*"><svg[^]*?<\/svg>Recent activity<\/h2><p role="status" class="mt-3\.5 text-body text-text-secondary">Loading…<\/p><\/section><section [^>]*>.*Your block<\/h2>/,
    );
    expect(html).not.toContain('Last session');
  });

  it('sets the last session over the block’s card while none is live (HomeIdle), and neither before a class’s first ends', () => {
    const third = taught('Biology, period 3', { count: 28, lastStart: '2026-10-12T13:05:00.000Z' });
    const html = plain(view({ me: me([third, TODAY, NONE]) }));
    expect(html).toMatch(
      /<div class="flex min-w-0 grow basis-80 flex-col gap-5"><section aria-labelledby="([^"]+)" class="[^"]*"><h2 id="\1" class="[^"]*"><svg[^]*?<\/svg>Last session<\/h2><p id="[^"]+" class="mt-3\.5 text-body font-semibold wrap-anywhere">Biology, period 3<\/p>.*?Loading the last session…<\/p><\/section><section [^>]*>.*Your block<\/h2>/,
    );
    expect(html).not.toContain('Recent activity');
    // No session over yet, or a new teacher: the block's card alone (HomeNew; PV1).
    for (const classes of [[NONE], []]) {
      const alone = plain(view({ me: me(classes) }));
      expect(alone).not.toMatch(/Recent activity|Last session/);
      expect(alone).toContain('Your block');
    }
  });

  it('shows no last session past a bell until the classes are read again: never an older one meanwhile', () => {
    // The bell has rung by this computer's clock, the read still counting the session running.
    const html = plain(view({ now: Date.parse(BELL) }));
    expect(html).not.toMatch(/Recent activity|Last session/);
    // Read again: the session just ended is the last, over the morning's.
    const ended = taught('Biology, period 3', { count: 28, lastStart: '2026-10-12T14:05:00.000Z' });
    const after = plain(view({ me: me([ended, TODAY, NONE]), now: Date.parse(BELL) + 3000 }));
    expect(after).toMatch(/Last session<\/h2><p id="[^"]+" [^>]*>Biology, period 3<\/p>/);
  });

  it('reads Recent activity only on a page wide enough to show it, and Last session’s report once a session (sources)', () => {
    // Hidden under 640 px (PV1, PhoneHome), so a phone never reads what it hides.
    expect(source).toContain("const WIDE = '(min-width: 40rem)';");
    expect(source).toMatch(
      /\{live\.length > 0 \? \(\s*wide \? \(\s*<RecentActivity only=\{live\.length === 1 \? \(live\[0\]\?\.c\.id \?\? null\) : null\} \/>\s*\) : null\s*\) : last !== null \? \(\s*<LastSessionCard key=\{last\.session\.id\} last=\{last\} \/>\s*\) : null\}\s*<Blocks \/>/,
    );
    // Read again while in view, stopped as it goes (pollActivity, tested in lib/activity); its
    // Try again starts it afresh, held until its first answer.
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*const poll = pollActivity\(api, \(answer\) => \{\s*setRead\(answer\);\s*setRetrying\(false\);\s*\}\);\s*return \(\) => poll\.stop\(\);\s*\}, \[api, attempt\]\);/,
    );
    expect(source).toMatch(
      /retrying=\{retrying\}\s*onRetry=\{\(\) => \{\s*setRetrying\(true\);\s*setAttempt\(\(n\) => n \+ 1\);\s*\}\}/,
    );
    // Last session's report: read as it shows, again only by Try again, its line said meanwhile.
    expect(source).toMatch(
      /void readReport\(api, classId, sessionId\)\.then\(\(answer\) => \{\s*if \(live\) setRead\(answer\);\s*\}\);/,
    );
    expect(source).toMatch(/\}, \[api, classId, sessionId\]\);/);
    expect(source).toContain(
      'onRetry={async () => setRead(await readReport(api, classId, sessionId))}',
    );
    // Never the loading line in a failure's place while Try again reads: that dropped its focus.
    expect(source).not.toMatch(/setRead\(\{ kind: 'loading' \}\);/);
    // Past a bell the read still counts it running: no Last session until it is read again.
    expect(source).toMatch(
      /const running = me\.classes\.some\(\(c\) => \(c\.summary\?\.runningSession \?\? null\) !== null\);\s*const last = running \? null : lastOf\(me\.classes\);/,
    );
  });
});

/*
 * The rail (PV17c): Recent activity while a class is live (Main), Last session while none is
 * (HomeIdle); loading and failing as HomeMoreStates draws them, and their other states as
 * HomeRailStates draws them (drawn first).
 */
describe('Recent activity (PV17c; Main, HomeMoreStates, HomeRailStates)', () => {
  const CLASS = { id: 'c1', name: 'Biology, period 3' };
  const event = (
    eventId: string,
    type: ActivityEvent['type'],
    hhmm: string,
    over: Partial<ActivityEvent> = {},
  ): ActivityEvent => ({
    eventId,
    type,
    occurredAt: `2026-10-12T${hhmm}:00.000Z`,
    class: CLASS,
    student: null,
    reason: null,
    ...over,
  });
  // Main's four, newest first.
  const MAIN = [
    event('e4', 'unlock', '13:31', {
      student: { id: 'u1', displayName: 'Ethan Park' },
      reason: 'nurse',
    }),
    event('e3', 'protection_off', '13:22', { student: { id: 'u2', displayName: 'Amara Okafor' } }),
    event('e2', 'unlock', '13:18', {
      student: { id: 'u3', displayName: 'Jaylen Brooks' },
      reason: 'bathroom',
    }),
    event('e1', 'session_started', '13:05'),
  ];
  const UTC = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  const card = (read: ActivityRead, only: string | null = 'c1', retrying = false) =>
    plain(
      renderToStaticMarkup(
        createElement(RecentActivityView, { read, only, retrying, onRetry: () => undefined }),
      ),
    );
  /** Each moment as read: its icon, its words, the line under them, its time. */
  const moments = (html: string) =>
    [...html.matchAll(/<li class="relative[^"]*">([^]*?)<\/li>/g)].map(([, inner = '']) => ({
      icon: /lucide-([\w-]+)/.exec(inner)?.[1],
      words: /<p [^>]*>([^<]*)/.exec(inner)?.[1],
      under: /<small [^>]*>([^<]*)<\/small>/.exec(inner)?.[1],
      time: /<time dateTime="([^"]+)"[^>]*>([^<]*)<\/time>/.exec(inner)?.slice(1),
    }));

  it('says each moment as Main does: who did what, the reason and the class, the time without AM or PM', () => {
    expect(
      MAIN.map((e) => activityMoment(e, UTC)).map(({ words, under, time }) => [words, under, time]),
    ).toEqual([
      ['Ethan Park used Emergency Unlock', `Nurse${DOT}Biology, period 3`, '1:31'],
      ['Amara Okafor turned protection off', 'Biology, period 3', '1:22'],
      ['Jaylen Brooks used Emergency Unlock', `Bathroom${DOT}Biology, period 3`, '1:18'],
      ['Session started', 'Biology, period 3', '1:05'],
    ]);
  });

  it('says "No reason given" for an unlock with none, or with one this build doesn’t know (HomeRailStates)', () => {
    const none = event('e5', 'unlock', '13:40', {
      student: { id: 'u4', displayName: 'Diego Ramírez' },
    });
    expect(activityMoment(none, UTC).under).toBe(`No reason given${DOT}Biology, period 3`);
    const newer = { ...none, reason: 'library' } as unknown as ActivityEvent;
    expect(activityMoment(newer, UTC).under).toBe(`No reason given${DOT}Biology, period 3`);
  });

  it('names a student as their tile does: the start of their id for an account with no name', () => {
    const deleted = event('e6', 'protection_off', '13:41', {
      student: { id: '0199b0a1-ffff-7000-8000-000000000004', displayName: null },
    });
    expect(activityMoment(deleted, UTC).words).toBe('0199b0a1 turned protection off');
  });

  it('lists them on v2’s timeline, each dot its kind’s icon, then Open the class to the one live', () => {
    const html = card({ kind: 'ready', events: MAIN });
    expect(moments(html)).toEqual(
      MAIN.map((e) => {
        const { words, under, time } = activityMoment(e);
        return {
          icon: {
            unlock: 'lock-open',
            protection_off: 'shield-off',
            session_started: 'circle-check',
          }[e.type],
          words,
          under,
          time: [e.occurredAt, time],
        };
      }),
    );
    // The card on its own, its label with the scroll's icon, 14 px between its parts.
    expect(html).toMatch(
      /^<section aria-labelledby="([^"]+)" class="rounded-md border border-border-default bg-surface-card p-5 shadow-1"><h2 id="\1" class="flex items-center gap-2 text-section-label text-text-tertiary uppercase"><svg(?=[^>]*\bwidth="14")[^>]*\blucide-scroll-text\b[^>]*>[^]*?<\/svg>Recent activity<\/h2><ol class="flex flex-col mt-3\.5">/,
    );
    // Open the class in a line of the body's height 14 px under the list, as the board sets it.
    expect(html).toMatch(
      /<\/ol><div class="mt-3\.5 text-body"><a class="rounded-xs text-caption font-semibold text-text-brand [^"]*" href="\/classes\/c1">Open the class<\/a><\/div><\/section>$/,
    );
  });

  it('ends on the list with two classes live: each live card has its own Open the class (HomeRailStates)', () => {
    const html = card({ kind: 'ready', events: MAIN }, null);
    expect(html).not.toContain('Open the class');
    expect(html).toMatch(/<\/ol><\/section>$/);
  });

  it('says Loading… until it is read, and a read that failed with its reason and a small Try again (HomeMoreStates)', () => {
    expect(card({ kind: 'loading' })).toMatch(
      /Recent activity<\/h2><p role="status" class="mt-3\.5 text-body text-text-secondary">Loading…<\/p><\/section>$/,
    );
    const failed = card({ kind: 'error', message: CANT_REACH });
    expect(failed).toMatch(
      new RegExp(
        `Recent activity<\\/h2><div class="mt-3\\.5"><div role="alert" class="text-body"><p class="font-semibold">Couldn't load recent activity\\.<\\/p><p class="text-text-secondary">${CANT_REACH.replaceAll('.', '\\.')}<\\/p><\\/div>${tryAgain({ margin: 'mt-3\\.5' })}<\\/div><\\/section>$`,
      ),
    );
    // Neither the list nor Open the class until a read works.
    expect(failed).not.toMatch(/<ol|Open the class/);
  });

  it('holds Try again as Loading… while its read runs, its line kept, focus then on its label (HomeRetryStates)', () => {
    const held = card({ kind: 'error', message: CANT_REACH }, 'c1', true);
    expect(held).toMatch(
      new RegExp(
        `<p class="text-text-secondary">${CANT_REACH.replaceAll('.', '\\.')}<\\/p><\\/div>${tryAgain({ held: true, margin: 'mt-3\\.5' })}<\\/div><\\/section>$`,
      ),
    );
    // Read, its failure gone and Try again with it: focus on the card's label, never the page.
    expect(source).toMatch(
      /<h2 id=\{id\} className=\{RAIL_LABEL\}>\s*<ScrollText[^]*?<TryAgain onRetry=\{onRetry\} held=\{retrying\} then=\{\[id\]\} className="mt-3\.5">/,
    );
  });

  it('draws nothing for a list that came back empty: never an empty state (PV1)', () => {
    expect(card({ kind: 'ready', events: [] })).toBe('');
  });
});

describe('Last session (PV17c; HomeIdle, HomeMoreStates, HomeRailStates)', () => {
  const LAST: LastSession = {
    classId: 'c3',
    name: 'Biology, period 3',
    session: {
      id: 's9',
      startedAt: '2026-10-12T13:05:00.000Z',
      endedAt: '2026-10-12T13:55:00.000Z',
    },
  };
  const student = (n: number) => ({ id: `u${n}`, displayName: `Student ${n}` });
  const unlockOf = (n: number) => ({
    eventId: `e${n}`,
    student: student(n),
    occurredAt: '2026-10-12T13:30:00.000Z',
    reason: null,
    recordedAs: null,
  });
  // HomeIdle's: 25 joined, 43 minutes each on average, 5 unlocks.
  const REPORT: SessionReportResponse = {
    ended: true,
    startedAt: LAST.session.startedAt,
    endsAt: LAST.session.endedAt,
    endedAt: LAST.session.endedAt,
    joined: Array.from({ length: 25 }, (_, i) => student(i)),
    focusMinutes: 1075,
    averageFocusMinutes: 43,
    silentMinutes: 2,
    unlocks: [1, 2, 3, 4, 5].map(unlockOf),
    protectionOffs: [],
  };
  const card = (read: ReportRead) =>
    plain(
      renderToStaticMarkup(
        createElement(LastSessionView, { last: LAST, read, onRetry: () => Promise.resolve() }),
      ),
    );
  /** Each figure as read: its name and its value. */
  const figures = (html: string) =>
    [...html.matchAll(/<dt [^>]*>([^<]*)<\/dt><dd [^>]*>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]);

  it('names the class and when it ran, then who joined, the average per student and the unlocks (HomeIdle)', () => {
    const html = card({ kind: 'ready', report: REPORT });
    const [, id = '', name = ''] =
      /^<section aria-labelledby="([^"]+)" class="rounded-md border border-border-default bg-surface-card p-5 shadow-1"><h2 id="\1" class="flex items-center gap-2 text-section-label text-text-tertiary uppercase"><svg(?=[^>]*\bwidth="14")[^>]*\blucide-clock\b[^>]*>[^]*?<\/svg>Last session<\/h2><p id="([^"]+)" class="mt-3\.5 text-body font-semibold wrap-anywhere">Biology, period 3<\/p>/.exec(
        html,
      ) ?? [];
    expect(id).not.toBe('');
    expect(html).toContain(
      `<p class="text-caption text-text-tertiary">${sessionTimes({ ...LAST.session, endsAt: LAST.session.endedAt })}</p>`,
    );
    expect(figures(html)).toEqual([
      ['Joined', '25'],
      ['Average per student', '43 min'],
      ['Unlocks', '5'],
    ]);
    // v2.css's `.stats`, 14 px under the times, 12 px between rows and 28 between figures.
    expect(html).toContain('<dl class="flex flex-wrap mt-3.5 gap-x-7 gap-y-3">');
    // Open the recap: the class page, where the recap shows after the bell (ClassEnded), in a line
    // of the body's height 14 px under the figures, as the board sets it.
    expect(html).toMatch(
      new RegExp(
        `<div class="mt-3\\.5 text-body"><a aria-describedby="${name}" class="rounded-xs text-caption font-semibold text-text-brand [^"]*" href="\\/classes\\/c3">Open the recap<\\/a><\\/div><\\/section>$`,
      ),
    );
  });

  it('reads a report the sweep hasn’t marked yet as any other: never as still running', () => {
    // Within a minute of its bell R2 says `ended: false`; its figures already run to the bell.
    const unswept = { ...REPORT, ended: false, endedAt: null };
    expect(card({ kind: 'ready', report: unswept })).toBe(card({ kind: 'ready', report: REPORT }));
  });

  it('says nobody joined in place of the figures, the unlocks kept when there were any (HomeRailStates)', () => {
    const nobody = {
      ...REPORT,
      joined: [],
      averageFocusMinutes: null,
      focusMinutes: 0,
      unlocks: [],
    };
    const html = card({ kind: 'ready', report: nobody });
    expect(html).toContain(
      '<p class="mt-3.5 text-body text-text-secondary">Nobody joined this session.</p><div class="mt-3.5 text-body"><a ',
    );
    expect(figures(html)).toEqual([]);
    const unlocked = card({ kind: 'ready', report: { ...nobody, unlocks: [unlockOf(1)] } });
    expect(unlocked).toContain('Nobody joined this session.</p><dl ');
    expect(figures(unlocked)).toEqual([['Unlocks', '1']]);
  });

  it('says Loading the last session… under when it ran, and a failure with Try again; no link to the recap until read (HomeMoreStates)', () => {
    const loading = card({ kind: 'loading' });
    expect(loading).toMatch(
      /<p class="text-caption text-text-tertiary">[^<]*<\/p><p role="status" class="mt-3\.5 text-body text-text-secondary">Loading the last session…<\/p><\/section>$/,
    );
    const failed = card({ kind: 'error', message: CANT_REACH });
    expect(failed).toMatch(
      new RegExp(
        `<p class="text-caption text-text-tertiary">[^<]*<\\/p><div class="mt-3\\.5"><div role="alert" class="text-body"><p class="font-semibold">Couldn't load the last session\\.<\\/p><p class="text-text-secondary">${CANT_REACH.replaceAll('.', '\\.')}<\\/p><\\/div>${tryAgain({ margin: 'mt-3\\.5' })}<\\/div><\\/section>$`,
      ),
    );
    for (const html of [loading, failed]) expect(html).not.toMatch(/Open the recap|<dl/);
  });

  it('holds Try again until its read answers, focus then on its label (HomeRetryStates)', () => {
    // Its read's promise holds it as Loading… (`TryAgain`), the line said meanwhile; read, its
    // failure gone and Try again with it, focus on the card's label, never the page.
    expect(source).toMatch(
      /<h2 id=\{id\} className=\{RAIL_LABEL\}>\s*<Clock[^]*?<TryAgain onRetry=\{onRetry\} then=\{\[id\]\} className="mt-3\.5">\s*<div role="alert" className="text-body">\s*<p className="font-semibold">Couldn&apos;t load the last session\.<\/p>/,
    );
  });
});

/*
 * Main's live card (PV17b): the class page's own grid (`LiveGrid`'s snapshot, stream and 15 s
 * read) drawn as Main draws it; its loading and its failure as HomeMoreStates, and its other states
 * as HomeLiveStates draws them (drawn first); on a phone as PhoneHome.
 */
describe('the live card (PV17b; Main, HomeMoreStates, HomeLiveStates)', () => {
  /** 23:04 before the bell, as Main draws it, 50 minutes in all. */
  const T = Date.parse(BELL) - (23 * 60 + 4) * 1000;
  const STARTED = new Date(Date.parse(BELL) - 50 * 60_000).toISOString();
  const UNLOCK_AT = '2026-10-12T14:31:00.000Z';

  /** Main's 28: 17 focused, 3 unlocked (Ethan Park's the newest), 2 protection off, 1 silent, 3 not here, 2 left. */
  function main(unlocks = true): Students {
    const out: Students = {};
    let n = 0;
    const add = (name: string, over: Partial<Student> = {}) => {
      n += 1;
      out[`u${n}`] = {
        studentId: `u${n}`,
        displayName: name,
        state: 'focused',
        joinedAt: new Date(T - 20 * 60_000),
        lastSeenAt: new Date(T - 10_000),
        endedAt: null,
        unlock: null,
        clockOff: false,
        ...over,
      };
    };
    for (let i = 0; i < 17; i++) add(`Student ${i}`);
    const unlocked = (eventId: string, at: string) =>
      unlocks
        ? {
            state: 'unlocked' as const,
            unlock: { eventId, reason: 'nurse' as const, at: new Date(at) },
          }
        : { state: 'focused' as const };
    add('Jaylen Brooks', unlocked('e1', '2026-10-12T14:18:00.000Z'));
    add('Mateo Silva', unlocked('e2', '2026-10-12T14:20:00.000Z'));
    add('Ethan Park', unlocked('e3', UNLOCK_AT));
    add('Amara Okafor', { state: 'protection_off' });
    add('Lucas Ferreira', { state: 'protection_off' });
    add('Tomás Herrera', { lastSeenAt: new Date(T - 5 * 60_000) });
    for (const name of ['Zuri Mensah', 'Wei Zhang', 'Omar Siddiqui']) {
      add(name, { state: null, joinedAt: null, lastSeenAt: null });
    }
    add('Caleb Washington', { endedAt: new Date(T - 60_000) });
    add('Priya Natarajan', { endedAt: new Date(T - 60_000) });
    return out;
  }

  const grid = (over: Partial<GridNow> = {}): GridNow => ({
    students: main(),
    now: new Date(T),
    error: null,
    retry: () => undefined,
    retrying: false,
    stale: null,
    ...over,
  });
  const card = (g: GridNow, startedAt: string | null = STARTED) => {
    vi.useFakeTimers({ now: T });
    try {
      return plain(
        renderToStaticMarkup(
          createElement(LiveCardView, {
            classId: 'c1',
            name: 'Biology, period 3',
            grid: g,
            startedAt,
            endsAt: BELL,
          }),
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  };
  /**
   * Each link in the card: where it goes, its words (each tag read as a space, never removed
   * outright, so no tag can form from what is left), what describes it, its classes.
   */
  const links = (html: string) =>
    [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map(([, attrs = '', inner = '']) => ({
      href: /\bhref="([^"]*)"/.exec(attrs)?.[1],
      text: inner
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      describedBy: /\baria-describedby="([^"]*)"/.exec(attrs)?.[1],
      classes: /\bclass="([^"]*)"/.exec(attrs)?.[1]?.split(' ') ?? [],
      inner,
    }));

  it('is v2’s `.livecard`: the live edge, 16 px corners, 22 px in, its parts 16 px apart, named by the class', () => {
    const html = card(grid());
    const [, id = '', classes = ''] =
      /^<section aria-labelledby="([^"]+)" class="([^"]*)">/.exec(html) ?? [];
    expect(classes.split(' ')).toEqual(
      expect.arrayContaining([
        'flex',
        'flex-col',
        'gap-4',
        'rounded-live',
        'border',
        'border-live-edge',
        'bg-surface-card',
        'p-5.5',
        'shadow-1',
      ]),
    );
    expect(html).toContain(`<h2 id="${id}" class="text-h3 wrap-anywhere">Biology, period 3</h2>`);
  });

  it('heads with the ring, the name over the class counted, and the countdown to the bell (Main)', () => {
    const html = card(grid());
    expect(html).toContain(
      '<p class="text-countdown-sub text-text-secondary wrap-anywhere">Live · 25 of 28 joined</p>',
    );
    expect(html).toContain('<span class="font-num text-home-countdown tabular-nums">23:04</span>');
    expect(html).toContain(`ends <time dateTime="${BELL}">${clock(BELL)}</time>`);
    // The 46 px ring, its arc the share of the 50 minutes left.
    const around = 2 * Math.PI * 20.5;
    expect(html).toContain(
      `stroke-dasharray="${(((23 * 60 + 4) / 3000) * around).toFixed(1)} ${around.toFixed(1)}"`,
    );
  });

  it('counts the class in its six states, as the class page does', () => {
    const counts = /<ul aria-label="The class right now"[^>]*>(.*?)<\/ul>/.exec(card(grid()))?.[1];
    expect(
      [...(counts ?? '').matchAll(/<li [^>]*>(?:<svg[^]*?<\/svg>)?([^<]*)<\/li>/g)].map(
        (m) => m[1],
      ),
    ).toEqual(['17 Focused', '3 Unlocked', '2 Protection off', '1 Silent', '3 Not here', '2 Left']);
  });

  it('ends on Open the class and Present, to the class’s page, each described by its name', () => {
    const html = card(grid());
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    const [open, present] = links(html);
    expect(open).toMatchObject({ href: '/classes/c1', text: 'Open the class', describedBy: id });
    expect(open?.classes).toEqual(expect.arrayContaining(['h-10', 'bg-action-primary-bg']));
    expect(presentHref('c1')).toBe('/classes/c1?present');
    expect(present).toMatchObject({
      href: '/classes/c1?present',
      text: 'Present',
      describedBy: id,
    });
    // A secondary button with its 16 px icon, never on a phone, which drives no projector (PhoneHome).
    expect(present?.classes).toEqual(
      expect.arrayContaining(['h-10', 'border-border-strong', 'max-sm:hidden']),
    );
    expect(present?.inner).toMatch(/^<svg[^>]*\bwidth="16"[^>]*\blucide-presentation\b/);
  });

  it('says the newest unlock on the grid, its student and when, after them (Main; PhoneHome under them)', () => {
    const html = card(grid());
    // A name with no break in it wraps rather than run out of the card on a phone.
    expect(html).toContain(
      `<p class="ml-auto text-countdown-sub text-text-tertiary wrap-anywhere max-sm:ml-0">Ethan Park used Emergency Unlock at <time dateTime="${UNLOCK_AT}">${clock(UNLOCK_AT)}</time></p></div></section>`,
    );
    // Never its reason: Recent activity's, and only the teacher's own screen.
    expect(html).not.toMatch(/Nurse|nurse/);
  });

  it('says none while no chip carries an unlock: Present ends the row (HomeLiveStates)', () => {
    const html = card(grid({ students: main(false) }));
    expect(html).not.toContain('Emergency Unlock');
    expect(html).toMatch(/>Present<\/a><\/div><\/section>$/);
  });

  it('says a lost or quiet live feed under the counts in the class page’s own line, the counts kept (HomeLiveStates)', () => {
    const line = (stale: GridNow['stale']) =>
      /<\/ul><p class="([^"]*)">([^<]*)<\/p><div class="flex flex-wrap items-center gap-2\.5">/.exec(
        card(grid({ stale })),
      );
    const lost = line({ reason: 'reconnecting', secondsAgo: 40 });
    expect(lost?.[2]).toBe('Reconnecting… last updated 40s ago');
    expect(lost?.[1]?.split(' ')).toEqual(
      expect.arrayContaining([
        'rounded-sm',
        'border',
        'border-border-default',
        'bg-surface-sunken',
        'px-4',
        'py-3',
        'text-body',
        'text-text-primary',
        'tabular-nums',
      ]),
    );
    expect(line({ reason: 'stale', secondsAgo: 120 })?.[2]).toBe(
      'Live feed has gone quiet. Last updated 2 min ago.',
    );
    expect(card(grid())).not.toMatch(/Reconnecting|gone quiet/);
  });

  it('says its name and Loading this session… until the session is read: the ring’s track, no time, no way in (HomeMoreStates)', () => {
    const html = card(grid({ students: null }), null);
    expect(html).toMatch(
      /<h2 id="[^"]+" class="text-h3 wrap-anywhere">Biology, period 3<\/h2><\/div><\/div><p role="status" class="text-body text-text-secondary">Loading this session…<\/p><\/section>$/,
    );
    expect(html).not.toMatch(/stroke-arc-fill|home-countdown|<a /);
  });

  it('says a read that failed with its reason and a small Try again, the grid’s own (HomeMoreStates)', () => {
    const html = card(grid({ students: null, error: CANT_REACH }));
    expect(html).toMatch(
      new RegExp(
        `<\\/div><\\/div><div><div role="alert" class="text-body"><p class="font-semibold">Couldn't load this session\\.<\\/p><p class="text-text-secondary">${CANT_REACH.replaceAll('.', '\\.')}<\\/p><\\/div>${tryAgain({ margin: 'mt-3\\.5' })}<\\/div><\\/section>$`,
      ),
    );
    expect(html).not.toMatch(/home-countdown|<a /);
    // Its failure stands even once a later read fills the grid, as the class page's does.
    expect(card(grid({ error: CANT_REACH }))).toContain("Couldn't load this session.");
  });

  it('holds the grid’s Try again as Loading… while it reads again, its line kept, focus then on its name (HomeRetryStates)', () => {
    const held = card(grid({ students: null, error: CANT_REACH, retrying: true }));
    expect(held).toMatch(
      new RegExp(
        `<p class="text-text-secondary">${CANT_REACH.replaceAll('.', '\\.')}<\\/p><\\/div>${tryAgain({ held: true, margin: 'mt-3\\.5' })}<\\/div><\\/section>$`,
      ),
    );
    // Read, the card's counts in the failure's place: focus on the class's name, its heading.
    expect(source).toMatch(
      /<LiveCardHead id=\{id\} name=\{name\} now=\{now\} \/>[^]*?<TryAgain onRetry=\{grid\.retry\} held=\{grid\.retrying\} then=\{\[id\]\} className="mt-3\.5">/,
    );
  });

  it('draws a card for each class live by this computer’s clock, in the account’s order, over Your classes', () => {
    const second = taught('Period 4 Biology', { endsAt: '2026-10-12T15:20:00.000Z' });
    const html = plain(view({ me: me([LIVE, TODAY, second]) }));
    const cards = [
      ...html.matchAll(
        /<section aria-labelledby="[^"]+" class="[^"]*\brounded-live\b[^"]*">.*?<\/section>/g,
      ),
    ].map((m) => /<h2 [^>]*>([^<]*)<\/h2>/.exec(m[0])?.[1]);
    expect(cards).toEqual(['Biology, period 3', 'Period 4 Biology']);
    // Read as the page opens: each card's session loading first.
    expect(html.indexOf('Loading this session…')).toBeLessThan(html.indexOf('Your classes'));
    // None past its bell, and none for a teacher with no class live or no class at all.
    expect(plain(view({ now: Date.parse(BELL) }))).not.toContain('rounded-live');
    expect(plain(view({ me: me([TODAY, NONE]) }))).not.toContain('rounded-live');
    expect(plain(view({ me: me([]) }))).not.toContain('rounded-live');
  });

  it('lets a card go the moment the server ends its session, and reads the classes again; added time reads them too', () => {
    expect(source).toMatch(
      /const onEnded = useCallback\(\s*\(session: string\) => \{\s*setEnded\(\(cur\) => new Set\(cur\)\.add\(session\)\);\s*onRead\(\);\s*\},\s*\[onRead\],\s*\);/,
    );
    expect(source).toMatch(
      /const session = liveNow\(c, now\);\s*return session && !ended\.has\(session\.id\) \? \[\{ c, session \}\] : \[\];/,
    );
    // The card's own grid, the class page's: its snapshot's start for the ring, a later bell there
    // read again, so the row and the date's line keep to it.
    expect(source).toMatch(
      /setRead\(\{ startedAt, endsAt \}\);\s*if \(Date\.parse\(endsAt\) > Date\.parse\(bell\)\) onRead\(\);/,
    );
    expect(source).toMatch(/const endsAt = laterBell\(read\?\.endsAt \?\? null, bell\);/);
    expect(source).toMatch(
      /<LiveGrid\s*sessionId=\{session\.id\}\s*onEnded=\{onEnded\}\s*onSession=\{onSession\}\s*card=\{\(grid\) => \(/,
    );
    // No read of its own: the grid's snapshot and stream are the only ones. The rail's reads,
    // Recent activity's (PV17c-1) and Last session's (PV17c-2), are lib's (`pollActivity`,
    // `readReport`), never written out here.
    expect(source).not.toMatch(/api\.get|createSseClient|\/v1\//);
  });
});
