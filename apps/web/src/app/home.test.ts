import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as errors from '../lib/errors';

/*
 * The classes home's create row (the approved Classes home design), read from the source as the
 * invite-code screen's test reads its own: the page needs a browser to reach it. An empty name
 * leaves Create disabled and says nothing (Phase 2's behaviour; the design draws no line for it);
 * a made class is said by the list, read again, never a line of its own (D2e's "is ready" went).
 */
const page = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

describe('the classes home’s create row', () => {
  it('disables Create while the name is empty, and sends nothing for one', () => {
    const button = /<Button type="submit"[^>]*>/.exec(page)?.[0] ?? '';
    expect(button).toContain('aria-disabled={busy || !name.trim()}');
    const guard = page.indexOf('if (sending.current || !trimmed) return;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(page.indexOf('await createClass('));
  });

  it('says nothing for an empty name, and nothing for a made class but the list', () => {
    expect(Object.keys(errors)).not.toContain('NO_CLASS_NAME');
    expect(page).not.toMatch(/Enter a name|is ready/);
    // What the row does say: a create's failure, under the field, and Try again on its button.
    expect(page).toContain("{busy ? 'Creating…' : failed ? 'Try again' : 'Create class'}");
    // The list says a made class out loud too: it sits in a polite live region, the empty line
    // with it, so a first class replacing that line is heard as well; the form stays outside it,
    // its failure already an alert of its own.
    const live = page.indexOf('<div aria-live="polite">');
    const end = page.indexOf('</div>', page.indexOf('</ul>'));
    expect(live).toBeGreaterThan(-1);
    for (const inside of ['No classes yet.', '{me.classes.map(']) {
      expect(page.indexOf(inside), inside).toBeGreaterThan(live);
      expect(page.indexOf(inside), inside).toBeLessThan(end);
    }
    expect(page.indexOf('<form')).toBeGreaterThan(end);
  });
});
