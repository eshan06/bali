import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Present is the projector the class can see (PV9; ClassPresent at 1920 × 1080, PresentEnded): no
 * menu, the class page's own parts one size up, the code in a well of its own, +5, +10 and End kept
 * beside Present (the owner, 2026-10-12), and never an unlock's reason. After the bell it says only
 * "Class is over" (PV1), the figures left to the recap. Present is kept for the browser tab, so a
 * reload or a return from Reports comes back in it. Read from the class page's source; its header
 * and counts are rendered in live-header.test.ts, its tiles in live-grid.test.ts.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const page = read('./classes/[id]/page.tsx');

/** Each element the page renders of a component, from its name to the end of its tag. */
const tags = (name: string) => page.match(new RegExp(`<${name}\\b[^]*?/>`, 'g')) ?? [];

/** The page while a session runs: the render's first branch. */
const live = page.slice(
  page.indexOf('return klass !== null && grid !== null && !grid.over ? ('),
  page.indexOf('// After the bell in Present'),
);
/** Present after the bell: the render's second branch. */
const ended = page.slice(
  page.indexOf('// After the bell in Present'),
  page.indexOf('// No session running (PV6)'),
);

describe('the class page in Present while a session runs (ClassPresent)', () => {
  it('is the class page’s own tree, one size up, so the grid never reboots as Present turns on', () => {
    // React keeps a child by its place: the header, the read's failure, the said line, then the
    // grid's section, in both views; inside it the counts' bar, then the grid.
    expect(live).toMatch(
      /<main className=\{present \? PRESENT_PAGE : 'relative flex flex-col gap-5\.5'\}>\s*\{\/\*[^]*?\*\/\}\s*<LiveHeader[^>]*present=\{present\}\s*>[^]*?<\/LiveHeader>\s*\{\/\*[^]*?\*\/\}\s*\{cantLoad\(error\)\}\s*\{\/\*[^]*?\*\/\}\s*\{said \? \([^]*?\) : null\}\s*<section aria-label="Live grid" className="flex flex-col gap-5\.5">\s*\{\/\*[^]*?\*\/\}\s*<div[^>]*>\s*\{counts \? <LiveCounts counts=\{counts\} present=\{present\} \/> : null\}\s*\{present \? null : presentToggle\(true\)\}\s*<\/div>\s*<LiveGrid/,
    );
    const [grid] = tags('LiveGrid');
    expect(grid).toMatch(/\bpresent=\{present\}/);
    expect(grid).toMatch(/\blivePage\s/);
    expect(grid).not.toMatch(/\bkey=/);
  });

  it('keeps +5, +10 and End in its header, Present after them (the owner, 2026-10-12)', () => {
    expect(live).toMatch(
      /<LiveHeader[^>]*>\s*\{extend\}\s*\{end\('ml-2'\)\}\s*\{present \? presentToggle\(false, 'ml-2'\) : null\}\s*<\/LiveHeader>/,
    );
  });

  it('draws nothing ClassPresent leaves off: no nav, no roster, no New code, no heading', () => {
    expect(live).not.toMatch(/All classes|Roster|roster\.students|<JoinCode|<nav|<h2/);
    expect(page).not.toMatch(/NAV_LINK|ArrowLeft|DIVIDER/);
  });

  it('follows the toggle with focus as it moves into the header and back', () => {
    const toggle = page.slice(page.indexOf('const presentToggle'));
    expect(toggle).toMatch(
      /^const presentToggle = \(beside = false, className = ''\) => \(\s*<Button\s+ref=\{toggle\}/,
    );
    expect(toggle.slice(0, toggle.indexOf('</Button>'))).toMatch(
      /onClick=\{\(\) => \{\s*rememberPresent\(classId, !present\);\s*toggled\.current = true;\s*setPresent\(!present\);/,
    );
    // Only a press moves focus: the page coming back in Present takes none. Present left with no
    // session to show leaves no toggle to follow, so focus goes to Start, the next thing to do.
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*if \(toggled\.current\) \(toggle\.current \?\? start\.current\)\?\.focus\(\);\s*toggled\.current = false;\s*\}, \[present\]\);/,
    );
    expect(page).toMatch(/<Button\s+ref=\{start\}\s+type="submit"/);
  });
});

