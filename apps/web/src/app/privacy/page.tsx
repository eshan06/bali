import type { Metadata } from 'next';

import { PolicyDraft } from '@/components/policy-draft';
import { TextLink } from '@/components/text-link';

/*
 * The privacy policy's draft outline (Phase 6, C2a): the sections the lawyer's text will have,
 * each marked as a placeholder. It states no fact of its own; what the help page already says in
 * plain words (what Bali keeps, what a teacher sees) is linked, not restated.
 */

export const metadata: Metadata = {
  title: 'Bali privacy policy (draft)',
  description:
    "A draft outline of Bali's privacy policy. The final text is coming from Bali's lawyer.",
  // Kept out of search results while it is a placeholder; the lawyer's text removes this.
  robots: { index: false },
};

export default function PrivacyPage() {
  return (
    <PolicyDraft
      title="Privacy policy"
      notice={{
        lead: "This isn't the privacy policy yet.",
        body: "The final text is coming from Bali's lawyer. Until it arrives, this page shows the sections it will have, each marked as a placeholder. Nothing here is a promise.",
      }}
      sections={[
        {
          id: 'collects',
          title: 'What Bali collects',
          placeholder: (
            <>
              The final text will list what Bali collects and why. Until then, the help page says{' '}
              <TextLink href="/support#privacy">what Bali keeps</TextLink>.
            </>
          ),
        },
        {
          id: 'teacher-sees',
          title: 'What your teacher sees',
          placeholder: (
            <>
              The final text will cover what your teacher sees. Until then, the help page lists{' '}
              <TextLink href="/support#teacher-sees">what your teacher sees</TextLink> and what they
              never see.
            </>
          ),
        },
        {
          id: 'retention',
          title: 'How long records are kept',
          placeholder: 'The final text will say how long Bali keeps records.',
        },
        {
          id: 'deletion',
          title: 'Deleting your account',
          placeholder: 'The final text will say how to delete your account and what that removes.',
        },
      ]}
      related={{ href: '/terms', label: 'Terms' }}
    />
  );
}
