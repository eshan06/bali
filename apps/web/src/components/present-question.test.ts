import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { QuestionResults, TeacherQuestion } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { PresentQuestion } from './present-question';
import type { LiveQuestion } from './question-card';

/*
 * The live question on the projector, in the live grid's place (L7, part 2; PresentQuestion,
 * PresentAnswer, and the intermediate states drawn first on the canvas, PresentQuestionStates and
 * PresentQuestionPhone), rendered in each state. The class sees it, so it shows totals only, never
 * anything about one student: "N of M answered" while the question is open, each answer's count
 * only once it is closed and Bali's last read after the close is in, never under the server's
 * small-group guard, and the correct answer only once students are shown it.
 */
const source = readFileSync(
  fileURLToPath(new URL('./present-question.tsx', import.meta.url)),
  'utf8',
);

const question = (over: Partial<TeacherQuestion> = {}): TeacherQuestion => ({
  id: '0199e0a0-0000-7000-8000-000000000001',
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  correctOption: 1,
  revealed: false,
  open: true,
  ...over,
});
const totals = (over: Partial<QuestionResults> = {}): QuestionResults => ({
  answered: 18,
  eligible: 28,
  open: true,
  correctOption: 1,
  revealed: false,
  counts: [2, 12, 1, 3],
  ...over,
});
/** The class page's live question, as `useLiveQuestion` holds it; `final`: Bali's last read. */
function lesson(
  over: Partial<TeacherQuestion> = {},
  read: QuestionResults | null = totals(),
  final = false,
): LiveQuestion {
  return {
    question: question(over),
    results: read && { results: read, final, problem: null, at: 0 },
    closing: false,
    closeFailed: null,
    close: vi.fn(),
    done: vi.fn(),
  };
}
/** Closed (PresentAnswer's 21 of 28), its last read in unless `final` says otherwise. */
const closed = (revealed: boolean, over: Partial<QuestionResults> = {}, final = true) =>
  lesson(
    { open: false, revealed },
    totals({ answered: 21, open: false, revealed, counts: [3, 14, 1, 3], ...over }),
    final,
  );
const render = (l: LiveQuestion) =>
  renderToStaticMarkup(createElement(PresentQuestion, { id: 'L', lesson: l }));

/** Markup as read: each tag a space, each run of spaces one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
/** Each answer's row: its classes, and its markup. */
const rows = (html: string) =>
  [...html.matchAll(/<li class="([^"]*)">([^]*?)<\/li>/g)].map((m) => ({
    classes: (m[1] ?? '').split(' '),
    html: m[2] ?? '',
  }));
/** Each answer's count, in the rounded numerals, and its bar's width and colour. */
const counts = (html: string) =>
  rows(html).map((r) => /<span class="font-num text-data-lg[^"]*">(\d+)<\/span>/.exec(r.html)?.[1]);
const bars = (html: string) =>
  rows(html).map((r) => {
    const bar = /<span aria-hidden="true" class="([^"]*)" style="width:(\d+)%"/.exec(r.html);
    return bar ? [bar[2], bar[1]?.includes('bg-bar-right') ? 'green' : 'grey'] : null;
  });

