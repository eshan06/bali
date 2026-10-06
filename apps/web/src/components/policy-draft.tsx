import type { ReactNode } from 'react';

import { Lockup } from '@/components/mark';
import { TEXT_LINK, TextLink } from '@/components/text-link';

/*
 * The draft outline a policy page shows until the lawyer's words arrive (Phase 6, C2a): a notice
 * at the top saying so, then the sections the page will have, each line marked as a placeholder,
 * then where to ask. Public like the help page (P4): no API call, no state, rendered per request
 * like every page (the root layout's `dynamic`), and no Sign out bar (`PortalBar` skips it). It
 * makes no legal claim of its own: where a fact is already public on the help page, a line links
 * there instead of restating it. Drawn in Soft premium (D2c-2): the notice as DESIGN.md §4's calm
 * banner, and the outline as one card per section in a tray.
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
    <main className="mx-auto max-w-2xl px-4 py-12 text-body sm:px-10 sm:py-16">
      <Lockup />
      <h1 className="mt-8 text-h1">{title}</h1>
      <p className="mt-6 rounded-sm border border-border-default bg-surface-sunken px-4 py-3 text-body-lg">
        <strong className="font-semibold">{notice.lead}</strong> {notice.body}
      </p>

      <div className="mt-10 grid gap-2 rounded-lg bg-surface-sunken p-2">
        {sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-title`}
            className="scroll-mt-6 rounded-md border border-transparent bg-surface-card p-4 shadow-1 dark:border-border-default"
          >
            <h2 id={`${section.id}-title`} className="text-h3">
              {section.title}
            </h2>
            <p className="mt-2 max-w-prose text-text-secondary">
              <span className="font-semibold text-text-primary">Placeholder.</span>{' '}
              {section.placeholder}
            </p>
          </section>
        ))}
      </div>

      <section id="contact" aria-labelledby="contact-title" className="mt-10 scroll-mt-6">
        <h2 id="contact-title" className="text-h3">
          Contact
        </h2>
        <p className="mt-2 max-w-prose text-text-secondary">
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
    </main>
  );
}