describe('the class page in Present after the bell (PresentEnded)', () => {
  it('says "Class is over" alone under the header, its ring whole, the figures left to the recap', () => {
    expect(page).toMatch(/\) : klass !== null && present \? \(\s*\/\/ After the bell in Present/);
    expect(ended).toMatch(
      /<LiveHeader[^>]*\bpresent\s+over=\{noSession\}\s*>\s*\{presentToggle\(\)\}\s*<\/LiveHeader>\s*\{cantLoad\(error \?\? rosterError\)\}\s*<section[^>]*>\s*<h2 id=\{`\$\{id\}-over`\} className="text-present-question">\s*Class is over\s*<\/h2>\s*<\/section>\s*<\/main>/,
    );
    // The card fills the screen under the header, as `.p-card` does: 20 px corners, 36 × 44 px in.
    const card = /<section\s+aria-labelledby=\{`\$\{id\}-over`\}\s+className="([^"]*)"/.exec(ended);
    expect(card?.[1]?.split(' ')).toEqual(
      expect.arrayContaining([
        'flex-1',
        'items-center',
        'justify-center',
        'rounded-lg',
        'border-border-default',
        'bg-surface-card',
        'shadow-1',
        'px-11',
        'py-9',
      ]),
    );
    expect(ended).not.toMatch(/RecapCard|LiveGrid|How it ended|extend|end\(/);
  });

  it('never shows the recap or How it ended in Present, so no figure or reason reaches the room', () => {
    // Present after the bell is its own page, so the recap and How it ended only show off it; each
    // still takes Present, so no reason could reach the projector should that ever change (#265).
    expect(tags('LiveGrid')).toHaveLength(2);
    expect(tags('RecapCard')).toHaveLength(1);
    for (const tag of [...tags('RecapCard'), ...tags('LiveGrid')]) {
      expect(tag).toMatch(/\bpresent=\{present\}/);
    }
    const ending = page.slice(page.indexOf('<h2 id={`${id}-ended`}'));
    expect(ending.slice(0, ending.indexOf('<LiveGrid'))).toMatch(/\{presentToggle\(\)\}/);
    expect(page).not.toMatch(/openedInPresent|toggle=\{/);
  });
});

describe('Present’s page', () => {
  it('comes back in Present after a reload or a return from Reports, as this tab left it', () => {
    const start = page.indexOf('rememberedMinutes(classId)');
    expect(page.slice(start, page.indexOf('}, [classId]);', start))).toMatch(
      /setPresent\(rememberedPresent\(classId\)\);/,
    );
  });

  it('has no menu and is 36/48/40 in, as v2.css’s `.proj`, so a 1024 px projector shows four', () => {
    // The page tells the shell while Present is on, and the shell then draws no menu or frame
    // (shell.test.ts, `frameFor`).
    expect(page).toMatch(/usePresenting\(present\);/);
    const frame = /const PRESENT_PAGE = '([^']*)';/.exec(page)?.[1] ?? '';
    expect(frame.split(' ')).toEqual(
      expect.arrayContaining([
        'relative',
        'flex',
        'min-h-dvh',
        'flex-col',
        'gap-5.5',
        'pt-9',
        'pb-10',
        'sm:px-12',
      ]),
    );
    // Present's fourth column comes at a 56 rem grid (PRESENT_COLUMNS' @4xl): 1024 px less the two
    // gutters is 928 px, over it.
    const gutter = Number(/\bsm:px-(\d+)\b/.exec(frame)?.[1]) * 4;
    expect(1024 - 2 * gutter).toBeGreaterThanOrEqual(56 * 16);
  });
});
