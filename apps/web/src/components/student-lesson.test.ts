import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Presentation, StudentQuestion } from '@bali/shared';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bellTime } from '../lib/session-controls';
import type { LessonView, StudentClass } from '../lib/student-web';
import { StudentLesson, StudentLessonPage } from './student-lesson';

/*
 * A student's lesson page (W4, part 1a), rendered as it first draws, the boards' sample data in it:
 * StudentLesson's head (Biology, period 3 with Ms. Rivera, 23:14 left to a 9:55 bell),
 * StudentWaiting, StudentEnded and StudentStates' lines; and the states drawn first on the canvas,
 * StudentCardStates'. The question card is part 1b's; the phone's chip and its line part 2's: no
 * state here shows them.
 */
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('not found');
  }),
);
vi.mock('next/navigation', () => ({ notFound, useRouter: vi.fn() }));
const { default: Route } = await import('../app/lessons/[classId]/[sessionId]/page');
const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const STARTED = '2026-10-12T14:05:00.000Z';
const BELL = '2026-10-12T14:55:00.000Z';
/** 23:14 before the bell, as StudentLesson draws it. */
const NOW = Date.parse(BELL) - (23 * 60 + 14) * 1000;
const SESSION = '01924b2c-0000-7000-8000-000000000001';
const bell = { id: SESSION, startedAt: STARTED, endsAt: BELL };
const biology: StudentClass = {
  id: 'bio',
  name: 'Biology, period 3',
  teacher: { displayName: 'Ms. Rivera' },
  enrollmentId: 'e-bio',
  liveSession: bell,
};
const question: StudentQuestion = {
  id: '01924b2c-0000-7000-8000-000000000003',
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  open: true,
  correctOption: null,
  answer: null,
};
const slide = { deckId: 'd1', sha256: 'ab', page: 4, pageCount: 12 };
const live = (over: Partial<Presentation> = {}, behind = false, klass = biology): LessonView => ({
  kind: 'live',
  klass,
  bell,
  presentation: {
    running: true,
    question: null,
    slide: null,
    phone: { state: 'focused', lastSeenAt: null },
    ...over,
  },
  behind,
});

/** The page as it first draws `view`, at NOW. */
function render(view: LessonView): string {
  vi.useFakeTimers({ now: NOW });
  return renderToStaticMarkup(createElement(StudentLesson, { view, onRetry: () => {} }));
}
afterEach(() => vi.useRealTimers());

/** The visible words of some markup, each run of them on its own. */
const words = (html: string) =>
  html
    .split(/<[^>]+>/)
    .map((s) => s.replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&'))
    .filter((s) => s.trim() !== '');
const HEAD = ['Biology, period 3', 'with Ms. Rivera', '23:14', 'ends ', bellTime(BELL)];
const NOTHING = 'Nothing shared yet. Slides and questions from your teacher show up here.';

describe('the lesson page while the class runs', () => {
  it('draws the head as ClassLive’s: the 44 px ring the session left, the countdown to the server’s bell (StudentLesson)', () => {
    const html = render(live());
    const ring =
      /<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"[^]*?<\/svg>/.exec(
        html,
      )?.[0];
    const around = 2 * Math.PI * 19.5;
    const arc = (((23 * 60 + 14) / 3000) * around).toFixed(1);
    expect(ring).toContain(`stroke-dasharray="${arc} ${around.toFixed(1)}"`);
    expect(html).toMatch(
      /^<main class="flex flex-col gap-5\.5"><header class="flex flex-wrap items-center gap-x-4\.5 gap-y-3\.5 max-sm:gap-x-3\.5">/,
    );
    expect(html).toMatch(/<h1 class="text-page-title [^"]*">Biology, period 3<\/h1>/);
    expect(html).toContain(
      '<p class="mt-0.5 text-meta text-text-secondary wrap-anywhere">with Ms. Rivera</p>',
    );
    expect(html).toContain('<span class="font-num text-data-lg tabular-nums">23:14</span>');
    expect(html).toContain(`ends <time dateTime="${BELL}">${bellTime(BELL)}</time>`);
    // The phone's chip is part 2's.
    expect(html).not.toMatch(/Your phone|Focused/);
  });

  it('says nothing is shared yet while no question or slide shows (StudentWaiting)', () => {
    expect(words(render(live()))).toEqual([...HEAD, NOTHING]);
  });

  it('draws the head alone while a question or a slide shows that it doesn’t draw yet, never “nothing shared” (StudentCardStates)', () => {
    // The question card is part 1b's, slides W5's.
    for (const over of [{ question }, { slide }, { question, slide }]) {
      expect(words(render(live(over)))).toEqual(HEAD);
    }
  });

  it('says Bali can’t be reached under the head, as the stale banner is drawn (StudentStates, StudentCardStates)', () => {
    const html = render(live({}, true));
    expect(words(html)).toEqual([
      ...HEAD,
      "Can't reach Bali right now, so this page may be behind. It keeps trying.",
      NOTHING,
    ]);
    expect(html).toMatch(
      /<\/header><p role="status" class="rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary">/,
    );
    expect(render(live())).not.toContain('role="status"');
  });

  it('names a teacher with no name nowhere: the class alone', () => {
    const nameless = { ...biology, teacher: { displayName: '  ' } };
    expect(words(render(live({}, false, nameless)))).toEqual([
      'Biology, period 3',
      '23:14',
      'ends ',
      bellTime(BELL),
      NOTHING,
    ]);
  });
});

