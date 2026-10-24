import { Eye, EyeOff } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CARD_ALONE } from '@/components/card';
import { LockupBar } from '@/components/mark';
import { QUIET_LINK, TEXT_LINK, TextLink } from '@/components/text-link';

/*
 * The public help page (Phase 5, P4): read without signing in, so it calls no API and keeps no
 * state. It renders per request like every page (the root layout's `dynamic`), for the CSP nonce.
 * The teacher-sees lists are the student app's own (`ConsentCard`, ios/Bali/UI/JoinView.swift),
 * word for word; if the app's lists change, these change with them. Drawn as PV1 draws it in v2's
 * look (SupportPage; built in PV15), its words unchanged: under the white bar with Bali, one
 * column 860 px wide at most, each section a card.
 */

export const metadata: Metadata = {
  title: 'Bali help',
  description: 'How Bali works for students and teachers, and how to reach us.',
};

const SUPPORT_EMAIL = 'eshan.shah@vanderbilt.edu';

const TEACHER_SEES = [
  'Your focus status: focused, unlocked, or Screen Time off',
  'If Bali stops hearing from your phone during class, and when it last did',
  'When you tap in, and when class ends for you',
  'When you unlock, and the reason if you share one',
  'If you leave this class',
  "Your answers to questions, counted only in the class's totals",
];

const TEACHER_NEVER_SEES = [
  "Your screen, your apps, or what's in them",
  'Your messages or where you are',
  'Which answer is yours, or whether you answered',
];

/** A list of what a teacher sees, in a calm grey box (SupportPage), two side by side. */
const SEEN =
  'min-w-0 flex-[1_1_300px] rounded-sm border border-border-default bg-surface-sunken px-4 py-3';

const SECTIONS = [
  { id: 'students', title: 'For students' },
  { id: 'teachers', title: 'For teachers' },
  { id: 'privacy', title: 'Privacy' },
  { id: 'help', title: 'Get help' },
];

/** A section: a card on its own (v2's look, the SupportPage board), its questions 18 px apart. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`flex scroll-mt-6 flex-col gap-4.5 ${CARD_ALONE}`}
    >
      <h2 id={`${id}-title`} className="text-h3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-h3">{title}</h3>
      <div className="flex flex-col gap-1.5 text-text-secondary">{children}</div>
    </div>
  );
}

export default function SupportPage() {
  return (
    <>
      <LockupBar />
      <main className="mx-auto flex max-w-215 flex-col gap-5.5 px-9 pt-7.5 pb-14 text-body max-sm:px-4 max-sm:pt-5.5 max-sm:pb-10">
        <div>
          <h1 className="text-page-title text-balance">Help</h1>
          <p className="mt-2 text-text-secondary">
            Bali keeps your iPhone out of the way during class. You tap your phone on your
            teacher&apos;s Bali block, your apps go quiet until the bell, and Emergency Unlock gets
            you out any time.
          </p>
          <nav aria-label="On this page" className="mt-5.5">
            <ul className="flex flex-wrap items-center gap-x-5.5 gap-y-2.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className={QUIET_LINK}>
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <Section id="students" title="For students">
          <Question title="Join a class">
            <p>
              Get the class code from your teacher and enter it in the Bali app. Before you join,
              Bali shows you the class, its teacher, and what that teacher sees.
            </p>
          </Question>
          <Question title="Tap in">
            <p>
              When class starts, hold your iPhone to your teacher&apos;s Bali block. Your apps go
              quiet until the bell. Tap before your teacher starts class and Bali waits. Your phone
              locks when class starts, as long as Bali is open. No need to tap again.
            </p>
          </Question>
          <Question title="Emergency Unlock">
            <p>
              Hold Emergency Unlock for a second and your apps open right away. It works without a
              connection, and nobody has to say yes. You can pick a reason (bathroom, nurse or
              other) or skip it.
            </p>
            <p>
              Your teacher sees that you unlocked, and the reason if you pick one. Ready to focus
              again before the bell? Tap Lock my apps again.
            </p>
          </Question>
          <Question title="Calls and emergencies">
            <p>Calls, FaceTime, Messages and Emergency SOS keep working the whole time.</p>
          </Question>
          <Question title="When class ends">
            <p>
              Your apps come back at the bell on their own, even if Bali is closed or your phone is
              offline.
            </p>
          </Question>
          <Question title="Turning it off">
            <p>
              You approve Screen Time for Bali on your own iPhone, and you can turn it off in
              Settings any time. If you do during class, your teacher sees Screen Time off.
            </p>
          </Question>
          {/* The app's consent card's two lists (ConsentCard), side by side in calm grey boxes. */}
          <div id="teacher-sees" className="flex scroll-mt-6 flex-wrap items-start gap-3.5">
            <div className={SEEN}>
              <h3 className="flex items-center gap-2 text-h3">
                <Eye size={18} aria-hidden="true" className="shrink-0 text-text-brand" />
                What your teacher sees
              </h3>
              <ul className="mt-2.5 flex flex-col gap-1.5 text-text-secondary">
                {TEACHER_SEES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div className={SEEN}>
              <h3 className="flex items-center gap-2 text-h3">
                <EyeOff size={18} aria-hidden="true" className="shrink-0 text-text-brand" />
                What your teacher never sees
              </h3>
              <ul className="mt-2.5 flex flex-col gap-1.5 text-text-secondary">
                {TEACHER_NEVER_SEES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <Section id="teachers" title="For teachers">
          <Question title="Get an invite code">
            <p>
              A teacher account needs an invite code made for your school. To ask for one, email us
              at the address under Get help. Sign in to the{' '}
              <TextLink href="/login">teacher portal</TextLink> and enter it once to set up your
              account for teaching. A code works once, and expires 14 days after we make it.
            </p>
          </Question>
          <Question title="Register your block">
            <p>
              On the portal&apos;s home page, under Your block, type the ID written on your block
              (10 letters and digits) and press Register block. Your students tap that block to join
              your session.
            </p>
          </Question>
          <Question title="Run a class">
            <p>
              Create a class and give your students its join code. When class starts, open the class
              and start a session. A live grid shows who&apos;s focused, who unlocked, and whose
              protection is off (they turned Screen Time off on their phone).
            </p>
          </Question>
          <Question title="Reports">
            <p>
              When a session ends, its recap shows who joined, the class&apos;s focus and silent
              minutes, every unlock with its reason, and every time protection went off. Reports, in
              the menu, lists each class&apos;s past sessions; open one to see its recap. Reports
              show the class as a whole and never rank students.
            </p>
          </Question>
        </Section>

        <Section id="privacy" title="Privacy">
          <Question title="What Bali keeps">
            <p>
              Your name, the email you sign in with, the classes you&apos;re in, a random ID for
              your copy of the app, and the moments listed under What your teacher sees.
            </p>
          </Question>
          <Question title="What Bali never sees">
            <p>
              Your screen, your messages or where you are. Bali doesn&apos;t know which apps you
              have: it quiets every app it can, so there&apos;s no list to read.
            </p>
          </Question>
          <Question title="Privacy policy and terms">
            <p>
              Read the full <TextLink href="/privacy">privacy policy</TextLink> and{' '}
              <TextLink href="/terms">terms</TextLink>.
            </p>
          </Question>
        </Section>

        <Section id="help" title="Get help">
          <p>
            Email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className={`${TEXT_LINK} break-all`}>
              {SUPPORT_EMAIL}
            </a>
            . Tell us whether you&apos;re a student or a teacher, and what happened.
          </p>
        </Section>
      </main>
    </>
  );
}
