import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MeResponse } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createApiClient, NetworkError } from '../lib/api-client';
import { CANT_REACH } from '../lib/errors';
import type { Home } from '../lib/student-web';
import {
  AccountUnread,
  accountStep,
  frameFor,
  initials,
  PAGE,
  readAccount,
  reloadOnRestore,
  Shell,
  SideMenu,
} from './shell';

/*
 * The shell (PV5): v2's side menu on a teacher's signed-in pages, built to the canvas's teacher
 * boards, StudentZoom's bar and PV1's phone and no-name boards, under the owner's rulings of
 * 2026-10-13 (no menu in Present; nothing shown from an account that left; the menu only once the
 * account reads as a teacher). Which frame a page gets, what happens to the account as pages change
 * and the back button restores one, and, rendered, the menu's items, the page it marks, its foot
 * with and without a name, its bar under 776 px and its three rows under 640 px, and the page beside
 * it. And how the account is read (PV5b, the owner's approval of #352's review): Loading… in the
 * page's place until it answers, its failure there with Try again, read again on the next page,
 * and only the newest read's answer counts; the 13+ check read before `/v1/me`, which makes the
 * account, and a tab with no sign-in sent to /login (PV15). And a student's menu, Your classes and
 * Help, for an account that said 13+ in the app, the invite page at /invite under the bar (W3).
 */
const nav = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

function account(role: 'teacher' | 'student'): MeResponse {
  return {
    user: { id: 'u1', role, displayName: 'Ms. Rivera' },
    classes: [],
    session: null,
    armed: false,
  };
}

/** Where the home sends a teacher, a student who passed the 13+ check, or anyone else. */
const homeOf = (kind: Home['kind']): Home =>
  kind === 'invite' ? { kind } : { kind, me: account(kind) };

const menu = (over: Partial<Parameters<typeof SideMenu>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SideMenu, {
      role: 'teacher',
      path: '/',
      name: 'Ms. Rivera',
      leaving: false,
      onSignOut: () => undefined,
      ...over,
    }),
  );

/** Each link: where it goes, its words, whether it is marked the page open, its classes. */
const links = (html: string) =>
  [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map(([, attrs = '', inner = '']) => ({
    href: /\bhref="([^"]*)"/.exec(attrs)?.[1],
    text: inner.replace(/<[^>]+>/g, ''),
    current: /\baria-current="page"/.test(attrs),
    classes: /\bclass="([^"]*)"/.exec(attrs)?.[1]?.split(' ') ?? [],
  }));

/** The classes of the first element whose opening tag matches. */
const classesOf = (html: string, tag: RegExp) =>
  /\bclass="([^"]*)"/.exec(tag.exec(html)?.[0] ?? '')?.[1]?.split(' ') ?? [];

const NONE = { chrome: null, framed: false, hidden: false };
const MENU = { chrome: 'menu', framed: true, hidden: false };

