import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TOO_MANY_TRIES } from '../lib/errors';
import { askSaid, AskPanel, type Draft, NEW_DRAFT, refusals } from './ask-panel';

/*
 * Asking a question in the side panel (L7; LessonWrite, LessonStates' lines): rendered fresh, with
 * six answers and with one marked correct; what Bali refuses before it asks, and how a failed ask
 * is said, from the panel's own functions; what needs a press is read from the source.
 */
const source = readFileSync(fileURLToPath(new URL('./ask-panel.tsx', import.meta.url)), 'utf8');
const page = readFileSync(
  fileURLToPath(new URL('../app/classes/[id]/page.tsx', import.meta.url)),
  'utf8',
);

const render = (draft: Draft, openNow = false) =>
  renderToStaticMarkup(
    createElement(AskPanel, {
      id: 'P',
      draft,
      onDraft: vi.fn(),
      openNow,
      onAsk: vi.fn(),
      onAsked: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    }),
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

describe('the panel, fresh (LessonWrite)', () => {
  const html = render(NEW_DRAFT);

  it('is v2’s side panel, 460 px from the right, titled with what phones do', () => {
    expect(html).toMatch(/^<aside id="P" aria-labelledby="P-h" class="([^"]*)">/);
    const look = /^<aside [^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ');
    expect(look).toEqual(
      expect.arrayContaining(['fixed', 'right-0', 'w-115', 'max-w-full', 'shadow-3', 'z-5']),
    );
    expect(text(html)).toMatch(
      /^Ask a question Phones in this class show it within a few seconds\. Question 0 \/ 500 Answers/,
    );
    expect(html).toMatch(/<button type="button" aria-label="Close"/);
  });

  it('starts with no words and the two answers a question needs, neither removable', () => {
    expect(html).toMatch(/<textarea id="P-prompt" rows="3" maxLength="500"[^>]*><\/textarea>/);
    expect(html.match(/aria-label="Answer [A-F]"/g)).toEqual([
      'aria-label="Answer A"',
      'aria-label="Answer B"',
    ]);
    expect(html).not.toContain('Remove answer');
    // Every answer is the Field's own input, typed at 16 px (the owner's ruling).
    expect(html.match(/<input [^>]*class="[^"]*\btext-input\b[^"]*"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="false"[^>]*>Mark correct</g)).toHaveLength(2);
  });

  it('ends with Ask the class and Cancel, what the guard means, and nothing failed yet', () => {
    expect(text(html)).toMatch(
      /Add an answer Marking a correct answer is optional\. When you close the question, you choose whether students see it\. Ask the class Cancel You'll see how many picked each answer once 3 have answered\.$/,
    );
    expect(html).toMatch(/<button type="submit" aria-disabled="false" aria-busy="false"/);
    expect(html).not.toMatch(/role="alert"|aria-invalid|closes the open question/);
  });

  it('says asking closes the question open now, when one is', () => {
    expect(text(render(NEW_DRAFT, true))).toMatch(/Asking this closes the open question\.$/);
  });
});

describe('the panel as it is written', () => {
  it('six answers, each removable, and no more to add', () => {
    const html = render({
      prompt: 'Pick one',
      options: ['1', '2', '3', '4', '5', '6'],
      correct: null,
    });
    expect(html.match(/aria-label="Remove answer [A-F]"/g)).toHaveLength(6);
    expect(html).not.toContain('Add an answer');
    expect(text(html)).toContain('8 / 500');
  });

  it('the correct one pressed, its letter green and its button saying Correct with a check', () => {
    const html = render({ prompt: 'Q', options: ['x = 1', 'x = 2', 'x = 4'], correct: 1 });
    expect(html).toMatch(
      /aria-pressed="true"[^>]*><svg[^>]*\blucide-check\b[^>]*>[^]*?<\/svg>Correct</,
    );
    expect(html.match(/bg-letter-right/g)).toHaveLength(1);
  });

  it('removing an answer moves the correct mark with its answer, or drops it with it', () => {
    expect(source).toMatch(
      /correct:\s*draft\.correct === null \|\| draft\.correct < i\s*\? draft\.correct\s*: draft\.correct === i\s*\? null\s*: draft\.correct - 1,/,
    );
  });
});

describe('what Bali refuses before it asks (LessonStates)', () => {
  it('a question with no words, an empty answer, an answer over 200 characters', () => {
    const long = 'x'.repeat(214);
    expect(refusals({ prompt: '  ', options: ['A', ' ', long], correct: null })).toEqual({
      prompt: 'Write the question first.',
      options: [
        null,
        'Fill in this answer or remove it.',
        'Keep each answer to 200 characters. This one has 214.',
      ],
    });
  });

  it('counts characters as the server does: trimmed, by code point', () => {
    const emoji = '🙂'.repeat(200);
    expect(refusals({ prompt: 'Q', options: [` ${emoji} `, 'B'], correct: null }).options).toEqual([
      null,
      null,
    ]);
    expect(refusals({ prompt: 'Q', options: [`${emoji}!`, 'B'], correct: null }).options[0]).toBe(
      'Keep each answer to 200 characters. This one has 201.',
    );
  });

  it('says each under its field, marks it, and focuses the first; nothing is sent', () => {
    expect(source).toMatch(
      /if \(first !== -1\) \{\s*setTried\(true\);\s*document\.getElementById\([^)]*\)\?\.focus\(\);\s*return;\s*\}/,
    );
    expect(source).toMatch(/aria-invalid=\{refusal \? true : undefined\}/);
    expect(source).toMatch(/className="col-\[2\/-1\] text-body"/);
  });
});

