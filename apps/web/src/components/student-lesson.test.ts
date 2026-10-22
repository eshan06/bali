import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Presentation, StudentQuestion } from '@bali/shared';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bellTime } from '../lib/session-controls';
import type { LessonView, Said, Sending, StudentClass } from '../lib/student-web';
import type { DeckState } from '../lib/use-slide';
import { PRIVACY, StudentLesson, StudentLessonPage } from './student-lesson';

/*
 * A student's lesson (W4), rendered as it first draws, the boards' sample data in it:
 * StudentLesson's (Biology, period 3 with Ms. Rivera, 23:14 left to a 9:55 bell, its question
 * answered B, the phone focused), StudentNotIn, StudentClosed, StudentWaiting, StudentEnded,
 * StudentPhoneStates and StudentStates' lines; and the states drawn first on the canvas,
 * StudentNoSlide, StudentCardStates and StudentChipStates.
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
/** 9:41, the last good read's time while reads fail, as StudentPhoneStates draws it. */
const AS_OF = Date.parse(BELL) - 14 * 60_000;
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
  asOf: behind ? AS_OF : null,
});

/** The slide's deck as the page first holds it (W5): loading, its Try again a stand-in. */
const LOADING_DECK = { deck: { kind: 'loading' } as DeckState, onReloadDeck: () => {} };

