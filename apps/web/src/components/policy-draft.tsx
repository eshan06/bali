import type { ReactNode } from 'react';

import { LockupBar } from '@/components/mark';
import { TEXT_LINK, TextLink } from '@/components/text-link';

/*
 * A policy page, the privacy policy or the terms (Phase 6, C2): the owner's drafts of 2026-10-24
 * (`docs/legal/`), their words as written, until the lawyer's version replaces them in place
 * (C2-text). Its date under the title, what the policy covers, its sections, then where to ask.
 * Public like the help page (P4): no API call, no state, rendered per request like every page (the
 * root layout's `dynamic`), and no Sign out or side menu (the shell skips it). Drawn as PV1 draws it
 * in v2's look (PrivacyPage, TermsPage; built in PV15), with no new board (the owner, 2026-10-24):
 * under the white bar with Bali, one column 860 px wide at most, the sections as one card between
 * hairlines, each section's words in paragraphs and lists, its own headings in the body's size.
 */

const SUPPORT_EMAIL = 'eshan.shah@vanderbilt.edu';

export interface PolicySection {
  id: string;
  title: string;
  /** The section's words: paragraphs, lists, and an `h3` over each part a section has. */
  body: ReactNode;
}

/**
 * The policy's words, its intro's and each section's: 10 px between paragraphs and lists, a list's
 * items 6 px apart (a list in an item too), a part's heading semibold in the body's size and 8 px
 * further from what is over it, and bold in the same weight, both in the primary ink.
 */
const WORDS =
  'flex flex-col gap-2.5 text-text-secondary [&_h3]:mt-2 [&_h3]:font-semibold [&_h3]:text-text-primary [&_li+li]:mt-1.5 [&_li>ul]:mt-1.5 [&_strong]:font-semibold [&_strong]:text-text-primary [&_ul]:list-disc [&_ul]:pl-5';

export function PolicyDraft({
  title,
  date,
  intro,
  sections,
  contact,
  related,
}: {
  title: string;
  /** When the words took effect or last changed, the quiet line under the title. */
  date: string;
  /** Who runs Bali and what the policy covers, before its sections. */
  intro: ReactNode;
  sections: PolicySection[];
  /** The last section's title: where to ask, the support address. */
  contact: string;
  /** The other policy page, linked at the end beside the help page. */
  related: { href: string; label: string };
}) {
  return (
    <>
      <LockupBar />
      <main className="mx-auto max-w-215 px-9 pt-7.5 pb-14 text-body max-sm:px-4 max-sm:pt-5.5 max-sm:pb-10">
        <div className="flex flex-col gap-5.5">
          <div>
            <h1 className="text-page-title text-balance">{title}</h1>
            <p className="mt-0.5 text-meta text-text-secondary">{date}</p>
          </div>
          <div className={WORDS}>{intro}</div>

          {/* One card on its own (DESIGN.md §4), its sections between hairlines. */}
          <div className="rounded-md border border-border-default bg-surface-card px-5 shadow-1">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="scroll-mt-6 border-t border-border-default py-4.5 first:border-t-0"
              >
                <h2 id={`${section.id}-title`} className="text-h3">
                  {section.title}
                </h2>
                <div className={`mt-1.5 ${WORDS}`}>{section.body}</div>
              </section>
            ))}
          </div>

          <section id="contact" aria-labelledby="contact-title" className="scroll-mt-6">
            <h2 id="contact-title" className="text-h3">
              {contact}
            </h2>
            <p className="mt-1.5 text-text-secondary">
              Email{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className={`${TEXT_LINK} break-all`}>
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </section>

          <nav aria-label="Help and policies" className="border-t border-border-default pt-5.5">
            <ul className="flex flex-wrap gap-x-4.5 gap-y-1.5 text-meta">
              <li>
                <TextLink href="/support">Help and questions</TextLink>
              </li>
              <li>
                <TextLink href={related.href}>{related.label}</TextLink>
              </li>
            </ul>
          </nav>
        </div>
      </main>
    </>
  );
}
