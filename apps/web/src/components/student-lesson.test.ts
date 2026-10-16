import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Presentation, StudentQuestion } from '@bali/shared';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bellTime } from '../lib/session-controls';
import type { LessonView, StudentClass } from '../lib/student-web';
import {
  PRIVACY,
  type Said,
  type Sending,
  StudentLesson,
  StudentLessonPage,
} from './student-lesson';

/*
 * A student's lesson (W4, parts 1a and 1b), rendered as it first draws, the boards' sample data in
 * it: StudentLesson's (Biology, period 3 with Ms. Rivera, 23:14 left to a 9:55 bell, its question
 * answered B), StudentNotIn's card, StudentClosed, StudentWaiting, StudentEnded and StudentStates'
 * lines; and the states drawn first on the canvas, StudentNoSlide and StudentCardStates. The
 * phone's chip and its line are part 2's: no state here shows them.
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
const QUESTION = '01924b2c-0000-7000-8000-000000000003';
const SESSION = '01924b2c-0000-7000-8000-000000000001';
const bell = { id: SESSION, startedAt: STARTED, endsAt: BELL };
const biology: StudentClass = {
  id: 'bio',
  name: 'Biology, period 3',
  teacher: { displayName: 'Ms. Rivera' },
  enrollmentId: 'e-bio',
  liveSession: bell,
};
const PROMPT = 'Which value of x solves x² − 5x + 6 = 0?';
const OPTIONS = ['x = 1', 'x = 2', 'x = 4', 'x = 6'];
const question = (over: Partial<StudentQuestion> = {}): StudentQuestion => ({
  id: QUESTION,
  prompt: PROMPT,
  options: OPTIONS,
  open: true,
  correctOption: null,
  answer: null,
  ...over,
});
const yours = (option: number) => ({ option, eventId: '01924b2c-0000-7000-8000-00000000000a' });
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

/** The page as it first draws `view`, at NOW, with an answer on its way or said. */
function render(view: LessonView, sending: Sending = null, said: Said = null): string {
  vi.useFakeTimers({ now: NOW });
  return renderToStaticMarkup(
    createElement(StudentLesson, { view, sending, said, onPick: () => {}, onRetry: () => {} }),
  );
}
afterEach(() => vi.useRealTimers());

/** The visible words of some markup, each run of them on its own. */
const words = (html: string) =>
  html
    .split(/<[^>]+>/)
    .map((s) => s.replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&'))
    .filter((s) => s.trim() !== '');
/** Each option's button: its pressed state, and whether it ends on a check. */
const buttons = (html: string) =>
  [
    ...html.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>([^]*?)<\/button>/g),
  ].map((m) => ({ pressed: m[1] === 'true', checked: /lucide-check\b/.test(m[2] ?? '') }));
/** Each closed answer's row: its classes and its words. */
const rows = (html: string) =>
  [...html.matchAll(/<div class="(flex min-h-13 [^"]*)">([^]*?<\/span><\/span>)<\/div>/g)].map(
    (m) => ({ classes: (m[1] ?? '').split(' '), words: words(m[2] ?? '') }),
  );
const HEAD = ['Biology, period 3', 'with Ms. Rivera', '23:14', 'ends ', bellTime(BELL)];
const ANSWERS = ['A', 'x = 1', 'B', 'x = 2', 'C', 'x = 4', 'D', 'x = 6'];
const ANSWERED = 'Your answer is in. You can change it until the question closes.';
const NOTHING = 'Nothing shared yet. Slides and questions from your teacher show up here.';

