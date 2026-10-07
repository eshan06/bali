import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/*
 * The class page before its class is read (the Class page design's Loading and Error boards; the
 * owner's ruling): the session's place holds a placeholder, never the Start form, which used to
 * flash while the class loaded, even mid-lesson. Rendered as the server first draws it, before any
 * read; the error, which needs a read to fail, is read from the source.
 */
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
const { default: ClassDetailPage } = await import('./classes/[id]/page');
const page = readFileSync(
  fileURLToPath(new URL('./classes/[id]/page.tsx', import.meta.url)),
  'utf8',
);

describe('the class page before its class is read', () => {
  it('holds the session’s place with Loading…, never the Start form: a session may be live', () => {
    const html = renderToStaticMarkup(createElement(ClassDetailPage));
    expect(html).toMatch(
      /<section aria-label="Session" class="[^"]*"><p role="status" class="[^"]*">Loading…<\/p><\/section>/,
    );
    expect(html).not.toMatch(/Session length|Start session|minute session/);
    // The name's place, in the captions' ink, and the roster still on its way.
    expect(html).toMatch(/<h1 class="[^"]*\btext-text-tertiary\b[^"]*">…<\/h1>/);
    expect(html).toMatch(/Roster<\/h2><p role="status"[^>]*>Loading…<\/p>/);
  });

  it('says a class that didn’t load in that place, with Try again, and shows no roster', () => {
    const start = page.indexOf('{klass === null ? (');
    const unread = page.slice(start, page.indexOf(') : grid === null || grid.over ? (', start));
    expect(unread).toMatch(
      /error \? \([^]*role="alert"[^]*Couldn&apos;t load this class\.[^]*onClick=\{load\}[^]*Try again[^]*\) : \(/,
    );
    expect(unread).not.toMatch(/<form|startSession/);
    expect(page).toMatch(
      /\{klass === null && error \? null : \(\s*<section\s+aria-labelledby=\{`\$\{id\}-roster`\}/,
    );
  });

  it('keeps a roster that didn’t load out of the class’s card: said under the header', () => {
    // Only the class's own read sets `error`, so a roster failing first never says the class
    // failed while it is still on its way (santa's review).
    expect(page.match(/setError\(errText\(e\)\)/g)).toHaveLength(1);
    expect(page).toMatch(/\/roster`\)\s*\.then\(setRoster, \(e: unknown\) => setRosterError\(/);
    expect(page).toMatch(/\{klass && \(error \?\? rosterError\) \? \(/);
  });
});
