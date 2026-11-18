'use client';

import { useId } from 'react';

import { CARD_ENTRY } from './card';
import { EntryPage, STAGE_FOOT } from './entry-page';
import { TextLink } from './text-link';

/**
 * A student's home with the student web off (LO15, the owner's order of 2026-11-18; ARCHITECTURE,
 * Web portal, decision 9), drawn first on v2's canvas as intermediate states of signing in
 * (StudentWebOff, StudentWebOffNoClass, StudentWebOffPhone): one entry card under the shell's bar
 * with Sign out, as the invite page has it, saying the web is for teachers and Bali is in the app on
 * their phone. Nothing of the student's is shown, and nothing read for it beyond the shell's read
 * that says who they are: no class, no phone, no read again. In no class yet (`inClass` false), a
 * teacher who set up the app first keeps their way to the invite page, as the student home gives
 * it, there alone since a student in a class can't redeem a code (Live lesson, decision 13).
 */
export function StudentWebOff({ inClass }: { inClass: boolean }) {
  const id = useId();
  return (
    <EntryPage signedIn>
      <section aria-labelledby={id} className={CARD_ENTRY}>
        <h1 id={id} className="text-entry-title">
          You&apos;re signed in as a student
        </h1>
        <p className="-mt-2.5 text-body text-text-secondary">
          Use Bali in the app on your phone. This site is for teachers.
        </p>
      </section>
      {inClass ? null : (
        <p className={STAGE_FOOT}>
          Setting up a teacher account? <TextLink href="/invite">Enter your invite code</TextLink>
        </p>
      )}
    </EntryPage>
  );
}
