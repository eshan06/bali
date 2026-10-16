import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SessionReportQuestion } from '@bali/shared';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { SessionQuestions } from '../lib/reports';
import { ReportQuestions } from './report-questions';

/*
 * A session's Questions card on its report page (L7c), as ReportOpened draws it, LessonStates' lines
 * for it, and the intermediate states drawn first on the canvas (ReportQuestionsStates): rendered in
 * each, the questions in the order the server gives them, each with when it was asked, whether its
 * answer was shown, its words and its totals; the guard the server's alone; only totals.
 */
const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/** 9:05 to 9:55 on ReportOpened's day, Mon, Oct 12. */
const AT = (minute: number) => new Date(Date.UTC(2026, 9, 12, 14) + minute * 60_000).toISOString();

/** ReportOpened's two: one shown with its breakdown, one under the guard, its answer not shown. */
const SHOWN: SessionReportQuestion = {
  id: '0199e3a1-0000-7000-8000-000000000001',
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  correctOption: 1,
  revealed: true,
  open: false,
  openedAt: AT(18),
  answered: 21,
  eligible: 28,
  counts: [3, 14, 1, 3],
};
const GUARDED: SessionReportQuestion = {
  id: '0199e3a1-0000-7000-8000-000000000002',
  prompt: 'Which pair of numbers multiplies to 12 and adds to −7?',
  options: ['3 and 4', '−3 and −4', '−2 and −6', '2 and 6'],
  correctOption: 1,
  revealed: false,
  open: false,
  openedAt: AT(41),
  answered: 2,
  eligible: 28,
  counts: null,
};
/** ReportQuestionsStates' question with no correct answer. */
const NO_ANSWER: SessionReportQuestion = {
  id: '0199e3a1-0000-7000-8000-000000000003',
  prompt: 'How sure are you about factoring now?',
  options: ['Very sure', 'Fairly sure', 'Not sure yet'],
  correctOption: null,
  revealed: false,
  open: false,
  openedAt: AT(48),
  answered: 21,
  eligible: 28,
  counts: [6, 11, 4],
};
const ready = (...questions: SessionReportQuestion[]): SessionQuestions => ({
  kind: 'ready',
  questions,
});

/** Every space read as one, as Intl's narrow no-break space before AM and PM. */
const plain = (s: string) => s.replace(/\s/g, ' ').replace(/&#x27;/g, "'");
const render = (questions: SessionQuestions, onRetry = () => undefined) =>
  plain(renderToStaticMarkup(createElement(ReportQuestions, { questions, onRetry })));
/** The text of the card, its tags dropped. */
const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
const clock = (minute: number) =>
  plain(
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(AT(minute)),
    ),
  );