describe('the card (PresentQuestion)', () => {
  const html = render(lesson());

  it('is v2’s projector card: 20 px corners, 36 × 44 px in, its parts 28 px apart, named by its question', () => {
    expect(html).toMatch(/^<section aria-labelledby="L-pq" class="[^"]*">/);
    const card = /^<section [^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ');
    expect(card).toEqual(
      expect.arrayContaining([
        'flex-col',
        'gap-7',
        'rounded-lg',
        'border-border-default',
        'bg-surface-card',
        'px-11',
        'py-9',
        'shadow-1',
      ]),
    );
    // Right under its kicker, as the boards render (`.app h2`'s margin 0 outranks `.p-prompt`'s).
    expect(html).toMatch(
      /<\/p><h2 id="L-pq" class="max-w-256 text-present-question text-pretty wrap-break-word">Which value of x solves/,
    );
  });

  it('heads it "Question" in the brand’s ink, 14/15 in capitals, and says "18 of 28 answered" beside it', () => {
    expect(html).toContain('<p class="text-present-kicker uppercase text-text-brand">Question</p>');
    expect(html).toMatch(
      /<p aria-live="polite" class="flex items-baseline gap-2\.5 whitespace-nowrap"><span class="font-num text-present-countdown tabular-nums">18<\/span><span class="text-present-line text-text-secondary">of (?:<!-- -->)?28(?:<!-- -->)? answered<\/span><\/p>/,
    );
  });

  it('draws each answer as `.p-opt`: its 48 px letter and its words, 108 px tall at least, 22 × 24 px in', () => {
    expect(rows(html).map((r) => text(r.html))).toEqual([
      'A x = 1',
      'B x = 2',
      'C x = 4',
      'D x = 6',
    ]);
    for (const row of rows(html)) {
      expect(row.classes).toEqual(
        expect.arrayContaining([
          'grid',
          'min-h-27',
          'grid-cols-[48px_minmax(0,1fr)_auto]',
          'gap-x-5',
          'gap-y-3.5',
          'rounded-md',
          'border',
          'border-border-default',
          'px-6',
          'py-5.5',
        ]),
      );
      expect(row.html).toMatch(
        /^<span aria-hidden="true" class="grid size-12 shrink-0 place-items-center rounded-full text-h2 bg-surface-sunken text-text-primary">[A-D]<\/span>/,
      );
    }
    expect(html).toMatch(/<ul class="grid gap-4 lg:grid-cols-2">/);
  });

  it('says where to answer at its foot, and none of the sentences the canvas drops', () => {
    expect(html).toMatch(
      /<p class="text-present-line text-text-secondary">Answer in Bali on your phone\.<\/p><\/section>$/,
    );
    // DESIGN.md §1, The words.
    expect(html).not.toMatch(/The breakdown shows|Updates every few seconds|Every phone/);
  });

  it('puts the count under the question and the answers one to a row under 1024 px (PresentQuestionPhone)', () => {
    expect(html).toMatch(
      /<div class="flex items-start justify-between gap-x-12 gap-y-4 max-lg:flex-col"><div class="min-w-0">/,
    );
  });

  it('draws nothing with no question', () => {
    const none = { ...lesson(), question: null };
    expect(render(none)).toBe('');
  });
});

describe('a question open: "N of M answered" only (decision 11)', () => {
  it('never shows a count per answer while it is open, however many have answered', () => {
    // 18 answered: the server's guard would give the teacher the breakdown; the room never sees it.
    const html = render(lesson());
    expect(counts(html)).toEqual([undefined, undefined, undefined, undefined]);
    expect(bars(html)).toEqual([null, null, null, null]);
    expect(html).not.toContain('style=');
  });

  it('never marks the correct answer while it is open', () => {
    const html = render(lesson());
    expect(html).not.toMatch(/Correct|bg-option-right|bg-letter-right/);
  });

  it('leaves the count’s place empty before Bali’s first read (PresentQuestionStates)', () => {
    const html = render(lesson({}, null));
    expect(text(html)).toContain('Which value of x solves');
    expect(html).not.toMatch(/answered|aria-live/);
    // Closed, after a reload: the same.
    expect(render(lesson({ open: false }, null))).not.toMatch(/answered|aria-live/);
  });

  it('says results that can’t refresh in the class page’s words, Present’s size, under the head', () => {
    const behind = lesson();
    behind.results = {
      results: totals(),
      final: false,
      problem: { kind: 'failed', status: undefined, retryAfter: undefined },
      at: 0,
    };
    expect(render(behind)).toMatch(
      /answered<\/span><\/p><\/div><p role="status" class="rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-present-caption text-text-primary">These totals may be behind\. Bali can&#x27;t reach the server and keeps trying\.<\/p><ul/,
    );
  });
});

describe('a question closed (PresentAnswer, PresentQuestionStates)', () => {
  it('with its answer shown: each count and its bar, the correct one marked on green, its bar green', () => {
    const html = render(closed(true));
    expect(html).toContain(
      '<p class="text-present-kicker uppercase text-text-tertiary">Question · closed</p>',
    );
    expect(text(html)).toContain('21 of 28 answered');
    expect(counts(html)).toEqual(['3', '14', '1', '3']);
    // Out of those who answered, as the class page's bars.
    expect(bars(html)).toEqual([
      ['14', 'grey'],
      ['67', 'green'],
      ['5', 'grey'],
      ['14', 'grey'],
    ]);
    const [, right] = rows(html);
    expect(right?.classes).toEqual(
      expect.arrayContaining([
        'border-2',
        'border-bar-right',
        'bg-option-right',
        'px-5.75',
        'py-5.25',
      ]),
    );
    expect(right?.classes).not.toContain('border-border-default');
    expect(right?.html).toMatch(/class="[^"]*\bbg-letter-right text-text-brand">B<\/span>/);
    expect(right?.html).toMatch(
      /<span class="inline-flex items-center gap-1 text-present-tag text-text-brand uppercase"><svg[^>]*\blucide-circle-check\b[^>]*>[^]*<\/svg>Correct answer<\/span>/,
    );
    expect(right?.html).toMatch(/<svg[^>]*width="14"/);
    expect(text(html)).toMatch(/Bali shows only these totals, never who picked what\.$/);
  });

  it('without it (Close, or the bell): the counts, no answer marked, every bar grey', () => {
    const html = render(closed(false));
    expect(counts(html)).toEqual(['3', '14', '1', '3']);
    expect(bars(html).map((b) => b?.[1])).toEqual(['grey', 'grey', 'grey', 'grey']);
    expect(html).not.toMatch(/Correct|bg-option-right|bg-letter-right|bg-bar-right/);
  });

  it('with no correct answer: the same, nothing marked', () => {
    const html = render(
      lesson(
        { open: false, correctOption: null },
        totals({ answered: 21, open: false, correctOption: null, counts: [3, 14, 1, 3] }),
        true,
      ),
    );
    expect(counts(html)).toEqual(['3', '14', '1', '3']);
    expect(html).not.toMatch(/Correct|bg-option-right/);
  });

  it('shows no count until Bali’s last read after the close is in, so the room never watches one move', () => {
    // The stream's close, or this tab's, before the read after it (L6's `final`).
    const html = render(closed(true, {}, false));
    expect(text(html)).toContain('Question · closed');
    expect(text(html)).toContain('21 of 28 answered');
    expect(counts(html)).toEqual([undefined, undefined, undefined, undefined]);
    expect(html).not.toContain('Too few answers');
    // Its last read in: the counts.
    expect(counts(render(closed(true)))).toEqual(['3', '14', '1', '3']);
  });

  it('closed by the bell, found by a read before the sweep: closed, its counts once its last read is in', () => {
    // Held open (no close heard), its results closed: the bell's (A17).
    const bell = lesson({}, totals({ answered: 21, open: false, counts: [3, 14, 1, 3] }), true);
    const html = render(bell);
    expect(text(html)).toContain('Question · closed');
    expect(counts(html)).toEqual(['3', '14', '1', '3']);
    expect(html).not.toContain('Correct');
  });

  it('under 3 answers: no count per answer, the report’s line under the question, the answer marked if shown', () => {
    const html = render(closed(true, { answered: 2, counts: null }));
    expect(html).toMatch(
      /<\/h2><p class="mt-2 text-present-line text-text-secondary">Too few answers to show a breakdown\.<\/p><\/div>/,
    );
    expect(text(html)).toContain('2 of 28 answered');
    expect(counts(html)).toEqual([undefined, undefined, undefined, undefined]);
    expect(text(html)).toContain('B x = 2 Correct answer');
    expect(render(closed(false, { answered: 2, counts: null }))).not.toContain('Correct');
  });

  it('says the totals may be behind until the last count is in, and not after', () => {
    const behind = closed(true, {}, false);
    behind.results = {
      ...(behind.results as NonNullable<LiveQuestion['results']>),
      problem: { kind: 'failed', status: 503, retryAfter: undefined },
    };
    expect(render(behind)).toContain('These totals may be behind.');
    behind.results = { ...behind.results, final: true, problem: null };
    expect(render(behind)).not.toContain('may be behind');
  });
});

describe('only totals, never anything about one student (ARCHITECTURE, Live lesson, decision 2)', () => {
  it('draws nothing but the counts, whatever else a read carried', () => {
    const smuggled = {
      ...totals({ answered: 21, open: false, revealed: true, counts: [3, 14, 1, 3] }),
      names: ['Ana Rodríguez'],
      answers: [{ student: 'Ben Okafor', option: 1 }],
    };
    const html = render(lesson({ open: false, revealed: true }, smuggled, true));
    expect(html).not.toMatch(/Ana|Ben|Rodríguez|Okafor/);
  });

  it('reads no student, and its counts are the server’s guarded count alone, never a threshold of its own', () => {
    expect(source).not.toMatch(/displayName|studentId|\.students\b|roster|Student\b/);
    // The guard is the server's (`counts` null under 3): no number of answers is tested here.
    expect(source).not.toMatch(/\banswered\s*[<>]=?\s*\d|\d\s*[<>]=?\s*\w+\.answered\b/);
    expect(source).toMatch(/const counts = last \? \(totals\?\.counts \?\? null\) : null;/);
    // Each answer's count only once closed and its last read is in (L6's `final`).
    expect(source).toMatch(/const last = !open && r\?\.final === true;/);
    // The correct answer only once shown, never while open.
    expect(source).toMatch(
      /const shown = !open && \(q\.revealed \|\| totals\?\.revealed === true\);/,
    );
  });
});
