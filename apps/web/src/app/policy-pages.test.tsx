// @vitest-environment jsdom
import { PORTAL_EVENTS, type PortalEvent } from '@bali/shared';
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
 * app's and the help page's own (#130), the owner's two later lines (section 1's clock set ahead,
 * section 6's records at another school), PostHog named wherever its counts change what a line says
 * (A4) and no line keeping a teacher's ID there once their counts go (A6), no email domain and no
 * TestFlight, since the app comes from the App Store (2026-11-07), Contact's mailto and the
 * footer's links, and nothing of the drafts' notes for the lawyer.
 * Reached from /login and from the
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
    date: 'Effective November 7, 2026',
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
    date: 'Last updated November 7, 2026',
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

  it('names no email domain and no TestFlight: which addresses may sign up is the pool’s to say, and the app comes from the App Store (2026-11-07)', () => {
    render(<policy.Page />);
    // The support address is Contact's, not a rule about who may sign up.
    const words = (screen.getByRole('main').textContent ?? '').replaceAll(SUPPORT_EMAIL, '');
    expect(words).not.toMatch(/@\w/);
    expect(words).not.toMatch(/gmail|vanderbilt\.edu/i);
    expect(words).not.toMatch(/testflight|test version/i);
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
    expect(rows.map((row) => row.firstElementChild?.tagName)).toEqual(Array(12).fill('STRONG'));
    expect(rows[0]?.textContent).toBe(
      "The email you sign in with. To sign you in. It's held by our sign-in provider (Amazon Cognito), not in Bali's own database.",
    );
    expect(rows.at(-1)?.textContent).toBe('What you write when you email us. To answer you.');
  });

  it('names a phone clock set ahead right after the check-in, as section 2 lists it after not hearing from the phone', () => {
    render(<PrivacyPage />);
    const students = screen.getByRole('heading', { level: 3, name: 'If you are a student' })
      .nextElementSibling as HTMLElement;
    const rows = within(students).getAllByRole('listitem');
    const checkIn = rows.findIndex((row) =>
      row.textContent?.startsWith('A check-in from your phone about every 30 seconds'),
    );
    expect(checkIn).toBeGreaterThan(-1);
    const clock = rows[checkIn + 1];
    expect(clock?.firstElementChild?.textContent).toBe("Whether your phone's clock is set ahead.");
    expect(clock?.textContent).toBe(
      "Whether your phone's clock is set ahead. So your teacher knows your phone's times may be off (section 2).",
    );
    // The section it points to says it too.
    expect(TEACHER_SEES).toContain("If your phone's clock is set ahead");
  });
});

describe('the privacy policy’s section 6, how long records are kept', () => {
  it('keeps the names of anyone with records at another school, as the retention run does', () => {
    render(<PrivacyPage />);
    const retention = screen.getByRole('region', { name: '6. How long records are kept' });
    const items = within(retention)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items[1]).toBe(
      "After that day, we remove the names and sign-ins of everyone whose records all fall on or before it, unless they also have records at another school that uses Bali. What's left is counts that name no one, such as “3 unlocks in that session”.",
    );
  });
});

/** Each teacher action the portal counts for PostHog (A3a's `PORTAL_EVENTS`), in the policy's words. */
const SAID: Record<PortalEvent, string> = {
  portal_signed_in: 'when they sign in',
  portal_class_created: 'create a class',
  portal_block_registered: 'register a block',
  portal_session_started: 'start, end or extend a session',
  portal_session_ended: 'start, end or extend a session',
  portal_session_extended: 'start, end or extend a session',
  portal_question_asked: 'ask a question',
  portal_slides_shown: 'show slides',
  portal_present_opened: 'open Present',
  portal_report_opened: 'open a report or a recap',
  portal_recap_opened: 'open a report or a recap',
};