/** The page as it first draws `view`, at NOW, with an answer on its way or said. */
function render(
  view: LessonView,
  sending: Sending = null,
  said: Said = null,
  deck: DeckState = LOADING_DECK.deck,
): string {
  vi.useFakeTimers({ now: NOW });
  return renderToStaticMarkup(
    createElement(StudentLesson, {
      view,
      deck,
      onReloadDeck: () => {},
      sending,
      said,
      onPick: () => {},
      onRetry: () => {},
    }),
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
const HEAD = [
  'Biology, period 3',
  'with Ms. Rivera',
  '23:14',
  'ends ',
  bellTime(BELL),
  'Your phone',
  'Focused',
];
const ANSWERS = ['A', 'x = 1', 'B', 'x = 2', 'C', 'x = 4', 'D', 'x = 6'];
/** The slide's head (StudentLesson): which slide, and Full screen. */
const SLIDE = ['Slide 4 of 12', 'Full screen'];
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

  it('shows the card beside the slide, the card first in the page’s order at every width (StudentLesson, StudentZoom; W5)', () => {
    const both = render(live({ question: question({ answer: yours(1) }), slide }));
    expect(words(both)).toEqual([
      ...HEAD,
      'Question',
      PROMPT,
      ...ANSWERS,
      ANSWERED,
      PRIVACY,
      ...SLIDE,
      'Loading…',
    ]);
    // Beside the slide from 1024 px, its 25 rem column on the right; over it under 1024 px.
    expect(both).toMatch(
      /<div class="grid items-start gap-6 lg:grid-cols-\[minmax\(0,1fr\)_25rem\]"><div class="lg:col-start-2 lg:row-start-1"><section aria-labelledby="([^"]+)" class="flex flex-col gap-3\.5 rounded-live[^"]*">[^]*?<\/section><\/div><section aria-labelledby=/,
    );
    // Its question's heading, where focus comes once a question asked closes full screen.
    expect(both).toMatch(/<h2 id="[^"]+-question" tabindex="-1" class="mt-2 text-h3 /);
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

  it('says the answer is in once a read shows Bali holding an answer that said it didn’t send, or one after it (W4’s follow-up)', () => {
    const sent = '01924b2c-0000-7000-8000-00000000000b';
    const said: Said = { questionId: QUESTION, said: 'failed', eventId: sent };
    const DIDNT = 'Bali couldn&#x27;t send your answer. Check your connection and pick it again.';
    // Its reply lost, or later than 10 s: the read since shows it held under the id it went under.
    const landed = render(
      live({ question: question({ answer: { option: 2, eventId: sent } }) }),
      null,
      said,
    );
    expect(landed).not.toContain('role="alert"');
    expect(words(landed)).toContain(ANSWERED);
    expect(buttons(landed).map((b) => b.pressed)).toEqual([false, false, true, false]);
    // A pick on the phone since, its id after this one's: that answer is in.
    const later = { option: 3, eventId: '01924b2c-0000-7000-8000-00000000000c' };
    expect(words(render(live({ question: question({ answer: later }) }), null, said))).toContain(
      ANSWERED,
    );
    // Not yet: the read holds an older answer, or none.
    for (const answer of [yours(1), null]) {
      expect(render(live({ question: question({ answer }) }), null, said)).toContain(DIDNT);
    }
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
      /^<div class="flex flex-col gap-5\.5"><header class="flex flex-wrap items-center gap-x-4\.5 gap-y-3\.5 max-sm:gap-x-3\.5">/,
    );
    // Focusable from a script alone, for full screen's close (W5).
    expect(html).toMatch(
      /<h1 id="[^"]+-class" tabindex="-1" class="text-page-title [^"]*">Biology, period 3<\/h1>/,
    );
    expect(html).toContain(
      '<p class="mt-0.5 text-meta text-text-secondary wrap-anywhere">with Ms. Rivera</p>',
    );
    expect(html).toContain('<span class="font-num text-data-lg tabular-nums">23:14</span>');
    expect(html).toContain(`ends <time dateTime="${BELL}">${bellTime(BELL)}</time>`);
    // The student's own phone at its end, on a line of its own on a phone, as ClassLive's controls.
    expect(html).toMatch(
      /<\/p><div class="ml-auto flex flex-wrap items-center gap-2 max-sm:ml-0 max-sm:basis-full"><p role="status" class="inline-flex flex-wrap items-center gap-2"><span class="text-caption text-text-tertiary">Your phone<\/span><span class="[^"]*">[^]*?<span>Focused<\/span><\/span><\/p><\/div><\/header>/,
    );
  });

  it('says nothing is shared yet while no question or slide shows (StudentWaiting)', () => {
    expect(words(render(live()))).toEqual([...HEAD, NOTHING]);
  });

  it('draws the slide alone while no question shows, at the width it has beside one (StudentSlideAlone, drawn first)', () => {
    const html = render(live({ slide }));
    expect(words(html)).toEqual([...HEAD, ...SLIDE, 'Loading…']);
    // The grid's first column, the second left for a question, as v2.css's `.s-lesson` lays it.
    expect(html).toMatch(
      /<div class="grid items-start gap-6 lg:grid-cols-\[minmax\(0,1fr\)_25rem\]"><section aria-labelledby=/,
    );
    expect(html).not.toContain(NOTHING);
  });

  it('says Bali can’t be reached under the head, the lesson as last read under it (StudentStates, StudentCardStates)', () => {
    const BEHIND = "Can't reach Bali right now, so this page may be behind. It keeps trying.";
    // The phone's chip kept "as of" the last good read beside it (StudentPhoneStates).
    const AS_OF_WORDS = ['as of ', bellTime(new Date(AS_OF).toISOString())];
    const html = render(live({}, true));
    expect(words(html)).toEqual([...HEAD, ...AS_OF_WORDS, BEHIND, NOTHING]);
    expect(html).toMatch(
      /<\/header><p role="status" class="rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary">/,
    );
    const card = render(live({ question: question({ answer: yours(1) }) }, true));
    expect(words(card)).toEqual([
      ...HEAD,
      ...AS_OF_WORDS,
      BEHIND,
      'Question',
      PROMPT,
      ...ANSWERS,
      ANSWERED,
      PRIVACY,
    ]);
    expect(buttons(card).map((b) => b.pressed)).toEqual([false, true, false, false]);
    expect(render(live())).not.toMatch(/Can.t reach|as of/);
  });

  it('names a teacher with no name nowhere: the class alone', () => {
    const nameless = { ...biology, teacher: { displayName: '  ' } };
    expect(words(render(live({}, false, nameless)))).toEqual([
      'Biology, period 3',
      '23:14',
      'ends ',
      bellTime(BELL),
      'Your phone',
      'Focused',
      NOTHING,
    ]);
  });
});

