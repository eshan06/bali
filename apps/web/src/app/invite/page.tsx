'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { InviteEntry } from '@/components/invite-code';
import { useMe } from '@/components/shell';

/**
 * The invite page at an address of its own (W3): where a student's home with no classes sends a
 * teacher who set up the app first ("Setting up a teacher account?"; decision 13), `/` being that
 * student's home. The page Home shows an account the 13+ check never passed, its line for students
 * only for one (`InviteEntry`). Once the account teaches, after a redeem here too, its classes at
 * `/`. Until the account is read, the shell says Loading… or its failure in the page's place.
 */
export default function InviteRoute() {
  const router = useRouter();
  const { home, load } = useMe();

  useEffect(() => {
    if (home?.kind === 'teacher') router.replace('/');
  }, [home, router]);

  if (home === null || home.kind === 'teacher') return null;
  return <InviteEntry forStudents={home.kind === 'invite'} onTeacher={() => load(true)} />;
}