describe('the privacy policy names PostHog, which Bali’s server sends its counts to (A4)', () => {
  /** Section 1's part on what is collected automatically: each item its bold lead, then its words. */
  const automatic = () =>
    within(
      screen.getByRole('heading', {
        level: 3,
        name: 'Automatically, from the portal and our servers',
      }).nextElementSibling as HTMLElement,
    ).getAllByRole('listitem');

  it('no longer says there are no analytics or tracking tools, and still promises no tracking cookies or ads', () => {
    render(<PrivacyPage />);
    const words = screen.getByRole('main').textContent ?? '';
    expect(words).not.toMatch(/no analytics/i);
    expect(words).not.toMatch(/tracking or advertising tools/i);
    expect(
      within(screen.getByRole('region', { name: 'The short version' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      "Bali quiets a student's iPhone during class and shows the teacher who is focused.",
      'Bali never sees your screen, your messages, where you are, or which apps you have.',
      "We don't sell your information, show ads, or use advertising tools or tracking cookies.",
      'Your school decides to use Bali. We hold class records for the school and use them only to run Bali for that school and to count how Bali is used (section 1).',
      'You can delete your account from the app at any time.',
    ]);
    expect(automatic().map((item) => item.querySelector('strong')?.textContent)).toEqual([
      'No tracking cookies and no ads.',
      'Error reports.',
      'Usage counts.',
      'Server logs.',
    ]);
  });

  it('says what the counts hold, what PostHog never gets, totals when only one or two tap in, and how long they stay', () => {
    render(<PrivacyPage />);
    expect(automatic()[2]?.textContent).toBe(
      "Usage counts. To learn how Bali is used, our server sends counts to PostHog, our analytics provider. For each class session: when it starts, ends or is extended and how it ends, how many students are in the class and how many tapped in, how long it was set to run and how long it ran, the class's total focus minutes, and its Emergency Unlocks as one number, never split by reason. For each teacher: when they sign in, create a class, register a block, start, end or extend a session, ask a question, show slides, open Present, or open a report or a recap. PostHog files every count under a teacher, known to it only by the ID Bali gives their account. It never gets anyone's name or email, a student's ID, a web address, or anything typed into Bali. A session's totals add up the students who tapped in, and they're sent however few that is. When a class has only one or two students, or only one or two tap in, its counts are those students' own numbers. Only our server talks to PostHog. The portal has no PostHog script or cookie, the iPhone app sends PostHog nothing, and PostHog never sees your IP address. PostHog keeps the counts for 1 year, then deletes them, though not always right away. Deleting an account or disposing of a school's data doesn't remove them sooner (sections 6 and 7).",
    );
  });

  it('no longer says each teacher’s ID stays at PostHog after their counts go: PostHog keeps no profile of them (A6)', () => {
    render(<PrivacyPage />);
    const words = screen.getByRole('main').textContent ?? '';
    expect(words).not.toContain('ID stays');
    expect(words).not.toContain('even after their counts are deleted');
    expect(words).not.toMatch(/outlast/i);
  });

  it('names every teacher action the portal counts', () => {
    render(<PrivacyPage />);
    const usage = automatic()[2]?.textContent ?? '';
    for (const event of PORTAL_EVENTS) expect(usage, event).toContain(SAID[event]);
  });

  it('lists PostHog among the service providers, after Sentry', () => {
    render(<PrivacyPage />);
    const sharing = screen.getByRole('region', { name: '4. Who we share it with' });
    const providers = within(within(sharing).getAllByRole('list')[1])
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');
    expect(providers.map((item) => item.split(':')[0])).toEqual([
      'Amazon Web Services',
      'Railway',
      'Vercel',
      'Sentry',
      'PostHog',
      'Apple',
    ]);
    expect(providers[4]).toBe('PostHog: usage counts that name no one (section 1)');
  });

  it('says the counts stay at PostHog after a school’s disposal and an account’s deletion, a teacher’s too', () => {
    render(<PrivacyPage />);
    const retention = within(screen.getByRole('region', { name: '6. How long records are kept' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(retention[2]).toBe(
      'A school can ask us in writing to dispose of all its data. We remove names from everyone at the school and delete its classes, blocks and pending invite codes. Usage counts stay at PostHog until it deletes them (section 1).',
    );
    expect(retention.at(-1)).toBe(
      'Error reports, usage counts and server logs are kept as section 1 says.',
    );
    const deletion = screen.getByRole('region', { name: '7. Deleting your account' });
    expect(within(deletion).getAllByRole('listitem')[3]?.textContent).toBe(
      "Usage counts stay at PostHog until it deletes them (section 1). They never named you, but when a class had only one or two students, or only one or two tapped in, a session's counts are those students' own numbers, yours included.",
    );
    expect(deletion.querySelector('ul + p')?.textContent).toBe(
      "A teacher with a class or a registered block deletes their account through their school, so a class isn't left without its teacher. Email us to start. When a teacher's account is deleted, their usage counts stay at PostHog under the ID Bali gave their account, until PostHog deletes them (section 1).",
    );
  });

  it('says what else changed with it: how the records are used, the FERPA section and encryption', () => {
    render(<PrivacyPage />);
    expect(screen.getByRole('region', { name: '3. How we use it' }).textContent).toContain(
      'keep the service working and secure, count how Bali is used (section 1), answer support emails',
    );
    expect(
      screen.getByRole('region', { name: '5. Schools and student records (FERPA)' }).textContent,
    ).toContain(
      "use them only for the school's purposes, apart from the usage counts in section 1.",
    );
    expect(screen.getByRole('region', { name: '9. Security' }).textContent).toContain(
      'Railway, Amazon Web Services, Sentry and PostHog encrypt the data they store for us.',
    );
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

describe('the pages say what is true now: no pilot rule on email addresses, and the App Store (2026-11-07)', () => {
  it('has the terms say who Bali is for in two lines, students and teachers, with no pilot line', () => {
    render(<TermsPage />);
    const who = screen.getByRole('region', { name: '1. Who Bali is for' });
    expect(
      within(who)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Students 13 or older, in a class whose teacher uses Bali.',
      'Teachers at a school that has an agreement with us. A teacher account needs an invite code we make for that school.',
    ]);
  });

  it('has the terms name no pilot, so they stay true once it ends: section 7 says Bali may have bugs', () => {
    render(<TermsPage />);
    const changes = screen.getByRole('region', { name: '7. Changes to Bali' });
    expect(changes.querySelector('p')?.textContent).toBe(
      "Bali is new and still changing, and it may have bugs. We may change, pause or stop features. We'll avoid doing it during class hours when we can.",
    );
    expect(screen.getByRole('main').textContent).not.toMatch(/pilot/i);
  });

  it('has the privacy policy name Apple for the App Store, not TestFlight', () => {
    render(<PrivacyPage />);
    const sharing = screen.getByRole('region', { name: '4. Who we share it with' });
    const providers = within(within(sharing).getAllByRole('list')[1])
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(providers.at(-1)).toBe(
      "Apple: App Store delivery, Screen Time on your phone, and class-start notifications when they're on",
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
