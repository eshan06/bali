import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TEACHER_NEVER_SEES, TEACHER_SEES } from '@/components/teacher-sees';

import SupportPage, { metadata } from './page';

/*
 * The help page (P4) and the student app must say the same thing about what a teacher sees: the
 * lists the help page and the privacy policy show (`teacher-sees.ts`) are the app's `ConsentCard`
 * lists, word for word; and a tap before class promises what the Waiting screen does. The page is
 * rendered as the server first draws it; only the app's own Swift sources are read as text.
 */
const html = renderToStaticMarkup(createElement(SupportPage));
/** The page's words as a reader gets them: its tags taken out, each run of spaces made one. */
const words = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const swift = readFileSync(
  fileURLToPath(new URL('../../../../../ios/Bali/UI/JoinView.swift', import.meta.url)),
  'utf8',
);

function swiftList(name: string): string[] {
  const body = new RegExp(`static let ${name} = \\[([\\s\\S]*?)\\]`).exec(swift)?.[1];
  if (!body) throw new Error(`ConsentCard.${name} not found in JoinView.swift`);
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
}

describe('the help page says what the app says', () => {
  it('what a teacher sees, word for word', () => {
    expect(TEACHER_SEES).toEqual(swiftList('sees'));
    expect(TEACHER_SEES).toHaveLength(6);
  });

  it('what a teacher never sees, word for word', () => {
    expect(TEACHER_NEVER_SEES).toEqual(swiftList('neverSees'));
  });

  it('a tap before class keeps the Waiting screen’s condition', () => {
    const waiting = readFileSync(
      fileURLToPath(new URL('../../../../../ios/Bali/UI/WaitingView.swift', import.meta.url)),
      'utf8',
    );
    const promise = 'Your phone locks when class starts, as long as Bali is open.';
    expect(waiting).toContain(promise);
    expect(words).toContain(promise);
  });

  it('the support address is a mailto link', () => {
    expect(html).toMatch(
      /<a href="mailto:eshan\.shah@vanderbilt\.edu"[^>]*>eshan\.shah@vanderbilt\.edu<\/a>/,
    );
  });

  it('no new em dash in its words', () => {
    expect(words).not.toMatch(/[—–]/);
    expect(JSON.stringify(metadata)).not.toMatch(/[—–]/);
  });
});
