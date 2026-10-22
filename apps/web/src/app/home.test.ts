import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MeResponse } from '@bali/shared';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { Me } from '../components/shell';
import type { Home } from '../lib/student-web';

/*
 * Where the home sends each account (PV15; a student to their own home since W3; a teacher to v2's
 * Home since PV17a, whose view is home.test's in components/), and the invite page at `/invite`
 * (W3), rendered as the server first draws them, the shell's read of the account given; what needs
 * a clock or a press (the account read again at a bell, the greeting's turn, a redeem's focus) is
 * read from the source, as Classes' page is.
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

  it('a teacher: v2’s Home, the greeting heading it, no invite card (PV17a)', () => {
    const html = drawnFor({ kind: 'teacher', me: account('teacher') });
    expect(html).toMatch(
      /^<main class="flex flex-col gap-5\.5"><div><h1 tabindex="-1" class="text-greeting text-balance wrap-anywhere">Good (morning|afternoon|evening), Ana Rodríguez<\/h1>/,
    );
    // One page heading and one main: the shell's own main is gone once the account is read.
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).not.toContain('Enter your invite code');
  });

  it('an account the 13+ check never passed: the invite card under the bar, the line for students under it', () => {
    const html = drawnFor({ kind: 'invite' });
    expect(html).toMatch(
      /^<main class="[^"]*\bmin-h-\[calc\(100dvh-60px\)\][^"]*"><div class="[^"]*"><section aria-labelledby="[^"]*" class="[^"]*">.*<h1 [^>]*>Enter your invite code<\/h1>.*<\/section><p class="[^"]*">([^<]*)<\/p><\/div><\/main>$/,
    );
    expect(html).toContain(`>${STUDENTS_LINE}</p>`);
    // Neither a teacher's Home nor a student's.
    expect(html).not.toContain('Your classes');
    expect(html).not.toContain('Good ');
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

describe('a teacher’s Home, as the page runs it (PV17a)', () => {
  it('reads the account as it opens, and after a redeem gives the greeting focus', () => {
    expect(page).toMatch(
      /if \(!getAccessToken\(\)\) \{\s*router\.replace\('\/login'\);\s*return;\s*\}\s*load\(\);/,
    );
    expect(page).toMatch(/redeemed\.current = true;\s*load\(true\);/);
    expect(page).toMatch(
      /if \(!redeemed\.current \|\| home\?\.kind !== 'teacher'\) return;\s*redeemed\.current = false;\s*heading\.current\?\.focus\(\);/,
    );
    expect(page).toMatch(
      /<TeacherHome\s+ref=\{heading\}\s+me=\{home\.me\}\s+failed=\{error\}\s+now=\{now\}\s+onRead=\{\(\) => load\(\)\}\s+onRetry=\{refresh\}\s+\/>/,
    );
  });

  it('dates each answer as it lands, and redraws at a bell or the greeting’s turn, whichever comes first', () => {
    expect(page).toMatch(/useEffect\(\(\) => setNow\(Date\.now\(\)\), \[home\]\);/);
    expect(page).toMatch(/const bell = classes === null \? null : nextBell\(classes, now\);/);
    expect(page).toMatch(
      /if \(!teacher\) return;\s*const next = Math\.min\(bell \?\? Infinity, nextTurn\(now\)\);\s*const timer = window\.setTimeout\(\(\) => setNow\(Math\.max\(Date\.now\(\), next\)\), next - Date\.now\(\)\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[teacher, bell, now\]\);/,
    );
  });

  it('reads the clock afresh as the tab comes back into view, a timer having slept with the computer', () => {
    expect(page).toMatch(
      /const back = \(\) => \{\s*if \(document\.visibilityState === 'visible'\) setNow\(Date\.now\(\)\);\s*\};\s*document\.addEventListener\('visibilitychange', back\);\s*return \(\) => document\.removeEventListener\('visibilitychange', back\);\s*\}, \[\]\);/,
    );
  });

  it('reads the account again just after a live class’s bell, once per bell, as Classes does', () => {
    expect(page).toMatch(/const readAt = classes === null \? null : nextBell\(classes, 0\);/);
    expect(page).toMatch(
      /const timer = window\.setTimeout\(load, readAt \+ AFTER_BELL_MS - Date\.now\(\)\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[readAt, load\]\);/,
    );
  });

  it('makes no class itself: New class lives on Classes (#421)', () => {
    expect(page).not.toMatch(/createClass|New class name|<form/);
  });
});

describe('the block’s card', () => {
  it('offers Try again on the block’s register only for an answer that never came (PB5’s review)', () => {
    // A refusal, of the ID or a deleted account's (`final`), keeps the button's own words.
    const blocks = readFileSync(
      fileURLToPath(new URL('../components/blocks.tsx', import.meta.url)),
      'utf8',
    );
    // `TryAgain` as the send's own button: Try again only once a send of it failed.
    expect(blocks).toMatch(
      /send=\{\{\s*words: 'Register block',\s*sending: 'Registering…',\s*failed: said\?\.kind === 'failed',\s*\}\}/,
    );
  });
});