describe('what frames a page', () => {
  it('draws nothing on a page read without signing in: each has its own bar', () => {
    for (const path of ['/login', '/auth/callback', '/support', '/privacy', '/terms']) {
      expect(frameFor(path, homeOf('teacher'), null, false), path).toEqual(NONE);
    }
  });

  it('draws the side menu for a teacher, the page beside it in v2’s frame', () => {
    for (const path of ['/', '/classes/c1', '/reports']) {
      expect(frameFor(path, homeOf('teacher'), null, false), path).toEqual(MENU);
    }
  });

  it('draws no menu or frame on the projector, as ClassPresent draws it (the owner, 2026-10-13)', () => {
    expect(frameFor('/classes/c1', homeOf('teacher'), null, true)).toEqual(NONE);
    // Whether or not the account is read yet: a reload in Present comes back without the menu.
    expect(frameFor('/classes/c1', null, null, true)).toEqual(NONE);
  });

  it('draws no menu or bar while the account is read, so none flashes for anyone; the page waits (the owner, 2026-10-13)', () => {
    for (const path of ['/', '/classes/c1', '/reports']) {
      expect(frameFor(path, null, null, false), path).toEqual({
        chrome: null,
        framed: false,
        hidden: true,
      });
    }
  });

  it('draws the bar for an account the 13+ check never passed, never the menu; the invite page frames itself', () => {
    for (const path of ['/', '/invite']) {
      expect(frameFor(path, homeOf('invite'), null, false), path).toEqual({
        chrome: 'bar',
        framed: false,
        hidden: false,
      });
    }
    expect(frameFor('/classes/c1', homeOf('invite'), null, false)).toEqual({
      chrome: 'bar',
      framed: true,
      hidden: false,
    });
  });

  it('draws the side menu for a student who said 13+ in the app, their home in v2’s frame; the invite page under the bar (W3)', () => {
    for (const path of ['/', '/reports', '/classes/c1', '/no-such-page']) {
      expect(frameFor(path, homeOf('student'), null, false), path).toEqual(MENU);
    }
    // Help is its own page with its own bar, for a student as for a teacher.
    expect(frameFor('/support', homeOf('student'), null, false)).toEqual(NONE);
    // Their home's "Setting up a teacher account?" opens the Invite board's page, as drawn.
    expect(frameFor('/invite', homeOf('student'), null, false)).toEqual({
      chrome: 'bar',
      framed: false,
      hidden: false,
    });
    // A teacher there has the menu, and the page sends them to their classes.
    expect(frameFor('/invite', homeOf('teacher'), null, false)).toEqual(MENU);
  });

  it('says a failed read in the page’s place under the bar, with Sign out, on every page (#352’s review)', () => {
    // A class page under a failed read showed itself with no menu and nothing said: the page waits
    // for the account on every page, its failure said where the page would be (`AccountUnread`).
    for (const path of ['/', '/classes/c1', '/reports']) {
      expect(frameFor(path, null, CANT_REACH, false), path).toEqual({
        chrome: 'bar',
        framed: false,
        hidden: true,
      });
    }
  });
});

describe('the account as pages change (the owner, 2026-10-13)', () => {
  const teacher = homeOf('teacher');

  it('is forgotten once the sign-in is gone, so going back never shows it', () => {
    // A Sign out and an expired session both land on /login, the token gone.
    expect(accountStep('/login', false, teacher, null, false, true)).toBe('forget');
    expect(accountStep('/login', false, homeOf('invite'), null, false, true)).toBe('forget');
    expect(accountStep('/login', false, null, CANT_REACH, false, true)).toBe('forget');
    // An answer that lands after the Sign out is forgotten too.
    expect(accountStep('/', false, teacher, null, false, false)).toBe('forget');
    expect(accountStep('/login', false, null, null, false, true)).toBe('keep');
  });

  it('sends a tab with no sign-in on a signed-in page to /login, a URL with no page too (PV5b’s review)', () => {
    // A URL with no page has no page of its own to send it there: the shell said Loading… for ever.
    for (const path of ['/no-such-page', '/classes/c1/nothing', '/', '/classes/c1', '/reports']) {
      expect(accountStep(path, false, null, null, false, true), path).toBe('sign in');
    }
    // Never from a page read without signing in, the sign-in page itself among them.
    for (const path of ['/login', '/auth/callback', '/support', '/privacy', '/terms']) {
      expect(accountStep(path, false, null, null, false, true), path).toBe('keep');
    }
    // What the tab still holds is forgotten first, as it is on /login.
    expect(accountStep('/no-such-page', false, teacher, null, false, true)).toBe('forget');
    // Signed in, a URL with no page reads the account like any page, its frame the account's.
    expect(accountStep('/no-such-page', true, null, null, false, true)).toBe('read');
  });

  it('is read once on a signed-in page, and kept as pages change, Help included', () => {
    expect(accountStep('/classes/c1', true, null, null, false, true)).toBe('read');
    expect(accountStep('/classes/c1', true, null, null, true, true)).toBe('keep');
    expect(accountStep('/classes/c1', true, teacher, null, false, true)).toBe('keep');
    expect(accountStep('/support', true, teacher, null, false, true)).toBe('keep');
    expect(accountStep('/support', true, null, null, false, true)).toBe('keep');
  });

  it('is read again after a failure on the next page opened, never again on its own page (#352’s review)', () => {
    // A failed read used to wait for Home, so a class page kept no menu until the teacher went
    // there: any page opened next reads it again, as Try again does on the page it failed on.
    for (const path of ['/', '/classes/c1', '/reports']) {
      expect(accountStep(path, true, null, CANT_REACH, false, true), path).toBe('read');
    }
    // A later read of a known account that failed (Home's list after a create) too.
    expect(accountStep('/classes/c1', true, teacher, CANT_REACH, false, true)).toBe('read');
    // Its own page, as the failure lands: kept, said with Try again, never a loop of reads.
    expect(accountStep('/classes/c1', true, null, CANT_REACH, false, false)).toBe('keep');
    // Never a second read beside one under way, nor on a page read without signing in.
    expect(accountStep('/classes/c1', true, null, CANT_REACH, true, true)).toBe('keep');
    expect(accountStep('/support', true, null, CANT_REACH, false, true)).toBe('keep');
  });

  it('reloads every signed-in page the back button restores whole, whoever is signed in now', () => {
    // Its account may have signed out, expired, or given way to another sign-in in this tab.
    expect(reloadOnRestore(true, '/')).toBe(true);
    expect(reloadOnRestore(true, '/classes/c1')).toBe(true);
    expect(reloadOnRestore(false, '/')).toBe(false);
    expect(reloadOnRestore(true, '/login')).toBe(false);
    expect(reloadOnRestore(true, '/support')).toBe(false);
  });
});

