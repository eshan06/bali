// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { accountStep, Shell } from '../components/shell';
import { TEACHER_NEVER_SEES, TEACHER_SEES } from '../components/teacher-sees';
import LoginPage from './login/page';
import PrivacyPage, { metadata as privacyMetadata } from './privacy/page';
import SupportPage from './support/page';
import TermsPage, { metadata as termsMetadata } from './terms/page';

/*
 * The privacy policy and the terms (C2-text) as a reader meets them, signed out (the owner's
 * decision of 2026-10-22: the portal's tests drive the page): the owner's drafted words of
 * 2026-10-24 under each title and its date, every section in the draft's order, the sections the
 * owner named at the outline's ids, the privacy draft's table as a list, its section 2's lists the
 * app's and the help page's own (#130), Contact's mailto and the footer's links, and nothing of the
 * drafts' notes for the lawyer. Reached from /login and from the
 * help page; framed by the shell with no menu, no Sign out and no read; whole in the server's HTML,
 * so the words need no script. That every page renders per request is rendering.test.ts's.
 */

const nav = vi.hoisted(() => ({ path: '/privacy', replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const SUPPORT_EMAIL = 'eshan.shah@vanderbilt.edu';

interface Policy {
  path: string;
  Page: ComponentType;
  metadata: typeof privacyMetadata;
  title: string;
  date: string;
  /** Every section's title, in the draft's order, Contact's last. */
  sections: string[];
  /** The sections the owner named for the outline (C2a), each at the outline's id. */
  named: Record<string, string>;
  /** Each part's heading inside a section. */
  parts: string[];
  /** The footer's link to the other policy. */
  other: [string, string];
}

const POLICIES: Policy[] = [
  {
    path: '/privacy',
    Page: PrivacyPage,
    metadata: privacyMetadata,
    title: 'Privacy policy',
    date: 'Effective October 24, 2026',
    sections: [
      'The short version',
      '1. What Bali collects',
      '2. What your teacher sees',
      '3. How we use it',
      '4. Who we share it with',
      '5. Schools and student records (FERPA)',
      '6. How long records are kept',
      '7. Deleting your account',
      '8. Age',
      '9. Security',
      '10. Your choices and rights',
      '11. Changes to this policy',
      '12. Contact us',
    ],
    named: {
      collects: '1. What Bali collects',
      'teacher-sees': '2. What your teacher sees',
      retention: '6. How long records are kept',
      deletion: '7. Deleting your account',
      contact: '12. Contact us',
    },
    parts: [
      'If you are a student',
      'If you are a teacher',
      'What Bali never collects',
      'Automatically, from the portal and our servers',
    ],
    other: ['/terms', 'Terms'],
  },
  {
    path: '/terms',
    Page: TermsPage,
    metadata: termsMetadata,
    title: 'Terms of use',
    date: 'Last updated October 24, 2026',
    sections: [
      '1. Who Bali is for',
      '2. Your account',
      '3. Using Bali in class',
      '4. Bali is not a safety device',
      '5. Leaving Bali',
      '6. Changes to these terms',
      '7. Changes to Bali',
      '8. Ownership and feedback',
      '9. Disclaimers',
      '10. Limitation of liability',
      '11. Disputes and governing law',
      '12. State notices',
      '13. General',
      '14. Contact',
    ],
    named: {
      who: '1. Who Bali is for',
      account: '2. Your account',
      'in-class': '3. Using Bali in class',
      leaving: '5. Leaving Bali',
      changes: '6. Changes to these terms',
      contact: '14. Contact',
    },
    parts: ['Teachers also agree to', 'Nobody may'],
    other: ['/privacy', 'Privacy policy'],
  },
];

/** Each link in a part of the page: where it goes, and its words. */
const linksIn = (part: HTMLElement) =>
  within(part)
    .getAllByRole('link')
    .map((link) => [link.getAttribute('href'), link.textContent]);

describe.each(POLICIES)('$path, the owner’s drafted words', (policy) => {
  it('opens on its title, its date under it in the quiet meta line, then who runs Bali', () => {
    render(<policy.Page />);
    const title = screen.getByRole('heading', { level: 1 });
    expect(title.textContent).toBe(policy.title);
    const date = title.nextElementSibling as HTMLElement;
    expect(date.textContent).toBe(policy.date);
    expect([...date.classList]).toEqual(['mt-0.5', 'text-meta', 'text-text-secondary']);
    expect(screen.getByRole('main').textContent).toContain('Eshan Shah and Jonathan Bani');
  });

  it('has every section of the draft, in its order, each a region its title names', () => {
    render(<policy.Page />);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(policy.sections);
    for (const title of policy.sections) {
      expect(screen.getByRole('region', { name: title })).toBeTruthy();
    }
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(policy.parts);
  });

  it('keeps the outline’s id on each section the owner named, so a link to one still lands', () => {
    render(<policy.Page />);
    for (const [id, title] of Object.entries(policy.named)) {
      expect(screen.getByRole('region', { name: title }).id, title).toBe(id);
    }
  });

  it('ends on Contact, the support address a mailto link, then Help and the other policy', () => {
    render(<policy.Page />);
    const contact = screen.getByRole('region', { name: policy.sections.at(-1) });
    expect(contact.textContent).toBe(`${policy.sections.at(-1)}Email ${SUPPORT_EMAIL}.`);
    expect(linksIn(contact)).toEqual([[`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL]]);
    expect(linksIn(screen.getByRole('navigation', { name: 'Help and policies' }))).toEqual([
      ['/support', 'Help and questions'],
      policy.other,
    ]);
  });

  it('shows none of the outline or the drafts’ notes: no Placeholder, no draft, no lawyer, no dash', () => {
    render(<policy.Page />);
    const words = document.body.textContent ?? '';
    for (const left of [/placeholder/i, /draft/i, /lawyer/i, /not live/i, /legal advice/i]) {
      expect(words).not.toMatch(left);
    }
    expect(words).not.toMatch(/[—–]/);
    expect(document.querySelector('table')).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('is titled without "(draft)" and still kept out of search results until the lawyer’s version', () => {
    expect(JSON.stringify(policy.metadata)).not.toMatch(/draft|lawyer|placeholder/i);
    expect(JSON.stringify(policy.metadata)).not.toMatch(/[—–]/);
    expect(policy.metadata.title).toBe(`Bali ${policy.title.toLowerCase()}`);
    expect(policy.metadata.robots).toEqual({ index: false });
  });

  it('is whole in the server’s HTML, so it reads with no script', () => {
    const html = renderToStaticMarkup(<policy.Page />);
    for (const words of [policy.title, policy.date, ...policy.sections, ...policy.parts]) {
      expect(html).toContain(words);
    }
    expect(html).toContain(`href="mailto:${SUPPORT_EMAIL}"`);
  });

  it('shows signed out under its own bar alone: no menu, no Sign out, no read, not sent to sign in', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    nav.path = policy.path;
    render(
      <Shell>
        <policy.Page />
      </Shell>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(policy.title);
    expect(screen.getAllByRole('banner').map((bar) => bar.textContent)).toEqual(['Bali']);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('navigation').map((n) => n.getAttribute('aria-label'))).toEqual([
      'Help and policies',
    ]);
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    // Its path with a slash after it too, never a path that only starts with its name.
    expect(accountStep(`${policy.path}/`, false, null, null, false, true)).toBe('keep');
    expect(accountStep(`${policy.path}-notice`, false, null, null, false, true)).toBe('sign in');
  });
});

describe('the privacy policy’s table of what Bali collects, as a list', () => {
  it('lists each row as one item: what, in bold, then why', () => {
    render(<PrivacyPage />);
    const students = screen.getByRole('heading', { level: 3, name: 'If you are a student' })
      .nextElementSibling as HTMLElement;
    const rows = within(students).getAllByRole('listitem');
    expect(rows.map((row) => row.firstElementChild?.tagName)).toEqual(Array(11).fill('STRONG'));
    expect(rows[0]?.textContent).toBe(
      "The email you sign in with. To sign you in. It's held by our sign-in provider (Amazon Cognito), not in Bali's own database.",
    );
    expect(rows.at(-1)?.textContent).toBe('What you write when you email us. To answer you.');
  });
});

describe('the privacy policy’s section 2, what your teacher sees, says what the app says (#130)', () => {
  it('lists what a teacher sees, then what they never see, as the app and the help page list them', () => {
    render(<PrivacyPage />);
    const sees = screen.getByRole('region', { name: '2. What your teacher sees' });
    const lists = within(sees)
      .getAllByRole('list')
      .map((list) =>
        within(list)
          .getAllByRole('listitem')
          .map((line) => line.textContent),
      );
    expect(lists).toEqual([TEACHER_SEES, TEACHER_NEVER_SEES]);
    const never = within(sees).getAllByRole('list')[1]?.previousElementSibling;
    expect(never?.textContent).toBe('Your teacher never sees:');
    expect(never?.querySelector('strong')?.textContent).toBe('never');
    // The draft's paragraph on answers is gone: the lists' answers lines say it.
    expect(sees.textContent).not.toMatch(/answer totals/);
  });

  it('shows the help page the same two lists', () => {
    render(<SupportPage />);
    const help = within(screen.getByRole('region', { name: 'For students' }))
      .getAllByRole('list')
      .map((list) =>
        within(list)
          .getAllByRole('listitem')
          .map((line) => line.textContent),
      );
    expect(help).toEqual([TEACHER_SEES, TEACHER_NEVER_SEES]);
  });
});

describe('the terms link the privacy policy as this portal’s own page', () => {
  it('in their opening paragraph', () => {
    render(<TermsPage />);
    expect(screen.getByRole('link', { name: 'privacy policy' }).getAttribute('href')).toBe(
      '/privacy',
    );
  });
});

describe('both pages are reachable signed out', () => {
  it('from the sign-in page, beside Help', () => {
    render(<LoginPage />);
    expect(linksIn(screen.getByRole('navigation', { name: 'Help and policies' }))).toEqual([
      ['/support', 'Help and questions'],
      ['/privacy', 'Privacy policy'],
      ['/terms', 'Terms'],
    ]);
  });

  it('from the help page, whose line says they are there to read, at the address the policies give', () => {
    render(<SupportPage />);
    const privacy = screen.getByRole('region', { name: 'Privacy' });
    const line = within(privacy).getByRole('heading', {
      level: 3,
      name: 'Privacy policy and terms',
    }).nextElementSibling as HTMLElement;
    expect(line.textContent).toBe('Read the full privacy policy and terms.');
    expect(linksIn(line)).toEqual([
      ['/privacy', 'privacy policy'],
      ['/terms', 'terms'],
    ]);
    expect(screen.getByRole('link', { name: SUPPORT_EMAIL }).getAttribute('href')).toBe(
      `mailto:${SUPPORT_EMAIL}`,
    );
  });
});
