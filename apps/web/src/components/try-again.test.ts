import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { handOff, land, TryAgain } from './try-again';

/*
 * Try again, one for every read in the portal (the owner's follow-up of 2026-10-16): it held in
 * place on the account's card only (PV17a), and everywhere else it went as its read started, so
 * keyboard focus fell to the page's body. Here: one button throughout, held as Loading… while its
 * read runs, so focus stays on it; its line said again at each failure; and once the read lands and
 * its failure goes, focus lands in the region, never on the body. The repo renders no DOM in its
 * tests, so focus is driven here through `handOff` and `land` with a page of their own.
 */
const source = readFileSync(fileURLToPath(new URL('./try-again.tsx', import.meta.url)), 'utf8');

const LINE = createElement('p', { role: 'alert', className: 'text-body' }, 'Couldn’t load it.');
const render = (props: Partial<Parameters<typeof TryAgain>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(TryAgain, { onRetry: () => undefined, then: [], children: LINE, ...props }),
  );

describe('Try again, as drawn', () => {
  it('is one small secondary button saying Try again, after its failure’s own line', () => {
    expect(render()).toMatch(
      /^<p role="alert" class="text-body">Couldn’t load it\.<\/p><button type="button" aria-disabled="false" aria-busy="false" class="[^"]*\bh-8\.5\b[^"]*\bborder-border-strong\b[^"]*">Try again<\/button>$/,
    );
  });

  it('holds as Loading… while its read runs (HomeInterimStates), focusable all the same: never disabled', () => {
    const held = render({ held: true });
    expect(held).toMatch(
      /<button type="button" aria-disabled="true" aria-busy="true" class="[^"]*\baria-disabled:opacity-55\b[^"]*">Loading…<\/button>$/,
    );
    // `disabled` would drop focus to the body, the very thing it holds against.
    expect(held).not.toMatch(/\sdisabled=""/);
  });

  it('comes full size where its failure is a card’s, in its place', () => {
    expect(render({ size: 'md', className: 'mt-3.5' })).toMatch(
      /<button type="button" aria-disabled="false" aria-busy="false" class="[^"]*\bh-10\b[^"]*\bmt-3\.5\b[^"]*">Try again<\/button>$/,
    );
  });
});

describe('Try again as a send’s own button (Register block, Make new code)', () => {
  const send = (failed: boolean, held = false) =>
    render({
      held,
      children: undefined,
      send: { words: 'Make new code', sending: 'Making…', failed },
    });

  it('says its send’s words until one fails, and Try again once one did, its line drawn apart', () => {
    expect(send(false)).toMatch(
      /^<button type="button" aria-disabled="false" aria-busy="false" class="[^"]*">Make new code<\/button>$/,
    );
    expect(send(true)).toMatch(
      /^<button type="button" aria-disabled="false" aria-busy="false" class="[^"]*">Try again<\/button>$/,
    );
  });

  it('says its own sending word while one is on its way, a resend too, held and never disabled', () => {
    for (const failed of [false, true]) {
      const held = send(failed, true);
      expect(held).toMatch(
        /<button type="button" aria-disabled="true" aria-busy="true" [^>]*>Making…<\/button>$/,
      );
      expect(held).not.toMatch(/\sdisabled=""/);
    }
  });

  it('is its form’s submit, in its form’s look: Enter in the field presses it', () => {
    expect(
      render({
        type: 'submit',
        variant: 'primary',
        size: 'md',
        children: undefined,
        send: { words: 'Register block', sending: 'Registering…', failed: false },
      }),
    ).toMatch(
      /^<button type="submit" aria-disabled="false" aria-busy="false" class="[^"]*\bh-10\b[^"]*\bbg-action-primary-bg\b[^"]*">Register block<\/button>$/,
    );
  });
});

describe('Try again, pressed', () => {
  it('reads again once, holding while the read’s promise runs, and never twice at once', () => {
    // A press while held sends nothing: its read is on its way.
    expect(source).toMatch(
      /function press\(\) \{\s*if \(busy\) return;\s*const answer = onRetry\(\);\s*if \(!\(answer instanceof Promise\)\) return;\s*setWaiting\(true\);\s*const done = \(\) => setWaiting\(false\);\s*answer\.then\(done, done\);\s*\}/,
    );
    expect(source).toMatch(/const busy = held \|\| waiting;/);
    expect(source).toMatch(
      /\{busy \? \(send\?\.sending \?\? 'Loading…'\) : !send \|\| send\.failed \? 'Try again' : send\.words\}/,
    );
  });

  it('says its line again at each answer that leaves the failure standing, a new element each time', () => {
    expect(source).toMatch(
      /if \(was !== busy\) \{\s*setWas\(busy\);\s*if \(!busy\) setSaid\(\(n\) => n \+ 1\);\s*\}/,
    );
    expect(source).toMatch(/<Fragment key=\{said\}>\{children\}<\/Fragment>/);
  });

  it('hands focus on as it goes with its failure, from the moment it goes, so never to the body', () => {
    // A layout effect's cleanup runs while the button is still in the page: what had focus is known.
    expect(source).toMatch(
      /useLayoutEffect\(\(\) => \{\s*const el = button\.current;\s*return \(\) => handOff\(el, \(\) => where\.current\);\s*\}, \[\]\);/,
    );
  });
});