describe('the shell’s wiring of the rulings (read from its source)', () => {
  const shell = read('./shell.tsx');

  it('frames the page by Present, the account and its failure', () => {
    expect(shell).toMatch(/const frame = frameFor\(path, home, error, presenting\);/);
    // A page's usePresenting reaches the shell's own state, on and back off.
    expect(shell).toMatch(/const \[presenting, setPresenting\] = useState\(false\);/);
    expect(shell).toMatch(/<PresentingContext value=\{setPresenting\}>/);
    expect(shell).toMatch(
      /useEffect\(\(\) => \{\s*setPresenting\(on\);\s*return \(\) => setPresenting\(false\);\s*\}, \[on, setPresenting\]\);/,
    );
  });

  it('reads, keeps or forgets the account, or signs the tab in, as accountStep says, on every page and every answer', () => {
    // A new page is one the effect hasn't seen yet: the same page's answers never read again.
    expect(shell).toMatch(
      /const newPage = seen\.current !== path;\s*seen\.current = path;\s*const signedIn = getAccessToken\(\) !== null;\s*const step = accountStep\(path, signedIn, home, error, reading\.current, newPage\);\s*if \(step === 'read'\) load\(\);\s*if \(step === 'sign in'\) router\.replace\('\/login'\);\s*if \(step === 'forget'\) \{\s*setHome\(null\);\s*setError\(null\);\s*\}\s*\}, \[path, home, error, load, router\]\);/,
    );
  });

  it('reads again for the student home’s 30 s only when no read is on its way, its failure kept until an answer, so it isn’t said afresh each time (the owner, 2026-10-16)', () => {
    expect(shell).toMatch(
      /const refresh = useCallback\(async \(\) => \{\s*if \(reading\.current\) return;\s*reading\.current = true;\s*const limited = \{ get: <T,>\(path: string\) => api\.get<T>\(path, POLL_TIMEOUT_MS\) \};\s*const said = await readAccount\(limited, reads\);\s*\/\/ A newer read is under way: its answer is the one that counts\.\s*if \(said === null\) return;\s*reading\.current = false;\s*if \('home' in said\) \{\s*setHome\(said\.home\);\s*setError\(null\);\s*\} else setError\(said\.error\);\s*\}, \[api\]\);/,
    );
    // Every read sets `reading` as it starts, the shell's own (`load`) too.
    expect(shell).toMatch(
      /setError\(null\);\s*reading\.current = true;\s*void readAccount\(api, reads\)/,
    );
  });

  it('applies only the newest read’s answer, so a past failure never shows over fresh data (#352’s review)', () => {
    expect(shell).toMatch(
      /void readAccount\(api, reads\)\.then\(\(said\) => \{\s*\/\/ A newer read is under way: its answer is the one that counts\.\s*if \(said === null\) return;\s*reading\.current = false;\s*if \('home' in said\) setHome\(said\.home\);\s*else setError\(said\.error\);\s*\}\);/,
    );
  });

  it('reads the account as the home does, the 13+ check first, and never /v1/me itself (PV15)', () => {
    expect(shell).toMatch(/said = \{ home: await homeFor\(api\) \};/);
    expect(shell).not.toMatch(/['"]\/v1\/me['"?]/);
    // The menu names the account `/v1/me` read, none for one the check never let it read.
    expect(shell).toMatch(
      /const me = home === null \|\| home\.kind === 'invite' \? null : home\.me;\s*const value = useMemo\(\s*\(\) => \(\{ home, me, error, load, refresh \}\),\s*\[home, me, error, load, refresh\],\s*\);/,
    );
    expect(shell).toMatch(/name=\{me\?\.user\.displayName\?\.trim\(\) \|\| null\}/);
    // A student's menu once the account reads as one, a teacher's otherwise (W3).
    expect(shell).toMatch(/role=\{home\?\.kind === 'student' \? 'student' : 'teacher'\}/);
  });

  it('says the account unread in the page’s place, Try again reading it again (#352’s review)', () => {
    expect(shell).toMatch(
      /\{frame\.hidden \? <AccountUnread error=\{error\} onRetry=\{\(\) => load\(\)\} \/> : null\}\s*<div hidden=\{frame\.hidden\}/,
    );
  });

  it('reloads a page the browser kept whole as reloadOnRestore says', () => {
    expect(shell).toMatch(
      /const back = \(e: PageTransitionEvent\) => \{\s*if \(reloadOnRestore\(e\.persisted, window\.location\.pathname\)\) window\.location\.reload\(\);\s*\};\s*window\.addEventListener\('pageshow', back\);/,
    );
  });
});

