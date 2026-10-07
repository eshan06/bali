'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { COLUMNS, QUIET, ROW, Row } from '@/components/reports-list';
import { NAV_LINK } from '@/components/text-link';
import { getAccessToken } from '@/lib/auth';
import { FIRST_READ, type ReadAt, readSessions, startRead } from '@/lib/reports';
import { useApi } from '@/lib/use-api';

/** The class page's column, 1400 px at most, and in it the list's, 72 rem (the Recap & reports design). */
const PAGE = 'mx-auto max-w-[1400px] px-4 pt-10 pb-16 sm:px-10 *:max-w-6xl';

/**
 * A class's reports (R5; the Recap & reports design): R3's sessions, a page of 20 at a time, each
 * a card whose row opens its recap's timeline inside it. A list, not a table, so it reflows by its
 * own width (DESIGN.md §8): never a table that scrolls sideways.
 */
export default function ReportsPage() {
  const api = useApi();
  const router = useRouter();
  const classId = useParams<{ id: string }>().id;
  const [list, setList] = useState(FIRST_READ);
  const [open, setOpen] = useState<string | null>(null);
  // Each read's number: one answered after a newer read started, or the page moved on, is dropped.
  const latest = useRef(0);

  async function read(from: typeof list, at: ReadAt) {
    const mine = ++latest.current;
    setList(startRead(from, at));
    const next = await readSessions(api, classId, from, at);
    if (mine === latest.current) setList(next);
  }

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    void read(FIRST_READ, 'newest');
    return () => {
      latest.current += 1;
    };
  }, [api, classId, router]);

  const retry = (at: ReadAt, words: string) =>
    list.failure?.at === at ? (
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
        <p role="alert" className="text-body">
          {words} <span className="text-text-secondary">{list.failure.message}</span>
        </p>
        <Button variant="secondary" onClick={() => void read(list, at)}>
          Try again
        </Button>
      </div>
    ) : null;

  return (
    <main className={PAGE}>
      <Link href={`/classes/${classId}`} className={NAV_LINK}>
        <ArrowLeft size={16} aria-hidden="true" />
        {list.className ?? 'Back to the class'}
      </Link>
      <h1 className="mt-6 text-h1">Reports</h1>

      {/* Mounted throughout, so a screen reader hears what it comes to say. */}
      <p role="status" className="mt-6 text-body text-text-secondary empty:mt-0">
        {list.reading === 'newest'
          ? 'Loading sessions…'
          : list.restarted
            ? 'Bali lost your place in the list, so it starts again from the newest session.'
            : null}
      </p>
      {list.failure?.at === 'newest' ? (
        <div className="mt-6">
          <div role="alert" className="text-body">
            <p className="font-semibold">Couldn&apos;t load the sessions.</p>
            <p className="text-text-secondary">{list.failure.message}</p>
          </div>
          <Button variant="secondary" onClick={() => void read(list, 'newest')} className="mt-4">
            Try again
          </Button>
        </div>
      ) : null}

      {list.loaded && list.sessions.length === 0 && list.nextBefore === null ? (
        <p className="mt-6 flex flex-col text-body text-text-secondary">
          <span className="font-semibold text-text-primary">No reports yet.</span>
          <span>When a session ends, its report shows here.</span>
        </p>
      ) : null}
      {list.sessions.length > 0 ? (
        <div className="mt-6 @container">
          {/* The column names, once, for the eye, in line with the figures inside the cards' 1 px
              edge and `space-4`; each figure carries its own for a screen reader. */}
          <div
            aria-hidden="true"
            className={`hidden px-[17px] pb-2 text-label uppercase @4xl:grid @4xl:items-end ${QUIET} ${ROW}`}
          >
            <span>Session</span>
            {COLUMNS.map((name) => (
              <span key={name} className="text-right">
                {name}
              </span>
            ))}
          </div>
          <ul aria-label="Sessions, newest first" className="grid gap-2">
            {list.sessions.map((session) => (
              <Row
                key={session.id}
                classId={classId}
                session={session}
                open={open === session.id}
                onToggle={() => setOpen(open === session.id ? null : session.id)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {list.loaded && list.nextBefore !== null
        ? (retry('earlier', "Couldn't load earlier sessions.") ?? (
            // Held, not disabled, while it reads: focus stays on it.
            <Button
              variant="secondary"
              onClick={() => {
                if (list.reading === null) void read(list, 'earlier');
              }}
              aria-disabled={list.reading !== null}
              className="mt-6"
            >
              {list.reading === 'earlier' ? 'Loading…' : 'Show earlier'}
            </Button>
          ))
        : null}
    </main>
  );
}