describe('a failed ask (LessonStates)', () => {
  it('no answer to go by: said with Try again, which resends it under its id', () => {
    expect(askSaid({ kind: 'failed', status: undefined, retryAfter: undefined })).toEqual({
      words: "Bali couldn't ask the question. Check your connection and try again.",
      retry: true,
    });
    expect(askSaid({ kind: 'failed', status: 503, retryAfter: undefined }).retry).toBe(true);
    expect(askSaid({ kind: 'refused', status: 409, reason: 'event_id_conflict' }).retry).toBe(true);
    // Try again submits the form again: the same words are the same attempt (L6).
    expect(source).toMatch(
      /\{failed\.retry \? \(\s*<Button variant="secondary" size="sm" type="submit" aria-disabled=\{busy\}>\s*Try again/,
    );
  });

  it('the session ended first: said, with no Try again', () => {
    expect(askSaid({ kind: 'refused', status: 409, reason: 'session_not_running' })).toEqual({
      words: "This session has ended, so Bali didn't ask the question.",
      retry: false,
    });
  });

  it('over the budget: the portal’s words for a 429', () => {
    expect(askSaid({ kind: 'failed', status: 429, retryAfter: 1 }).words).toBe(TOO_MANY_TRIES);
  });

  it('is said right above Ask the class, as an alert; asked, the panel goes', () => {
    expect(source).toMatch(
      /\{failed \? \([^]*?<p role="alert" className="text-body">\s*\{failed\.words\}[^]*?\) : null\}\s*<div className="[^"]*border-t[^"]*">\s*<Button type="submit"/,
    );
    expect(source).toMatch(
      /if \(answer\.kind === 'opened'\) onAsked\(\);\s*else setSaid\(answer\);/,
    );
  });
});

describe('on the class page', () => {
  it('asks through the live question, a new one sent trimmed; asked, focus goes to it', () => {
    expect(page).toMatch(/onAsk=\{ask\}/);
    expect(source).toMatch(
      /prompt: draft\.prompt\.trim\(\),\s*options: draft\.options\.map\(\(option\) => option\.trim\(\)\),\s*correctOption: draft\.correct,/,
    );
    expect(page).toMatch(
      /onAsked=\{\(\) => \{\s*setAsking\(false\);\s*setDraft\(NEW_DRAFT\);\s*window\.requestAnimationFrame\(\(\) => document\.getElementById\(`\$\{id\}-q`\)\?\.focus\(\)\);/,
    );
  });

  it('Cancel drops what was written; Close and Escape keep it, focus back on Ask', () => {
    expect(page).toMatch(/onCancel=\{\(\) => \{\s*setDraft\(NEW_DRAFT\);\s*closePanel\(\);/);
    expect(page).toMatch(/onClose=\{closePanel\}/);
    expect(page).toMatch(
      /const closePanel = \(\) => \{\s*setAsking\(false\);\s*document\.getElementById\(`\$\{id\}-ask`\)\?\.focus\(\);/,
    );
    expect(source).toMatch(/if \(e\.key === 'Escape'\) onClose\(\);/);
  });

  it('shares the student panel’s place: one opening closes the other', () => {
    expect(page).toMatch(/asking=\{panel\}\s*onStudentPanel=\{\(\) => setAsking\(false\)\}/);
    const grid = readFileSync(fileURLToPath(new URL('./live-grid.tsx', import.meta.url)), 'utf8');
    expect(grid).toMatch(
      /useEffect\(\(\) => \{\s*if \(asking\) setPanel\(null\);\s*\}, \[asking\]\);/,
    );
    expect(grid).toMatch(/const open = \(studentId: string\) => \{\s*onStudentPanel\?\.\(\);/);
  });

  it('a new session starts with no panel and nothing written', () => {
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*setAsking\(false\);\s*setDraft\(NEW_DRAFT\);\s*\}, \[grid\?\.id\]\);/,
    );
  });
});
