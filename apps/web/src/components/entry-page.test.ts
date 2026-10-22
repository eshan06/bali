import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EntryPage, STAGE_FOOT } from './entry-page';
import { TOP_BAR } from './mark';

/*
 * An entry page in v2's look (v2.css's stage: SignIn, Invite, AuthCallback; PV15), rendered: one
 * column 400 px wide at most, its parts 6 px apart, centred in the window. Signed out, the brand
 * opens it (the mark at 40 px, Bali and its line) where a bar was; signed in, the shell's bar with
 * Sign out is above it, 60 px with its hairline, so it fills the window less that bar and no more,
 * or an empty page would scroll. The window is the one that shows (`dvh`): iPhone Safari's `vh` is
 * the window behind its toolbars, so a page that fills it is taller than the screen (PB2's review).
 */
const render = (signedIn: boolean) =>
  renderToStaticMarkup(
    createElement(EntryPage, { signedIn, children: createElement('p', null, 'card') }),
  );
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const classesOf = (html: string, tag: RegExp) =>
  /\bclass="([^"]*)"/.exec(tag.exec(html)?.[0] ?? '')?.[1]?.split(' ') ?? [];

describe('the entry page', () => {
  it('centres one column, 400 px at most, its parts 6 px apart, 48/24/72 in', () => {
    for (const html of [render(false), render(true)]) {
      expect(classesOf(html, /^<(main|div)\b[^>]*>/)).toEqual(
        expect.arrayContaining([
          'flex',
          'flex-col',
          'items-center',
          'justify-center',
          'px-6',
          'pt-12',
          'pb-18',
        ]),
      );
      // The column inside it.
      expect(/^<[^>]+><div class="([^"]*)">/.exec(html)?.[1]?.split(' ')).toEqual(
        expect.arrayContaining(['w-full', 'max-w-100', 'flex-col', 'items-center', 'gap-1.5']),
      );
      expect(html).toMatch(/<p>card<\/p><\/div><\/(main|div)>$/);
    }
  });

  it('is the page’s `<main>` signed out; signed in, it sits in the shell’s, the page’s one (the owner’s follow-up, 2026-10-16)', () => {
    expect(render(false)).toMatch(/^<main\b/);
    expect(render(true)).toMatch(/^<div\b/);
    expect(render(true)).not.toMatch(/<main\b/);
  });

  it('signed out, opens with the brand, no bar: the mark at 40 px, Bali, and its line, 28 px over the card', () => {
    const html = render(false);
    expect(html).not.toContain('<header');
    expect(classesOf(html, /<main\b[^>]*>/)).toContain('min-h-dvh');
    // 6 px apart, as the boards render them: v2.css's `.app p` outranks `.stage-name`'s 10 px.
    expect(html).toMatch(
      /<svg width="40" height="40"[^>]*>.*<\/svg><p translate="no" class="text-h2">Bali<\/p><p class="mb-5\.5 text-data font-normal text-text-secondary">Focus sessions for your classroom<\/p><p>card<\/p>/,
    );
  });

  it('signed in, leaves the bar to the shell and fills the window less its 60 px', () => {
    const html = render(true);
    expect(html).not.toContain('<header');
    expect(html).not.toContain('Focus sessions for your classroom');
    expect(classesOf(html, /^<div\b[^>]*>/)).toContain('min-h-[calc(100dvh-60px)]');
    // The bar above it: v2's, 60 px tall with its hairline inside.
    expect(TOP_BAR.split(' ')).toEqual(
      expect.arrayContaining(['h-15', 'border-b', 'bg-surface-card', 'px-8', 'max-sm:px-4']),
    );
    expect(read('./portal-bar.tsx')).toMatch(/<header className=\{TOP_BAR\}>/);
    // The body under them no taller than the window that shows, or the page scrolls anyway.
    expect(read('../app/layout.tsx')).toMatch(/<body className="min-h-dvh /);
  });

  it('sets a line under the card as the stage’s foot: 13.5/19, centred, in the secondary ink, 6 px under it', () => {
    expect(STAGE_FOOT.split(' ').sort()).toEqual(
      ['w-full', 'text-center', 'text-meta', 'text-text-secondary'].sort(),
    );
  });
});
