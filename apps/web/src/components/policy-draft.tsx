import type { ReactNode } from 'react';

import { LockupBar } from '@/components/mark';
import { TEXT_LINK, TextLink } from '@/components/text-link';

/*
 * The draft outline a policy page shows until the lawyer's words arrive (Phase 6, C2a): a notice
 * at the top saying so, then the sections the page will have, each marked as a placeholder, then
 * where to ask. Public like the help page (P4): no API call, no state, rendered per request like
 * every page (the root layout's `dynamic`), and no Sign out or side menu (the shell skips it). It
 * makes no legal claim of its own: where a fact is already public on the help page, a line links
 * there instead of restating it. Drawn as PV1 draws it in v2's look (PrivacyPage, TermsPage; built
 * in PV15), its words unchanged: under the white bar with Bali, one column 860 px wide at most, the
 * notice as a calm grey box, the outline as one card, each section's title beside a Placeholder
 * chip in Not here's tint.
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
      <main className="mx-auto max-w-215 px-9 pt-7.5 pb-14 text-body max-sm:px-4 max-sm:pt-5.5 max-sm:pb-10">
        <div className="flex flex-col gap-5.5">
          <h1 className="text-page-title text-balance">{title}</h1>
          <div className="rounded-sm border border-border-default bg-surface-sunken px-4 py-3">
            <p className="font-semibold text-pretty">{notice.lead}</p>
            <p className="mt-0.75 text-pretty">{notice.body}</p>
          </div>

          {/* One card on its own (DESIGN.md §4), its sections between hairlines. */}
          <div className="rounded-md border border-border-default bg-surface-card px-5 shadow-1">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="scroll-mt-6 border-t border-border-default py-4.5 first:border-t-0"
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 id={`${section.id}-title`} className="text-h3">
                    {section.title}
                  </h2>
                  <span className="rounded-full border-[1.5px] border-transparent bg-state-notjoined-bg px-2.5 py-0.75 text-caption font-medium whitespace-nowrap text-state-notjoined-fg">
                    Placeholder
                  </span>
                </div>
                <p className="mt-1.5 text-pretty text-text-secondary">{section.placeholder}</p>
              </section>
            ))}
          </div>

          <section id="contact" aria-labelledby="contact-title" className="scroll-mt-6">
            <h2 id="contact-title" className="text-h3">
              Contact
            </h2>
            <p className="mt-1.5 text-pretty text-text-secondary">
              Email{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className={`${TEXT_LINK} break-all`}>
                {SUPPORT_EMAIL}
              </a>{' '}
              with any question.
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
