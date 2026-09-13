import type { Metadata } from 'next';
import { LegalLayout } from '@/components/legal/LegalLayout';
import { FORM_EMAIL } from '@/lib/forms';
import { ContactForm } from './ContactForm';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Reach the Bali team — demos, support, and privacy requests.',
};

export default function ContactPage() {
  return (
    <LegalLayout title="Contact">
      <p>
        We&apos;re a small team and we read everything. Tell us what you need and we&apos;ll get back
        to you.
      </p>

      <ContactForm contactEmail={FORM_EMAIL} privacyEmail={FORM_EMAIL} />
    </LegalLayout>
  );
}
