import type { Metadata } from 'next';

import { PolicyDraft, TextLink } from '@/components/policy-draft';

/*
 * The terms' draft outline (Phase 6, C2a): the sections the lawyer's text will have, each marked
 * as a placeholder. It states no fact of its own; how a class works is already on the help page,
 * so that line links there.
 */

export const metadata: Metadata = {
  title: 'Bali terms of use (draft)',
  description:
    "A draft outline of Bali's terms of use. The final text is coming from Bali's lawyer.",
};

export default function TermsPage() {
  return (
    <PolicyDraft
      title="Terms of use"
      notice={{
        lead: "These aren't the terms yet.",
        body: "The final text is coming from Bali's lawyer. Until it arrives, this page shows the sections they will have, each marked as a placeholder. Nothing here is a promise.",
      }}
      sections={[
        {
          id: 'who',
          title: 'Who Bali is for',
          placeholder: 'The final text will say who can use Bali.',
        },
        {
          id: 'account',
          title: 'Your account',
          placeholder: 'The final text will cover your account and signing in.',
        },
        {
          id: 'in-class',
          title: 'Using Bali in class',
          placeholder: (
            <>
              The final text will cover tapping in, Emergency Unlock and the bell. Until then, the
              help page says <TextLink href="/support#students">how a class works</TextLink>.
            </>
          ),
        },
        {
          id: 'leaving',
          title: 'Leaving Bali',
          placeholder: 'The final text will cover leaving a class and deleting your account.',
        },
        {
          id: 'changes',
          title: 'Changes to these terms',
          placeholder: 'The final text will say how these terms can change.',
        },
      ]}
      related={{ href: '/privacy', label: 'Privacy policy' }}
    />
  );
}