describe('the student’s own phone beside the class’s name (StudentPhoneStates, StudentChipStates)', () => {
  /** The phone's chip in the head: its classes, its icon, its words. */
  const chip = (html: string) => {
    const m =
      /<span class="text-caption text-text-tertiary">Your phone<\/span><span class="([^"]*)">(<svg[^>]*>)[^]*?<\/svg><span>([^]*?)<\/span><\/span>/.exec(
        html,
      );
    const said = words(m?.[3] ?? '').join('');
    return { classes: (m?.[1] ?? '').split(' '), icon: m?.[2] ?? '', words: said };
  };
  /** The phone's line under the head: its icon and its words. */
  const line = (html: string) => {
    const m =
      /<\/header><div class="flex items-start gap-3 rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body text-text-primary">(<svg[^>]*>)[^]*?<\/svg><p>([^]*?)<\/p><\/div>/.exec(
        html,
      );
    return m ? { icon: m[1] ?? '', words: words(m[2] ?? '').join('') } : null;
  };
  const NOT_IN = "You're not tapped in yet. Tap your teacher's block with your phone.";
  /** 9:41, three minutes after the phone last checked in at 9:38. */
  const SINCE = new Date(AS_OF - 3 * 60_000).toISOString();

  it('is Focused in focus’s green, with no line (StudentLesson)', () => {
    const html = render(live());
    expect(chip(html)).toMatchObject({ words: 'Focused' });
    expect(chip(html).classes).toEqual(
      expect.arrayContaining([
        'rounded-full',
        'border-[1.5px]',
        'border-transparent',
        'bg-state-focused-bg',
        'text-state-focused-fg',
        'text-caption',
        'font-medium',
      ]),
    );
    expect(chip(html).icon).toMatch(/lucide-circle-check/);
    expect(line(html)).toBeNull();
  });

  it('is Not in, in not here’s grey, its line under the head saying to tap in (StudentNotIn)', () => {
    const html = render(live({ phone: null, question: question() }));
    expect(chip(html)).toMatchObject({ words: 'Not in' });
    expect(chip(html).classes).toEqual(
      expect.arrayContaining(['bg-state-notjoined-bg', 'text-state-notjoined-fg']),
    );
    expect(chip(html).icon).toContain('class="lucide lucide-circle shrink-0"');
    expect(line(html)).toEqual({
      icon: expect.stringMatching(/lucide-nfc/) as string,
      words: NOT_IN,
    });
    // Right under the head, then the card.
    expect(words(html)).toEqual([
      ...HEAD.slice(0, -1),
      'Not in',
      NOT_IN,
      'Question',
      PROMPT,
      ...ANSWERS,
      'Pick an answer. You can change it until the question closes.',
      PRIVACY,
    ]);
  });

  it('is Unlocked in emergency orange, its line naming the bell the account says', () => {
    const html = render(live({ phone: { state: 'unlocked', lastSeenAt: null } }));
    expect(chip(html)).toMatchObject({ words: 'Unlocked' });
    expect(chip(html).classes).toEqual(
      expect.arrayContaining(['bg-state-emergency-bg', 'text-state-emergency-fg']),
    );
    expect(chip(html).icon).toMatch(/lucide-lock-open/);
    expect(line(html)).toEqual({
      icon: expect.stringMatching(/lucide-smartphone/) as string,
      words: `Everything on your phone is open until you lock your apps again in the Bali app, or until the bell at ${bellTime(BELL)}. Your teacher can see you unlocked.`,
    });
    expect(html).toContain(`until the bell at <time dateTime="${BELL}">${bellTime(BELL)}</time>.`);
  });

  it('is Screen Time off in protection off’s red, its line saying how to turn it back on', () => {
    const html = render(live({ phone: { state: 'protection_off', lastSeenAt: null } }));
    expect(chip(html)).toMatchObject({ words: 'Screen Time off' });
    expect(chip(html).classes).toEqual(
      expect.arrayContaining(['bg-state-revoked-bg', 'text-state-revoked-fg']),
    );
    expect(chip(html).icon).toMatch(/lucide-shield-off/);
    expect(line(html)).toEqual({
      icon: expect.stringMatching(/lucide-smartphone/) as string,
      words:
        "Screen Time is off for Bali, so no app on your phone is paused and your teacher sees that it's off. Open the Bali app on your phone to turn it back on.",
    });
  });

  it('is Silent with its minutes, dashed, never green, its line naming when Bali last heard from it', () => {
    vi.useFakeTimers({ now: AS_OF });
    const html = renderToStaticMarkup(
      createElement(StudentLesson, {
        view: live({ phone: { state: 'silent', lastSeenAt: SINCE } }),
        ...LOADING_DECK,
        sending: null,
        said: null,
        onPick: () => {},
        onRetry: () => {},
      }),
    );
    expect(chip(html).words).toBe('Silent\u00a0· 3 min');
    expect(chip(html).classes).toEqual(
      expect.arrayContaining([
        'border-dashed',
        'border-border-strong',
        'bg-state-ended-bg',
        'text-state-ended-fg',
      ]),
    );
    expect(chip(html).icon).toMatch(/lucide-wifi-off/);
    expect(line(html)).toEqual({
      icon: expect.stringMatching(/lucide-smartphone/) as string,
      words: `Bali hasn't heard from your phone since ${bellTime(SINCE)}, and your teacher sees that. Open the Bali app on your phone so it can check in.`,
    });
    expect(html).toContain(`since <time dateTime="${SINCE}">${bellTime(SINCE)}</time>,`);
  });

  it('is the grid’s Unknown for a state this page has no chip for, with no line (StudentChipStates)', () => {
    const newer = { state: 'charging', lastSeenAt: null } as unknown as Presentation['phone'];
    const html = render(live({ phone: newer }));
    expect(chip(html).words).toBe('Unknown\u00a0· refresh');
    expect(chip(html).classes).toEqual(
      expect.arrayContaining([
        'border-dashed',
        'border-border-strong',
        'bg-state-nodevice-bg',
        'text-text-primary',
      ]),
    );
    expect(chip(html).icon).toMatch(/lucide-circle-question-mark|lucide-circle-help/);
    expect(line(html)).toBeNull();
  });

  it('keeps its state as of the last good read while Bali can’t be reached, Silent’s minutes stopped then (StudentPhoneStates, StudentChipStates)', () => {
    // Ten minutes on, still unreached: the chip says what the read at 9:41 said.
    vi.useFakeTimers({ now: AS_OF + 10 * 60_000 });
    const view = live({ phone: { state: 'silent', lastSeenAt: SINCE } }, true);
    const html = renderToStaticMarkup(
      createElement(StudentLesson, {
        view,
        ...LOADING_DECK,
        sending: null,
        said: null,
        onPick: () => {},
        onRetry: () => {},
      }),
    );
    const asOf = new Date(AS_OF).toISOString();
    expect(chip(html).words).toBe('Silent\u00a0· 3 min');
    expect(html).toContain(
      `<span class="text-caption text-text-tertiary">as of <time dateTime="${asOf}">${bellTime(asOf)}</time></span></p></div></header>`,
    );
  });

  it('says the phone’s line, then that Bali can’t be reached, then the lesson as last read (StudentChipStates)', () => {
    const html = render(live({ phone: null }, true));
    const asOf = new Date(AS_OF).toISOString();
    expect(words(html)).toEqual([
      ...HEAD.slice(0, -1),
      'Not in',
      'as of ',
      bellTime(asOf),
      NOT_IN,
      "Can't reach Bali right now, so this page may be behind. It keeps trying.",
      NOTHING,
    ]);
  });

  it('shows no phone once the class is over (StudentEnded)', () => {
    const html = render({ kind: 'over', klass: biology, at: Date.parse(BELL) });
    expect(html).not.toMatch(/Your phone|Focused|Checking/);
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
      '<div><p role="status" class="text-body text-text-secondary">Loading…</p></div>',
    );
    expect(render({ kind: 'failed' })).toMatch(
      /^<div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Bali couldn&#x27;t load this lesson\.<\/p><button type="button" aria-disabled="false" aria-busy="false" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/div>$/,
    );
  });

  it('keeps its failure said while Try again reads it again, held as Loading… (StudentRetryStates)', () => {
    vi.useFakeTimers({ now: NOW });
    const html = renderToStaticMarkup(
      createElement(StudentLesson, {
        view: { kind: 'failed' },
        held: true,
        deck: LOADING_DECK.deck,
        onReloadDeck: () => {},
        sending: null,
        said: null,
        onPick: () => {},
        onRetry: () => {},
      }),
    );
    expect(html).toMatch(
      /^<div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Bali couldn&#x27;t load this lesson\.<\/p><button type="button" aria-disabled="true" aria-busy="true" class="[^"]*">Loading…<\/button><\/div>$/,
    );
    expect(html).not.toMatch(/\sdisabled=""/);
    // Read: focus on the class's name, the page's heading; with none (not the student's class), on
    // the page's first control, Your classes (`TryAgain`'s `land`).
    expect(source('./student-lesson.tsx')).toMatch(
      /<TryAgain onRetry=\{onRetry\} held=\{held\} then=\{\[`\$\{id\}-class`\]\}>/,
    );
  });

  it('says a class the account doesn’t list isn’t the student’s, and leads to Your classes (StudentCardStates)', () => {
    expect(render({ kind: 'not_in_class' })).toMatch(
      /^<div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">This lesson is for a class you&#x27;re not in\.<\/p><a class="[^"]*\bh-8\.5\b[^"]*" href="\/">Your classes<\/a><\/div>$/,
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
    // Try again follows it afresh and reads the account again (`refresh`, which keeps a failure said
    // until its answer), the lesson as it was kept, so its failure stays said meanwhile.
    expect(component).toMatch(
      /onRetry=\{\(\) => \{\s*setAgain\(\{ lesson, accountReads \}\);\s*setAttempt\(\(n\) => n \+ 1\);\s*void refresh\(\)\.then\(\(\) => setAccountReads\(\(n\) => n \+ 1\)\);\s*\}\}/,
    );
    // Held until the read it waits on answers (retryHeld, tested in student-web.test.ts): the
    // lesson's while the class and its bell are known, else the account's.
    expect(component).toMatch(
      /const held = retryHeld\(again, view, klass !== undefined && bell !== null, \{\s*lesson,\s*accountReads,\s*\}\);\s*if \(again !== null && !held\) setAgain\(null\);/,
    );
    // The account's last read decides: one since the page opened answers for it.
    expect(component).toMatch(
      /const account = me !== opened \? 'fresh' : asked\.current && error !== null \? 'failed' : 'stale';/,
    );
  });

  it('answers through the lesson it follows, its picks as picker says them (tested in student-web.test.ts)', () => {
    expect(component).toMatch(/const \[pick\] = useState\(\(\) => picker\(setPicks\)\);/);
    expect(component).toMatch(
      /onPick=\{\(questionId, option\) => void pick\(following\.current, questionId, option\)\}/,
    );
    expect(component).toMatch(/sending=\{picks\.sending\}\s*said=\{picks\.said\}/);
    // A tap on the answer Bali holds sends nothing, but while one is on its way or after one
    // didn't send: then it's sent again.
    expect(component).toMatch(
      /if \(picked !== i \|\| sending !== null \|\| said === 'failed'\) onPick\(i\);/,
    );
  });

  it('loads the slide’s deck only while the lesson shows it, closed once it stops, changes or the class is over (W5)', () => {
    // Through the presenter's own hook (use-slide-hook.test.ts): loadDeck's check, `no-store`.
    expect(component).toMatch(
      /const view = lessonView\(klass, account, bell, lesson\);\s*const shown = view\.kind === 'live' \? view\.presentation\.slide : null;\s*const \{ deck, reload \} = useShownDeck\(api, shown\);/,
    );
    expect(component).toMatch(
      /view=\{held \? \{ kind: 'failed' \} : view\}\s*held=\{held\}\s*deck=\{deck\}\s*onReloadDeck=\{reload\}/,
    );
  });

  it('opens full screen on Full screen’s press, the page itself full screen where the browser allows it (W5)', () => {
    // The browser's own full screen only on the press itself, before the view opens.
    expect(component).toMatch(
      /onFull=\{\(\) => \{[^}]*enterFullscreen\(\);\s*setFull\(\{ open: \{ questionId: q\?\.id \?\? null \}, back: null \}\);\s*\}\}/,
    );
    expect(component).toMatch(
      /\{full\.open && slide \? \(\s*<SlideFull\s*slide=\{slide\}\s*deck=\{deck\}\s*behind=\{behind\}\s*onReload=\{onReloadDeck\}\s*onLeave=\{leave\}\s*\/>\s*\) : null\}/,
    );
    // Shut as the page first draws.
    expect(render(live({ slide }))).not.toMatch(/<dialog/);
  });

  it('closes full screen by itself once a question is asked, the slides stop or the class is over, focus where the student is now (W5; PV1)', () => {
    // When, as fullEnds says (tested in student-web.test.ts), checked at each draw.
    expect(component).toMatch(
      /const ends = full\.open === null \? null : fullEnds\(full\.open, view\);\s*if \(ends !== null\) setFull\(\{ open: null, back: ends \}\);/,
    );
    // Left by the student, once: Exit full screen, Esc, or the browser leaving full screen.
    expect(component).toMatch(
      /setFull\(\(cur\) => \(cur\.open === null \? cur : \{ open: null, back: 'left' \}\)\)/,
    );
    // Closed: the page out of the browser's full screen, focus on Full screen, the question asked,
    // or the class's name; with no class's name on the page (the lesson refused, or no longer the
    // student's), on its Try again or its Your classes (santa's review).
    expect(component).toMatch(
      /if \(full\.open !== null \|\| full\.back === null\) return;\s*leaveFullscreen\(\);\s*const to = \{ left: 'full', question: 'question', gone: 'class' \}\[full\.back\];\s*const target =\s*document\.getElementById\(`\$\{id\}-\$\{to\}`\) \?\?\s*document\.querySelector<HTMLElement>\('main :is\(button, a\)'\);\s*target\?\.focus\(\);/,
    );
    // Those views have no class's name, and their first control is that way on.
    expect(render({ kind: 'failed' })).not.toMatch(/-class"/);
    expect(render({ kind: 'failed' })).toMatch(
      /^<div[^>]*><p role="alert"[^>]*>[^<]*<\/p><button /,
    );
    expect(render({ kind: 'not_in_class' })).toMatch(
      /^<div[^>]*><p role="alert"[^>]*>[^<]*<\/p><a /,
    );
    expect(component).toMatch(/fullId=\{`\$\{id\}-full`\}/);
    expect(component).toMatch(/headingId=\{`\$\{id\}-question`\}/);
    expect(component).toMatch(/headingId=\{`\$\{id\}-class`\}/);
    // The page gone (another page, the class's end): out of full screen with it.
    expect(component).toMatch(/useEffect\(\(\) => \(\) => leaveFullscreen\(\), \[\]\);/);
  });

  it('sends anyone but a student home', () => {
    expect(component).toMatch(
      /if \(home !== null && home\.kind !== 'student'\) router\.replace\('\/'\);/,
    );
  });
});
