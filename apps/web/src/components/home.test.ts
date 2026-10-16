import type { MeResponse } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { TaughtClass } from '../lib/classes';
import { CANT_REACH } from '../lib/errors';
import { DOT } from './live-grid';

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
const { TeacherHome, dayLine, greeting, nextTurn, NEW_CLASS } = await import('./home');

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
      /^<main class="flex flex-col gap-5\.5"><div><h1 tabindex="-1" class="text-greeting wrap-anywhere">Good (morning|afternoon|evening), Ms\. Rivera<\/h1><p class="mt-0\.75 text-meta text-text-secondary">[^<]+<\/p><\/div>/,
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

  it('draws no live card, Recent activity or Last session yet: PV17b’s and PV17c’s (HomeInterim)', () => {
    const html = plain(view());
    expect(html).not.toMatch(/Recent activity|Last session|Open the class|Present/);
  });
});
