import type { Metadata } from 'next';
import { LegalLayout } from '@/components/legal/LegalLayout';
import { ContactForm } from './ContactForm';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Reach the Bali team — demos, support, and privacy requests.',
};

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@trybali.com';
const PRIVACY = process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? 'privacy@trybali.com';

export default function ContactPage() {
  return (
    <LegalLayout title="Contact">
      <p>
        We&apos;re a small team and we read everything. Tell us what you need and we&apos;ll get back
        to you.
      </p>

      <ContactForm contactEmail={CONTACT} privacyEmail={PRIVACY} />
    </LegalLayout>
  );
}
