import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Deck } from '@bali/shared';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TOO_MANY_TRIES } from '../lib/errors';
import {
  DeckRow,
  type Decks,
  focusAfter,
  idOf,
  inUseLine,
  type Made,
  megabytes,
  notReadyLine,
  readyLine,
  type Refusal,
  type Removal,
  removeLine,
  type Row,
  rowsOf,
  type Sending,
  type SlidesActions,
  SlidesView,
  stoppedLine,
  TITLE,
} from './slides';

/*
 * Your slides (M5b) as the canvas draws it: the Slides board's rows, LessonStates' lines for it,
 * and SlidesStates' states in between, each rendered from the board's own data; its buttons pressed
 * through its own element tree; the page's wiring read from its source.
 */
const page = readFileSync(
  fileURLToPath(new URL('../app/slides/page.tsx', import.meta.url)),
  'utf8',
);

const MB = 1024 * 1024;
/** A day as the rows write it, "Oct 6", its words kept on one line. */
const at = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
    .format(new Date(iso))
    .replace(/\s/g, String.fromCharCode(0xa0));
const deck = (n: number, over: Partial<Deck>): Deck => ({
  id: `0199b000-0000-7000-8000-00000000000${n}`,
  title: '',
  status: 'ready',
  bytes: MB,
  sha256: 'a'.repeat(64),
  pageCount: 1,
  rejection: null,
  createdAt: '2026-10-06T15:00:00.000Z',
  ...over,
});
/** The Slides board's decks. */
const FACTORING = deck(1, {
  title: 'Factoring quadratics',
  pageCount: 12,
  bytes: Math.round(4.2 * MB),
});
const UNIT2 = deck(2, {
  title: 'Unit 2 review',
  pageCount: 24,
  bytes: Math.round(8.9 * MB),
  createdAt: '2026-09-28T15:00:00.000Z',
});
const PARABOLAS = deck(3, {
  title: 'Graphing parabolas',
  pageCount: 9,
  bytes: Math.round(2.1 * MB),
  createdAt: '2026-10-02T15:00:00.000Z',
});
const MIDTERM = deck(4, {
  title: 'Midterm review (scanned)',
  status: 'rejected',
  pageCount: null,
  rejection: 'encrypted',
});
const sending = (key: string, title: string, state: Sending['state'], over = {}): Sending => ({
  key,
  title,
  deckId: null,
  state,
  cancelling: false,
  ...over,
});
const UNIT3 = sending('upload-1', 'Unit 3 review', { step: 'uploading', percent: 62 });
const LAB = sending('upload-2', 'Lab safety', { step: 'checking' });
/** The board's rows, in its order. */
const BOARD: Row[] = [
  { key: FACTORING.id, deck: FACTORING },
  { key: UNIT2.id, deck: UNIT2 },
  { key: PARABOLAS.id, deck: PARABOLAS },
  { key: UNIT3.key, sending: UNIT3 },
  { key: LAB.key, sending: LAB },
  { key: MIDTERM.id, deck: MIDTERM },
];
const BIOLOGY = [{ id: 'c1', name: 'Biology, period 3' }];

const actions = (): SlidesActions => ({
  pick: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  ask: vi.fn(),
  remove: vi.fn(),
  keep: vi.fn(),
});
const view = (
  decks: Decks,
  rows: Row[],
  over: Partial<Parameters<typeof SlidesView>[0]> = {},
): Parameters<typeof SlidesView>[0] => ({
  decks,
  rows,
  refusal: null,
  removals: {},
  inUse: {},
  on: actions(),
  ...over,
});
const render = (props: Parameters<typeof SlidesView>[0]) =>
  renderToStaticMarkup(createElement(SlidesView, props));
const row = (r: Row, removal?: Removal, inUse?: typeof BIOLOGY, on = actions()) =>
  renderToStaticMarkup(createElement(DeckRow, { row: r, removal, inUse, on }));

/** Markup as read: each tag a space, each run of spaces one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Every host element the tree draws, each component drawn out, as React would. */
function hosts(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (typeof node.type === 'function') {
    return hosts((node.type as (p: unknown) => ReactNode)(node.props));
  }
  return [node, ...hosts(node.props.children as ReactNode)];
}
const words = (n: ReactNode): string =>
  Array.isArray(n)
    ? n.map(words).join('')
    : typeof n === 'string'
      ? n
      : isValidElement<{ children?: ReactNode }>(n)
        ? words(n.props.children)
        : '';
