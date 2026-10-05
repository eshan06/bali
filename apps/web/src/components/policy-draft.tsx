import Link from 'next/link';
import type { ReactNode } from 'react';

/*
 * The draft outline a policy page shows until the lawyer's words arrive (Phase 6, C2a): a notice
 * at the top saying so, then the sections the page will have, each line marked as a placeholder,
 * then where to ask. Public like the help page (P4): no API call, no state, rendered per request
 * like every page (the root layout's `dynamic`), and no Sign out bar (`PortalBar` skips it). It
 * makes no legal claim of its own: where a fact is already public on the help page, a line links
 * there instead of restating it.
 */

const SUPPORT_EMAIL = 'eshan.shah@vanderbilt.edu';

const LINK =
  'font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300';

/** A link in the page's words, styled as the help page styles its own. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={LINK}>
      {children}
    </Link>
  );
}

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
    <main className="mx-auto max-w-2xl px-4 py-12 leading-relaxed sm:px-10 sm:py-16">
      <p className="text-sm font-semibold">Bali</p>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-6 max-w-[65ch] rounded-lg border border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
        <p>
          <strong className="font-semibold">{notice.lead}</strong> {notice.body}
        </p>
      </div>

      <div className="mt-12 space-y-10">
        {sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-title`}
            className="scroll-mt-6 border-t border-slate-200 pt-8 dark:border-slate-800"
          >
            <h2 id={`${section.id}-title`} className="text-xl font-semibold">
              {section.title}
            </h2>
            <p className="mt-4 max-w-[65ch] border-l-2 border-dashed border-slate-300 pl-4 text-slate-600 dark:border-slate-700 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-slate-100">Placeholder.</span>{' '}
              {section.placeholder}
            </p>
          </section>
        ))}

        <section
          id="contact"
          aria-labelledby="contact-title"
          className="scroll-mt-6 border-t border-slate-200 pt-8 dark:border-slate-800"
        >
          <h2 id="contact-title" className="text-xl font-semibold">
            Contact
          </h2>
          <p className="mt-4 max-w-[65ch] text-slate-700 dark:text-slate-300">
            Email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className={`${LINK} break-all`}>
              {SUPPORT_EMAIL}
            </a>{' '}
            with any question.
          </p>
        </section>
      </div>

      <nav
        aria-label="Help and policies"
        className="mt-12 border-t border-slate-200 pt-8 text-sm dark:border-slate-800"
      >
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
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
