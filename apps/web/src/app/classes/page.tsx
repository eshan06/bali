'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ClassesView } from '@/components/classes';
import { useMe } from '@/components/shell';
import { getAccessToken } from '@/lib/auth';
import { AFTER_BELL_MS, nextBell } from '@/lib/classes';

/**
 * Classes, in the menu (PV16a; the Classes board): the teacher's classes from the shell's one read
 * of the account (`useMe`), read again as the page opens, so each card's students and sessions are
 * this moment's, and dated by this computer's clock as each read lands. At a live class's bell by
 * that clock its Live chip goes, and the account is read again just after it, so its last session
 * shows. Anyone but a teacher goes to their own home. Until the account is read, the shell says
 * Loading… or its failure in the page's place (PV5b).
 */
export default function ClassesPage() {
  const router = useRouter();
  const { home, error, load } = useMe();
  const [now, setNow] = useState(() => Date.now());
  const classes = home?.kind === 'teacher' ? home.me.classes : null;
  // The next bell by this computer's clock, when a card's Live chip goes; and the first bell of
  // the classes the last read counts running, past ones too, when the account is read again.
  const bell = classes === null ? null : nextBell(classes, now);
  const readAt = classes === null ? null : nextBell(classes, 0);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    load();
  }, [load, router]);

  useEffect(() => {
    if (home !== null && home.kind !== 'teacher') router.replace('/');
  }, [home, router]);

  // Each read's answer is dated as it lands: "today" stays today's after a Try again past midnight.
  useEffect(() => setNow(Date.now()), [home]);

  useEffect(() => {
    if (bell === null) return;
    const timer = window.setTimeout(() => setNow(Math.max(Date.now(), bell)), bell - Date.now());
    return () => window.clearTimeout(timer);
  }, [bell]);

  // Once per bell: an answer still counting it running (a clock well ahead) waits for a later read.
  useEffect(() => {
    if (readAt === null) return;
    const timer = window.setTimeout(load, readAt + AFTER_BELL_MS - Date.now());
    return () => window.clearTimeout(timer);
  }, [readAt, load]);

  if (classes === null) return null;
  return <ClassesView classes={classes} failed={error} now={now} onRead={() => load()} />;
}
