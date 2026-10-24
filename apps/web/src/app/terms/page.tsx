import type { Metadata } from 'next';

import { PolicyDraft } from '@/components/policy-draft';
import { TextLink } from '@/components/text-link';

/*
 * The terms of use (Phase 6, C2-text): the owner's draft of 2026-10-24, `docs/legal/terms-of-use.md`,
 * its body as written: its date under the title, its link to the privacy policy this portal's own
 * `/privacy`, and the notes for the lawyer left off, never public. It stands until the lawyer's
 * version replaces it in place (C2).
 */

export const metadata: Metadata = {
  title: 'Bali terms of use',
  description:
    'Who can use Bali, your account, using Bali in class, leaving Bali, and how these terms change.',
  // Kept out of search results while it is the owner's draft; the lawyer's version removes this.
  robots: { index: false },
};

export default function TermsPage() {
  return (
    <PolicyDraft
      title="Terms of use"
      date="Last updated October 24, 2026"
      intro={
        <p>
          These terms are an agreement between you and Eshan Shah and Jonathan Bani, who run Bali
          (“Bali”, “we”, “us”), for using the Bali iPhone app and the Bali portal (together,
          “Bali”). By creating an account or using Bali, you agree to them. If you don’t agree,
          don’t use Bali. Our <TextLink href="/privacy">privacy policy</TextLink> is part of these
          terms.
        </p>
      }
      sections={[
        {
          id: 'who',
          title: '1. Who Bali is for',
          body: (
            <>
              <ul>
                <li>
                  <strong>Students</strong> 13 or older, in a class whose teacher uses Bali.
                </li>
                <li>
                  <strong>Teachers</strong> at a school that has an agreement with us. A teacher
                  account needs an invite code we make for that school.
                </li>
                <li>
                  <strong>During the Vanderbilt pilot</strong>, accounts are open only to
                  @vanderbilt.edu addresses, and the app is a test version delivered through Apple’s
                  TestFlight.
                </li>
              </ul>
              <p>
                If your school has an agreement with us, that agreement also applies. Where it and
                these terms disagree, the school agreement wins.
              </p>
            </>
          ),
        },
        {
          id: 'account',
          title: '2. Your account',
          body: (
            <ul>
              <li>Give your real name and keep it current. Your teacher sees it.</li>
              <li>
                Keep your password to yourself. You’re responsible for what happens under your
                account. Tell us right away if you think someone else got in.
              </li>
              <li>One account per person, on your own iPhone.</li>
            </ul>
          ),
        },
        {
          id: 'in-class',
          title: '3. Using Bali in class',
          body: (
            <>
              <ul>
                <li>
                  <strong>Tapping in.</strong> When you hold your iPhone to your teacher’s Bali
                  block, your apps go quiet until the bell, through Apple’s Screen Time. Calls,
                  FaceTime, Messages and Emergency SOS keep working.
                </li>
                <li>
                  <strong>Emergency Unlock.</strong> Always available, with or without a connection,
                  and nobody has to approve it. Every unlock is recorded, and your teacher sees it,
                  along with the reason if you pick one.
                </li>
                <li>
                  <strong>The bell.</strong> Your apps come back on their own at the end of the
                  session, even if Bali is closed or your phone is offline.
                </li>
                <li>
                  <strong>Screen Time.</strong> You can turn it off for Bali in Settings at any
                  time. Your teacher sees when you do during class.
                </li>
                <li>
                  <strong>Your school’s rules come first.</strong> Bali is a tool your teacher
                  chooses. How a class handles unlocks or phones is up to your teacher and school,
                  not to us.
                </li>
              </ul>
              <h3>Teachers also agree to</h3>
              <ul>
                <li>Use Bali only for the classes they teach, under their school’s policies.</li>
                <li>Keep their block and its ID to themselves, and tell us if a block is lost.</li>
                <li>
                  Upload only slides and questions they have the right to share, with nothing in
                  them that breaks the law or their school’s rules.
                </li>
                <li>
                  Treat what Bali shows about students as school records, under their school’s
                  privacy rules.
                </li>
              </ul>
              <h3>Nobody may</h3>
              <ul>
                <li>
                  Try to get around Bali’s records, for example by faking a tap, a block or a
                  check-in, or by changing the app.
                </li>
                <li>
                  Try to see another person’s information, or get into an account or class that
                  isn’t theirs.
                </li>
                <li>
                  Overload, scan or attack Bali’s servers, or copy Bali to build a competing
                  product.
                </li>
                <li>Use Bali to harass anyone, or to break the law.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'safety',
          title: '4. Bali is not a safety device',
          body: (
            <p>
              Bali never blocks emergency calls, and Emergency Unlock always works. Still, don’t
              rely on Bali in an emergency. If your phone has no signal, is off or is broken, Bali
              can’t help. Bali also can’t promise that every app will be quieted, since that depends
              on Apple’s Screen Time.
            </p>
          ),
        },
        {
          id: 'leaving',
          title: '5. Leaving Bali',
          body: (
            <ul>
              <li>
                <strong>Leave a class</strong> in the app any time a session isn’t running.
              </li>
              <li>
                <strong>Delete your account</strong> in the app (Me → Delete account). Our privacy
                policy, section 7, says what that removes and what stays as counts that name no one.
                A teacher with a class or block deletes theirs through their school.
              </li>
              <li>
                <strong>We may suspend or close an account</strong> that breaks these terms or puts
                others at risk. If we do, we’ll say why unless the law stops us, and Emergency
                Unlock keeps working on that phone until the bell.
              </li>
              <li>
                <strong>If Bali shuts down</strong>, we’ll tell schools in advance and handle their
                records as their agreements say.
              </li>
            </ul>
          ),
        },
        {
          id: 'changes',
          title: '6. Changes to these terms',
          body: (
            <p>
              If we change these terms, we’ll update the date at the top. If a change matters, we’ll
              say so in the app and on the portal before it applies. If you keep using Bali after
              that, you accept the new terms. If you don’t accept them, delete your account.
            </p>
          ),
        },
        {
          id: 'changes-to-bali',
          title: '7. Changes to Bali',
          body: (
            <p>
              Bali is new and still changing, and the pilot version may have bugs. We may change,
              pause or stop features. We’ll avoid doing it during class hours when we can.
            </p>
          ),
        },
        {
          id: 'ownership',
          title: '8. Ownership and feedback',
          body: (
            <p>
              We own Bali’s software, name and design. Teachers keep their own slides and questions,
              and give us permission to store and show them to their class only to run Bali. If you
              send us ideas, we may use them freely, without owing you anything.
            </p>
          ),
        },
        {
          id: 'disclaimers',
          title: '9. Disclaimers',
          body: (
            <p>
              BALI IS PROVIDED “AS IS” AND “AS AVAILABLE”. AS FAR AS THE LAW ALLOWS, WE DISCLAIM ALL
              WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR
              PURPOSE AND NON-INFRINGEMENT. WE DON’T PROMISE THAT BALI WILL ALWAYS WORK, BE
              ERROR-FREE, OR QUIET EVERY APP.
            </p>
          ),
        },
        {
          id: 'liability',
          title: '10. Limitation of liability',
          body: (
            <p>
              AS FAR AS THE LAW ALLOWS: (A) WE ARE NOT LIABLE FOR LOST DATA, LOST PROFITS, OR ANY
              INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES ARISING FROM BALI;
              AND (B) OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO THE GREATER OF $50 AND WHAT
              YOU PAID US IN THE SIX MONTHS BEFORE THE CLAIM. BALI IS FREE TO STUDENTS, SO THAT IS
              USUALLY $50. A SCHOOL AGREEMENT MAY SET ITS OWN LIMITS, AND THEN THOSE APPLY TO THAT
              SCHOOL.
            </p>
          ),
        },
        {
          id: 'disputes',
          title: '11. Disputes and governing law',
          body: (
            <p>
              These terms are governed by the laws of the State of Tennessee, without regard to its
              conflict-of-law rules. Claims go to the state or federal courts in Davidson County,
              Tennessee, except small claims, which may go to small-claims court. Before going to
              court, email us and give us 30 days to try to fix it.
            </p>
          ),
        },
        {
          id: 'state-notices',
          title: '12. State notices',
          body: (
            <ul>
              <li>
                <strong>California.</strong> Bali is provided by Eshan Shah and Jonathan Bani and is
                free to students. To complain or ask about Bali, email us. You may also contact the
                Complaint Assistance Unit of the California Department of Consumer Affairs, 1625 N.
                Market Blvd., Suite N112, Sacramento, CA 95834, (800) 952-5210 (Cal. Civ. Code
                §&nbsp;1789.3).
              </li>
              <li>
                <strong>Other states.</strong> Residents of Colorado, Connecticut, Virginia, Nevada
                and other states with privacy laws: the privacy policy, section 10, says how to see,
                correct, delete or get a copy of your information. We don’t sell personal
                information.
              </li>
            </ul>
          ),
        },
        {
          id: 'general',
          title: '13. General',
          body: (
            <ul>
              <li>
                <strong>Accessibility.</strong> We aim to meet WCAG 2.1 AA in the portal and to
                support VoiceOver and large text in the app. Tell us about anything that gets in
                your way.
              </li>
              <li>
                <strong>Messages from us.</strong> We may contact you by email or in the app. That
                counts as written notice.
              </li>
              <li>
                <strong>Whole agreement.</strong> These terms, the privacy policy and any school
                agreement are the whole agreement about Bali. If part of these terms can’t be
                enforced, the rest still applies. Not enforcing a term isn’t giving it up. You can’t
                transfer these terms. We can transfer them only along with Bali itself, and only as
                the school agreements allow.
              </li>
              <li>
                <strong>Export laws.</strong> Don’t use Bali in breach of U.S. export laws.
              </li>
            </ul>
          ),
        },
      ]}
      contact="14. Contact"
      related={{ href: '/privacy', label: 'Privacy policy' }}
    />
  );
}