/** The one button whose words are `name`, to press. */
function press(node: ReactNode, name: string) {
  const found = hosts(node).filter(
    (e) => e.type === 'button' && words(e.props.children as ReactNode).trim() === name,
  );
  if (found.length !== 1) throw new Error(`${found.length} buttons named "${name}"`);
  (found[0].props.onClick as () => void)();
}

describe('Your slides, as the Slides board draws it', () => {
  const refusal: Refusal = { kind: 'too_large', name: 'Chapter 4 scan.pdf', bytes: 31 * MB };
  const props = view([FACTORING, UNIT2, PARABOLAS, MIDTERM], BOARD, {
    refusal,
    removals: { [UNIT2.id]: { busy: false, failure: null } },
    inUse: { [PARABOLAS.id]: BIOLOGY },
  });
  const html = render(props);

  it('says each of its lines, in its order', () => {
    expect(text(html)).toBe(
      text(
        [
          'Your slides PDFs up to 25 MB and 200 pages. Students see a slide only while you show it in class. Upload a PDF',
          '“Chapter 4 scan.pdf” is 31 MB. Bali takes PDFs up to 25 MB.',
          `Factoring quadratics 12 pages · 4.2 MB · Added ${at(FACTORING.createdAt)} Remove`,
          `Unit 2 review 24 pages · 8.9 MB · Added ${at(UNIT2.createdAt)} Remove “Unit 2 review”? Students won't see it again, and you can't undo this. Remove Keep`,
          `Graphing parabolas 9 pages · 2.1 MB · Added ${at(PARABOLAS.createdAt)} Remove It's showing in Biology, period 3 right now. Stop showing it there first.`,
          'Unit 3 review Uploading · 62% Cancel',
          'Lab safety Checking the file…',
          'Midterm review (scanned) This PDF is password-protected. Remove the password, then upload it again. Remove',
        ].join(' '),
      ),
    );
  });

  it('draws the head as v2.css’s page head, Upload a PDF its primary button with the upload icon', () => {
    expect(html).toMatch(
      new RegExp(
        `^<main class="flex flex-col gap-5\\.5"><div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"><div><h1 id="${TITLE}" tabindex="-1" class="text-page-title">Your slides</h1><p class="mt-0\\.5 text-meta text-text-secondary">`,
      ),
    );
    expect(html).toMatch(
      /<button type="button" class="[^"]*\bbg-action-primary-bg\b[^"]*"><svg [^>]*width="16"[^>]*lucide-upload[^>]*>.*?<\/svg>Upload a PDF<\/button>/,
    );
    const on = actions();
    press(SlidesView({ ...props, on }), 'Upload a PDF');
    expect(on.pick).toHaveBeenCalledOnce();
  });

  it('says a refused pick under the head, in the primary ink', () => {
    expect(html).toContain(
      '<p role="alert" class="text-body">“Chapter 4 scan.pdf” is 31\u00a0MB. Bali takes PDFs up to 25 MB.</p>',
    );
  });

  it('draws each row as v2.css’s .deck-row: the file’s tile, the name and its line, its buttons', () => {
    const rows = [...html.matchAll(/<li class="([^"]*)">/g)].map((m) => m[1]);
    expect(rows).toHaveLength(6);
    for (const classes of rows) {
      expect(classes?.split(' ')).toEqual(
        expect.arrayContaining([
          'grid',
          'grid-cols-[40px_minmax(0,1fr)_auto]',
          'items-center',
          'gap-x-4',
          'gap-y-1',
          'rounded-md',
          'border-border-default',
          'bg-surface-card',
          'px-4',
          'py-3.5',
        ]),
      );
      // A list's row, with no shadow, as the board draws it.
      expect(classes).not.toMatch(/shadow/);
    }
    expect(html).toContain('<ul class="flex max-w-215 flex-col gap-2.5">');
    expect(html).toMatch(
      /<span class="grid size-10 place-items-center rounded-sm bg-surface-sunken text-text-secondary"><svg [^>]*width="18"[^>]*lucide-file-text/,
    );
    const id = idOf(FACTORING.id);
    expect(html).toContain(
      `<p id="${id}-name" class="font-semibold wrap-anywhere">Factoring quadratics</p><p aria-live="polite" class="text-caption text-text-tertiary">12 pages · 4.2\u00a0MB · Added ${at(FACTORING.createdAt)}</p>`,
    );
    // Remove names its deck for a screen reader.
    expect(html).toContain(
      `<button type="button" id="${id}-act" aria-describedby="${id}-name" class="`,
    );
  });

  it('draws an upload’s percentage and its bar, the percentage said by the bar alone', () => {
    const id = idOf(UNIT3.key);
    expect(html).toContain(
      '<p aria-live="polite" class="text-caption text-text-tertiary">Uploading<span aria-hidden="true"> · 62%</span></p>',
    );
    expect(html).toContain(
      `<div role="progressbar" aria-labelledby="${id}-name" aria-valuemin="0" aria-valuemax="100" aria-valuenow="62" class="mt-1.5 h-1 w-60 max-w-full overflow-hidden rounded-full bg-surface-sunken"><span class="block h-full rounded-full bg-surface-brand" style="width:62%"></span></div>`,
    );
  });

  it('asks before removing, across the row’s foot, with Remove and Keep in its place', () => {
    const id = idOf(UNIT2.id);
    expect(html).toMatch(
      new RegExp(
        `<div class="flex flex-wrap items-center gap-2\\.5"></div><div role="group" aria-labelledby="${id}-rm" class="col-\\[2/-1\\] flex flex-wrap items-center gap-x-4 gap-y-3"><p id="${id}-rm">Remove “Unit 2 review”\\?`,
      ),
    );
    expect(html).toContain(`id="${id}-keep"`);
    const on = actions();
    const tree = DeckRow({
      row: { key: UNIT2.id, deck: UNIT2 },
      removal: { busy: false, failure: null },
      inUse: undefined,
      on,
    });
    press(tree, 'Remove');
    press(tree, 'Keep');
    expect(on.remove).toHaveBeenCalledWith(UNIT2.id);
    expect(on.keep).toHaveBeenCalledWith(UNIT2.id);
  });

  it('says a deck in use under its row, naming the class, Remove still there', () => {
    expect(html).toContain(
      '<p role="alert" class="col-[2/-1]">It&#x27;s showing in Biology, period 3 right now. Stop showing it there first.</p>',
    );
    const on = actions();
    press(DeckRow({ row: BOARD[2], removal: undefined, inUse: BIOLOGY, on }), 'Remove');
    expect(on.ask).toHaveBeenCalledWith(PARABOLAS.id);
  });

  it('cancels an upload by its Cancel, and checks with no button', () => {
    const on = actions();
    press(SlidesView({ ...props, on }), 'Cancel');
    expect(on.cancel).toHaveBeenCalledWith(UNIT3.key);
    expect(text(row(BOARD[4]))).toBe('Lab safety Checking the file…');
  });
});

