import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MeResponse } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { TaughtClass } from '../lib/classes';
import { CANT_REACH } from '../lib/errors';
import type { Home } from '../lib/student-web';
import { DOT } from './live-grid';
import type { Me } from './shell';

/*
 * Classes, in the menu (PV16): its head with New class (PV16b), a card per class with its students,
 * its last session or none, and while it runs the Live chip and the live card's edge (Classes); the
 * first class's card with none yet and its Create a class (ClassesEmpty); the list's failure over
 * the classes read before (HomeStates); the block's card beside them in v2's look; and the page
 * that reads the account again as it opens and at each live class's bell, for a teacher only, with
 * New class's dialog (new-class.test.ts).
 */
const shell = vi.hoisted((): { me: unknown } => ({ me: null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
vi.mock('@/components/shell', () => ({ useMe: () => shell.me }));
const { ClassesView, classLine, lastSessionDay, students } = await import('./classes');
const { cardId } = await import('./new-class');
const { default: ClassesPage } = await import('../app/classes/page');

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const UTC = { locale: 'en-US', timeZone: 'UTC' };
/** Monday, October 12, 2026, 2:30 PM UTC. */
const NOW = Date.parse('2026-10-12T14:30:00.000Z');
const day = (iso: string) => lastSessionDay(iso, new Date(NOW), UTC);
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
      runningSession: endsAt ? { id: 's-live', endsAt } : null,
      lastSession: lastStart
        ? { id: 's-last', startedAt: lastStart, endedAt: new Date(NOW).toISOString() }
        : null,
    },
  };
}

const BELL = '2026-10-12T14:55:00.000Z';
const CLASSES = [
  taught('Biology, period 3', { count: 28, endsAt: BELL, lastStart: '2026-10-09T13:00:00.000Z' }),
  taught('Period 1 Biology', { lastStart: '2026-10-12T08:00:00.000Z' }),
  taught('Period 6 AP Biology', { count: 24 }),
];

const view = (over: Partial<Parameters<typeof ClassesView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ClassesView, {
      classes: CLASSES,
      failed: null,
      now: NOW,
      onRead: () => undefined,
      onNew: () => undefined,
      ...over,
    }),
  );

/** Each card: where it goes, its classes, its words, each element's own, in order. */
const cards = (html: string) =>
  [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map(([, attrs = '', inner = '']) => ({
    href: /\bhref="([^"]*)"/.exec(attrs)?.[1],
    classes: /\bclass="([^"]*)"/.exec(attrs)?.[1]?.split(' ') ?? [],
    words: plain(inner)
      .split(/<[^>]+>/)
      .filter(Boolean),
    inner,
  }));

describe('a card’s line (Classes; ClassesStates)', () => {
  it('says its students, one or many', () => {
    expect(students(0)).toBe('0 students');
    expect(students(1)).toBe('1 student');
    expect(students(28)).toBe('28 students');
  });

  it('says when the last session started: today with its time, a day of the last six, else its date', () => {
    expect(day('2026-10-12T08:00:00.000Z')).toBe('today, 8:00 AM');
    expect(day('2026-10-11T22:00:00.000Z')).toBe('Sunday');
    expect(day('2026-10-09T13:00:00.000Z')).toBe('Friday');
    expect(day('2026-10-06T09:00:00.000Z')).toBe('Tuesday');
    // A week ago or more: its date, a weekday no longer telling which week.
    expect(day('2026-10-05T09:00:00.000Z')).toBe('Oct 5');
    expect(day('2026-10-02T09:00:00.000Z')).toBe('Oct 2');
    // Another year: the year too.
    expect(day('2025-12-18T09:00:00.000Z')).toBe('Dec 18, 2025');
  });

  it('is the students alone while the class is live, else with its last session or none', () => {
    const [live, today, none] = CLASSES as [TaughtClass, TaughtClass, TaughtClass];
    expect(classLine(live, NOW, UTC)).toBe('28 students');
    expect(classLine(today, NOW, UTC)).toBe(`26 students${DOT}last session today, 8:00 AM`);
    expect(classLine(none, NOW, UTC)).toBe(`24 students${DOT}no sessions yet`);
    // Past its bell by this computer's clock, the live class says its last session again.
    expect(classLine(live, Date.parse(BELL), UTC)).toBe(`28 students${DOT}last session Friday`);
    expect(classLine(taught('New', { count: 0 }), NOW, UTC)).toBe(
      `0 students${DOT}no sessions yet`,
    );
  });
});

