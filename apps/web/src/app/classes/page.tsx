'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ClassesView } from '@/components/classes';
import { NewClass, type NewClassHandle } from '@/components/new-class';
import { useMe } from '@/components/shell';
import { getAccessToken } from '@/lib/auth';
import { AFTER_BELL_MS, nextBell } from '@/lib/classes';

/**
 * Classes, in the menu (PV16; the Classes board): the teacher's classes from the shell's one read
 * of the account (`useMe`), read again as the page opens, so each card's students and sessions are
 * this moment's, and dated by this computer's clock as each read lands; after every create too, from
 * New class's dialog (PV16b). At a live class's bell by that clock its Live chip goes, and the
 * account is read again just after it, so its last session shows. Anyone but a teacher goes to
 * their own home. Until the account is read, the shell says Loading… or its failure in the page's
 * place (PV5b). Opened from Home's Create a class (`?new`, HomeNew), New class opens as the page
 * shows, as ClassesNew draws it.
 */
export default function ClassesPage() {
  const router = useRouter();
  const asked = useSearchParams().has('new');
  const { home, error, load } = useMe();
  const newClass = useRef<NewClassHandle>(null);
  const [now, setNow] = useState(() => Date.now());
  const classes = home?.kind === 'teacher' ? home.me.classes : null;
  const shown = classes !== null;
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

  // Once: the address forgets it, so a reload or a way back here opens the page alone.
  useEffect(() => {
    if (!asked || !shown) return;
    newClass.current?.open();
    window.history.replaceState(null, '', '/classes');
  }, [asked, shown]);

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
  return (
    <ClassesView
      classes={classes}
      failed={error}
      now={now}
      onRead={() => load()}
      onNew={() => newClass.current?.open()}
    >
      <NewClass ref={newClass} onAnswer={() => load()} />
    </ClassesView>
  );
}
