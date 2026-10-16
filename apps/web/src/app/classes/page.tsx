'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ClassesView } from '@/components/classes';
import { NewClass, type NewClassHandle } from '@/components/new-class';
import { useMe } from '@/components/shell';
import { getAccessToken } from '@/lib/auth';
import { nextBell } from '@/lib/classes';

/**
 * Classes, in the menu (PV16; the Classes board): the teacher's classes from the shell's one read
 * of the account (`useMe`), read again as the page opens, so each card's students and sessions are
 * this moment's; after every create too. At a live class's bell by this computer's clock its Live
 * chip goes and the account is read again, so its last session shows. Anyone but a teacher goes
 * to their own home. Until the account is read, the shell says Loading… or its failure in the
 * page's place (PV5b).
 */
export default function ClassesPage() {
  const router = useRouter();
  const { home, error, load } = useMe();
  const newClass = useRef<NewClassHandle>(null);
  const [now, setNow] = useState(() => Date.now());
  const classes = home?.kind === 'teacher' ? home.me.classes : null;
  const bell = classes === null ? null : nextBell(classes, now);

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

  useEffect(() => {
    if (bell === null) return;
    const timer = window.setTimeout(() => {
      setNow(Math.max(Date.now(), bell));
      load();
    }, bell - Date.now());
    return () => window.clearTimeout(timer);
  }, [bell, load]);

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