/** The page `handOff` reads and moves focus in. */
type Page = NonNullable<Parameters<typeof handOff>[2]>;

/**
 * A page of its own for focus: elements by id, its `main`'s heading and first control, which of them
 * has focus (`active`, the body to start with), each focus moved, in order, and the tabindex each
 * was given. A heading (`h1`, or an id in `headings`) can't take focus until it has one.
 */
function page({
  ids = [] as string[],
  headings = [] as string[],
  heading = false,
  tabbed = [] as string[],
  control = false,
}) {
  const focused: string[] = [];
  const body = { name: 'body' };
  let active: object | null = body;
  const tabindex = new Map<string, string>(tabbed.map((name) => [name, '-1']));
  const element = (name: string) => {
    const el = {
      name,
      matches: () => !(name === 'h1' || headings.includes(name)) || tabindex.has(name),
      set tabIndex(value: number) {
        tabindex.set(name, String(value));
      },
      focus: () => {
        focused.push(name);
        active = el;
      },
    };
    return el;
  };
  const doc = {
    get activeElement() {
      return active;
    },
    body,
    getElementById: (id: string) => (ids.includes(id) ? element(id) : null),
    querySelector: (selector: string) =>
      selector === 'main h1' && heading
        ? element('h1')
        : selector.startsWith('main :is(') && control
          ? element('first control')
          : null,
  };
  return {
    doc: doc as unknown as Page,
    focused,
    tabindex,
    /** Focus somewhere: on Try again as it is pressed, the body once it goes, or anywhere else. */
    on: (el: object | null) => {
      active = el;
    },
    body,
  };
}

/** Frames held until `run`: what the page has drawn by then is what focus can land on. */
function frames() {
  const queued: (() => void)[] = [];
  return {
    frame: (run: () => void) => void queued.push(run),
    run: () => queued.splice(0).forEach((f) => f()),
  };
}

const BUTTON = { name: 'Try again' } as unknown as Element;

describe('where focus lands once the read is in (`land`)', () => {
  it('on the first of its ids the page has: the region’s heading, else what is there instead', () => {
    const { doc, focused, tabindex } = page({ ids: ['yours', 'greeting'] });
    land(doc, ['gone', 'yours', 'greeting']);
    expect(focused).toEqual(['yours']);
    // A control takes focus as it is.
    expect([...tabindex]).toEqual([]);
  });

  it('on a heading, given tabindex -1 to take it, as a heading focus is moved to is', () => {
    const { doc, focused, tabindex } = page({ ids: ['yours'], headings: ['yours'] });
    land(doc, ['yours']);
    expect(focused).toEqual(['yours']);
    expect([...tabindex]).toEqual([['yours', '-1']]);
  });

  it('with none of its ids there, on the page’s own heading, made able to take it', () => {
    const { doc, focused, tabindex } = page({ heading: true, control: true });
    land(doc, ['gone']);
    expect(focused).toEqual(['h1']);
    expect([...tabindex]).toEqual([['h1', '-1']]);
  });

  it('keeps a heading’s own tabindex, which takes focus as it is', () => {
    const { doc, focused, tabindex } = page({ heading: true, tabbed: ['h1'] });
    land(doc, []);
    expect(focused).toEqual(['h1']);
    expect([...tabindex]).toEqual([['h1', '-1']]);
  });

  it('with no heading, on the page’s first control; with nothing, nowhere, never a throw', () => {
    const controls = page({ control: true });
    land(controls.doc, []);
    expect(controls.focused).toEqual(['first control']);
    const bare = page({});
    expect(() => land(bare.doc, ['gone'])).not.toThrow();
    expect(bare.focused).toEqual([]);
  });
});

