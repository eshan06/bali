import type { Metadata } from 'next';
import { LegalLayout, LegalSection } from '@/components/legal/LegalLayout';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms for using Bali.',
};

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@trybali.com';

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" updated="June 16, 2026">
      <p>
        These terms govern use of Bali, a classroom focus tool. By creating an account or using the
        service you agree to them. If you are using Bali on behalf of a school, you agree on the
        school&apos;s behalf.
      </p>

      <LegalSection heading="Who can use Bali">
        <p>
          Bali is for use by teachers and schools. Teacher accounts are for educators (18 or older).
          Students use the Bali iOS app under their school&apos;s direction; students do not create
          accounts on this website.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>
          Use Bali only for legitimate classroom focus sessions. Do not attempt to access classes,
          rosters, or student data you are not authorized to see, probe or disrupt the service, or use it
          to harass or surveil students. Focus status is a conversation starter, not a verdict.
        </p>
      </LegalSection>

      <LegalSection heading="Not a safety or monitoring system">
        <p>
          Bali is a focus aid, not a safety, security, location, or emergency-response system. The
          emergency unlock is always available to a student and is designed to work on the device even
          without a network; the notification to the teacher is best-effort and depends on connectivity.
          Do not rely on Bali for student safety or supervision. The Phone app always remains available
          during a session — calls and 911 are never blocked.
        </p>
      </LegalSection>

      <LegalSection heading="Your data">
        <p>
          Your use of Bali is also governed by our{' '}
          <a className="font-semibold text-ink-brand underline underline-offset-2" href="/privacy">
            Privacy Policy
          </a>
          . Schools retain ownership of their data and may request export or deletion.
        </p>
      </LegalSection>

      <LegalSection heading="Availability and changes">
        <p>
          We work to keep Bali available and reliable but provide it on an &quot;as is&quot; basis without
          warranties. We may update, suspend, or discontinue features, and we may revise these terms; if
          we make material changes we will update the date above.
        </p>
      </LegalSection>

      <LegalSection heading="Limitation of liability">
        <p>
          To the extent permitted by law, Bali is not liable for indirect or consequential damages arising
          from use of the service. Nothing here limits rights that cannot be limited under applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about these terms? Email{' '}
          <a className="font-semibold text-ink-brand underline underline-offset-2" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
