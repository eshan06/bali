import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Present is the projector the class can see, so it never shows an unlock's reason (#265). A
 * session that ends while the page is projected switches it to the recap card and How it ended
 * (D2g): both take Present as the live grid does, and How it ended keeps the toggle, so leaving
 * Present shows the reasons again. Present is kept for the browser tab, so a reload or a return
 * from Reports comes back in it; with no session to show then, the recap carries the toggle. Read
 * from the class page's source.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const page = read('./classes/[id]/page.tsx');
const recapCard = read('../components/recap-card.tsx');

/** Each element the page renders of a component, from its name to the end of its tag. */
const tags = (name: string) => page.match(new RegExp(`<${name}\\b[^]*?/>`, 'g')) ?? [];

/** The effect that reads, once the page is in the browser, what was kept for the class. */
function opening(): string {
  const start = page.indexOf('rememberedMinutes(classId)');
  return page.slice(start, page.indexOf('}, [classId]);', start));
}

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

  it('comes back in Present after a reload or a return from Reports, as this tab left it', () => {
    expect(opening()).toMatch(/const (\w+) = rememberedPresent\(classId\);[^]*setPresent\(\1\);/);
    const toggle = page.slice(page.indexOf('const presentToggle'));
    const press = toggle.slice(toggle.indexOf('onClick'), toggle.indexOf('className'));
    expect(press).toMatch(/rememberPresent\(classId, !present\)/);
    expect(press).toMatch(/setPresent\(!present\)/);
  });

  it('puts the toggle on the recap when the page comes back in Present with no session to show', () => {
    expect(opening()).toMatch(
      /const (\w+) = rememberedPresent\(classId\);[^]*setOpenedInPresent\(\1\);/,
    );
    const [recap] = tags('RecapCard');
    expect(recap).toMatch(/\btoggle=\{grid === null && openedInPresent \? presentToggle : null\}/);
    expect(recapCard.match(/\{toggle\}/g)).toHaveLength(1);
  });
});
