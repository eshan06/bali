import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Present is the projector the class can see, so it never shows an unlock's reason (#265). A
 * session that ends while the page is projected switches it to the recap card and How it ended
 * (D2g): both take Present as the live grid does, and How it ended keeps the toggle, so leaving
 * Present shows the reasons again. Read from the class page's source.
 */
const page = readFileSync(
  fileURLToPath(new URL('./classes/[id]/page.tsx', import.meta.url)),
  'utf8',
);

/** Each element the page renders of a component, from its name to the end of its tag. */
const tags = (name: string) => page.match(new RegExp(`<${name}\\b[^]*?/>`, 'g')) ?? [];

describe('the class page in Present', () => {
  it('gives Present to every grid it shows, live and ended, and to the recap', () => {
    expect(tags('LiveGrid')).toHaveLength(2);
    expect(tags('RecapCard')).toHaveLength(1);
    for (const tag of [...tags('LiveGrid'), ...tags('RecapCard')]) {
      expect(tag).toMatch(/\bpresent=\{present\}/);
    }
  });

  it('keeps the toggle beside How it ended, as beside the live grid', () => {
    const ended = page.slice(page.indexOf('How it ended'));
    expect(ended.slice(0, ended.indexOf('<LiveGrid'))).toMatch(/\{presentToggle\}/);
    expect(page.match(/\{presentToggle\}/g)).toHaveLength(2);
  });
});