describe('the list’s other states (LessonStates, SlidesStates)', () => {
  it('says none yet in a plain line', () => {
    const html = render(view([], []));
    expect(text(html)).toMatch(/Upload a PDF No slides yet\. Upload a PDF to show it in class\.$/);
    expect(html).toContain(
      '<p class="text-body text-text-secondary">No slides yet. Upload a PDF to show it in class.</p>',
    );
  });

  it('says Loading… while the list is read (SlidesStates)', () => {
    expect(render(view('loading', []))).toContain(
      '<p role="status" class="text-body text-text-secondary">Loading…</p>',
    );
  });

  it('says a failed read with Try again, which reads it again', () => {
    const on = actions();
    const props = view('failed', [], { on });
    expect(render(props)).toMatch(
      /<div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Bali couldn&#x27;t load your slides\.<\/p><button type="button" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/div>/,
    );
    press(SlidesView(props), 'Try again');
    expect(on.read).toHaveBeenCalledOnce();
  });

  it('keeps an upload in sight while the list loads or failed, under its line', () => {
    const html = render(view('failed', [{ key: UNIT3.key, sending: UNIT3 }]));
    expect(text(html)).toMatch(
      /Bali couldn't load your slides\. Try again Unit 3 review Uploading/,
    );
    expect(text(render(view('loading', [{ key: LAB.key, sending: LAB }])))).toMatch(
      /Loading… Lab safety Checking the file…$/,
    );
  });

  it('says a picked file that isn’t a PDF where the size refusal sits', () => {
    const html = render(view([], [], { refusal: { kind: 'not_pdf', name: 'Unit 3.pptx' } }));
    expect(html).toContain(
      '<p role="alert" class="text-body">“Unit 3.pptx” isn&#x27;t a PDF. Save it as a PDF, then upload it.</p>',
    );
  });

  it('says every refusal the check makes, in the board’s words', () => {
    const line = (rejection: Deck['rejection']) =>
      notReadyLine(deck(9, { status: 'rejected', rejection }));
    expect(line('not_pdf')).toBe("This file isn't a PDF.");
    expect(line('too_large')).toBe('This PDF is over 25 MB.');
    expect(line('too_many_pages')).toBe('This PDF has more than 200 pages.');
    expect(line('mismatch')).toBe("The upload didn't arrive in one piece. Upload it again.");
    expect(line('too_slow')).toBe(
      "Bali couldn't read this PDF in time. Save it again, then upload it.",
    );
    expect(line('unfinished')).toBe("The upload didn't finish. Upload it again.");
    expect(line('encrypted')).toBe(
      'This PDF is password-protected. Remove the password, then upload it again.',
    );
  });

  it('says a pending deck no upload here is sending as the sweep will: unfinished, with Remove', () => {
    const pending = deck(8, { title: 'Unit 3 review', status: 'pending', pageCount: null });
    expect(text(row({ key: pending.id, deck: pending }))).toBe(
      "Unit 3 review The upload didn't finish. Upload it again. Remove",
    );
  });
});

