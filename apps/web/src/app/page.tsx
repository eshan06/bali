'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { nextTurn, TeacherHome } from '@/components/home';
import { InviteEntry } from '@/components/invite-code';
import { useMe } from '@/components/shell';
import { StudentHome } from '@/components/student-home';
import { getAccessToken } from '@/lib/auth';
import { AFTER_BELL_MS, nextBell } from '@/lib/classes';

/**
 * The home (decision 13), where the account belongs. A teacher's is v2's Home (PV17a; Main,
 * HomeIdle, HomeNew): the greeting and the date, each class once, the block's card, and a new
 * teacher's first class card, its Create a class to Classes' New class (#421). The account is the
 * shell's one read (`useMe`: the 13+ check, then `/v1/me`), which the side menu names too, read
 * again as the page opens; each answer is dated as it lands. By this computer's clock the greeting
 * and the date turn at noon, 5 PM and midnight, and a live class's chip goes at its bell, the
 * account read again just after it, as Classes reads it. A student who said 13+ in the app gets their
 * own home (W3; StudentHome); an account the 13+ check never passed, the invite page with its line
 * for students (Invite, PV15). Until the account answers, the shell says Loading… or its failure in
 * the page's place (PV5b); the page sits in the shell's frame beside the menu (PV5).
 */
export default function HomePage() {
  const router = useRouter();
  const { home, error, load, refresh } = useMe();
  const [now, setNow] = useState(() => Date.now());
  // Set by a redeem (T2): the greeting takes focus once the account is read as a teacher.
  const redeemed = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const classes = home?.kind === 'teacher' ? home.me.classes : null;
  // The next bell by this computer's clock, when a row's Live chip goes; and the first bell of the
  // classes the last read counts running, past ones too, when the account is read again.
  const bell = classes === null ? null : nextBell(classes, now);
  const readAt = classes === null ? null : nextBell(classes, 0);
  const teacher = classes !== null;

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    load();
  }, [load, router]);

  // The account teaches now (T2): who it is, read again, so Home shows, the side menu with it; no
  // reload.
  const onTeacher = useCallback(() => {
    redeemed.current = true;
    load(true);
  }, [load]);

  useEffect(() => {
    if (!redeemed.current || home?.kind !== 'teacher') return;
    redeemed.current = false;
    heading.current?.focus();
  }, [home]);

  // Each read's answer is dated as it lands: "today" stays today's after a Try again past midnight.
  useEffect(() => setNow(Date.now()), [home]);

  // The next change by the clock alone: a bell, or the greeting's or the date's turn.
  useEffect(() => {
    if (!teacher) return;
    const next = Math.min(bell ?? Infinity, nextTurn(now));
    const timer = window.setTimeout(() => setNow(Math.max(Date.now(), next)), next - Date.now());
    return () => window.clearTimeout(timer);
  }, [teacher, bell, now]);

  // Back in view, the clock read afresh: a timer can sleep with the computer (a tab left overnight).
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);

  // Once per bell: an answer still counting it running (a clock well ahead) waits for a later read.
  useEffect(() => {
    if (readAt === null) return;
    const timer = window.setTimeout(load, readAt + AFTER_BELL_MS - Date.now());
    return () => window.clearTimeout(timer);
  }, [readAt, load]);

  // The account not read yet, or its read failed: the shell says so in this page's place
  // (`AccountUnread`), as it does on every page.
  if (home === null) return null;
  if (home.kind === 'student') {
    return <StudentHome me={home.me} failed={error !== null} onRead={load} onRefresh={refresh} />;
  }
  // Never through the 13+ check: the invite code, in place of the classes or a 403.
  if (home.kind === 'invite') return <InviteEntry forStudents onTeacher={onTeacher} />;
  return (
    <TeacherHome
      ref={heading}
      me={home.me}
      failed={error}
      now={now}
      onRead={() => load()}
      onRetry={refresh}
    />
  );
}
