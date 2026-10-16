import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/*
 * New class (PV16b): v2's dialog (ClassesNew), its states as HomeStates and ClassesStates draw them,
 * and once Bali makes the class, "<name> is ready" with its join code, Copy code and Done
 * (ClassesCreated, CopyStates). Rendered closed, as the page holds it; what needs a press (a send,
 * its answer, the made class) is read from the source, as the join code's dialog is.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined }) }));
const { NewClass, cardId } = await import('./new-class');
const source = readFileSync(fileURLToPath(new URL('./new-class.tsx', import.meta.url)), 'utf8');
const joinCode = readFileSync(fileURLToPath(new URL('./join-code.tsx', import.meta.url)), 'utf8');

const html = renderToStaticMarkup(createElement(NewClass, { onAnswer: () => undefined }));
/** A slice of the source, from one marker to the next. */
const between = (from: string, to: string) =>
  source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

describe('New class, the dialog (ClassesNew)', () => {
  it('is rendered closed, titled by its New class, only showModal opening it', () => {
    expect(html).toMatch(/^<dialog aria-labelledby="([^"]+)-title" class="[^"]*"><form /);
    expect(html).not.toMatch(/^<dialog[^>]*\sopen[\s=>]/);
    expect(html).toMatch(/<h2 id="[^"]+-title" class="text-dialog-title">New class<\/h2>/);
    // v2's dialog, the class page's New code's own: 460 px, 120 px down, over the warm backdrop.
    const dialog = /^<dialog [^>]*class="([^"]*)"/.exec(html)?.[1];
    expect(dialog).toBe(/export const DIALOG =\s*'([^']*)'/.exec(joinCode)?.[1]);
  });

  it('asks for the class’s name, its help under it, Create class held until a name is typed', () => {
    expect(html).toMatch(
      /<label for="([^"]+)-name" class="[^"]*">Class name<\/label><div class="mt-2"><div><input id="\1-name" maxLength="120" autoComplete="off" aria-describedby="\1-name-help" class="[^"]*\btext-input\b[^"]*" name="class-name" value=""\/><\/div><\/div><p id="\1-name-help" class="mt-2 text-caption text-text-tertiary">Your students see this name in the Bali app\.<\/p>/,
    );
    expect(html).toMatch(
      /<div class="flex flex-wrap justify-end gap-2\.5"><button type="button" aria-disabled="false" class="[^"]*\bborder-border-strong\b[^"]*">Cancel<\/button><button type="submit" aria-disabled="true" aria-busy="false" class="[^"]*\bbg-action-primary-bg\b[^"]*">Create class<\/button><\/div><\/form><\/dialog>$/,
    );
    expect(html).not.toContain('role="alert"');
  });

  it('opens with the name focused, and holds Cancel and Escape while a class is being made', () => {
    expect(source).toMatch(
      /open\(\) \{\s*dialog\.current\?\.showModal\(\);\s*field\.current\?\.focus\(\);\s*\}/,
    );
    expect(source).toMatch(
      /onCancel=\{\(e\) => \{[^}]*if \(sending\.current\) e\.preventDefault\(\);/,
    );
    expect(source).toMatch(
      /aria-disabled=\{busy\}\s*onClick=\{\(\) => \{\s*if \(!sending\.current\) dialog\.current\?\.close\(\);/,
    );
    expect(source).toMatch(/readOnly=\{busy\}/);
  });

  it('sends a name once, says Creating… and then what came back, Try again resending all but a final refusal', () => {
    const create = between('async function create', 'function closed');
    // An empty name sends nothing; a second press before the page redraws neither.
    expect(create.indexOf('if (sending.current || !trimmed) return;')).toBeGreaterThan(-1);
    expect(create.indexOf('if (sending.current || !trimmed) return;')).toBeLessThan(
      create.indexOf('await createClass(api, trimmed)'),
    );
    // Every answer has the page read the list again: a class made before its answer was lost
    // shows there (the route takes no eventId).
    expect(create).toMatch(
      /await createClass\(api, trimmed\);\s*sending\.current = false;\s*setBusy\(false\);\s*onAnswer\(\);/,
    );
    // Said in the dialog, opened again if the browser closed it meanwhile (a second Escape).
    expect(create).toMatch(
      /if \(dialog\.current && !dialog\.current\.open\) dialog\.current\.showModal\(\);\s*if \(answer\.kind === 'created'\) setMade\(answer\.klass\);\s*else setFailed\(answer\);/,
    );
    expect(source).toContain(
      "{busy ? 'Creating…' : failed?.kind === 'failed' ? 'Try again' : 'Create class'}",
    );
    expect(source).toMatch(
      /<Button type="submit" aria-disabled=\{busy \|\| !name\.trim\(\)\} aria-busy=\{busy\}>/,
    );
    // Its failure right under the help, as HomeStates and ClassesStates draw it, the field
    // described by it; typing again clears it.
    expect(source).toMatch(
      /\/>\s*\{failed \? \(\s*<p id=\{`\$\{id\}-said`\} role="alert" className="text-body text-pretty break-words">\s*\{failed\.message\}/,
    );
    expect(source).toMatch(/aria-describedby=\{failed \? `\$\{id\}-said` : undefined\}/);
    expect(source).toMatch(/setName\(e\.target\.value\);\s*setFailed\(null\);/);
  });
});

describe('a class made: "<name> is ready" (ClassesCreated, CopyStates)', () => {
  const ready = between('{made ? (', '<form onSubmit');

  it('turns the dialog into its join code with Copy code and Done, its title taking focus', () => {
    // The board's own check: 40 px at a 1.5 stroke, by a class (PV4b), in green-600.
    expect(ready).toMatch(
      /<CircleCheck size=\{40\} aria-hidden="true" className="stroke-\[1\.5\] text-ready" \/>/,
    );
    expect(ready).toMatch(
      /<h2\s*ref=\{title\}\s*id=\{`\$\{id\}-title`\}\s*tabIndex=\{-1\}\s*className="text-dialog-title wrap-anywhere"\s*>\s*\{made\.name\} is ready\s*<\/h2>/,
    );
    expect(ready).toMatch(
      /<p id=\{`\$\{id\}-line`\} className="-mt-2 text-body text-text-secondary">\s*Put this join code on the board\. Students join with it in the Bali app\.\s*<\/p>/,
    );
    expect(ready).toMatch(
      /<span translate="no" className=\{CODE\}>\s*\{made\.joinCode\}\s*<\/span>/,
    );
    expect(source).toMatch(/aria-describedby=\{made \? `\$\{id\}-line` : undefined\}/);
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*if \(made\) title\.current\?\.focus\(\);\s*\}, \[made\]\);/,
    );
    // Its parts at the start of the dialog, as the board aligns them; Done its whole width.
    expect(source).toMatch(/className=\{made \? `\$\{DIALOG\} items-start` : DIALOG\}/);
    expect(ready).toMatch(
      /<Button onClick=\{\(\) => dialog\.current\?\.close\(\)\} className="w-full">\s*Done\s*<\/Button>/,
    );
  });

  it('copies the code with the class page’s Copy, saying Copied or how to copy it by hand', () => {
    expect(source).toMatch(/const \{ copy, copyCode, forget \} = useCopy\(\);/);
    expect(ready).toMatch(/onClick=\{\(\) => void copyCode\(made\.joinCode\)\}/);
    expect(ready).toMatch(/\{copy === 'copied' \? 'Copied' : 'Copy code'\}/);
    expect(ready).toMatch(
      /<span role="status" className="sr-only">\s*\{copy === 'copied' \? 'Copied' : null\}/,
    );
    expect(ready).toMatch(
      /\{copy === 'failed' \? \(\s*<p role="alert" className="text-body">\s*\{CANT_COPY\}/,
    );
  });

  it('closed, gives focus to the class’s card on the list and starts the next New class afresh', () => {
    const closed = between('function closed', 'return (');
    expect(closed).toMatch(/if \(sending\.current\) return;/);
    expect(closed).toMatch(
      /if \(made\) document\.getElementById\(cardId\(made\.id\)\)\?\.focus\(\);\s*setName\(''\);\s*setFailed\(null\);\s*setMade\(null\);\s*forget\(\);/,
    );
    expect(source).toMatch(/onClose=\{closed\}/);
    expect(cardId('c1')).toBe('class-c1');
  });
});