describe('the lesson page in its other states', () => {
  it('says class is over with its time, and leads back to Your classes (StudentEnded)', () => {
    const html = render({ kind: 'over', klass: biology, at: Date.parse(BELL) });
    expect(words(html)).toEqual([
      'Biology, period 3',
      'with Ms. Rivera',
      'Class is over',
      'This class ended at ',
      bellTime(BELL),
      ". Slides and questions from it aren't available after class.",
      'Your classes',
    ]);
    // Over: no ring, no countdown, nothing of the lesson.
    expect(html).not.toMatch(/<svg|23:14|Nothing shared/);
    expect(html).toMatch(
      /<section aria-labelledby="([^"]+)" class="flex max-w-160 flex-col items-start gap-3 rounded-md border border-border-default bg-surface-card p-5 shadow-1"><h2 id="\1" class="text-h3">Class is over<\/h2>/,
    );
    expect(html).toContain(`<time dateTime="${BELL}">${bellTime(BELL)}</time>`);
    expect(html).toMatch(/<a class="[^"]*\bh-10\b[^"]*" href="\/">Your classes<\/a>/);
  });

  it('says class is over with no time when the page can’t vouch for one (StudentCardStates)', () => {
    const html = render({ kind: 'over', klass: biology, at: null });
    expect(words(html)).toContain(
      "This class has ended. Slides and questions from it aren't available after class.",
    );
    expect(html).not.toContain('<time');
  });

  it('says Loading… until the first read, and a read that failed with Try again (StudentStates)', () => {
    expect(render({ kind: 'loading' })).toBe(
      '<main><p role="status" class="text-body text-text-secondary">Loading…</p></main>',
    );
    expect(render({ kind: 'failed' })).toMatch(
      /^<main class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Bali couldn&#x27;t load this lesson\.<\/p><button type="button" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/main>$/,
    );
  });

  it('says a class the account doesn’t list isn’t the student’s, and leads to Your classes (StudentCardStates)', () => {
    expect(render({ kind: 'not_in_class' })).toMatch(
      /^<main class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">This lesson is for a class you&#x27;re not in\.<\/p><a class="[^"]*\bh-8\.5\b[^"]*" href="\/">Your classes<\/a><\/main>$/,
    );
  });
});

describe('its URL and its reads (from their sources)', () => {
  const CLASS = '0199e3a1-0000-7000-8000-00000000000c';
  const component = source('./student-lesson.tsx');

  it('is a page for a class and a session each an id the API mints, else none, and afresh for another', async () => {
    const page = await Route({ params: Promise.resolve({ classId: CLASS, sessionId: SESSION }) });
    expect(isValidElement(page) && page.type).toBe(StudentLessonPage);
    expect(isValidElement(page) && page.props).toEqual({ classId: CLASS, sessionId: SESSION });
    expect(isValidElement(page) && page.key).toBe(`${CLASS}/${SESSION}`);
    for (const [classId, sessionId] of [
      ['..', SESSION],
      [CLASS, '..'],
      ['c1', SESSION],
      [CLASS, `${SESSION}/..`],
    ]) {
      notFound.mockClear();
      await expect(Route({ params: Promise.resolve({ classId, sessionId }) })).rejects.toThrow(
        'not found',
      );
      expect(notFound).toHaveBeenCalledOnce();
    }
  });

  it('reads the account as it opens, the shell’s one read, and again at the bell, once', () => {
    expect(component).toMatch(/asked\.current = true;\s*load\(\);\s*\}, \[load, router\]\);/);
    expect(component).toMatch(
      /const timer = window\.setTimeout\(\(\) => load\(\), Math\.max\(0, Date\.parse\(endsAt\) - Date\.now\(\)\)\);/,
    );
    expect(component).not.toMatch(/api\.get\b/);
  });

  it('follows the session only once a read lists it as the class’s, and Try again starts afresh', () => {
    expect(component).toMatch(
      /const listed = klass\?\.liveSession\?\.id === sessionId \? klass\.liveSession : null;/,
    );
    expect(component).toMatch(
      /if \(!follows\) return;\s*const followed = followLesson\(api, sessionId, setLesson\);/,
    );
    expect(component).toMatch(
      /onRetry=\{\(\) => \{\s*setLesson\(EMPTY\);\s*setAttempt\(\(n\) => n \+ 1\);\s*load\(\);\s*\}\}/,
    );
    // The account's last read decides: one since the page opened answers for it.
    expect(component).toMatch(
      /const account = me !== opened \? 'fresh' : asked\.current && error !== null \? 'failed' : 'stale';/,
    );
  });

  it('sends anyone but a student home', () => {
    expect(component).toMatch(
      /if \(home !== null && home\.kind !== 'student'\) router\.replace\('\/'\);/,
    );
  });
});
