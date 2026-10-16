import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MeResponse } from '@bali/shared';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { Me } from '../components/shell';
import * as errors from '../lib/errors';
import type { Home } from '../lib/student-web';

/*
 * The classes home's create row (the approved Classes home design), read from the source as the
 * invite-code screen's test reads its own: the page needs a browser to reach it. An empty name
 * leaves Create disabled and says nothing (Phase 2's behaviour; the design draws no line for it);
 * a made class is said by the list, read again, never a line of its own (D2e's "is ready" went).
 * And where the home sends each account (PV15; a student to their own home since W3), and the
 * invite page at `/invite` (W3), rendered as the server first draws them, the shell's read of the
 * account given.
 */
const page = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

const shell = vi.hoisted((): { me: unknown } => ({ me: null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
vi.mock('@/components/shell', () => ({ useMe: () => shell.me }));
const { default: HomePage } = await import('./page');
const { default: InviteRoute } = await import('./invite/page');

/** A page as it first draws for an account the shell read as `home`. */
function drawnFor(home: Home | null, Page: () => ReactNode = HomePage): string {
  const me: Me = {
    home,
    me: home === null || home.kind === 'invite' ? null : home.me,
    error: null,
    load: () => undefined,
    refresh: () => Promise.resolve(),
  };
  shell.me = me;
  return renderToStaticMarkup(createElement(Page));
}
const account = (role: 'teacher' | 'student'): MeResponse => ({
  user: { id: 'u1', role, displayName: 'Ana Rodríguez' },
  classes: [],
  session: null,
  armed: false,
});
const STUDENTS_LINE =
  'Here as a student? Set up Bali in the app on your iPhone first, then refresh this page.';

describe('the home sends each account where it belongs (PV15; decision 13)', () => {
  it('draws nothing of its own before the account is read: the shell says Loading… or its failure', () => {
    expect(drawnFor(null)).toBe('');
  });

  it('a teacher: their classes, no invite card', () => {
    const html = drawnFor({ kind: 'teacher', me: account('teacher') });
    expect(html).toMatch(/<h1 [^>]*>Your classes<\/h1>/);
    expect(html).not.toContain('Enter your invite code');
  });

  it('an account the 13+ check never passed: the invite card under the bar, the line for students under it', () => {
    const html = drawnFor({ kind: 'invite' });
    expect(html).toMatch(
      /^<main class="[^"]*\bmin-h-\[calc\(100dvh-60px\)\][^"]*"><div class="[^"]*"><section aria-labelledby="[^"]*" class="[^"]*">.*<h1 [^>]*>Enter your invite code<\/h1>.*<\/section><p class="[^"]*">([^<]*)<\/p><\/div><\/main>$/,
    );
    expect(html).toContain(`>${STUDENTS_LINE}</p>`);
    expect(html).not.toContain('Your classes');
  });

  it('a student who said 13+ in the app: their own home, their classes, never the invite card (W3)', () => {
    const html = drawnFor({ kind: 'student', me: account('student') });
    expect(html).toMatch(
      /^<main class="flex flex-col gap-5\.5"><div><h1 class="text-page-title">Your classes<\/h1>/,
    );
    // In no class yet, as this account is: the empty card, and a teacher's way to the invite page.
    expect(html).toContain('You&#x27;re not in a class yet');
    expect(html).toMatch(/href="\/invite">Enter your invite code<\/a>/);
    expect(html).not.toContain('Enter your invite code</h1>');
    expect(html).not.toContain('Here as a student');
  });
});

describe('the invite page at /invite, where a student’s home sends a teacher who set up the app first (W3)', () => {
  it('a student who said 13+ in the app: the invite card, never told to set up the app again', () => {
    const html = drawnFor({ kind: 'student', me: account('student') }, InviteRoute);
    expect(html).toMatch(
      /^<main class="[^"]*\bmin-h-\[calc\(100dvh-60px\)\][^"]*"><div class="[^"]*"><section aria-labelledby="[^"]*" class="[^"]*">.*<h1 [^>]*>Enter your invite code<\/h1>.*<\/section><\/div><\/main>$/,
    );
    expect(html).not.toContain('Here as a student');
  });

  it('an account the 13+ check never passed: the page Home shows it, its line for students under the card', () => {
    // The same markup, but for the ids React mints per tree.
    const ids = (html: string) => html.replace(/_R_\w+_/g, 'id');
    const html = drawnFor({ kind: 'invite' }, InviteRoute);
    expect(ids(html)).toBe(ids(drawnFor({ kind: 'invite' })));
    expect(html).toContain(`>${STUDENTS_LINE}</p>`);
  });

  it('draws nothing before the account is read, nor for a teacher, whom it sends to their classes', () => {
    expect(drawnFor(null, InviteRoute)).toBe('');
    expect(drawnFor({ kind: 'teacher', me: account('teacher') }, InviteRoute)).toBe('');
    const route = readFileSync(
      fileURLToPath(new URL('./invite/page.tsx', import.meta.url)),
      'utf8',
    );
    expect(route).toMatch(
      /useEffect\(\(\) => \{\s*if \(home\?\.kind === 'teacher'\) router\.replace\('\/'\);\s*\}, \[home, router\]\);/,
    );
    // A redeem here reads the account afresh, as Home's does, so the classes come with the menu.
    expect(route).toContain('onTeacher={() => load(true)}');
    expect(route).not.toMatch(/['"`]\/v1\//);
  });
});

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
    // What the row does say: a create's failure, under the field, and Try again on its button,
    // but after a final refusal (a deleted account), which no resend can change (PB5's review).
    expect(page).toContain(
      "{busy ? 'Creating…' : failed?.kind === 'failed' ? 'Try again' : 'Create class'}",
    );
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

  it('offers Try again on the block’s register only for an answer that never came (PB5’s review)', () => {
    // A refusal, of the ID or a deleted account's (`final`), keeps the button's own words.
    const blocks = readFileSync(
      fileURLToPath(new URL('../components/blocks.tsx', import.meta.url)),
      'utf8',
    );
    expect(blocks).toContain(
      "{busy ? 'Registering…' : said?.kind === 'failed' ? 'Try again' : 'Register block'}",
    );
  });
});
