import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import LoginPage from './page';

/*
 * Sign in, for teachers and students (SignIn; PV15), rendered as the server first draws it: v2's
 * stage, the card in W3's words for both (ARCHITECTURE, Live lesson, decision 13), the line for
 * students under it, then the public pages.
 */
const html = renderToStaticMarkup(createElement(LoginPage));

describe('the sign-in page', () => {
  it('opens with the brand on v2’s stage, no bar', () => {
    expect(html).not.toContain('<header');
    expect(html).toMatch(
      /^<main [^>]*><div [^>]*><svg [^>]*>.*?<\/svg><p translate="no" class="text-h2">Bali<\/p><p class="[^"]*">Focus sessions for your classroom<\/p><section /,
    );
  });

  it('says the board’s words for teachers and students, in its card', () => {
    expect(html).toMatch(
      /<section aria-labelledby="sign-in-title" class="[^"]*"><h1 id="sign-in-title" class="text-entry-title">Sign in to Bali<\/h1><p class="[^"]*">Teachers and students sign in here to see their classes\.<\/p><button type="button" class="[^"]*\bh-12\b[^"]*">Sign in<\/button><\/section>/,
    );
    expect(html).not.toContain('Teacher portal');
  });

  it('tells students to set up the app first, under the card, then links the public pages', () => {
    expect(html).toMatch(
      /<\/section><p class="[^"]*">Students: set up Bali in the app on your iPhone first\.<\/p><nav aria-label="Help and policies"/,
    );
    const links = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(links).toEqual([
      ['/support', 'Help and questions'],
      ['/privacy', 'Privacy policy'],
      ['/terms', 'Terms'],
    ]);
  });
});
