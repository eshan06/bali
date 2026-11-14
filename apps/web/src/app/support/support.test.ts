import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  TEACHER_NEVER_SEES,
  TEACHER_SEES,
  TEACHER_SEES_BOTH_APPS,
} from '@/components/teacher-sees';

import SupportPage, { metadata } from './page';

/*
 * The help page (P4) and the student apps must say the same thing about what a teacher sees: the
 * lists the help page and the privacy policy show (`teacher-sees.ts`) are the iPhone app's
 * `ConsentCard` lists, word for word, but the help page's focus status, which names Android's lock
 * beside Screen Time as Android's own list words it (`ConsentList`, AP2b); and a tap before class
 * promises what the Waiting screen does. The page is rendered as the server first draws it; only
 * the apps' own Swift and Kotlin sources are read as text.
 */
const html = renderToStaticMarkup(createElement(SupportPage));
/** The page's words as a reader gets them: its tags taken out, each run of spaces made one. */
const words = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const swift = readFileSync(
  fileURLToPath(new URL('../../../../../ios/Bali/UI/JoinView.swift', import.meta.url)),
  'utf8',
);
const kotlin = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../../android/outbox/src/main/kotlin/com/bali/outbox/Consent.kt',
      import.meta.url,
    ),
  ),
  'utf8',
);

function swiftList(name: string): string[] {
  const body = new RegExp(`static let ${name} = \\[([\\s\\S]*?)\\]`).exec(swift)?.[1];
  if (!body) throw new Error(`ConsentCard.${name} not found in JoinView.swift`);
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
}

/** What a teacher sees, as Android's consent list writes it (`ConsentList.WHOLE`'s `sees`). */
function kotlinSees(): string[] {
  const body = /val WHOLE =[\s\S]*?\bsees =\s*listOf\(([\s\S]*?)\)/.exec(kotlin)?.[1];
  if (!body) throw new Error('ConsentList.WHOLE.sees not found in Consent.kt');
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
}

describe('the help page says what the apps say', () => {
  it('what a teacher sees, word for word', () => {
    expect(TEACHER_SEES).toEqual(swiftList('sees'));
    expect(TEACHER_SEES).toHaveLength(8);
  });

  it('what a teacher never sees, word for word', () => {
    expect(TEACHER_NEVER_SEES).toEqual(swiftList('neverSees'));
  });

  it('its focus status names Android’s lock beside Screen Time, each in its own app’s words (AP2b)', () => {
    const [iphone, ...rest] = swiftList('sees');
    const [android] = kotlinSees();
    expect(iphone).toBe('Your focus status: focused, unlocked, or Screen Time off');
    expect(android).toBe("Your focus status: focused, unlocked, or Bali's lock off");
    expect(TEACHER_SEES_BOTH_APPS).toEqual([`${iphone} (or Bali's lock off)`, ...rest]);
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
    expect(html).toMatch(/<a href="mailto:team@getbali\.app"[^>]*>team@getbali\.app<\/a>/);
  });

  it('no new em dash in its words', () => {
    expect(words).not.toMatch(/[—–]/);
    expect(JSON.stringify(metadata)).not.toMatch(/[—–]/);
  });
});