describe('the avatar’s initials', () => {
  it('are the first letter of the name’s first two words, as v2 drew them, in any script', () => {
    expect(initials('Ms. Rivera')).toBe('MR');
    expect(initials('Ana Rodríguez')).toBe('AR');
    expect(initials('  ana   sofía  rodríguez ')).toBe('AS');
    expect(initials('Ñuñez')).toBe('Ñ');
    expect(initials('(Coach) Smith')).toBe('CS');
    expect(initials('teacher@school.edu')).toBe('T');
    expect(initials('李小龍')).toBe('李');
    // A word with no letter gives its first character, so no avatar is ever empty.
    expect(initials('204 B')).toBe('2B');
  });
});

describe('the side menu', () => {
  it('links Bali, Home, Classes, Reports, Questions, Slides and Help, each page as it exists', () => {
    const html = menu();
    expect(html).toMatch(/^<nav aria-label="Main" /);
    expect(links(html).map(({ href, text }) => [href, text])).toEqual([
      ['/', 'Bali'],
      ['/', 'Home'],
      ['/classes', 'Classes'],
      ['/reports', 'Reports'],
      ['/questions', 'Questions'],
      ['/slides', 'Slides'],
      ['/support', 'Help'],
    ]);
    // Classes with the boards' icon, the grid of four (PV16a); Reports with the boards' icon, the
    // class page's Reports button's (PV13); Questions with
    // theirs, the speech bubble with a question mark (L7b); Slides with theirs, the presentation
    // board (M5b).
    expect(html).toMatch(/<a [^>]*href="\/classes"><svg[^>]*\blucide-layout-grid\b/);
    expect(html).toMatch(/<a [^>]*href="\/reports"><svg[^>]*\blucide-chart-bar\b/);
    expect(html).toMatch(
      /<a [^>]*href="\/questions"><svg[^>]*\blucide-message-circle-question-mark\b/,
    );
    expect(html).toMatch(/<a [^>]*href="\/slides"><svg[^>]*\blucide-presentation\b/);
    // The lockup, the mark at 20 px and its word at 16/22 in the brand's ink, as the boards render
    // it (v2.css's links take that ink, `.brand` among them).
    expect(html).toMatch(/<a [^>]*translate="no"[^>]*><svg[^>]*width="20"/);
    expect(links(html)[0]?.classes).toEqual(
      expect.arrayContaining(['text-lockup', 'text-text-brand']),
    );
  });

  it('marks the page open, grey and semibold, and nothing on a page it doesn’t list yet', () => {
    const current = (path: string) =>
      links(menu({ path }))
        .filter((l) => l.current)
        .map((l) => l.text);
    expect(current('/')).toEqual(['Home']);
    expect(current('/classes')).toEqual(['Classes']);
    expect(current('/reports')).toEqual(['Reports']);
    expect(current('/questions')).toEqual(['Questions']);
    expect(current('/slides')).toEqual(['Slides']);
    // A page under one it lists: a class's page and its reports' old address under Classes (PV16a),
    // a session's report under Reports (PV14, ReportOpened); none under Home's `/`, nor a page whose
    // name only starts as another's does.
    expect(current('/classes/c1')).toEqual(['Classes']);
    expect(current('/classes/c1/reports')).toEqual(['Classes']);
    expect(current('/classesx')).toEqual([]);
    expect(current('/reports/c1/s1')).toEqual(['Reports']);
    expect(current('/reportsx')).toEqual([]);
    // By its aria-current, which a screen reader says too, never by colour alone.
    const home = links(menu()).find((l) => l.text === 'Home');
    expect(home?.classes).toEqual(
      expect.arrayContaining([
        'aria-[current=page]:bg-surface-sunken',
        'aria-[current=page]:font-semibold',
        'aria-[current=page]:text-text-primary',
        'text-data',
        'rounded-item',
      ]),
    );
  });

  it('names the account at its foot: the initials beside the name, Sign out an icon named so', () => {
    const html = menu();
    expect(html).toMatch(
      /<span aria-hidden="true" class="[^"]*\bbg-avatar-bg\b[^"]*">MR<\/span><span title="Ms\. Rivera" class="[^"]*\btext-menu-name\b[^"]*">Ms\. Rivera<\/span><button type="button" aria-label="Sign out" aria-disabled="false"[^>]*><svg[^>]*lucide-log-out/,
    );
  });

  it('keeps a name too long for the foot on one line, cut with an ellipsis, whole on hover and to a screen reader (MenuNameStates)', () => {
    // An account with no name of its own shows its sign-in, the demo teacher's an email: no longer
    // broken mid-word over three lines (PV14's shots), its text whole in the page for a screen
    // reader, and its title the whole of it on hover.
    const email = 'bali-demo-teacher@bali.test';
    const html = menu({ name: email });
    expect(html).toContain(`<span title="${email}" class="`);
    const name = classesOf(html, /<span title="[^"]*" class="[^"]*">/);
    expect(name).toEqual(expect.arrayContaining(['min-w-0', 'truncate', 'text-menu-name']));
    expect(name).not.toContain('wrap-anywhere');
    expect(html).toContain(`>${email}</span>`);
    // On a phone the foot keeps its place beside Bali on the bar's top row, growing into the room
    // there and cutting the name to fit, the avatar, the name and Sign out together at its end.
    const foot = classesOf(html, /<div class="[^"]*\bborder-t\b[^"]*">/);
    expect(foot).toEqual(
      expect.arrayContaining([
        'max-sm:min-w-0',
        'max-sm:flex-1',
        'max-sm:basis-0',
        'max-sm:justify-end',
      ]),
    );
    expect(classesOf(html, /<button type="button" aria-label="Sign out"[^>]*>/)).toEqual(
      expect.arrayContaining(['ml-auto', 'max-sm:ml-0', 'shrink-0']),
    );
  });

  it('with no name to show, says Sign out in words alone, with no initials (HomeNoName)', () => {
    const html = menu({ name: null });
    expect(html).not.toContain('bg-avatar-bg');
    expect(html).not.toContain('aria-label="Sign out"');
    expect(html).toMatch(
      /<button type="button" aria-disabled="false"[^>]*><svg[^>]*>.*?<\/svg>Sign out<\/button><\/div><\/nav>$/,
    );
  });

  it('for a student, links Bali, Your classes and Help, as StudentHome draws it, and none of a teacher’s pages (W3)', () => {
    const html = menu({ role: 'student', name: 'Ana Rodríguez' });
    expect(links(html).map(({ href, text, current }) => [href, text, current])).toEqual([
      ['/', 'Bali', false],
      ['/', 'Your classes', true],
      ['/support', 'Help', false],
    ]);
    expect(html).not.toMatch(/Home|Reports|Questions|Slides/);
    // Your classes with the boards' icon, the grid of four.
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*><svg[^>]*\blucide-layout-grid\b/);
    // The same foot: the initials beside the name, Sign out an icon.
    expect(html).toMatch(
      /<span aria-hidden="true" class="[^"]*\bbg-avatar-bg\b[^"]*">AR<\/span><span title="Ana Rodríguez" class="[^"]*\btext-menu-name\b[^"]*">Ana Rodríguez<\/span><button type="button" aria-label="Sign out"/,
    );
    // On a page the student has no item for, nothing is marked.
    expect(links(menu({ role: 'student', path: '/invite' })).filter((l) => l.current)).toEqual([]);
  });

  it('marks Your classes on a student’s lesson too, as StudentLesson draws it, and on no page merely named alike (W4)', () => {
    const current = (path: string) =>
      links(menu({ role: 'student', path }))
        .filter((l) => l.current)
        .map((l) => l.text);
    expect(current('/lessons/c1/s1')).toEqual(['Your classes']);
    expect(current('/lessonsx')).toEqual([]);
    expect(current('/support')).toEqual(['Help']);
    // A teacher's menu has no lessons under Home.
    expect(links(menu({ path: '/lessons/c1/s1' })).filter((l) => l.current)).toEqual([]);
  });

  it('holds Sign out while it signs out, as the bar does', () => {
    expect(menu({ leaving: true })).toMatch(/aria-label="Sign out" aria-disabled="true"/);
    expect(menu({ name: null, leaving: true })).toMatch(
      /aria-disabled="true"[^>]*><svg[^>]*>.*?<\/svg>Signing out…<\/button>/,
    );
  });

  it('is 216 px and stays in view; one bar on top under 776 px; three rows under 640 px', () => {
    const html = menu();
    expect(classesOf(html, /<nav\b[^>]*>/)).toEqual(
      expect.arrayContaining([
        'w-54',
        'sticky',
        'top-0',
        'h-dvh',
        'overflow-y-auto',
        'border-r',
        'px-3',
        'pt-8',
        'pb-3.5',
        'max-[776px]:static',
        'max-[776px]:h-auto',
        'max-[776px]:flex-row',
        'max-[776px]:flex-wrap',
        'max-[776px]:border-r-0',
        'max-[776px]:border-b',
      ]),
    );
    // Under 640 px (PV1's phone boards): Bali and the account on the first row, the gap a break
    // after them, then the links.
    expect(classesOf(html, /<div class="[^"]*\bborder-t\b[^"]*">/)).toContain('max-sm:order-1');
    expect(classesOf(html, /<div class="min-h-6[^"]*">/)).toEqual(
      expect.arrayContaining([
        'max-[776px]:hidden',
        'max-sm:block',
        'max-sm:order-2',
        'max-sm:basis-full',
      ]),
    );
    for (const link of links(html).slice(1)) expect(link.classes).toContain('max-sm:order-3');
  });
});

