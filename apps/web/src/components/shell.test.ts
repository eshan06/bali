import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MeResponse } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { accountStep, frameFor, initials, PAGE, reloadOnRestore, Shell, SideMenu } from './shell';

/*
 * The shell (PV5): v2's side menu on a teacher's signed-in pages, built to the canvas's teacher
 * boards, StudentZoom's bar and PV1's phone and no-name boards, under the owner's rulings of
 * 2026-10-13 (no menu in Present; nothing shown from an account that left; the menu only once the
 * account reads as a teacher). Which frame a page gets, what happens to the account as pages change
 * and the back button restores one, and, rendered, the menu's items, the page it marks, its foot
 * with and without a name, its bar under 776 px and its three rows under 640 px, and the page beside
 * it.
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

const menu = (over: Partial<Parameters<typeof SideMenu>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SideMenu, {
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
      expect(frameFor(path, account('teacher'), null, false), path).toEqual(NONE);
    }
  });

  it('draws the side menu for a teacher, the page beside it in v2’s frame', () => {
    for (const path of ['/', '/classes/c1', '/classes/c1/reports']) {
      expect(frameFor(path, account('teacher'), null, false), path).toEqual(MENU);
    }
  });

  it('draws no menu or frame on the projector, as ClassPresent draws it (the owner, 2026-10-13)', () => {
    expect(frameFor('/classes/c1', account('teacher'), null, true)).toEqual(NONE);
    // Whether or not the account is read yet: a reload in Present comes back without the menu.
    expect(frameFor('/classes/c1', null, null, true)).toEqual(NONE);
  });

  it('shows nothing until the account is read, so no menu flashes for anyone (the owner, 2026-10-13)', () => {
    for (const path of ['/', '/classes/c1', '/classes/c1/reports']) {
      expect(frameFor(path, null, null, false), path).toEqual({
        chrome: null,
        framed: false,
        hidden: true,
      });
    }
  });

  it('keeps today’s bar for an account that doesn’t teach, never the menu; the invite page frames itself', () => {
    expect(frameFor('/', account('student'), null, false)).toEqual({
      chrome: 'bar',
      framed: false,
      hidden: false,
    });
    expect(frameFor('/classes/c1', account('student'), null, false)).toEqual({
      chrome: 'bar',
      framed: true,
      hidden: false,
    });
  });

  it('says a failed read under today’s bar, with Sign out (Home has Try again)', () => {
    for (const path of ['/', '/classes/c1']) {
      expect(frameFor(path, null, "Couldn't reach Bali.", false), path).toEqual({
        chrome: 'bar',
        framed: true,
        hidden: false,
      });
    }
  });
});

describe('the account as pages change (the owner, 2026-10-13)', () => {
  const teacher = account('teacher');

  it('is forgotten once the sign-in is gone, so going back never shows it', () => {
    // A Sign out and an expired session both land on /login, the token gone.
    expect(accountStep('/login', false, teacher, null, false)).toBe('forget');
    expect(accountStep('/login', false, null, "Couldn't reach Bali.", false)).toBe('forget');
    // An answer that lands after the Sign out is forgotten too.
    expect(accountStep('/', false, teacher, null, false)).toBe('forget');
    expect(accountStep('/login', false, null, null, false)).toBe('keep');
  });

  it('is read once on a signed-in page, and kept as pages change, Help included', () => {
    expect(accountStep('/classes/c1', true, null, null, false)).toBe('read');
    expect(accountStep('/classes/c1', true, null, null, true)).toBe('keep');
    expect(accountStep('/classes/c1', true, teacher, null, false)).toBe('keep');
    expect(accountStep('/support', true, teacher, null, false)).toBe('keep');
    expect(accountStep('/support', true, null, null, false)).toBe('keep');
    // A failed read waits for Try again or another page: never a loop of reads.
    expect(accountStep('/', true, null, "Couldn't reach Bali.", false)).toBe('keep');
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
    expect(shell).toMatch(/const frame = frameFor\(path, me, error, presenting\);/);
    // A page's usePresenting reaches the shell's own state, on and back off.
    expect(shell).toMatch(/const \[presenting, setPresenting\] = useState\(false\);/);
    expect(shell).toMatch(/<PresentingContext value=\{setPresenting\}>/);
    expect(shell).toMatch(
      /useEffect\(\(\) => \{\s*setPresenting\(on\);\s*return \(\) => setPresenting\(false\);\s*\}, \[on, setPresenting\]\);/,
    );
  });

  it('reads, keeps or forgets the account as accountStep says, on every page and every answer', () => {
    expect(shell).toMatch(
      /const step = accountStep\(path, getAccessToken\(\) !== null, me, error, reading\.current\);\s*if \(step === 'read'\) load\(\);\s*if \(step === 'forget'\) \{\s*setMe\(null\);\s*setError\(null\);\s*\}\s*\}, \[path, me, error, load\]\);/,
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
  it('links Bali, Home and Help, and no page that doesn’t exist yet, dead or disabled', () => {
    const html = menu();
    expect(html).toMatch(/^<nav aria-label="Main" /);
    expect(links(html).map(({ href, text }) => [href, text])).toEqual([
      ['/', 'Bali'],
      ['/', 'Home'],
      ['/support', 'Help'],
    ]);
    expect(html).not.toMatch(/Classes|Reports|Questions|Slides/);
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
    expect(current('/classes/c1')).toEqual([]);
    expect(current('/classes/c1/reports')).toEqual([]);
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
      /<span aria-hidden="true" class="[^"]*\bbg-avatar-bg\b[^"]*">MR<\/span><span class="[^"]*\btext-menu-name\b[^"]*">Ms\. Rivera<\/span><button type="button" aria-label="Sign out" aria-disabled="false"[^>]*><svg[^>]*lucide-log-out/,
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

  it('first paints a signed-in page hidden, with no menu or bar, until the account is read', () => {
    nav.path = '/classes/c1';
    expect(renderToStaticMarkup(createElement(Shell, null, page))).toBe(
      '<div><div hidden=""><main>page</main></div></div>',
    );
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
    expect(home).toContain('const { me, error, load } = useMe();');
    expect(home).not.toContain("'/v1/me'");
    // A redeem forgets the account and reads it again, so the menu comes with the classes.
    expect(home).toMatch(/redeemed\.current = true;\s*load\(true\);/);
  });
});