describe('an upload that stopped (LessonStates, SlidesStates)', () => {
  const stopped = (why: Parameters<typeof stoppedLine>[0], over = {}) =>
    sending('upload-3', 'Unit 3 review', { step: 'stopped', why }, over);
  const failed = { kind: 'failed', status: undefined, retryAfter: undefined } as const;

  it('says why across its foot, with Try again, and keeps Cancel', () => {
    const on = actions();
    const r: Row = { key: 'upload-3', sending: stopped(failed) };
    const html = row(r, undefined, undefined, on);
    expect(text(html)).toBe(
      'Unit 3 review Cancel The upload stopped. Check your connection and try again. Try again',
    );
    expect(html).toMatch(
      /<div class="col-\[2\/-1\] flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert">The upload stopped\. Check your connection and try again\.<\/p><button type="button" aria-describedby="deck-upload-3-name" aria-disabled="false" class="[^"]*\bh-8\.5\b/,
    );
    // No line under the name and no bar: the foot says it.
    expect(html).not.toContain('aria-live');
    expect(html).not.toContain('progressbar');
    const tree = DeckRow({ row: r, removal: undefined, inUse: undefined, on });
    press(tree, 'Try again');
    press(tree, 'Cancel');
    expect(on.retry).toHaveBeenCalledWith('upload-3');
    expect(on.cancel).toHaveBeenCalledWith('upload-3');
  });

  it('says the 25 minutes, and too many tries, each in its words', () => {
    expect(stoppedLine({ kind: 'too_slow' })).toBe(
      'The upload was still going after 25 minutes, so Bali stopped it. Try again on a faster connection.',
    );
    expect(stoppedLine({ kind: 'failed', status: 429, retryAfter: 1 })).toBe(TOO_MANY_TRIES);
    expect(stoppedLine({ kind: 'failed', status: 503, retryAfter: undefined })).toBe(
      'The upload stopped. Check your connection and try again.',
    );
    // A refusal is said as the stop is; its Try again starts afresh (`uploadAgain`).
    expect(stoppedLine({ kind: 'refused', status: 409, reason: 'event_id_conflict' })).toBe(
      'The upload stopped. Check your connection and try again.',
    );
  });

  it('holds Cancel, and Try again, while its Cancel is sent (SlidesStates)', () => {
    const on = actions();
    const uploading = sending(
      'upload-4',
      'Unit 3 review',
      { step: 'uploading', percent: 62 },
      {
        cancelling: true,
      },
    );
    const html = row({ key: 'upload-4', sending: uploading });
    expect(html).toMatch(
      /<button type="button" id="deck-upload-4-act" aria-describedby="deck-upload-4-name" aria-disabled="true"/,
    );
    const held = { key: 'upload-3', sending: stopped(failed, { cancelling: true }) };
    const tree = DeckRow({ row: held, removal: undefined, inUse: undefined, on });
    press(tree, 'Cancel');
    press(tree, 'Try again');
    press(
      DeckRow({
        row: { key: 'upload-4', sending: uploading },
        removal: undefined,
        inUse: undefined,
        on,
      }),
      'Cancel',
    );
    expect(on.cancel).not.toHaveBeenCalled();
    expect(on.retry).not.toHaveBeenCalled();
  });
});

