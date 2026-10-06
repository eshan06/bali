import { Eye, EyeOff } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { buttonClass } from '@/components/button';
import { CARD } from '@/components/card';
import { Lockup } from '@/components/mark';
import { TEXT_LINK, TextLink } from '@/components/text-link';

/*
 * The public help page (Phase 5, P4): read without signing in, so it calls no API and keeps no
 * state. It renders per request like every page (the root layout's `dynamic`), for the CSP nonce.
 * The teacher-sees lists are the student app's own (`ConsentCard`, ios/Bali/UI/JoinView.swift),
 * word for word; if the app's lists change, these change with them.
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
];

const TEACHER_NEVER_SEES = [
  "Your screen, your apps, or what's in them",
  'Your messages or where you are',
];

const SECTIONS = [
  { id: 'students', title: 'For students' },
  { id: 'teachers', title: 'For teachers' },
  { id: 'privacy', title: 'Privacy' },
  { id: 'help', title: 'Get help' },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 border-t border-border-default pt-10"
    >
      <h2 id={`${id}-title`} className="text-h2">
        {title}
      </h2>
      <div className="mt-6 space-y-8">{children}</div>
    </section>
  );
}

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-h3">{title}</h3>
      <div className="mt-2 max-w-prose space-y-3 text-text-secondary">{children}</div>
    </div>
  );
}

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-body sm:px-10 sm:py-16">
      <Lockup />
      <h1 className="mt-8 text-h1">Help</h1>
      <p className="mt-4 max-w-prose text-body-lg text-text-secondary">
        Bali keeps your iPhone out of the way during class. You tap your phone on your
        teacher&apos;s Bali block, your apps go quiet until the bell, and Emergency Unlock gets you
        out any time.
      </p>

      <nav aria-label="On this page" className="mt-8">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={buttonClass('secondary')}>
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-12 space-y-12">
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
          {/* The app's consent card's two lists (ConsentCard), as two cards. */}
          <div id="teacher-sees" className="grid scroll-mt-6 gap-2">
            <div className={CARD}>
              <h3 className="flex items-center gap-2 text-h3">
                <Eye size={20} aria-hidden="true" className="shrink-0 text-text-brand" />
                What your teacher sees
              </h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-text-secondary">
                {TEACHER_SEES.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div className={CARD}>
              <h3 className="flex items-center gap-2 text-h3">
                <EyeOff size={20} aria-hidden="true" className="shrink-0 text-text-brand" />
                What your teacher never sees
              </h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-text-secondary">
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
              A teacher account needs an invite code. Email us at the address under Get help and
              we&apos;ll send you one. Sign in to the{' '}
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
              minutes, every unlock with its reason, and every time protection went off. Reports, on
              the class page, lists your past sessions; open one to see its recap. Reports show the
              class as a whole and never rank students.
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
              The full privacy policy and terms are coming from Bali&apos;s lawyer. Until they
              arrive, the <TextLink href="/privacy">privacy policy</TextLink> and{' '}
              <TextLink href="/terms">terms</TextLink> pages show the sections each will have.
            </p>
          </Question>
        </Section>

        <Section id="help" title="Get help">
          <div className="max-w-prose text-text-secondary">
            <p>
              Email{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className={`${TEXT_LINK} break-all`}>
                {SUPPORT_EMAIL}
              </a>
              . Tell us whether you&apos;re a student or a teacher, and what happened.
            </p>
          </div>
        </Section>
      </div>
    </main>
  );
}
