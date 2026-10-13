import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MeResponse } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { chromeFor, initials, Shell, SideMenu } from './shell';

/*
 * The shell (PV5): v2's side menu on a teacher's signed-in pages, built to the canvas's teacher
 * boards, StudentZoom's bar and PV1's phone and no-name boards. Rendered: which frame a page gets,
 * the menu's items, the page it marks, its foot with and without a name, its bar under 776 px and
 * its three rows under 640 px, and the page beside it.
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

describe('what frames a page', () => {
  it('draws nothing on a page read without signing in: each has its own bar', () => {
    for (const path of ['/login', '/auth/callback', '/support', '/privacy', '/terms']) {
      expect(chromeFor(path, account('teacher')), path).toBe('none');
    }
  });

  it('keeps today’s bar on the invite page alone, home for an account that doesn’t teach', () => {
    expect(chromeFor('/', account('student'))).toBe('bar');
    expect(chromeFor('/', account('teacher'))).toBe('menu');
  });

  it('draws the side menu on every other signed-in page, and before the account is read', () => {
    expect(chromeFor('/', null)).toBe('menu');
    for (const path of ['/classes/c1', '/classes/c1/reports']) {
      expect(chromeFor(path, null), path).toBe('menu');
      expect(chromeFor(path, account('student')), path).toBe('menu');
    }
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

  it('sets a signed-in page beside the menu, left-aligned, 1260 px at most, in v2’s gutters', () => {
    nav.path = '/classes/c1';
    const html = renderToStaticMarkup(createElement(Shell, null, page));
    const frame =
      /^<div class="flex max-\[776px\]:block"><nav aria-label="Main"[^]*<\/nav><div class="([^"]*)"><main>page<\/main><\/div><\/div>$/.exec(
        html,
      );
    expect(frame?.[1]?.split(' ')).toEqual(
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
    // Before the account is read, its foot says Sign out in words, so it is there from the first
    // paint, and nothing is marked on a page the menu doesn't list.
    expect(html).toContain('Sign out</button>');
    expect(html).not.toContain('aria-current');
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