describe('Classes (Classes, ClassesEmpty)', () => {
  it('is headed by Classes and New class, a secondary button with its plus that opens a dialog', () => {
    const html = view();
    expect(html).toMatch(
      /^<main class="flex flex-col gap-5\.5"><div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"><h1 class="text-page-title">Classes<\/h1><button type="button" aria-haspopup="dialog" class="[^"]*\bborder-border-strong\b[^"]*"><svg(?=[^>]*\bwidth="16")[^>]*\blucide-plus\b[^]*?<\/svg>New class<\/button><\/div>/,
    );
    // ClassesInterim's head, the title alone, went with PV16b.
    expect(html).not.toContain('Create a class');
  });

  it('draws a card per class, the whole card its link, in the list’s order, each with its id', () => {
    const list = cards(view());
    expect(list.map((c) => c.href)).toEqual(CLASSES.map((c) => `/classes/${c.id}`));
    // Focus comes to a class just made by its card's id (NewClass's Done).
    expect(view()).toMatch(new RegExp(`<a id="${cardId(CLASSES[0]?.id ?? '')}" `));
    expect(list.map((c) => c.words[0])).toEqual([
      'Biology, period 3',
      'Period 1 Biology',
      'Period 6 AP Biology',
    ]);
    // v2's `.classcard`: 18 × 20 px in, 12 × 16 px between its parts, 14 px corners, its own
    // hairline and soft shadow; the name 17/22 semibold over its 13/18 line; a 20 px chevron.
    for (const card of list) {
      expect(card.classes).toEqual(
        expect.arrayContaining([
          'flex',
          'flex-wrap',
          'items-center',
          'gap-x-4',
          'gap-y-3',
          'rounded-md',
          'border',
          'bg-surface-card',
          'px-5',
          'py-4.5',
          'shadow-1',
        ]),
      );
      expect(card.inner).toMatch(/<span class="block text-card-name wrap-anywhere">/);
      expect(card.inner).toMatch(/<span class="mt-0\.5 block text-caption text-text-tertiary">/);
      expect(card.inner).toMatch(/<svg(?=[^>]*\bwidth="20")[^>]*\blucide-chevron-right\b/);
    }
  });

  it('marks a class whose session runs with the Live chip and the live card’s edge, which no hover changes', () => {
    const [live, rest] = [cards(view())[0], cards(view())[1]];
    expect(live?.classes).toContain('border-live-edge');
    expect(live?.classes).not.toContain('hover:border-border-strong');
    expect(live?.words).toEqual([
      'Biology, period 3',
      '28 students',
      `Live${DOT}ends ${clock(BELL)}`,
    ]);
    expect(live?.inner).toMatch(
      /<span class="[^"]*\bbg-state-focused-bg\b[^"]*\btext-state-focused-fg\b[^"]*"><svg(?=[^>]*\bwidth="13")[^>]*\blucide-circle-check\b/,
    );
    expect(rest?.classes).toEqual(
      expect.arrayContaining(['border-border-default', 'hover:border-border-strong']),
    );
    expect(rest?.inner).not.toContain('Live');
    // At the bell by this computer's clock the chip and the edge go.
    const after = cards(view({ now: Date.parse(BELL) }))[0];
    expect(after?.classes).not.toContain('border-live-edge');
    expect(after?.inner).not.toContain('Live');
  });

  it('with no classes yet, the first class’s card, word for word, its Create a class opening the dialog', () => {
    const html = view({ classes: [] });
    expect(cards(html)).toEqual([]);
    expect(html).toMatch(
      /<section aria-labelledby="([^"]+)" class="flex flex-col items-start gap-2\.5 rounded-md border border-border-default bg-surface-card p-8 shadow-1"><svg width="46" height="46"[^]*?<\/svg><h2 id="\1" class="text-entry-title">Set up your first class<\/h2><p class="max-w-144 text-body text-text-secondary">Name it, then put its join code on the board\. Students join with it in the Bali app\.<\/p><button type="button" aria-haspopup="dialog" class="[^"]*\bbg-action-primary-bg\b[^"]*\bmt-1\.5\b[^"]*">Create a class<\/button><\/section>/,
    );
    // New class stays at the top (PV1's note on ClassesEmpty).
    expect(html).toContain('>New class</button>');
  });

  it('puts the New class dialog it is given after the columns', () => {
    const html = renderToStaticMarkup(
      createElement(
        ClassesView,
        {
          classes: CLASSES,
          failed: null,
          now: NOW,
          onRead: () => undefined,
          onNew: () => undefined,
        },
        createElement('dialog', { id: 'new' }),
      ),
    );
    expect(html).toMatch(/<\/div><\/div><dialog id="new"><\/dialog><\/main>$/);
  });

  it('says a list that didn’t load over the classes read before, with Try again (HomeStates)', () => {
    const html = plain(view({ failed: CANT_REACH }));
    expect(html).toContain(
      `<div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Couldn't load your classes. ${CANT_REACH}</p><button type="button" class="`,
    );
    expect(html).toMatch(/<button type="button" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button>/);
    expect(cards(html)).toHaveLength(3);
    expect(view()).not.toContain('role="alert"');
  });

  it('sets the block’s card beside the classes, v2’s columns: 520 px and 320 px, 20 px apart', () => {
    const html = view();
    expect(html).toContain(
      '<div class="flex flex-wrap items-start gap-5"><div class="flex min-w-0 grow-999 basis-130 flex-col gap-5">',
    );
    expect(html).toMatch(
      /<div class="flex min-w-0 grow basis-80 flex-col gap-5"><section aria-labelledby="[^"]+" class="[^"]*">/,
    );
  });
});