describe('removing a deck (SlidesStates)', () => {
  const r: Row = { key: UNIT2.id, deck: UNIT2 };
  const id = idOf(UNIT2.id);

  it('holds Remove and Keep while the removal is on its way', () => {
    const on = actions();
    const html = row(r, { busy: true, failure: null });
    expect(html.match(/<button type="button" (?:id="[^"]+" )?aria-disabled="true"/g)).toHaveLength(
      2,
    );
    const tree = DeckRow({ row: r, removal: { busy: true, failure: null }, inUse: undefined, on });
    press(tree, 'Remove');
    press(tree, 'Keep');
    expect(on.remove).not.toHaveBeenCalled();
    expect(on.keep).not.toHaveBeenCalled();
  });

  it('says a removal that didn’t go through in its question’s place, Remove there trying again', () => {
    const failed = { kind: 'failed', status: undefined, retryAfter: undefined } as const;
    expect(row(r, { busy: false, failure: failed })).toContain(
      `<p id="${id}-rm" role="alert">Bali couldn&#x27;t remove “Unit 2 review”. Check your connection and try again.</p>`,
    );
    expect(
      removeLine('Unit 2 review', { kind: 'refused', status: 409, reason: 'deck_in_use' }),
    ).toBe("Bali couldn't remove “Unit 2 review”.");
    expect(removeLine('Unit 2 review', { kind: 'failed', status: 429, retryAfter: 1 })).toBe(
      TOO_MANY_TRIES,
    );
  });

  it('names each class showing it, in the order given', () => {
    expect(inUseLine([{ id: 'c1', name: 'Biology, period 3' }])).toBe(
      "It's showing in Biology, period 3 right now. Stop showing it there first.",
    );
    expect(
      inUseLine([
        { id: 'c1', name: 'Biology, period 3' },
        { id: 'c2', name: 'Chemistry' },
      ]),
    ).toBe(
      "It's showing in Biology, period 3 and Chemistry right now. Stop showing it there first.",
    );
    expect(
      inUseLine([
        { id: 'c1', name: 'Biology' },
        { id: 'c2', name: 'Chemistry' },
        { id: 'c3', name: 'Physics' },
      ]),
    ).toBe(
      "It's showing in Biology, Chemistry, and Physics right now. Stop showing it there first.",
    );
  });
});

describe('a deck’s size and line, as the boards write them', () => {
  it('says tenths under 10 MB and whole numbers from there, never 0.0', () => {
    expect(megabytes(Math.round(4.2 * MB))).toBe('4.2\u00a0MB');
    expect(megabytes(Math.round(8.9 * MB))).toBe('8.9\u00a0MB');
    expect(megabytes(31 * MB)).toBe('31\u00a0MB');
    expect(megabytes(Math.round(12.6 * MB))).toBe('13\u00a0MB');
    expect(megabytes(25 * MB)).toBe('25\u00a0MB');
    expect(megabytes(600)).toBe('0.1\u00a0MB');
  });

  it('never says a file over the limit is within it', () => {
    expect(megabytes(25 * MB + 1)).toBe('25.1\u00a0MB');
    expect(megabytes(Math.round(25.3 * MB))).toBe('25.3\u00a0MB');
    expect(megabytes(Math.round(25.6 * MB))).toBe('26\u00a0MB');
  });

  it('says one page, or its pages', () => {
    expect(readyLine(deck(9, { pageCount: 1, bytes: MB }))).toBe(
      `1 page · 1.0\u00a0MB · Added ${at('2026-10-06T15:00:00.000Z')}`,
    );
  });
});

describe('the rows, and where focus goes', () => {
  const made: Made[] = [{ key: 'upload-9', deck: deck(7, { title: 'Made here' }) }];

  it('lists this page’s uploads first, then the decks made here, then the list, each once', () => {
    const listed = deck(6, { title: 'Listed' });
    const rows = rowsOf([made[0].deck, listed, deck(5, { status: 'pending' })], made, [
      { ...UNIT3, deckId: deck(5, {}).id },
    ]);
    // The pending deck the upload is sending is that upload's row; the deck made here keeps its key.
    expect(rows.map((r) => r.key)).toEqual([UNIT3.key, 'upload-9', listed.id]);
  });

  it('keeps the uploads while the list loads or failed', () => {
    expect(rowsOf('loading', [], [LAB]).map((r) => r.key)).toEqual([LAB.key]);
    expect(rowsOf('failed', made, []).map((r) => r.key)).toEqual(['upload-9']);
  });

  it('moves focus to the next row’s button, else the one before’s', () => {
    expect(focusAfter(BOARD, UNIT2.id)).toEqual([
      `${idOf(PARABOLAS.id)}-act`,
      `${idOf(FACTORING.id)}-act`,
    ]);
    expect(focusAfter(BOARD, MIDTERM.id)).toEqual([`${idOf(LAB.key)}-act`]);
    expect(focusAfter(BOARD, 'gone')).toEqual([]);
  });
});

describe('the page’s wiring (app/slides/page.tsx)', () => {
  it('reads the list as it opens, signed in', () => {
    expect(page).toMatch(
      /if \(getAccessToken\(\)\) void read\(\);\s*else router\.replace\('\/login'\);/,
    );
    expect(page).toMatch(/setDecks\(answer\.kind === 'read' \? answer\.decks : 'failed'\)/);
  });

  it('stops every upload as the page closes, and draws nothing after', () => {
    expect(page).toMatch(
      /return \(\) => \{\s*open\.current = false;\s*for \(const upload of running\.values\(\)\) upload\.controller\.abort\(\);/,
    );
    expect(page).toMatch(/if \(!open\.current\) return;/);
  });

  it('judges a pick before anything is sent, and starts its upload at 0%', () => {
    expect(page).toMatch(/const judged = await judgePick\(file\);/);
    expect(page).toMatch(/void run\(key, newUpload\(file, judged\.title\)\);/);
    // Cleared, so the same file picked again is read again.
    expect(page).toMatch(/e\.currentTarget\.value = '';/);
  });

  it('removes a Cancel’s pending deck, or keeps it as unfinished if Bali didn’t hear', () => {
    expect(page).toMatch(
      /if \(at\.running\) at\.controller\.abort\(\);\s*else void cancelled\(key, at\.upload, at\.near\);/,
    );
    expect(page).toMatch(/removeDeck\(api, removeAttemptFor\(undefined, deck\.id\)\)/);
    expect(page).toMatch(
      /if \(deck && answer\?\.kind !== 'removed'\) \{\s*setMade\(\(m\) => \[\{ key, deck \}, \.\.\.m\]\);/,
    );
  });

  it('frees a stopped row’s buttons, and takes a cancelled or gone deck off the list (santa’s review)', () => {
    // A stop never follows a Cancel (`runUpload` ends it cancelled); the row's buttons are free.
    expect(page).toMatch(
      /state: \{ step: 'stopped', why: failure \?\? \{ kind: 'too_slow' \} \},\s*cancelling: false,/,
    );
    expect(page).toMatch(/if \(deck\) unlist\(deck\.id\);\s*show\(key, null\);/);
    expect(page).toMatch(/\} else if \(deckId\) unlist\(deckId\);/);
  });

  it('runs Try again on from where it stopped, or afresh once the API refused it', () => {
    expect(page).toMatch(/uploadAgain\(\{ failure: at\.failure, upload: at\.upload \}\)/);
  });

  it('turns a checked upload into its deck under the same key, so its line is said', () => {
    expect(page).toMatch(/setMade\(\(m\) => \[\{ key, deck: end\.deck \}, \.\.\.m\.filter/);
    // Its buttons went with the check: focus lost to the page comes back to the row's button at
    // every end of a run but a Cancel's (a verdict, a stop), else to the title (santa's review).
    expect(page).toMatch(
      /if \(end\.kind === 'cancelled'\) return void cancelled\(key, end\.upload, at\?\.near \?\? \[\]\);\s*(?:\/\/[^\n]*\n\s*)*if \(document\.activeElement === document\.body\) setFocus\(\[`\$\{idOf\(key\)\}-act`, TITLE\]\);\s*if \(end\.kind === 'checked' \|\| end\.kind === 'gone'\)/,
    );
  });

  it('sends a removal with no answer again under its id, and says a deck in use by its classes', () => {
    expect(page).toMatch(
      /const attempt = removeAttemptFor\(unremoved\.current\.get\(deckId\), deckId\);/,
    );
    expect(page).toMatch(
      /if \(answer\.kind === 'in_use'\) \{\s*removal\(deckId, null\);\s*showing\(deckId, answer\.classes\);/,
    );
  });
});