describe('the shell', () => {
  const page = createElement('main', null, 'page');

  it('sets the page beside the menu left-aligned, 1260 px at most, in v2’s gutters', () => {
    expect(PAGE.split(' ')).toEqual(
      expect.arrayContaining([
        'max-w-[1260px]',
        'min-w-0',
        'flex-1',
        'px-9',
        'pt-7.5',
        'pb-14',
        'max-sm:px-4',
        'max-sm:pt-5.5',
        'max-sm:pb-10',
      ]),
    );
  });

  it('first paints Loading… in a signed-in page’s place, with no menu or bar, the page kept for later (#352’s review)', () => {
    // It painted a blank window (Home's own Loading… hidden with the page), after a redeem too. A
    // URL with no page paints the same, until the shell reads the account or sends it to /login.
    for (const path of ['/', '/classes/c1', '/no-such-page']) {
      nav.path = path;
      expect(renderToStaticMarkup(createElement(Shell, null, page)), path).toMatch(
        /^<div><main class="[^"]*"><p role="status" class="[^"]*">Loading…<\/p><\/main><div hidden=""><main>page<\/main><\/div><\/div>$/,
      );
    }
  });

  it('says the account unread as Home said it (HomeStates): Loading…, or its failure with Try again', () => {
    const unread = (error: string | null) =>
      renderToStaticMarkup(createElement(AccountUnread, { error, onRetry: () => undefined }));
    expect(unread(null)).toMatch(
      /^<main class="[^"]*"><p role="status" class="[^"]*\btext-text-secondary\b[^"]*">Loading…<\/p><\/main>$/,
    );
    expect(unread(CANT_REACH)).toMatch(
      /<p role="alert"><span class="block text-h3">Couldn(’|'|&#x27;)t load your account\.<\/span><span class="[^"]*">Couldn(’|'|&#x27;)t reach Bali\. Check your connection, then try again\.<\/span><\/p><button type="button"[^>]*>Try again<\/button>/,
    );
    // In the page's frame, beside no menu: v2's gutters, as the page would have them.
    expect(classesOf(unread(null), /<main\b[^>]*>/)).toEqual(PAGE.split(' '));
  });

  it('draws nothing around a page read without signing in, the page in the same place', () => {
    nav.path = '/login';
    expect(renderToStaticMarkup(createElement(Shell, null, page))).toBe(
      '<div><div><main>page</main></div></div>',
    );
  });

  it('is the root layout’s, in place of the bar', () => {
    const layout = read('../app/layout.tsx');
    expect(layout).toContain('<Shell>{children}</Shell>');
    expect(layout).not.toContain('PortalBar');
  });

  it('holds the one read of the account that Home shows and the menu names', () => {
    const home = read('../app/page.tsx');
    expect(home).toContain('const { home, error, load, refresh } = useMe();');
    expect(home).not.toContain("'/v1/me'");
    // A redeem forgets the account and reads it again, so the menu comes with the classes; until
    // it answers, the shell says Loading… in Home's place, as it does for every page.
    expect(home).toMatch(/redeemed\.current = true;\s*load\(true\);/);
    expect(read('./shell.tsx')).toMatch(/\(fresh = false\) => \{\s*if \(fresh\) setHome\(null\);/);
    // Home draws nothing of its own for an account not read: the shell's words are the only ones.
    expect(home).toMatch(/if \(home === null\) return null;/);
    expect(home).not.toMatch(/>\s*Loading…\s*<|Couldn&apos;t load your account/);
  });
});

describe('the account’s reads (#352’s review)', () => {
  const teacher = account('teacher');

  /** An API whose reads answer in the order asked, each settled by hand, each path kept. */
  function api() {
    const settles: { path: string; answer: (body: unknown) => void; fail: (e: unknown) => void }[] =
      [];
    return {
      settles,
      get: <T>(path: string) =>
        new Promise<T>((resolve, reject) => {
          settles.push({ path, answer: (body) => resolve(body as T), fail: reject });
        }),
    };
  }

  it('drops a read that settles after a newer one began: no past failure over fresh data', async () => {
    // Try again pressed twice on a slow connection, or a create's read beside Home's own.
    const reads = { current: 0 };
    const fake = api();
    const older = readAccount(fake, reads);
    const newer = readAccount(fake, reads);
    fake.settles[1]?.answer({ passed: true });
    await vi.waitFor(() => expect(fake.settles).toHaveLength(3));
    fake.settles[2]?.answer(teacher);
    expect(await newer).toEqual({ home: { kind: 'teacher', me: teacher } });
    fake.settles[0]?.fail(new NetworkError());
    expect(await older).toBeNull();
  });

  it('drops an older answer too, so the newest read’s word stands', async () => {
    const reads = { current: 0 };
    const fake = api();
    const older = readAccount(fake, reads);
    const newer = readAccount(fake, reads);
    fake.settles[1]?.fail(new NetworkError());
    expect(await newer).toEqual({ error: CANT_REACH });
    fake.settles[0]?.answer({ passed: true });
    await vi.waitFor(() => expect(fake.settles).toHaveLength(3));
    fake.settles[2]?.answer(teacher);
    expect(await older).toBeNull();
  });

  it('says the newest read’s failure in words: no answer is CANT_REACH', async () => {
    const fake = api();
    const read = readAccount(fake, { current: 0 });
    fake.settles[0]?.fail(new NetworkError());
    expect(await read).toEqual({ error: CANT_REACH });
  });
});

describe('where the account’s read sends it, the 13+ check before /v1/me (PV15)', () => {
  /** The API client over a fetch answering each path from `routes`, every path asked kept. */
  function client(routes: Record<string, () => Promise<Response>>) {
    const asked: string[] = [];
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      onUnauthorized,
      fetchImpl: (url) => {
        const path = (url as string).replace('http://api', '');
        asked.push(path);
        const route = routes[path];
        return route ? route() : Promise.resolve(Response.json({}, { status: 404 }));
      },
    });
    return { api, asked, onUnauthorized };
  }
  const json = (status: number, body: unknown) => () =>
    Promise.resolve(Response.json(body, { status }));
  const offline = () => Promise.reject(new Error('offline'));
  const reads = () => ({ current: 0 });

  it('a teacher: the check, then /v1/me, whose role sends them to their classes', async () => {
    const { api, asked } = client({
      '/v1/me/age-check': json(200, { passed: true }),
      '/v1/me': json(200, account('teacher')),
    });
    expect(await readAccount(api, reads())).toEqual({ home: homeOf('teacher') });
    expect(asked).toEqual(['/v1/me/age-check', '/v1/me']);
  });

  it('a student who said 13+ in the app: the check, then /v1/me, their account the app made', async () => {
    const { api, asked } = client({
      '/v1/me/age-check': json(200, { passed: true }),
      '/v1/me': json(200, account('student')),
    });
    expect(await readAccount(api, reads())).toEqual({ home: homeOf('student') });
    expect(asked).toEqual(['/v1/me/age-check', '/v1/me']);
  });

  it('a web sign-in that never set up the app: the invite page, and no /v1/me, so no account made', async () => {
    // On any signed-in page: the shell reads the account so on every one, a class page's link too.
    const { api, asked } = client({
      '/v1/me/age-check': json(200, { passed: false }),
      '/v1/me': json(200, account('student')),
    });
    expect(await readAccount(api, reads())).toEqual({ home: { kind: 'invite' } });
    expect(asked).toEqual(['/v1/me/age-check']);
  });

  it('a read that failed: said in words, nothing guessed, and Try again reads it all again', async () => {
    const routes: Record<string, () => Promise<Response>> = {
      '/v1/me/age-check': offline,
      '/v1/me': json(200, account('teacher')),
    };
    const { api, asked, onUnauthorized } = client(routes);
    expect(await readAccount(api, reads())).toEqual({ error: CANT_REACH });
    // Never /v1/me after a check that didn't answer: it could make an account the check never let.
    expect(asked).toEqual(['/v1/me/age-check']);
    // The check answered, /v1/me didn't: still the failure, never a guess at the account.
    routes['/v1/me/age-check'] = json(200, { passed: true });
    routes['/v1/me'] = offline;
    expect(await readAccount(api, reads())).toEqual({ error: CANT_REACH });
    // Try again, the connection back: the check first again, then the account.
    routes['/v1/me'] = json(200, account('teacher'));
    expect(await readAccount(api, reads())).toEqual({ home: homeOf('teacher') });
    expect(asked).toEqual([
      '/v1/me/age-check',
      '/v1/me/age-check',
      '/v1/me',
      '/v1/me/age-check',
      '/v1/me',
    ]);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a 401: the tab signs out once, toward /login, reads nothing more and says no failure', async () => {
    const { api, asked, onUnauthorized } = client({
      '/v1/me/age-check': json(401, { error: { code: 'unauthorized', message: 'expired' } }),
      '/v1/me': json(200, account('teacher')),
    });
    // Loading… stays in the page's place until /login opens: no "Couldn't load your account."
    expect(await readAccount(api, reads())).toEqual({ error: null });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(asked).toEqual(['/v1/me/age-check']);
  });

  it('reads /v1/me, which makes the account, nowhere in the portal but homeFor, after the check', () => {
    // A page or a piece that read it itself would make an account for a sign-in that never set
    // up the app (ARCHITECTURE, Live lesson, decision 13).
    const src = fileURLToPath(new URL('../', import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return files(path);
        return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
      });
    // Its code, its comments set aside: a path quoted, a template's included.
    const code = (file: string) =>
      readFileSync(file, 'utf8')
        .replace(/\/\*[^]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    const readers = files(src)
      .filter((file) => /['"`]\/v1\/me['"`?]/.test(code(file)))
      .map((file) => relative(src, file).split(sep).join('/'));
    expect(readers).toEqual(['lib/student-web.ts']);
  });
});