describe('the block’s card in v2’s look (Classes, HomeStates; PV16a)', () => {
  const html = view();
  const source = read('./blocks.tsx');

  it('is headed by its section label with the tag’s icon, its line under it', () => {
    expect(html).toMatch(
      /<h2 id="[^"]+" class="flex items-center gap-2 text-section-label text-text-tertiary uppercase"><svg(?=[^>]*\bwidth="14")[^>]*\blucide-nfc\b[^]*?<\/svg>Your block<\/h2><p class="mt-3\.5 text-body text-text-secondary">Students tap your block with their phone to join your session\.<\/p>/,
    );
    // Loading, then the rows or none, as the boards render them: 16 px under the line.
    expect(html).toContain(
      '<p role="status" class="mt-4 text-body text-text-secondary">Loading…</p>',
    );
  });

  it('spaces its parts as the boards render them, and says what didn’t load with a small Try again', () => {
    expect(source).toContain(
      '<p className="mt-4 border-y border-border-default py-2.75 text-body text-text-secondary">',
    );
    expect(source).toContain('<ul className="mt-4 border-b border-border-default">');
    expect(source).toMatch(/border-t border-border-default py-2\.75"/);
    expect(source).toContain('className="font-mono font-medium text-body break-all"');
    expect(source).toContain('className="mt-4.5"');
    // A refusal right under the help, the button 14 px under it, as HomeStates renders them.
    expect(source).toMatch(
      /role=\{said\.kind === 'done' \? 'status' : 'alert'\}\s*className="text-body break-words"/,
    );
    expect(source).toMatch(/aria-busy=\{busy\}\s*className="mt-3\.5"/);
    expect(source).toMatch(
      /<div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">\s*<p role="alert" className="text-body">\s*Couldn&apos;t load your blocks\.\{loadError \? ` \$\{loadError\}` : null\}\s*<\/p>\s*<Button variant="secondary" size="sm" onClick=\{load\}>/,
    );
  });
});

