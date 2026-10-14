import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Present is the projector the class can see, so it never shows an unlock's reason (#265). A
 * session that ends while the page is projected switches it to the recap card and How it ended
 * (D2g): both take Present as the live grid does, and How it ended keeps the toggle, so leaving
 * Present shows the reasons again. Present is kept for the browser tab, so a reload or a return
 * from Reports comes back in it; with no session to show then, the recap carries the toggle. While a
 * session runs, Present keeps its own page until PV9 draws it, beside the class page's own (PV7).
 * Read from the class page's source.
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

/** The page while a session runs: the render's first branch. */
const live = page.slice(
  page.indexOf('return klass !== null && grid !== null && !grid.over ? ('),
  page.indexOf('// No session running (PV6)'),
);

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
    expect(ended.slice(0, ended.indexOf('<LiveGrid'))).toMatch(/\{presentToggle\(\)\}/);
    // The live grid's, the ended grid's and the recap's: the same toggle, one each.
    expect(page.match(/\bpresentToggle\((?:!present)?\)/g)).toHaveLength(3);
    expect(live).toMatch(/\{presentToggle\(!present\)\}/);
  });

  it('comes back in Present after a reload or a return from Reports, as this tab left it', () => {
    expect(opening()).toMatch(/const (\w+) = rememberedPresent\(classId\);[^]*setPresent\(\1\);/);
    const toggle = page.slice(page.indexOf('const presentToggle'));
    const press = toggle.slice(toggle.indexOf('onClick'), toggle.indexOf('</Button>'));
    expect(press).toMatch(/rememberPresent\(classId, !present\)/);
    expect(press).toMatch(/setPresent\(!present\)/);
  });

  it('folds the bell, the code in code-lg and the controls into its header while a session runs', () => {
    // The Present board: one row, so a class of 28 fits one 1080p screen, until PV9 draws it.
    const start = live.indexOf('{present ? (\n        // Present');
    const header = live.slice(live.indexOf('<header', start), live.indexOf('</header>', start));
    expect(header).toMatch(/\{endsAt\}[^]*<JoinCode[^>]*\blarge \/>[^]*\{extend\}\s*\{end\(\)\}/);
    expect(read('../components/join-code.tsx')).toMatch(/large \? 'text-code-lg' : 'text-code'/);
    // Off Present the class page's own header (PV7) holds the controls, and no New code.
    expect(live.slice(start)).toMatch(
      /\) : \([^]*<LiveHeader[^]*>\s*\{extend\}\s*\{end\('ml-2'\)\}\s*<\/LiveHeader>/,
    );
    expect(tags('JoinCode').filter((tag) => !/\bcard\b/.test(tag))).toHaveLength(1);
  });

  it('keeps its nav and roster until PV9, the class page showing neither while a session runs', () => {
    expect(live).toMatch(/\{present \? \(\s*<nav aria-label="Class"/);
    expect(live).toMatch(/\{present \? \(\s*<section\s+aria-labelledby=\{`\$\{id\}-roster`\}/);
    expect(live.match(/All classes|Roster/g)).toHaveLength(2);
    expect(live).toMatch(
      /<ul className="mt-4 columns-2 gap-x-6 sm:columns-3 sm:gap-x-10 lg:columns-4">/,
    );
  });

  it('keeps the live grid in one place as Present turns on, so it never reboots or reconnects', () => {
    // React keeps a child by its place: the said line's slot holds a null when nothing is said,
    // and the grid's section sits after it in both views; inside it, the toggle second after the
    // heading (Present) or the counts (the class page), then the grid.
    expect(live).toMatch(
      /<div className=\{present \? undefined : 'contents'\}>\s*\{\/\*[^*]*\*\/\}\s*\{said \? \([^]*?\) : null\}\s*<section\s/,
    );
    const section = live.slice(live.indexOf('<section\n          aria-labelledby={present'));
    expect(section).toMatch(
      /^<section[^]*?<div[^>]*>\s*\{present \? \([^]*?\) : counts \? \([^]*?\) : null\}\s*\{presentToggle\(!present\)\}\s*<\/div>\s*<LiveGrid/,
    );
    const grid = tags('LiveGrid').find((tag) => tag.includes('onEnded'));
    expect(grid).not.toMatch(/\bkey=/);
    // Present keeps the line over the grid for a lost stream until PV9; the class page the pill.
    expect(grid).toMatch(/\blivePage=\{!present\}/);
  });

  it('puts the toggle on the recap when the page comes back in Present with no session to show', () => {
    expect(opening()).toMatch(
      /const (\w+) = rememberedPresent\(classId\);[^]*setOpenedInPresent\(\1\);/,
    );
    const [recap] = tags('RecapCard');
    expect(recap).toMatch(
      /\btoggle=\{grid === null && openedInPresent \? presentToggle\(\) : null\}/,
    );
    expect(recapCard.match(/\{toggle\}/g)).toHaveLength(1);
  });

  it('has no menu and keeps its own column, so a 1024 px projector shows four (the owner, 2026-10-13)', () => {
    // The page tells the shell while Present is on, and the shell then draws no menu or frame
    // (shell.test.ts, `frameFor`); the page keeps the column it had before the menu until PV9.
    expect(page).toMatch(/usePresenting\(present\);/);
    const frame = /const PRESENT_PAGE = '([^']*)';/.exec(page)?.[1] ?? '';
    expect(frame.split(' ')).toEqual(
      expect.arrayContaining(['mx-auto', 'max-w-[1400px]', 'px-4', 'sm:px-10']),
    );
    expect(live).toMatch(
      /<main className=\{present \? `\$\{PRESENT_PAGE\} pt-5` : 'relative flex flex-col gap-5\.5'\}>/,
    );
    // Present's fourth column comes at a 56 rem grid (PRESENT_COLUMNS' @4xl): 1024 px less the two
    // gutters is 944 px, over it.
    const gutter = Number(/\bsm:px-(\d+)\b/.exec(frame)?.[1]) * 4;
    expect(1024 - 2 * gutter).toBeGreaterThanOrEqual(56 * 16);
  });
});
