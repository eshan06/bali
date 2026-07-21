import type { Metadata } from 'next';
import { LegalLayout, LegalSection } from '@/components/legal/LegalLayout';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach the Bali team — demos, support, and privacy requests.',
};

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@trybali.com';
const PRIVACY = process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? 'privacy@trybali.com';

export default function ContactPage() {
  const mail = (addr: string) => (
    <a className="font-semibold text-ink-brand underline underline-offset-2" href={`mailto:${addr}`}>
      {addr}
    </a>
  );

  return (
    <LegalLayout title="Contact">
      <p>We&apos;re a small team and we read everything. The fastest way to reach us is email.</p>

      <LegalSection heading="Book a demo or ask about Bali">
        <p>
          For a 20-minute walkthrough with a real session, or any pre-sales question, email {mail(CONTACT)}{' '}
          — or use the &quot;Book a demo&quot; form on the home page.
        </p>
      </LegalSection>

      <LegalSection heading="Support for teachers and schools">
        <p>
          Already using Bali and need a hand? Email {mail(CONTACT)} and tell us your school and what you
          were trying to do — we&apos;ll get back to you.
        </p>
      </LegalSection>

      <LegalSection heading="Privacy, data, and compliance">
        <p>
          For privacy questions, a data-processing agreement, or a data export/deletion request, email{' '}
          {mail(PRIVACY)}. See our{' '}
          <a className="font-semibold text-ink-brand underline underline-offset-2" href="/privacy">
            Privacy Policy
          </a>{' '}
          for what we collect and what we never do.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
