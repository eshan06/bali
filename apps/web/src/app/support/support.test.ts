import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TEACHER_NEVER_SEES, TEACHER_SEES } from '@/components/teacher-sees';

/*
 * The help page (P4) and the student app must say the same thing about what a teacher sees: the
 * lists the help page and the privacy policy show (`teacher-sees.ts`) are the app's `ConsentCard`
 * lists, word for word.
 */
const page = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
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
    expect(page.replace(/\s+/g, ' ')).toContain(promise);
  });

  it('the support address is a mailto link', () => {
    expect(page).toContain("const SUPPORT_EMAIL = 'eshan.shah@vanderbilt.edu';");
    expect(page).toContain('href={`mailto:${SUPPORT_EMAIL}`}');
  });

  it('no new em dash in its words', () => {
    expect(page.split('*/').slice(1).join('')).not.toMatch(/[—–]/);
  });
});