/** Each question's part of the card, in the order drawn. */
const asked = (html: string) => html.split(/(?=<div class="flex flex-wrap items-start)/).slice(1);
/** Each option's row as read: its letter, words, tag and count. */
const rows = (html: string) =>
  [...html.matchAll(/<li class="grid[^"]*">([^]*?)<\/li>/g)].map((m) => text(m[1] ?? ''));
/** Each bar: its width and whether it is the correct answer's green. */
const bars = (html: string) =>
  [...html.matchAll(/<span aria-hidden="true" class="([^"]*)" style="width:(\d+)%"/g)].map((m) => [
    m[2],
    m[1]?.includes('bg-bar-right'),
  ]);

/** The card's element tree as it renders, to press its buttons. */
function tree(questions: SessionQuestions, onRetry: () => void): ReactNode {
  let drawn: ReactNode = null;
  function Probe() {
    drawn = ReportQuestions({ questions, onRetry });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return drawn;
}
/** A button of the tree's, by its words. */
function button(node: ReactNode, words: string): (() => void) | undefined {
  const said = (n: ReactNode): string =>
    Array.isArray(n)
      ? n.map(said).join('')
      : typeof n === 'string'
        ? n
        : n && typeof n === 'object' && 'props' in n
          ? said((n as ReactElement<{ children?: ReactNode }>).props.children)
          : '';
  if (Array.isArray(node)) {
    return (node as readonly ReactNode[]).map((n) => button(n, words)).find(Boolean);
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return undefined;
  const p = (node as ReactElement<{ onClick?: () => void; children?: ReactNode }>).props;
  if (p.onClick && said(p.children).trim() === words) return p.onClick;
  return button(p.children, words);
}

describe('the card (ReportOpened)', () => {
  const html = render(ready(SHOWN, GUARDED));

  it('is v2’s card on its own, titled Questions, how many it asked under its title', () => {
    expect(html).toMatch(
      /^<section aria-labelledby="([^"]+)" aria-busy="false" class="flex flex-col gap-5\.5 [^"]*"><div class="flex flex-col gap-0\.75"><h2 id="\1" class="text-section-label text-text-tertiary uppercase">Questions<\/h2><p class="text-body text-text-secondary">2 asked in this session<\/p><\/div>/,
    );
    const card = /^<section [^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ');
    expect(card).toEqual(expect.arrayContaining(['rounded-md', 'p-5', 'shadow-1', 'border']));
    expect(text(render(ready(NO_ANSWER)))).toMatch(/^\|Questions\|1 asked in this session\|/);
  });

  it('shows each question in the order asked: when, whether its answer was shown, its words', () => {
    const [first = '', second = ''] = asked(html);
    expect(asked(html)).toHaveLength(2);
    expect(first).toMatch(
      new RegExp(
        `^<div class="flex flex-wrap items-start gap-x-10 gap-y-5"><div class="min-w-0 flex-\\[999_1_440px\\]"><p class="text-caption text-text-tertiary">${clock(18)} · Answer shown</p><h3 class="mt-1 text-h3 text-pretty wrap-break-word">Which value of x solves x² − 5x \\+ 6 = 0\\?</h3><ul `,
      ),
    );
    expect(second).toContain(
      `<p class="text-caption text-text-tertiary">${clock(41)} · Answer not shown</p><h3 class="mt-1 text-h3 text-pretty wrap-break-word">Which pair of numbers multiplies to 12 and adds to −7?</h3>`,
    );
    // The server's order, whatever the times: never sorted here.
    expect(asked(render(ready(GUARDED, SHOWN)))[0]).toContain('Which pair of numbers');
  });

  it('puts each after the first under a hairline, 20 px below it', () => {
    const [first = '', second = ''] = asked(html);
    expect(first).not.toMatch(/^<div class="[^"]*\bborder-t\b/);
    expect(second).toMatch(
      /^<div class="flex flex-wrap items-start gap-x-10 gap-y-5 border-t border-border-default pt-5">/,
    );
  });

  it('gives each option its count and bar out of those who answered, the correct one marked green', () => {
    const [first = ''] = asked(html);
    expect(rows(first)).toEqual([
      '|A|x = 1|3|',
      '|B|x = 2|Correct answer|14|',
      '|C|x = 4|1|',
      '|D|x = 6|3|',
    ]);
    expect(bars(first)).toEqual([
      ['14', false],
      ['67', true],
      ['5', false],
      ['14', false],
    ]);
    expect(text(first)).toMatch(/\|21\|of 28 answered\|$/);
    // Beside the options as on the class page's card, a hairline at its left.
    expect(first).toContain(
      '<div class="flex flex-[1_1_160px] flex-col gap-1 border-l border-border-default pl-6"><p class="flex items-baseline gap-2"><span class="font-num text-data-lg tabular-nums">21</span><span class="text-text-secondary">of 28 answered</span></p></div>',
    );
  });

  it('under the guard says so, with no count or bar per option, its correct one tagged Correct', () => {
    const [first = '', second = ''] = asked(html);
    expect(second).toContain(
      '</h3><p class="text-body text-text-secondary">Too few answers to show a breakdown.</p><ul ',
    );
    expect(rows(second)).toEqual([
      '|A|3 and 4|',
      '|B|−3 and −4|Correct|',
      '|C|−2 and −6|',
      '|D|2 and 6|',
    ]);
    expect(second).not.toContain('style=');
    expect(text(second)).toMatch(/\|2\|of 28 answered\|$/);
    // The line only where the server gave no breakdown.
    expect(first).not.toContain('Too few answers');
  });

  it('a question with no correct answer: its time alone, nothing marked, every bar grey (ReportQuestionsStates)', () => {
    const [only = ''] = asked(render(ready(NO_ANSWER)));
    expect(only).toContain(`<p class="text-caption text-text-tertiary">${clock(48)}</p>`);
    expect(only).not.toMatch(/Answer shown|Answer not shown|Correct/);
    expect(rows(only)).toEqual(['|A|Very sure|6|', '|B|Fairly sure|11|', '|C|Not sure yet|4|']);
    expect(bars(only)).toEqual([
      ['29', false],
      ['52', false],
      ['19', false],
    ]);
  });
});

describe('the guard is the server’s alone (ARCHITECTURE, Live lesson, decision 3; "Settled")', () => {
  it('draws what the server counted, and nothing where it counted nothing, whatever N says', () => {
    // Neither can come from the server; each shows the card keys on `counts`, never on N.
    const counted = asked(render(ready({ ...SHOWN, answered: 2, counts: [0, 2, 0, 0] })))[0] ?? '';
    expect(rows(counted)).toEqual([
      '|A|x = 1|0|',
      '|B|x = 2|Correct answer|2|',
      '|C|x = 4|0|',
      '|D|x = 6|0|',
    ]);
    expect(counted).not.toContain('Too few answers');
    const withheld = asked(render(ready({ ...SHOWN, answered: 21, counts: null })))[0] ?? '';
    expect(withheld).toContain('Too few answers to show a breakdown.');
    expect(bars(withheld)).toEqual([]);
  });

  it('works out no threshold of its own, in either file that draws a question’s totals', () => {
    // No comparison of N, and none against the guard's 3 (or 2), anywhere in either file's code.
    for (const file of ['./report-questions.tsx', './question-card.tsx']) {
      expect(source(file)).not.toMatch(/\banswered\s*[<>]=?\s*\w|[<>]=?\s*[23]\b(?!\.)/);
    }
    expect(source('./report-questions.tsx')).toMatch(/question\.counts === null \?/);
  });
});

describe('its own read’s states (ReportQuestionsStates; LessonStates)', () => {
  it('loading: under its title, Loading…', () => {
    const html = render({ kind: 'loading' });
    expect(text(html)).toBe('|Questions|Loading…|');
    expect(html).toMatch(/^<section [^>]*aria-busy="true"/);
    expect(html).toContain('<p role="status" class="text-body text-text-secondary">Loading…</p>');
  });

  it('didn’t load: LessonStates’ line under its title, Try again reading them again', () => {
    const html = render({ kind: 'error' });
    expect(text(html)).toBe("|Questions|Bali couldn't load this session's questions.|Try again|");
    expect(html).toMatch(
      /<\/h2><\/div><div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Bali couldn't load this session's questions\.<\/p><button type="button" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/div><\/section>$/,
    );
    const onRetry = vi.fn();
    button(tree({ kind: 'error' }, onRetry), 'Try again')?.();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('none asked: no card at all', () => {
    expect(render(ready())).toBe('');
  });
});

describe('only totals, never who answered (ARCHITECTURE, Live lesson, decision 2)', () => {
  it('draws nothing but the counts, whatever else a read carried', () => {
    const smuggled = {
      ...SHOWN,
      names: ['Ana Rodríguez'],
      answers: [{ student: 'Ben Okafor', option: 1, answeredAt: AT(19) }],
    };
    expect(render(ready(smuggled))).not.toMatch(/Ana|Ben|Rodríguez|Okafor/);
  });

  it('names no student, and draws its options, bars and counts through the class page’s card’s one copy', () => {
    const card = source('./report-questions.tsx');
    expect(card).not.toMatch(/displayName|studentId|Student\b|responses/);
    expect(card).toMatch(/import type \{ SessionReportQuestion \} from '@bali\/shared';/);
    expect(card).toMatch(/<Options\s/);
    expect(card).toMatch(/answeredLine\(question\.answered, question\.eligible\)/);
    // The bars, the tags and "of M answered" are written once, in question-card.tsx.
    expect(card).not.toMatch(/bg-bar|Correct answer|of \{/);
    expect(source('./question-card.tsx')).toMatch(
      /<Options\s+question=\{q\}\s+counts=\{counts\}\s+answered=\{totals\?\.answered \?\? 0\}\s+shown=\{!open && revealed\}\s+\/>/,
    );
  });
});