describe('focus as Try again goes (`handOff`)', () => {
  it('with focus on it, once the page has drawn what took its place, lands focus there', () => {
    const { doc, focused, on, body } = page({ ids: ['h'] });
    on(BUTTON);
    const { frame, run } = frames();
    handOff(BUTTON, () => ['h'], doc, frame);
    // Not yet: the page hasn't drawn it. Removed, the button left focus on the body.
    expect(focused).toEqual([]);
    on(body);
    run();
    expect(focused).toEqual(['h']);
  });

  it('lands it as well where the browser still names the button gone, or nothing', () => {
    for (const after of [BUTTON, null]) {
      const { doc, focused, on } = page({ ids: ['h'] });
      on(BUTTON);
      const { frame, run } = frames();
      handOff(BUTTON, () => ['h'], doc, frame);
      on(after);
      run();
      expect(focused).toEqual(['h']);
    }
  });

  it('reads where to land as the frame comes: the page’s latest word', () => {
    const { doc, focused, on, body } = page({ ids: ['first', 'second'] });
    on(BUTTON);
    let then = ['first'];
    const { frame, run } = frames();
    handOff(BUTTON, () => then, doc, frame);
    then = ['second'];
    on(body);
    run();
    expect(focused).toEqual(['second']);
  });

  it('does nothing when focus was elsewhere as it went: a mouse user’s page is left as it is', () => {
    const { doc, focused } = page({ ids: ['h'] });
    const { frame, run } = frames();
    handOff(BUTTON, () => ['h'], doc, frame);
    run();
    expect(focused).toEqual([]);
  });

  it('never takes focus from where the page moved it itself meanwhile', () => {
    const { doc, focused, on } = page({ ids: ['h'] });
    on(BUTTON);
    const { frame, run } = frames();
    handOff(BUTTON, () => ['h'], doc, frame);
    on({ name: 'a panel’s title' });
    run();
    expect(focused).toEqual([]);
  });

  it('does nothing for a button never drawn', () => {
    const { doc } = page({ ids: ['h'] });
    const frame = vi.fn();
    handOff(null, () => ['h'], doc, frame);
    expect(frame).not.toHaveBeenCalled();
  });
});

describe('every read’s Try again in the portal is this one', () => {
  const src = fileURLToPath(new URL('../', import.meta.url));
  /** The portal's own source files under src/, tests left out. */
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
    });
  /** A button of its own saying Try again (JSX's text), or one that says it among its words. */
  const DRAWN = />\s*Try again\s*</;
  const SAID = /'Try again'/;

  it('draws no Try again of its own in a file this step moved onto it', () => {
    for (const file of MOVED) {
      const text = readFileSync(join(src, file), 'utf8');
      expect(text, file).not.toMatch(DRAWN);
      expect(text, file).toMatch(/<TryAgain\b/);
    }
    expect(readFileSync(join(src, 'components/shell.tsx'), 'utf8')).not.toMatch(SAID);
  });

  it('adds none of its own anywhere: each left is its own step’s', () => {
    const left = sources(src)
      .filter((file) => !file.endsWith(`${sep}try-again.tsx`))
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return DRAWN.test(text) || SAID.test(text);
      })
      .map((file) => relative(src, file).split(sep).join('/'))
      .sort();
    expect(left).toEqual(LEFT);
  });
});

/**
 * Home and Classes whole (the account's card, your classes, the live card, Recent activity, Last
 * session, your block and Register block), the live grid's own line (the class page's and
 * Present's), and the student's home; then the class page's own lines (its class and roster, an
 * extend's), the recap, the student panel, New code's Make new code, Reports, a session's report
 * and its Questions.
 */
const MOVED = [
  'app/classes/[id]/page.tsx',
  'components/blocks.tsx',
  'components/classes.tsx',
  'components/home.tsx',
  'components/join-code.tsx',
  'components/live-grid.tsx',
  'components/recap-card.tsx',
  'components/report-questions.tsx',
  'components/reports-list.tsx',
  'components/session-report.tsx',
  'components/shell.tsx',
  'components/student-home.tsx',
  'components/student-panel.tsx',
];

/**
 * The Try agains `TryAgain` doesn't draw yet, each settled in a step of its own: a read's failure
 * elsewhere, and a send's (the one button that sends saying it, as Create class and the invite
 * code do; or under its line, as an upload's, a slide change's, an ask's, a close's and a save's
 * do). A new one fails the test above.
 */
const LEFT = [
  'components/ask-panel.tsx',
  'components/decks-panel.tsx',
  'components/invite-code.tsx',
  'components/new-class.tsx',
  'components/question-card.tsx',
  'components/saved-questions.tsx',
  'components/slide-card.tsx',
  'components/slides.tsx',
  'components/student-lesson.tsx',
];
