'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ReportsView } from '@/components/reports-list';
import { useMe } from '@/components/shell';
import { getAccessToken } from '@/lib/auth';
import { FIRST_READ, type ReadAt, readSessions, type SessionList, startRead } from '@/lib/reports';
import { useApi } from '@/lib/use-api';

/**
 * Reports, in the menu (PV13; the Reports board): one class at a time, the one `?class=` names,
 * else the first of the account's classes, its sessions R3's, 20 a page.
 */
export default function ReportsPage() {
  const api = useApi();
  const router = useRouter();
  const { me } = useMe();
  const asked = useSearchParams().get('class');
  const classes = me?.classes ?? null;
  const classId = asked ?? classes?.[0]?.id ?? null;
  const [list, setList] = useState(FIRST_READ);
  const [open, setOpen] = useState<string | null>(null);
  // Each read's number: one answered after a newer read started, or the class changed, is dropped.
  const latest = useRef(0);

  async function read(from: SessionList, at: ReadAt) {
    if (classId === null) return;
    const mine = ++latest.current;
    setList(startRead(from, at));
    const next = await readSessions(api, classId, from, at);
    if (mine === latest.current) setList(next);
  }

  // As the page opens and each time another class is picked: that class's newest page, none open.
  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    if (classId === null) return;
    setOpen(null);
    void read(FIRST_READ, 'newest');
    return () => {
      latest.current += 1;
    };
  }, [api, classId, router]);

  return (
    <ReportsView
      classes={classes}
      classId={classId}
      list={list}
      open={open}
      onToggle={(id) => setOpen(open === id ? null : id)}
      onRead={(at) => void read(list, at)}
    />
  );
}
