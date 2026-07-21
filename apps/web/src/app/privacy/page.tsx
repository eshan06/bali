import type { Metadata } from 'next';
import { LegalLayout, LegalSection } from '@/components/legal/LegalLayout';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What Bali collects, what it never collects, and how student data is handled — written for schools and families.',
};

const CONTACT = process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? 'privacy@trybali.com';

/**
 * Plain-language privacy policy grounded in what the product actually does: status-only
 * focus data, no screen/app/message/browsing/location collection. Schools should review
 * with counsel before adoption; this reflects current data practices, not legal advice.
 */
export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="June 16, 2026">
      <p>
        Bali is a classroom focus tool for K-12 schools. A teacher starts a timed focus session;
        students tap a desk tag on their own iPhone, and Apple Screen Time pauses their apps until the
        bell. This policy explains exactly what we collect, what we deliberately never collect, and how
        we handle student information. It is written to be read by teachers, school administrators, and
        families.
      </p>

      <LegalSection heading="The short version (our privacy contract)">
        <p>
          Bali shows a teacher <strong>focus status</strong> — whether a student is focused, on a pass,
          or has used the emergency unlock — and the times those things happen. That is all. The same
          contract appears in the student app on day one and never grows without asking again.
        </p>
        <p>
          Bali <strong>never</strong> sees or collects screen contents, the apps a student keeps, their
          messages, their browsing, or their location. We cannot build usage or location reports because
          we never receive that data.
        </p>
      </LegalSection>

      <LegalSection heading="Who is responsible for student data">
        <p>
          The school (or district) decides to use Bali and directs how it is used. For student records,
          the school is the controller and Bali acts as a <strong>school official / service provider</strong>{' '}
          processing data on the school&apos;s behalf under FERPA, and collects the limited student
          information below only with the school&apos;s authorization, consistent with COPPA&apos;s
          school-consent framework. We use student information only to provide the service to that school
          — never for advertising, and we never sell it.
        </p>
      </LegalSection>

      <LegalSection heading="What we collect">
        <p>
          <strong>Teacher accounts:</strong> name, email, and school name, via sign-in (email/password or
          Google through Amazon Cognito), plus notification preferences.
        </p>
        <p>
          <strong>Students:</strong> a first and last name (so the teacher can recognize them on the
          roster and live grid), and the class memberships they join.
        </p>
        <p>
          <strong>Focus session activity:</strong> when a student taps in and out, their focus status
          during a session, emergency-unlock times and an optional reason if the student chooses to share
          one, and teacher-granted passes. This is the event history that powers the live grid, the
          teacher logs/reports, and the read-only parent summary.
        </p>
      </LegalSection>

      <LegalSection heading="What we never collect">
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>Screen contents, screenshots, or anything shown on a device</li>
          <li>The list of apps a student keeps, or which apps they open</li>
          <li>Messages, email, or browsing history</li>
          <li>Location — Bali never requests it</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Parent links">
        <p>
          A teacher can share a read-only link that shows a single student&apos;s focus summary — the same
          status-only information, no login required. The link is an unguessable token, can be revoked at
          any time by the teacher, and reveals nothing about screens, apps, messages, or location.
        </p>
      </LegalSection>

      <LegalSection heading="How information is shared">
        <p>
          We do not sell personal information and we do not share it for advertising. We use a small set
          of infrastructure providers to run the service (for example, Amazon Web Services for
          authentication and database hosting), who process data only to provide hosting to us.
        </p>
      </LegalSection>

      <LegalSection heading="Retention and deletion">
        <p>
          Schools may request export or deletion of their data, including student records, by contacting
          us. When a school ends its use of Bali, we delete or return school-controlled data on request.
          Account holders can edit their profile in Settings at any time.
        </p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          Connections are encrypted in transit (TLS). Access to school data is scoped per teacher and per
          class, and authentication is handled by Amazon Cognito. We aim to collect as little as possible —
          the strongest protection for data we never hold.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>
          If we make material changes we will update the date above and, where appropriate, notify the
          schools using Bali.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions, or a data export/deletion request? Email{' '}
          <a className="font-semibold text-ink-brand underline underline-offset-2" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
