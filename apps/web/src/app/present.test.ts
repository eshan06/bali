import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * Present is the projector the class can see (PV9; ClassPresent at 1920 × 1080, PresentEnded): no
 * menu, the class page's own parts one size up, the code in a well of its own, +5, +10 and End kept
 * beside Present (the owner, 2026-10-12), and never an unlock's reason. A live question shows in the
 * grid's place, totals only (L7, part 2), closed and put away there (L7, part 3). After the bell it
 * says only "Class is over" (PV1), the figures left to the recap. Present is kept for the browser
 * tab, so a reload or a return from Reports comes back in it. Read from the class page's source;
 * its header and counts are rendered in live-header.test.ts, its tiles in live-grid.test.ts, its
 * question in present-question.test.ts.
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
    // question or a slide), the class page's question card (never in Present), the grid, then
    // Present's question in the tiles' place (L7, part 2), or else its slide (M6, part 2d).
    expect(live).toMatch(
      /<main className=\{present \? PRESENT_PAGE : 'relative flex flex-col gap-5\.5'\}>\s*\{\/\*[^]*?\*\/\}\s*<LiveHeader[^>]*present=\{present\}\s*>[^]*?<\/LiveHeader>\s*\{\/\*[^]*?\*\/\}\s*\{cantLoad\(error\)\}\s*\{\/\*[^]*?\*\/\}\s*\{said \? \([^]*?\) : null\}\s*\{\/\*[^]*?\*\/\}\s*<section\s+aria-label=\{projected \? undefined : 'Live grid'\}\s+className="flex flex-1 flex-col gap-5\.5"\s*>\s*\{\/\*[^]*?\*\/\}\s*\{projected \? null : \(\s*<div[^>]*>\s*\{counts \? <LiveCounts counts=\{counts\} present=\{present\} \/> : null\}\s*\{present \? null : presentToggle\(true\)\}\s*<\/div>\s*\)\}\s*\{\/\*[^]*?\*\/\}\s*\{present \? null : lesson\.question === null && slides\.slide !== null \? \(\s*<SlideCard[^]*?\/>\s*\) : \(\s*<QuestionCard[^]*?\/>\s*\)\}\s*<LiveGrid[^]*?\/>\s*\{\/\*[^]*?\*\/\}\s*\{projected && lesson\.question !== null \? <PresentQuestion id=\{id\} lesson=\{lesson\} \/> : null\}\s*\{projected && lesson\.question === null && slides\.slide !== null \? \(\s*<PresentSlide id=\{id\} lesson=\{slides\} slide=\{slides\.slide\} \/>\s*\) : null\}\s*<\/section>/,
    );
    // And the side panel only out of Present, as the student's panel (L7-1b), whatever it holds.
    expect(page).toMatch(/const panel = present \? null : side;/);
    expect(live).toMatch(
      /\{panel === 'decks' \? \(\s*<DecksPanel[^]*?\{panel === 'ask' && !writing \? \(\s*<PickPanel[^]*?\{panel === 'ask' && writing \? \(\s*<AskPanel/,
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

  it('shows a question in the live grid’s place while one shows (L7, part 2; PresentQuestion, PresentAnswer)', () => {
    // The class page's own question, open or closed until Done or the next: one live question, so
    // the projector and the teacher's card never differ on which.
    expect(page).toMatch(
      /const projected = present && \(lesson\.question !== null \|\| slides\.slide !== null\);/,
    );
    // The grid stays, its stream with it (the question's close, the session's end, the counts in
    // the header), its tiles giving way to the question; the counts' bar goes too, as
    // PresentQuestion draws none; the section names no live grid while it holds a question.
    const [grid] = tags('LiveGrid');
    expect(grid).toMatch(/\btiles=\{!projected\}/);
    expect(grid).toMatch(/\bonEvent=\{onLessonEvent\}/);
    expect(tags('PresentQuestion')).toEqual(['<PresentQuestion id={id} lesson={lesson} />']);
    // Never the class page's card or its side panel there: their controls and the teacher's live
    // breakdown are the teacher's alone; nor its slide card (M6, part 2b-2), Present's slide being
    // PresentSlide's (2d).
    expect(live).toMatch(
      /\{present \? null : lesson\.question === null && slides\.slide !== null \? \(\s*<SlideCard[^]*?\) : \(\s*<QuestionCard/,
    );
    expect(page).toMatch(/const panel = present \? null : side;/);
  });

  it('shows the slide in the live grid’s place while no question shows (M6, part 2d; PresentSlide)', () => {
    // The session's own slide, through the class page's own hook: Present and the teacher's card
    // never differ on which page. A question first (the conductor's call, 2026-10-16), the slide
    // back after Done.
    expect(tags('PresentSlide')).toEqual([
      '<PresentSlide id={id} lesson={slides} slide={slides.slide} />',
    ]);
    expect(live).toMatch(
      /\{projected && lesson\.question !== null \? <PresentQuestion[^]*?\{projected && lesson\.question === null && slides\.slide !== null \? \(\s*<PresentSlide/,
    );
    // The grid stays underneath, its tiles and the counts giving way, as for a question.
    const [grid] = tags('LiveGrid');
    expect(grid).toMatch(/\btiles=\{!projected\}/);
    // Its section fills the rest of Present's page, at least the screen's height, so the slide's
    // frame takes what the header leaves (present-slide.test.ts).
    expect(page).toMatch(/const PRESENT_PAGE = '[^']*\bflex min-h-dvh flex-col\b/);
    expect(live).toMatch(
      /aria-label=\{projected \? undefined : 'Live grid'\}\s+className="flex flex-1 /,
    );
  });

  it('shows the slide card in the question card’s place while no question shows, the question first (M6, part 2b-2)', () => {
    // A question shows, open or closed until Done: the question card, as approved (the conductor's
    // call, 2026-10-16); the slide card back after Done. One slot, so the grid never moves.
    expect(live).toMatch(/lesson\.question === null && slides\.slide !== null \? \(\s*<SlideCard/);
    const [card] = tags('SlideCard');
    expect(card).toMatch(/\blesson=\{slides\}/);
    expect(card).toMatch(/\bslide=\{slides\.slide\}/);
    expect(card).toMatch(/\basking=\{panel === 'ask'\}/);
    // Both cards hear the stream through the grid; the slide's state from the question's read.
    expect(page).toMatch(
      /const \{ slides, onEvent: onSlideEvent \} = useSlide\(live \? grid\.id : null, snapshot, reread\);/,
    );
    expect(page).toMatch(
      /const onLessonEvent = useCallback\(\s*\(e: FeedEvent\) => \{\s*onEvent\(e\);\s*onSlideEvent\(e\);\s*\},\s*\[onEvent, onSlideEvent\],?\s*\);/,
    );
  });

  it('closes and puts away its question there, Done sending focus to Present in the header (L7, part 3)', () => {
    // PresentQuestion's foot holds Close, Close and show answer and Done (present-question.test.ts);
    // Done leaves the live grid, and focus goes on to the toggle, the header's last control.
    const toggle = page.slice(page.indexOf('const presentToggle'));
    expect(toggle).toMatch(
      /^const presentToggle = \(beside = false, className = ''\) => \(\s*<Button\s+ref=\{toggle\}\s+id=\{`\$\{id\}-present`\}/,
    );
    expect(read('../components/present-question.tsx')).toMatch(
      /doneButton\(lesson, `\$\{id\}-present`\)/,
    );
    // Ask another question stays on the class page: its panel lists the saved questions with their
    // answers, which the room must never see.
    expect(page).toMatch(/const panel = present \? null : side;/);
  });

  it('never shows the panel of your questions, which names their correct answers (the owner, 2026-10-15)', () => {
    // L7b, part 2: the panel lists the teacher's questions with each one's correct answer, so
    // it is drawn only while `panel` holds, which Present never does, both its views alike; and
    // nothing Present draws in its place reads the teacher's questions. Nor the decks' (M6, part
    // 2c): the teacher's to pick, never the room's.
    expect(page).toMatch(/const panel = present \? null : side;/);
    for (const [name, when] of [
      ['PickPanel', "{panel === 'ask' && !writing ? ("],
      ['AskPanel', "{panel === 'ask' && writing ? ("],
      ['DecksPanel', "{panel === 'decks' ? ("],
    ]) {
      const at = [...page.matchAll(new RegExp(`<${name}\\b`, 'g'))].map((m) => m.index);
      expect(at, name).toHaveLength(1);
      // Drawn right inside its own `panel` branch, and nowhere else.
      const before = page.slice(0, at[0]);
      expect(before.slice(before.lastIndexOf('{panel')).trimEnd(), name).toBe(when);
    }
    expect(ended).not.toMatch(/AskPanel|PickPanel|DecksPanel|saved-questions/);
    for (const part of ['present-question', 'present-slide', 'live-header', 'live-grid']) {
      expect(read(`../components/${part}.tsx`), part).not.toMatch(
        /ask-panel|decks-panel|saved-questions|PickPanel|PickView|DecksPanel/,
      );
    }
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
      /setPresent\(fromHome \|\| rememberedPresent\(classId\)\);/,
    );
  });

  it('opens in Present from Home’s Present (`?present`, Main), kept for the tab, the address forgetting it (PV17b)', () => {
    const start = page.indexOf('rememberedMinutes(classId)');
    expect(page.slice(start, page.indexOf('}, [classId]);', start))).toMatch(
      /const fromHome = new URLSearchParams\(window\.location\.search\)\.has\('present'\);\s*if \(fromHome\) \{\s*rememberPresent\(classId, true\);\s*window\.history\.replaceState\(null, '', `\/classes\/\$\{classId\}`\);\s*\}\s*setPresent\(fromHome \|\| rememberedPresent\(classId\)\);/,
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
