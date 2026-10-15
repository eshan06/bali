'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ReportsView } from '@/components/reports-list';
import { useMe } from '@/components/shell';
import { getAccessToken } from '@/lib/auth';
import { FIRST_READ, type ReadAt, readSessions, type SessionList, startRead } from '@/lib/reports';
import { useApi } from '@/lib/use-api';

/** A class's id, as the API mints them: anything else in `?class=` names no class. */
const CLASS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reports, in the menu (PV13; the Reports board): one class at a time, the one `?class=` names,
 * else the first of the account's classes, its sessions R3's, 20 a page.
 */
export default function ReportsPage() {
  const api = useApi();
  const router = useRouter();
  const { home } = useMe();
  const param = useSearchParams().get('class');
  const asked = param !== null && CLASS_ID.test(param) ? param : null;
  // An account the 13+ check never passed is read no further (PV15): it has no classes.
  const classes = home === null ? null : home.kind === 'invite' ? [] : home.me.classes;
  const classId = asked ?? classes?.[0]?.id ?? null;
  const [list, setList] = useState(FIRST_READ);
  const [open, setOpen] = useState<string | null>(null);
  // Each read's number: one answered after a newer read started, or the class changed, is dropped.
  const latest = useRef(0);

  // Another class picked, or none left: its list starts afresh in this same render, so no row or
  // report of the last class is ever drawn, or read, under this one's id.
  const [listed, setListed] = useState(classId);
  if (listed !== classId) {
    setListed(classId);
    setList(FIRST_READ);
    setOpen(null);
  }

  async function read(from: SessionList, at: ReadAt) {
    if (classId === null) return;
    const mine = ++latest.current;
    setList(startRead(from, at));
    const next = await readSessions(api, classId, from, at);
    if (mine === latest.current) setList(next);
  }

  // As the page opens and each time another class is picked: that class's newest page.
  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    if (classId === null) return;
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