describe('the lesson with a question (StudentLesson, StudentNoSlide)', () => {
  const html = render(live({ question: question({ answer: yours(1) }) }));

  it('says the class’s head, then the card: its question, its answers, its line and the privacy line', () => {
    expect(words(html)).toEqual([...HEAD, 'Question', PROMPT, ...ANSWERS, ANSWERED, PRIVACY]);
    expect(PRIVACY).toBe("Your teacher sees the class's totals, never which answer is yours.");
  });

  it('shows the answer Bali holds picked, the brand’s fill and a check, the rest to pick, no Submit', () => {
    expect(buttons(html)).toEqual([
      { pressed: false, checked: false },
      { pressed: true, checked: true },
      { pressed: false, checked: false },
      { pressed: false, checked: false },
    ]);
    const option = /<button type="button" aria-pressed="true" class="([^"]*)"/.exec(html)?.[1];
    expect(option?.split(' ')).toEqual(
      expect.arrayContaining([
        'min-h-13',
        'rounded-sm',
        'border-border-strong',
        'text-body-lg',
        'aria-pressed:bg-action-primary-bg',
        'aria-pressed:text-action-primary-fg',
        'aria-pressed:font-semibold',
      ]),
    );
    expect(html).not.toMatch(/Submit/);
  });

  it('is v2’s lesson card, at its own width beside where a slide goes and a column of its own under 1024 px', () => {
    expect(html).toMatch(
      /<div class="lg:max-w-100"><section aria-labelledby="([^"]+)" class="flex flex-col gap-3\.5 rounded-live border border-border-default bg-surface-card p-5\.5 shadow-1">/,
    );
  });

  it('never shows a count, nor anyone else’s answer: the read carries neither', () => {
    // Every word on the card is the question's, its letters, its lines or the privacy line.
    const card = /<section[^]*<\/section>/.exec(html)?.[0] ?? '';
    expect(words(card)).toEqual(['Question', PROMPT, ...ANSWERS, ANSWERED, PRIVACY]);
  });

  it('shows the card beside a slide too, the slide W5’s', () => {
    const both = render(live({ question: question({ answer: yours(1) }), slide }));
    expect(words(both)).toEqual([...HEAD, 'Question', PROMPT, ...ANSWERS, ANSWERED, PRIVACY]);
  });
});

