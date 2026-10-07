import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/*
 * The join code (the Class page design), rendered at rest: two items of the page's header, the
 * code with New code, and the line a made code is said in, mounted while empty so a screen reader
 * hears it land. The confirm, which needs a press to open, is read from the source: a raised card
 * on a line of its own, last in the header, so Present's row keeps its controls.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined }) }));
const { JoinCode } = await import('./join-code');
const source = readFileSync(fileURLToPath(new URL('./join-code.tsx', import.meta.url)), 'utf8');

describe('the join code', () => {
  it('draws the code and New code, its made-code line mounted and empty', () => {
    const html = renderToStaticMarkup(
      createElement(JoinCode, { classId: 'c1', code: 'VMAF7E', onClass: () => undefined }),
    );
    expect(html).toMatch(/<span translate="no" class="font-mono text-code">VMAF7E<\/span>/);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>New code<\/button>/);
    expect(html).toMatch(/<p role="status" class="[^"]*"><\/p>/);
    expect(html).not.toContain('role="group"');
  });

  it('opens its confirm as a raised card on a line of its own, last in the header', () => {
    const confirm = /<div\s+ref=\{group\}\s+role="group"[^>]*className="([^"]*)"/.exec(source)?.[1];
    expect(confirm?.split(' ')).toEqual(
      expect.arrayContaining(['order-last', 'basis-full', 'bg-surface-raised', 'shadow-2']),
    );
  });
});
