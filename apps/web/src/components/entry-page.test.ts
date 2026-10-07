import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EntryPage } from './entry-page';

/*
 * An entry page (the approved Entry & info design), rendered: one card's column, 440 px at most,
 * centred in the window under a bar. Signed out, the lockup's bar opens it; signed in, the
 * layout's Sign out bar is above it, so it fills the window less that bar and no more, or an
 * empty page would scroll. The window is the one that shows (`dvh`): iPhone Safari's `vh` is the
 * window behind its toolbars, so a page that fills it is taller than the screen (PB2's review).
 */
const render = (signedIn: boolean) =>
  renderToStaticMarkup(
    createElement(EntryPage, { signedIn, children: createElement('p', null, 'card') }),
  );
const COLUMN = '<div class="w-full max-w-110"><p>card</p></div></main>';

describe('the entry page', () => {
  it('signed out, opens with the lockup’s bar and fills the window under it', () => {
    const html = render(false);
    expect(html).toMatch(
      /^<div class="flex min-h-dvh flex-col"><header[^>]*>.*Bali<\/p><\/header><main class="[^"]*\bflex-1\b/,
    );
    expect(html).toContain(COLUMN);
  });

  it('signed in, leaves the bar to the layout and fills the window less its 56 px and hairline', () => {
    const html = render(true);
    expect(html).not.toContain('<header');
    expect(html).toMatch(/^<main class="[^"]*\bmin-h-\[calc\(100dvh-57px\)\]/);
    expect(html).toContain(COLUMN);
    const read = (path: string) =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
    expect(read('./portal-bar.tsx')).toMatch(
      /<header className="border-b border-border-default">\s*<div className="flex h-14 /,
    );
    // The body under them no taller than the window that shows, or the page scrolls anyway.
    expect(read('../app/layout.tsx')).toMatch(/<body className="min-h-dvh /);
  });
});