describe('the Classes page', () => {
  const account = (role: 'teacher' | 'student'): MeResponse => ({
    user: { id: 'u1', role, displayName: 'Ms. Rivera' },
    classes: role === 'teacher' ? CLASSES : [],
    session: null,
    armed: false,
  });
  function drawnFor(home: Home | null, error: string | null = null): string {
    const me: Me = {
      home,
      me: home === null || home.kind === 'invite' ? null : home.me,
      error,
      load: () => undefined,
      refresh: () => Promise.resolve(),
    };
    shell.me = me;
    return renderToStaticMarkup(createElement(ClassesPage));
  }
  const source = read('../app/classes/page.tsx');

  it('draws a teacher’s classes from the shell’s read, its failure over them', () => {
    const html = drawnFor({ kind: 'teacher', me: account('teacher') });
    expect(html).toMatch(/^<main [^>]*><div [^>]*><h1 class="text-page-title">Classes<\/h1>/);
    expect(cards(html)).toHaveLength(3);
    expect(drawnFor({ kind: 'teacher', me: account('teacher') }, CANT_REACH)).toContain(
      'role="alert"',
    );
  });

  it('holds New class’s dialog, closed, which New class and Create a class open, every answer reading the account again', () => {
    const html = drawnFor({ kind: 'teacher', me: account('teacher') });
    expect(html).toMatch(/<dialog aria-labelledby="[^"]+-title" class="[^"]*">/);
    expect(html).not.toMatch(/<dialog[^>]*\sopen[\s=>]/);
    expect(source).toMatch(/onNew=\{\(\) => newClass\.current\?\.open\(\)\}/);
    expect(source).toMatch(/<NewClass ref=\{newClass\} onAnswer=\{\(\) => load\(\)\} \/>/);
  });

  it('draws nothing before the account is read, nor for anyone but a teacher, whom it sends home', () => {
    expect(drawnFor(null)).toBe('');
    expect(drawnFor({ kind: 'student', me: account('student') })).toBe('');
    expect(drawnFor({ kind: 'invite' })).toBe('');
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*if \(home !== null && home\.kind !== 'teacher'\) router\.replace\('\/'\);\s*\}, \[home, router\]\);/,
    );
  });

  it('reads the account again as it opens, and at each live class’s bell, never before it', () => {
    expect(source).toMatch(
      /if \(!getAccessToken\(\)\) \{\s*router\.replace\('\/login'\);\s*return;\s*\}\s*load\(\);/,
    );
    // The chip goes at the bell by this computer's clock, each answer dated as it lands.
    expect(source).toMatch(/const bell = classes === null \? null : nextBell\(classes, now\);/);
    expect(source).toMatch(
      /const timer = window\.setTimeout\(\(\) => setNow\(Math\.max\(Date\.now\(\), bell\)\), bell - Date\.now\(\)\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[bell\]\);/,
    );
    expect(source).toMatch(/useEffect\(\(\) => setNow\(Date\.now\(\)\), \[home\]\);/);
    // The account read 3 s after the first bell the last read counts running, past ones too, so a
    // clock a little ahead of the server's still finds the session over; once per bell, never a loop.
    expect(source).toMatch(/const readAt = classes === null \? null : nextBell\(classes, 0\);/);
    expect(read('../lib/classes.ts')).toMatch(/export const AFTER_BELL_MS = 3000;/);
    expect(source).toMatch(
      /const timer = window\.setTimeout\(load, readAt \+ AFTER_BELL_MS - Date\.now\(\)\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[readAt, load\]\);/,
    );
  });
});
