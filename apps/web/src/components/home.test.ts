import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MeResponse } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { TaughtClass } from '../lib/classes';
import { CANT_REACH } from '../lib/errors';
import type { Student, Students } from '../lib/grid-state';
import { DOT, type GridNow } from './live-grid';

/*
 * A teacher's Home in v2's look (PV17a): the greeting and the date (Main, HomeIdle, HomeNew,
 * HomeNoName; the evening and two classes live drawn first, HomeInterimStates), each class once with
 * Live and Open or Start… (Main, HomeIdle), a new teacher's first class card going to Classes' New
 * class (HomeNew to ClassesNew), the list's failure over the classes read before, and the block's
 * card beside them; Main's live card waits for PV17b (HomeInterim, drawn first).
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
const { TeacherHome, dayLine, greeting, nextTurn, NEW_CLASS, LiveCardView, presentHref } =
  await import('./home');
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
      ...over,
    }),
  );

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
    const read = vi.fn();
    const html = plain(view({ failed: CANT_REACH, onRead: read }));
    expect(html).toMatch(
      new RegExp(
        `<\\/div><div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Couldn't load your classes\\. ${CANT_REACH.replaceAll('.', '\\.')}<\\/p><button type="button" class="[^"]*\\bh-8\\.5\\b[^"]*">Try again<\\/button><\\/div><div class="flex flex-wrap items-start gap-5">`,
      ),
    );
    expect(rows(html)).toHaveLength(3);
    expect(view()).not.toContain('role="alert"');
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

  it('draws no Recent activity or Last session yet: PV17c’s (HomeInterim)', () => {
    const html = plain(view());
    expect(html).not.toMatch(/Recent activity|Last session/);
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
  /** Each link in the card: where it goes, its words, what describes it, its classes. */
  const links = (html: string) =>
    [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map(([, attrs = '', inner = '']) => ({
      href: /\bhref="([^"]*)"/.exec(attrs)?.[1],
      text: inner.replace(/<[^>]+>/g, ''),
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
    expect(html).toContain(
      `<p class="ml-auto text-countdown-sub text-text-tertiary max-sm:ml-0">Ethan Park used Emergency Unlock at <time dateTime="${UNLOCK_AT}">${clock(UNLOCK_AT)}</time></p></div></section>`,
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
        `<\\/div><\\/div><div><div role="alert" class="text-body"><p class="font-semibold">Couldn't load this session\\.<\\/p><p class="text-text-secondary">${CANT_REACH.replaceAll('.', '\\.')}<\\/p><\\/div><button type="button" class="[^"]*\\bh-8\\.5\\b[^"]*\\bmt-3\\.5\\b[^"]*">Try again<\\/button><\\/div><\\/section>$`,
      ),
    );
    expect(html).not.toMatch(/home-countdown|<a /);
    // Its failure stands even once a later read fills the grid, as the class page's does.
    expect(card(grid({ error: CANT_REACH }))).toContain("Couldn't load this session.");
    expect(source).toMatch(/onClick=\{grid\.retry\}/);
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
    // No read of its own: the grid's snapshot and stream are the only ones.
    expect(source).not.toMatch(/api\.get|createSseClient|\/v1\//);
  });
});
