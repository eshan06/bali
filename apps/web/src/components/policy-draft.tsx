import type { ReactNode } from 'react';

import { LockupBar } from '@/components/mark';
import { TEXT_LINK, TextLink } from '@/components/text-link';

/*
 * The draft outline a policy page shows until the lawyer's words arrive (Phase 6, C2a): a notice
 * at the top saying so, then the sections the page will have, each marked as a placeholder, then
 * where to ask. Public like the help page (P4): no API call, no state, rendered per request like
 * every page (the root layout's `dynamic`), and no Sign out bar (`PortalBar` skips it). It makes
 * no legal claim of its own: where a fact is already public on the help page, a line links there
 * instead of restating it. Drawn as the approved Entry & info design draws it: the notice as
 * DESIGN.md §4's calm banner, and the outline as one document sheet, each section's title with a
 * small Placeholder badge.
 */

const SUPPORT_EMAIL = 'eshan.shah@vanderbilt.edu';

export interface PolicySection {
  id: string;
  title: string;
  /** What the final text will cover, said as a placeholder; may link to the help page. */
  placeholder: ReactNode;
}

export function PolicyDraft({
  title,
  notice,
  sections,
  related,
}: {
  title: string;
  /** The draft notice: its first sentence, set bold, and the rest. */
  notice: { lead: string; body: string };
  sections: PolicySection[];
  /** The other policy page, linked at the end beside the help page. */
  related: { href: string; label: string };
}) {
  return (
    <>
      <LockupBar />
      <main className="mx-auto max-w-280 px-4 pt-8 pb-16 text-body sm:px-10 sm:pt-12 sm:pb-24">
        <div className="max-w-180">
          <h1 className="text-h1 text-balance">{title}</h1>
          <div className="mt-6 rounded-sm border border-border-default bg-surface-sunken px-5 py-4">
            <p className="text-body-lg font-semibold text-pretty">{notice.lead}</p>
            <p className="mt-1 text-pretty">{notice.body}</p>
          </div>

          {/* One document sheet: a card on its own (DESIGN.md §4), its sections between hairlines. */}
          <div className="mt-10 rounded-lg border border-border-default bg-surface-card px-4 shadow-1 sm:px-6">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="scroll-mt-6 border-t border-border-default py-6 first:border-t-0"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 id={`${section.id}-title`} className="text-h3">
                    {section.title}
                  </h2>
                  <span className="rounded-xs bg-surface-sunken px-2 py-1 text-label text-text-secondary uppercase">
                    Placeholder
                  </span>
                </div>
                <p className="mt-2 max-w-[62ch] text-pretty text-text-secondary">
                  {section.placeholder}
                </p>
              </section>
            ))}
          </div>

          <section id="contact" aria-labelledby="contact-title" className="mt-12 scroll-mt-6">
            <h2 id="contact-title" className="text-h3">
              Contact
            </h2>
            <p className="mt-2 max-w-[62ch] text-pretty text-text-secondary">
              Email{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className={`${TEXT_LINK} break-all`}>
                {SUPPORT_EMAIL}
              </a>{' '}
              with any question.
            </p>
          </section>

          <nav aria-label="Help and policies" className="mt-12 border-t border-border-default pt-8">
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
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
