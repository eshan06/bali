import type { Metadata } from 'next';

import { PolicyDraft } from '@/components/policy-draft';
import { TEACHER_NEVER_SEES, TEACHER_SEES } from '@/components/teacher-sees';

/*
 * The privacy policy (Phase 6, C2-text): the owner's drafted words of 2026-10-24, kept here and
 * nowhere else (`docs/legal/privacy-policy.md` holds only the notes for the lawyer, who reviews this
 * page): its effective date under the title, what Bali collects as a list (each row of the draft's
 * table what, then why), and section 2's two lists the app's own, word for word (`teacher-sees.ts`,
 * #130). It stands until the lawyer's version replaces it in place (C2).
 */

export const metadata: Metadata = {
  title: 'Bali privacy policy',
  description:
    'What Bali collects, what your teacher sees, how long records are kept, and how to delete your account.',
  // Kept out of search results while it is the owner's draft; the lawyer's version removes this.
  robots: { index: false },
};

export default function PrivacyPage() {
  return (
    <PolicyDraft
      title="Privacy policy"
      date="Effective October 24, 2026"
      intro={
        <>
          <p>
            <strong>Who we are:</strong> Bali is run by Eshan Shah and Jonathan Bani (“Bali”, “we”,
            “us”).
          </p>
          <p>
            This policy covers the Bali iPhone app and the Bali portal at
            https://bali-portal.vercel.app (together, “Bali”).
          </p>
        </>
      }
      sections={[
        {
          id: 'short-version',
          title: 'The short version',
          body: (
            <ul>
              <li>
                Bali quiets a student&apos;s iPhone during class and shows the teacher who is
                focused.
              </li>
              <li>
                Bali never sees your screen, your messages, where you are, or which apps you have.
              </li>
              <li>
                We don&apos;t sell your information, show ads, or use tracking or advertising tools.
              </li>
              <li>
                Your school decides to use Bali. We hold class records for the school and use them
                only to run Bali for that school.
              </li>
              <li>You can delete your account from the app at any time.</li>
            </ul>
          ),
        },
        {
          id: 'collects',
          title: '1. What Bali collects',
          body: (
            <>
              <h3>If you are a student</h3>
              <ul>
                <li>
                  <strong>The email you sign in with.</strong> To sign you in. It&apos;s held by our
                  sign-in provider (Amazon Cognito), not in Bali&apos;s own database.
                </li>
                <li>
                  <strong>Your name, as you set it in the app.</strong> So your teacher knows
                  who&apos;s who on the class grid and in reports.
                </li>
                <li>
                  <strong>The classes you join, and when you leave one.</strong> To put you in the
                  right class.
                </li>
                <li>
                  <strong>
                    What happens to your phone during class: when you tap in, when you&apos;re
                    focused, when you use Emergency Unlock, when you go back to focus, when Screen
                    Time is turned off, when Bali stops hearing from your phone and when it hears
                    from it again, and when class ends for you.
                  </strong>{' '}
                  This is what Bali does. Your teacher sees it (section 2).
                </li>
                <li>
                  <strong>
                    A check-in from your phone about every 30 seconds during class, and when it last
                    arrived.
                  </strong>{' '}
                  So Bali can tell your teacher honestly whether your phone is still focused.
                </li>
                <li>
                  <strong>
                    The reason for an Emergency Unlock, only if you pick one: bathroom, nurse or
                    other.
                  </strong>{' '}
                  So your teacher knows why. You can always skip it.
                </li>
                <li>
                  <strong>
                    Your answers to class questions: the option you picked and when we got it.
                  </strong>{' '}
                  To count them in the class&apos;s totals. Your teacher never sees which answer is
                  yours.
                </li>
                <li>
                  <strong>That you confirmed you&apos;re 13 or older.</strong> To meet the age rule
                  (section 8). We never store your birth date or your age.
                </li>
                <li>
                  <strong>A random ID for your copy of the app.</strong> To keep your phone&apos;s
                  records in the right order. It isn&apos;t your phone&apos;s serial number or an
                  advertising ID, and it changes if you reinstall.
                </li>
                <li>
                  <strong>
                    A push token from Apple, when class-start notifications are on and you allow
                    them.
                  </strong>{' '}
                  To tell you when class starts. Only Apple&apos;s notification service receives it.
                </li>
                <li>
                  <strong>What you write when you email us.</strong> To answer you.
                </li>
              </ul>
              <h3>If you are a teacher</h3>
              <p>
                Your sign-in email and name, your school, your classes and their join codes, the ID
                of the Bali block you registered, the invite code you redeemed (we keep only a
                scrambled version of it), the questions you write, and the slide decks (PDFs) you
                upload.
              </p>
              <h3>What Bali never collects</h3>
              <p>
                Your screen or anything on it, your messages, calls or contacts, your location, your
                photos, your browsing or search history, your health records, or any advertising ID.{' '}
                <strong>Bali doesn&apos;t know which apps you have.</strong> It quiets every app it
                can, and Apple&apos;s Screen Time doesn&apos;t give Bali a list of your apps to
                read.
              </p>
              <h3>Automatically, from the portal and our servers</h3>
              <ul>
                <li>
                  <strong>No cookies for tracking, no analytics, no ads.</strong> The portal keeps
                  your sign-in in your browser tab&apos;s own storage, which is cleared when the tab
                  closes. It also remembers, on that computer, the session length a teacher last
                  picked. Amazon Cognito&apos;s sign-in page sets its own cookies, only to keep you
                  signed in.
                </li>
                <li>
                  <strong>Error reports.</strong> When something breaks on our servers or in the
                  portal, an error report goes to Sentry, our error-reporting provider. We strip
                  names, emails, unlock reasons, sign-in tokens and codes out of these reports
                  before they leave. The iPhone app sends none. Sentry keeps error reports for up to
                  90 days.
                </li>
                <li>
                  <strong>Server logs.</strong> Our hosting providers record basic request
                  information, such as IP addresses and the page or address requested, to run and
                  secure the service. Railway (our servers) keeps these logs for up to 90 days.
                  Vercel (the portal) keeps them for 1 hour.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'teacher-sees',
          title: '2. What your teacher sees',
          body: (
            <>
              <p>Before you join a class, the app shows you this list. Your teacher sees:</p>
              <ul>
                {TEACHER_SEES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p>
                Your teacher <strong>never</strong> sees:
              </p>
              <ul>
                {TEACHER_NEVER_SEES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p>
                Reports show the class as a whole and never rank students. A session&apos;s recap
                lists who joined, every Emergency Unlock with its reason, and every time protection
                went off.
              </p>
              <p>
                Unlock reasons are seen by your teacher. Bali&apos;s team sees them only to run and
                support Bali, never to share or sell. Your school can ask us for its records
                (section 5).
              </p>
              <p>
                You can see your own record in the app: the History screen shows everything recorded
                about you that your teacher can see, in every class you&apos;ve been in.
              </p>
            </>
          ),
        },
        {
          id: 'use',
          title: '3. How we use it',
          body: (
            <p>
              Only to run Bali: sign you in, run class sessions, show teachers their class, write
              reports, keep the service working and secure, answer support emails, and meet our
              legal duties. We don&apos;t use your information for ads, for profiling, or to train
              AI models, and we don&apos;t sell or rent it.
            </p>
          ),
        },
        {
          id: 'sharing',
          title: '4. Who we share it with',
          body: (
            <ul>
              <li>
                <strong>Your teacher and your school</strong>, as section 2 says.
              </li>
              <li>
                <strong>Service providers</strong> that run Bali for us, only for that, and under
                their own security and data-protection terms:
                <ul>
                  <li>
                    Amazon Web Services: sign-in (Amazon Cognito) and slide-deck storage (Amazon S3)
                  </li>
                  <li>Railway: our servers, database and backups</li>
                  <li>Vercel: the portal&apos;s hosting</li>
                  <li>Sentry: error reports, with personal details removed (section 1)</li>
                  <li>
                    Apple: TestFlight and App Store delivery, Screen Time on your phone, and
                    class-start notifications when they&apos;re on
                  </li>
                </ul>
              </li>
              <li>
                <strong>The law.</strong> Only when the law requires it, or to protect
                someone&apos;s safety. If we get a legal demand for a school&apos;s records, we tell
                the school first, unless the law forbids it.
              </li>
              <li>
                <strong>If Bali is sold or merged</strong>, the records go only with this
                policy&apos;s promises, and only as each school&apos;s agreement allows.
              </li>
            </ul>
          ),
        },
        {
          id: 'schools',
          title: '5. Schools and student records (FERPA)',
          body: (
            <p>
              Bali is used by schools. When a school uses Bali, the class records we hold about its
              students are education records the school controls. We hold them as a “school
              official” under the Family Educational Rights and Privacy Act (FERPA), under our
              agreement with the school, and use them only for the school&apos;s purposes. If that
              agreement and this policy disagree, the agreement wins. To see, correct or remove a
              record, you can ask your school or email us. We&apos;ll give the school a copy of
              everything we hold about one student. For a school in a state with its own
              student-privacy law, we follow that law too.
            </p>
          ),
        },
        {
          id: 'retention',
          title: '6. How long records are kept',
          body: (
            <ul>
              <li>
                Each school picks the last day of its school year with us. For the Vanderbilt pilot
                it&apos;s December 18, 2026.
              </li>
              <li>
                After that day, we remove the names and sign-ins of everyone whose records all fall
                on or before it. What&apos;s left is counts that name no one, such as “3 unlocks in
                that session”.
              </li>
              <li>
                A school can ask us in writing to dispose of all its data. We remove names from
                everyone at the school and delete its classes, blocks and pending invite codes.
              </li>
              <li>
                <strong>Backups.</strong> We back up the database every day and every week. Daily
                backups are kept for 6 days and weekly backups for 27 days, then deleted. So
                something deleted from Bali can remain in a backup for up to 27 days, where nobody
                uses it except to recover from a failure.
              </li>
              <li>Error reports and server logs are kept as section 1 says.</li>
            </ul>
          ),
        },
        {
          id: 'deletion',
          title: '7. Deleting your account',
          body: (
            <>
              <p>
                Students can delete their account in the app (Me → Delete account). When you do:
              </p>
              <ul>
                <li>Your name and sign-in are removed, from Bali and from Amazon Cognito.</li>
                <li>You leave every class.</li>
                <li>
                  The class&apos;s records keep their counts but no longer name you. Your answers
                  stay in the class&apos;s totals, attached to no one.
                </li>
                <li>Backups age out as section 6 says.</li>
              </ul>
              <p>
                A teacher with a class or a registered block deletes their account through their
                school, so a class isn&apos;t left without its teacher. Email us to start.
              </p>
            </>
          ),
        },
        {
          id: 'age',
          title: '8. Age',
          body: (
            <p>
              Bali is for people 13 and older. The app asks before you sign up. If you&apos;re under
              13, it stops and Bali records nothing. If we learn we have an account for someone
              under 13, we delete it. The Vanderbilt pilot is for adult students only.
            </p>
          ),
        },
        {
          id: 'security',
          title: '9. Security',
          body: (
            <>
              <ul>
                <li>
                  <strong>On the way:</strong> everything between your device and Bali travels
                  encrypted (HTTPS). Inside our hosting, our servers reach the database over
                  Railway&apos;s private network, which is also encrypted and isn&apos;t reachable
                  from the internet.
                </li>
                <li>
                  <strong>Stored:</strong> Railway, Amazon Web Services and Sentry encrypt the data
                  they store for us. Invite codes are stored only in scrambled form.
                </li>
                <li>
                  <strong>Access:</strong> only Bali&apos;s team can reach the production systems.
                </li>
              </ul>
              <p>
                No system is perfectly secure. If a breach exposes your information, we&apos;ll tell
                your school and you without unreasonable delay, and within 45 days at the latest, or
                sooner if a school agreement or the law requires it.
              </p>
            </>
          ),
        },
        {
          id: 'choices',
          title: '10. Your choices and rights',
          body: (
            <ul>
              <li>
                <strong>See your record:</strong> the app&apos;s History screen, or email us for all
                of it.
              </li>
              <li>
                <strong>Fix your name:</strong> in the app, any time.
              </li>
              <li>
                <strong>Leave a class:</strong> in the app, any time a session isn&apos;t running.
              </li>
              <li>
                <strong>Delete your account:</strong> section 7.
              </li>
              <li>
                <strong>Turn Bali off:</strong> you can turn off Screen Time for Bali in Settings at
                any time. If you do during class, your teacher sees “Screen Time off”.
              </li>
              <li>
                <strong>State privacy rights:</strong> depending on where you live, you may have the
                right to know, correct, delete or get a copy of what we hold. Email us and
                we&apos;ll answer within 45 days. We don&apos;t sell or share personal information
                for advertising, so there&apos;s nothing to opt out of.
              </li>
            </ul>
          ),
        },
        {
          id: 'changes',
          title: '11. Changes to this policy',
          body: (
            <p>
              If we change this policy, we&apos;ll update the date at the top. If a change matters,
              such as collecting something new, we&apos;ll say so in the app and on the portal
              before it applies.
            </p>
          ),
        },
      ]}
      contact="12. Contact us"
      related={{ href: '/terms', label: 'Terms' }}
    />
  );
}
