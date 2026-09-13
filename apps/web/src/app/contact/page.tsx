import type { Metadata } from 'next';
import { LegalLayout, LegalSection } from '@/components/legal/LegalLayout';
import { ContactForm } from './ContactForm';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Reach the Bali team — demos, support, and privacy requests.',
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
      <p>
        We&apos;re a small team and we read everything. Tell us what you need and we&apos;ll get back
        to you.
      </p>

      <ContactForm contactEmail={CONTACT} privacyEmail={PRIVACY} />

      <LegalSection heading="Prefer to email directly?">
        <p>
          Demos and support: {mail(CONTACT)}. Privacy questions, a data-processing agreement, or a
          data export or deletion request: {mail(PRIVACY)}. See our{' '}
          <a className="font-semibold text-ink-brand underline underline-offset-2" href="/privacy">
            Privacy Policy
          </a>{' '}
          for what we collect and what we never do.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
