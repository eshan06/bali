import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/*
 * The join code (PV6): before a session on its own card (ClassBefore, CopyStates), the code on its
 * chip, its line, Copy and New code, New code's confirm a dialog (ClassNewCode), rendered closed at
 * rest. While a session runs the header shows the code (PV7, PV9), with no New code. What needs a
 * press (Copy's answer, the dialog's states) is read from the source.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined }) }));
const { JoinCode } = await import('./join-code');
const source = readFileSync(fileURLToPath(new URL('./join-code.tsx', import.meta.url)), 'utf8');

const render = () =>
  renderToStaticMarkup(
    createElement(JoinCode, { classId: 'c1', code: 'VMAF7E', onClass: () => undefined }),
  );
/** A constant's class list, by its name. */
const classes = (name: string) =>
  (new RegExp(`const ${name} =\\s*'([^']*)'`).exec(source)?.[1] ?? '').split(' ');

describe('the join code’s card, before a session (ClassBefore)', () => {
  const html = render();

  it('draws the code at 40/48 on its grey chip, selectable whole, then what students do with it', () => {
    expect(html).toMatch(
      /^<span translate="no" class="[^"]*">VMAF7E<\/span><p role="status" class="mt-3 text-body empty:mt-0"><\/p><p class="text-caption text-text-tertiary">Students type it in the Bali app to join this class\.<\/p>/,
    );
    expect(/^<span translate="no" class="([^"]*)">/.exec(html)?.[1]?.split(' ')).toEqual(
      expect.arrayContaining([
        'bg-surface-sunken',
        'border-border-default',
        'rounded-md',
        'font-mono',
        'text-code-card',
        'pl-[calc(26px+0.16em)]',
        'select-all',
      ]),
    );
  });

  it('has Copy and New code as small buttons, New code opening a dialog', () => {
    expect(html).toMatch(
      /<button type="button" class="[^"]*\bh-8\.5\b[^"]*"><svg[^>]*\blucide-copy\b[^>]*>[^]*?<\/svg>Copy<\/button>/,
    );
    expect(html).toMatch(
      /<button type="button" aria-haspopup="dialog" class="[^"]*\bh-8\.5\b[^"]*">New code<\/button>/,
    );
    // Copied is said to a screen reader too, from a region mounted while empty; no failure yet.
    expect(html).toContain('<span role="status" class="sr-only"></span>');
    expect(html).not.toContain('role="alert"');
  });

  it('says Copied for a few seconds, or, where the browser refuses, how to copy it by hand', () => {
    expect(source).toMatch(/const COPIED_FOR = 2000;/);
    expect(source).toMatch(
      /if \(await copyText\(code\)\) \{\s*setCopy\('copied'\);\s*copied\.current = window\.setTimeout\(\(\) => setCopy\(null\), COPIED_FOR\);\s*\} else setCopy\('failed'\);/,
    );
    expect(source).toMatch(
      /\{copy === 'copied' \? 'Copied' : 'Copy'\}[^]*\{copy === 'failed' \? \(\s*<p role="alert" className="mt-3 text-body">\s*\{CANT_COPY\}/,
    );
    // A new code makes the old one's Copied or failure moot.
    expect(source).toMatch(/window\.clearTimeout\(copied\.current\);\s*setCopy\(null\);/);
  });
});

describe('New code’s confirm, a dialog (ClassNewCode)', () => {
  const html = render();
  const dialog = /<dialog[^]*<\/dialog>/.exec(html)?.[0] ?? '';

  it('is rendered closed, titled and described, Cancel before Make new code', () => {
    expect(dialog).toMatch(
      /^<dialog aria-labelledby="([^"]+)-ask" aria-describedby="\1-line" class="[^"]*">/,
    );
    // No `open` attribute: only showModal opens it, so the page behind it is inert.
    expect(dialog).not.toMatch(/^<dialog[^>]*\sopen[\s=>]/);
    expect(dialog).toMatch(/<h2 id="[^"]+" class="text-dialog-title">Make a new code\?<\/h2>/);
    expect(dialog).toMatch(
      /<span translate="no" class="font-mono font-medium">VMAF7E<\/span> stops working right away\.<\/p>/,
    );
    expect(dialog).toMatch(
      />Cancel<\/button><button[^>]*>Make new code<\/button><\/div><\/dialog>$/,
    );
  });

  it('is v2’s dialog: 460 px, 120 px down, its warm backdrop, shown only while open', () => {
    expect(classes('DIALOG')).toEqual(
      expect.arrayContaining([
        'mt-30',
        'w-115',
        'max-w-[calc(100%-48px)]',
        'rounded-md',
        'p-6',
        'gap-4.5',
        'shadow-3',
        'backdrop:bg-scrim',
        'open:flex',
      ]),
    );
    expect(classes('DIALOG')).not.toContain('flex');
  });

  it('opens modal with Cancel focused, holds Escape while a code is made, says a failure in itself', () => {
    expect(source).toMatch(
      /dialog\.current\?\.showModal\(\);\s*\/\/[^\n]*\n\s*cancel\.current\?\.focus\(\);/,
    );
    expect(source).toMatch(
      /onCancel=\{\(e\) => \{[^}]*if \(sending\.current\) e\.preventDefault\(\);/,
    );
    expect(source).toMatch(
      /if \(answer\.kind === 'failed'\) \{\s*setSaid\(answer\);[^}]*if \(dialog\.current && !dialog\.current\.open\) dialog\.current\.showModal\(\);/,
    );
    expect(source).toMatch(
      /\{busy \? 'Making…' : said\?\.kind === 'failed' \? 'Try again' : 'Make new code'\}/,
    );
  });

  it('reads the class once more when closed after a failure, and gives focus back to New code', () => {
    const closed = source.slice(
      source.indexOf('function closed()'),
      source.indexOf('async function copyCode'),
    );
    expect(closed).toMatch(
      /if \(said\?\.kind === 'failed'\) \{\s*void codeMoved\(api, classId, code\)/,
    );
    expect(closed).toMatch(
      /setSaid\(\(cur\) => \(cur\?\.kind === 'made' \? cur : null\)\);\s*toggle\.current\?\.focus\(\);/,
    );
    expect(source).toMatch(/onClose=\{closed\}/);
  });
});
