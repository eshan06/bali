import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Present is the projector the class can see (PV9; ClassPresent at 1920 × 1080, PresentEnded): no
 * menu, the class page's own parts one size up, the code in a well of its own, +5, +10 and End kept
 * beside Present (the owner, 2026-10-12), and never an unlock's reason. A live question shows in the
 * grid's place, totals only (L7, part 2). After the bell it says only "Class is over" (PV1), the
 * figures left to the recap. Present is kept for the browser tab, so a reload or a return from
 * Reports comes back in it. Read from the class page's source; its header and counts are rendered
 * in live-header.test.ts, its tiles in live-grid.test.ts, its question in present-question.test.ts.
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
    // grid's section, in both views; inside it the counts' bar (none while Present shows a
    // question), the class page's question card (never in Present), the grid, then Present's
    // question in the tiles' place (L7, part 2).
    expect(live).toMatch(
      /<main className=\{present \? PRESENT_PAGE : 'relative flex flex-col gap-5\.5'\}>\s*\{\/\*[^]*?\*\/\}\s*<LiveHeader[^>]*present=\{present\}\s*>[^]*?<\/LiveHeader>\s*\{\/\*[^]*?\*\/\}\s*\{cantLoad\(error\)\}\s*\{\/\*[^]*?\*\/\}\s*\{said \? \([^]*?\) : null\}\s*<section aria-label=\{projected \? undefined : 'Live grid'\} className="flex flex-col gap-5\.5">\s*\{\/\*[^]*?\*\/\}\s*\{projected \? null : \(\s*<div[^>]*>\s*\{counts \? <LiveCounts counts=\{counts\} present=\{present\} \/> : null\}\s*\{present \? null : presentToggle\(true\)\}\s*<\/div>\s*\)\}\s*\{\/\*[^]*?\*\/\}\s*\{present \? null : \(?\s*<QuestionCard[^]*?\/>\s*\)?\}\s*<LiveGrid[^]*?\/>\s*\{\/\*[^]*?\*\/\}\s*\{projected \? <PresentQuestion id=\{id\} lesson=\{lesson\} \/> : null\}\s*<\/section>/,
    );
    // And the side panel's asking only out of Present, as the student's panel (L7-1b).
    expect(page).toMatch(/const panel = asking && !present;/);
    expect(live).toMatch(/\{panel \? \(\s*<AskPanel/);
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

  it('shows a question in the live grid’s place while one shows (L7, part 2; PresentQuestion, PresentAnswer)', () => {
    // The class page's own question, open or closed until Done or the next: one live question, so
    // the projector and the teacher's card never differ on which.
    expect(page).toMatch(/const projected = present && lesson\.question !== null;/);
    // The grid stays, its stream with it (the question's close, the session's end, the counts in
    // the header), its tiles giving way to the question; the counts' bar goes too, as
    // PresentQuestion draws none; the section names no live grid while it holds a question.
    const [grid] = tags('LiveGrid');
    expect(grid).toMatch(/\btiles=\{!projected\}/);
    expect(grid).toMatch(/\bonEvent=\{onEvent\}/);
    expect(tags('PresentQuestion')).toEqual(['<PresentQuestion id={id} lesson={lesson} />']);
    // Never the class page's card or its side panel there: their controls and the teacher's live
    // breakdown are the teacher's alone.
    expect(live).toMatch(/\{present \? null : \(\s*<QuestionCard/);
    expect(page).toMatch(/const panel = asking && !present;/);
  });

  it('draws nothing ClassPresent leaves off: no nav, no roster, no New code, no heading', () => {
    expect(live).not.toMatch(/All classes|Roster|roster\.students|<JoinCode|<nav|<h2/);
    expect(page).not.toMatch(/NAV_LINK|ArrowLeft|DIVIDER/);
  });

  it('keeps its slides icon while pressed, as ClassPresent draws it, never a check', () => {
    const toggle = page.slice(page.indexOf('const presentToggle'));
    expect(toggle.slice(0, toggle.indexOf('</Button>'))).toMatch(
      /aria-pressed=\{present\}[^]*>\s*<Presentation size=\{16\} aria-hidden="true" \/>\s*Present\s*$/,
    );
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

  it('never shows the recap in Present, so no figure or reason reaches the room', () => {
    // Present after the bell is its own page, so the recap only shows off it; it still takes
    // Present, so no reason could reach the projector should that ever change (#265). How it ended
    // is gone (PV12b), and with it the toggle beside it: ClassEnded draws no Present.
    expect(tags('LiveGrid')).toHaveLength(1);
    expect(tags('RecapCard')).toHaveLength(1);
    for (const tag of [...tags('RecapCard'), ...tags('LiveGrid')]) {
      expect(tag).toMatch(/\bpresent=\{present\}/);
    }
    expect(page).not.toMatch(/How it ended<|openedInPresent|toggle=\{/);
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
