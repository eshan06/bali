import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * The policy pages (C2a) are a marked draft outline until the lawyer's words arrive: each says so
 * at the top, every section goes through the one renderer that marks it as a placeholder, the
 * support address is a mailto link, and the pages are reachable from /login and /support with no
 * Sign out bar. Read from the sources, as the help page's test reads its own.
 */
function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

/** The file past its header comment: the words, not the notes about them. */
function words(source: string): string {
  return source.split('*/').slice(1).join('');
}

const pages = {
  privacy: read('./privacy/page.tsx'),
  terms: read('./terms/page.tsx'),
};
const draft = read('../components/policy-draft.tsx');
const login = read('./login/page.tsx');
const support = read('./support/page.tsx');
const bar = read('../components/portal-bar.tsx');

describe('the policy pages are a marked draft outline', () => {
  it.each(Object.entries(pages))(
    '/%s says at the top that the final text is coming from the lawyer and nothing on it is a promise',
    (_, page) => {
      expect(page).toContain('<PolicyDraft');
      expect(page).toMatch(/lead: "Th(is|ese) (isn't|aren't) the .* yet\."/);
      expect(page).toContain("The final text is coming from Bali's lawyer.");
      expect(page).toContain('Nothing here is a promise.');
    },
  );

  it('renders per request like every page: no segment override', () => {
    for (const source of [...Object.values(pages), draft]) {
      expect(source).not.toMatch(
        /export\s+(const\s+(dynamic|revalidate)\b|.*generateStaticParams)/,
      );
      expect(source).not.toContain("'use client'");
    }
  });

  it('every section is rendered through the one place that marks it as a placeholder', () => {
    // The map over `sections` and its Placeholder badge sit in the same renderer: a section
    // can't skip it.
    expect(draft).toMatch(/sections\.map\([\s\S]*>\s*Placeholder\s*<\/span>[\s\S]*<\/section>/);
    expect(draft.match(/>\s*Placeholder\s*</g)).toHaveLength(1);
  });

  it('has the sections the owner named, then Contact with the support address as a mailto link', () => {
    for (const title of [
      'What Bali collects',
      'What your teacher sees',
      'How long records are kept',
      'Deleting your account',
    ]) {
      expect(pages.privacy).toContain(`title: '${title}'`);
    }
    for (const title of [
      'Who Bali is for',
      'Your account',
      'Using Bali in class',
      'Leaving Bali',
      'Changes to these terms',
    ]) {
      expect(pages.terms).toContain(`title: '${title}'`);
    }
    expect(draft).toContain('id="contact"');
    expect(draft).toContain("const SUPPORT_EMAIL = 'eshan.shah@vanderbilt.edu';");
    // The same address the help page gives.
    expect(support).toContain("const SUPPORT_EMAIL = 'eshan.shah@vanderbilt.edu';");
    expect(draft).toContain('href={`mailto:${SUPPORT_EMAIL}`}');
  });

  it('links to the help page where a fact is already public there, at anchors it has', () => {
    const anchors = [
      ...Object.values(pages)
        .join('')
        .matchAll(/href="\/support#([\w-]+)"/g),
    ].map((m) => m[1]);
    expect(anchors).toEqual(expect.arrayContaining(['privacy', 'teacher-sees', 'students']));
    for (const anchor of anchors) {
      expect(support, `/support#${anchor}`).toMatch(new RegExp(`id(="|: ')${anchor}['"]`));
    }
  });

  it('is linked from /login and from /support, which no longer says "coming soon"', () => {
    for (const href of ['/support', '/privacy', '/terms']) {
      expect(login).toContain(`href: '${href}'`);
    }
    for (const href of ['/privacy', '/terms']) {
      expect(support).toContain(`href="${href}"`);
    }
    expect(support).not.toContain('coming soon');
  });

  it('shows no Sign out bar, like /login and /support', () => {
    // The pattern as PortalBar declares it, tested on paths rather than pinned as text.
    const source = /const SIGNED_OUT_PATHS = \/(.+)\/;/.exec(bar)?.[1];
    expect(source).toBeDefined();
    const signedOut = new RegExp(source ?? '');
    for (const path of ['/privacy', '/terms', '/privacy/', '/support', '/login']) {
      expect(signedOut.test(path), path).toBe(true);
    }
    for (const path of ['/', '/classes/abc', '/privacy-notice']) {
      expect(signedOut.test(path), path).toBe(false);
    }
  });

  it('no new em dash in their words', () => {
    for (const source of [...Object.values(pages), draft]) {
      expect(words(source)).not.toMatch(/[—–]/);
    }
  });
});