describe('the question card, every state', () => {
  it('asks for a pick while none is in (StudentNotIn’s card)', () => {
    const html = render(live({ question: question() }));
    expect(words(html)).toContain('Pick an answer. You can change it until the question closes.');
    expect(buttons(html).some((b) => b.pressed)).toBe(false);
  });

  it('shows a pick on its way picked, and says so (StudentCardStates)', () => {
    const sending = { questionId: QUESTION, option: 3 };
    const html = render(live({ question: question({ answer: yours(1) }) }), sending);
    expect(buttons(html).map((b) => b.pressed)).toEqual([false, false, false, true]);
    expect(words(html)).toContain('Sending your answer…');
    // Another question's sending is none of this card's.
    const other = render(live({ question: question() }), { questionId: 'q0', option: 3 });
    expect(buttons(other).some((b) => b.pressed)).toBe(false);
  });

  it('says an answer that didn’t send in the line’s place, the answer Bali holds left picked', () => {
    const said: Said = { questionId: QUESTION, said: 'failed' };
    const html = render(live({ question: question({ answer: yours(1) }) }), null, said);
    expect(html).toContain(
      '<p role="alert" class="text-body">Bali couldn&#x27;t send your answer. Check your connection and pick it again.</p>',
    );
    expect(words(html)).not.toContain(ANSWERED);
    expect(buttons(html).map((b) => b.pressed)).toEqual([false, true, false, false]);
    // Once closed there's no picking it again: the closed line in its place.
    const closed = render(live({ question: question({ open: false }) }), null, said);
    expect(closed).not.toContain('role="alert"');
  });

  it('says a pick that reached Bali too late, on the closed card, until another question', () => {
    const said: Said = { questionId: QUESTION, said: 'too_late' };
    const closed = render(live({ question: question({ open: false }) }), null, said);
    expect(closed).toContain(
      '<p role="alert" class="text-body">This question closed before your answer reached Bali, so it wasn&#x27;t counted.</p>',
    );
    const next = render(live({ question: question({ id: 'q2' }) }), null, said);
    expect(next).not.toContain('role="alert"');
  });

  it('closes the card as Bali says too late, before a read shows it closed, the answer it holds marked', () => {
    const said: Said = { questionId: QUESTION, said: 'too_late' };
    const html = render(live({ question: question({ answer: yours(3) }) }), null, said);
    expect(buttons(html)).toEqual([]);
    expect(words(html)).toEqual([
      ...HEAD,
      'Question · closed',
      PROMPT,
      ...ANSWERS.slice(0, 6),
      'D',
      'x = 6',
      'Your answer',
      "This question closed before your answer reached Bali, so it wasn't counted.",
      PRIVACY,
    ]);
    // No answer marked correct until a read shows it.
    expect(rows(html)[1]?.classes).toEqual(expect.arrayContaining(['text-text-secondary']));
  });

  it('closed without the answer shown, marks nothing for a student who didn’t answer (StudentCardStates)', () => {
    const html = render(live({ question: question({ open: false }) }));
    expect(words(html)).toEqual([
      ...HEAD,
      'Question · closed',
      PROMPT,
      ...ANSWERS,
      'Your teacher closed this question.',
      PRIVACY,
    ]);
    expect(rows(html).map((r) => r.classes.includes('text-text-secondary'))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('marks the correct answer once shown, and the student’s own, never red (StudentClosed)', () => {
    const html = render(
      live({ question: question({ open: false, correctOption: 1, answer: yours(3) }) }),
    );
    expect(words(html)).toEqual([
      ...HEAD,
      'Question · closed',
      PROMPT,
      'A',
      'x = 1',
      'B',
      'x = 2',
      'Correct answer',
      'C',
      'x = 4',
      'D',
      'x = 6',
      'Your answer',
      'Your teacher closed it and showed the answer.',
      PRIVACY,
    ]);
    expect(buttons(html)).toEqual([]);
    const [a, b, , d] = rows(html);
    expect(a?.classes).toEqual(expect.arrayContaining(['bg-surface-card', 'text-text-secondary']));
    expect(b?.classes).toEqual(
      expect.arrayContaining([
        'border-2',
        'border-bar-right',
        'bg-option-right',
        'text-text-primary',
      ]),
    );
    expect(d?.classes).toEqual(
      expect.arrayContaining(['bg-surface-sunken', 'border-border-strong', 'text-text-primary']),
    );
    expect(html).toMatch(
      /<span class="[^"]*\btext-text-brand\b[^"]*"><svg[^>]*lucide-circle-check[^]*?<\/svg>Correct answer<\/span>/,
    );
    expect(html).toMatch(/<span class="[^"]*\btext-state-notjoined-fg\b[^"]*">Your answer<\/span>/);
    expect(html).not.toMatch(/red|revoked|destructive/);
  });

  it('puts both marks on one answer when the student’s was right (StudentCardStates)', () => {
    const html = render(
      live({ question: question({ open: false, correctOption: 1, answer: yours(1) }) }),
    );
    expect(rows(html)[1]?.words).toEqual(['B', 'x = 2', 'Correct answer', 'Your answer']);
    expect(words(html).filter((w) => w === 'Your answer')).toHaveLength(1);
  });

  it('marks only the correct answer for a student who didn’t answer (StudentCardStates)', () => {
    const html = render(live({ question: question({ open: false, correctOption: 2 }) }));
    expect(words(html)).not.toContain('Your answer');
    expect(rows(html)[2]?.words).toEqual(['C', 'x = 4', 'Correct answer']);
  });

  it('closed without the answer shown, marks only the student’s own (StudentCardStates)', () => {
    const html = render(live({ question: question({ open: false, answer: yours(3) }) }));
    expect(words(html)).not.toContain('Correct answer');
    expect(rows(html)[3]?.words).toEqual(['D', 'x = 6', 'Your answer']);
    expect(words(html)).toContain('Your teacher closed this question.');
  });
});

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

  it('draws the head alone while a slide shows and no question, until W5 draws slides here (StudentCardStates)', () => {
    expect(words(render(live({ slide })))).toEqual(HEAD);
  });

  it('says Bali can’t be reached under the head, the lesson as last read under it (StudentStates, StudentCardStates)', () => {
    const html = render(live({ question: question({ answer: yours(1) }) }, true));
    expect(words(html).slice(0, 6)).toEqual([
      ...HEAD,
      "Can't reach Bali right now, so this page may be behind. It keeps trying.",
    ]);
    expect(html).toMatch(
      /<\/header><p role="status" class="rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary">/,
    );
    expect(buttons(html).map((b) => b.pressed)).toEqual([false, true, false, false]);
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
    expect(html).not.toMatch(/<svg|23:14|Nothing shared|Question/);
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

  it('follows the session only once a read lists it as the class’s, while the class is listed, and Try again starts afresh', () => {
    // Its start and bell as keptBell keeps them (tested in student-web.test.ts), every read.
    expect(component).toMatch(
      /const \[bell, setBell\] = useState\(\(\) => keptBell\(null, klass, sessionId\)\);\s*const kept = keptBell\(bell, klass, sessionId\);\s*if \(kept !== bell\) setBell\(kept\);/,
    );
    // A class the account no longer lists is followed no more: its reads would only be refused.
    expect(component).toMatch(/const follows = endsAt !== null && klass !== undefined;/);
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

  it('answers through followLesson’s one request, saying only the last pick’s answer', () => {
    expect(component).toMatch(/const result = await followed\.answer\(questionId, option\);/);
    expect(component).toMatch(/if \(picks\.current !== mine\) return;/);
    expect(component).toMatch(/const words = answerSaid\(result\);/);
    // A pick of the answer Bali holds sends nothing; one still on its way is sent again.
    expect(component).toMatch(/if \(picked !== i \|\| sending !== null\) onPick\(i\);/);
  });

  it('sends anyone but a student home', () => {
    expect(component).toMatch(
      /if \(home !== null && home\.kind !== 'student'\) router\.replace\('\/'\);/,
    );
  });
});
