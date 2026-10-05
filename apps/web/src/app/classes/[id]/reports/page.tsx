'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';

import { RecapCard } from '@/components/recap-card';
import { getAccessToken } from '@/lib/auth';
import { FIRST_READ, type ReadAt, readSessions, sessionRow, startRead } from '@/lib/reports';
import { useApi } from '@/lib/use-api';

/** The secondary button, as the recap card's Try again. */
const BUTTON =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors hover:bg-slate-100 disabled:opacity-50 motion-reduce:transition-none dark:border-slate-700 dark:hover:bg-slate-900';
const COLUMNS = ['Joined', 'Focus time', 'Average', 'Silent', 'Unlocks', 'Protection off'];
const CELL = 'py-2 pl-4 text-right tabular-nums';
const LINE = 'border-b border-slate-200 dark:border-slate-800';

/**
 * A class's reports (R5): R3's sessions, a page at a time, each row opening its recap (R4's card
 * fed by R2). Narrower than its columns, the table scrolls sideways (DESIGN.md: desktop-first).
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
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p role="alert" className="text-sm">
          {words} <span className="text-slate-600 dark:text-slate-300">{list.failure.message}</span>
        </p>
        <button type="button" onClick={() => void read(list, at)} className={BUTTON}>
          Try again
        </button>
      </div>
    ) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href={`/classes/${classId}`} className="text-sm text-slate-500 hover:underline">
        ← {list.className ?? 'Back to the class'}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Reports</h1>

      {/* Mounted throughout, so a screen reader hears what it comes to say. */}
      <p role="status" className="mt-6 text-sm text-slate-500 empty:mt-0 dark:text-slate-400">
        {list.reading === 'newest'
          ? 'Loading sessions…'
          : list.restarted
            ? 'Bali lost your place in the list, so it starts again from the newest session.'
            : null}
      </p>
      {retry('newest', "Couldn't load the sessions.")}

      {list.loaded && list.sessions.length === 0 && list.nextBefore === null ? (
        <p className="mt-6 text-sm">No reports yet. When a session ends, its report shows here.</p>
      ) : null}
      {list.sessions.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table aria-label="Sessions, newest first" className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className={`${LINE} text-slate-500 dark:text-slate-400`}>
                <th scope="col" className="py-2 pr-4 pl-5 text-left font-normal">
                  Session
                </th>
                {COLUMNS.map((name) => (
                  <th key={name} scope="col" className="py-2 pl-4 text-right font-normal">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.sessions.map((session) => {
                const row = sessionRow(session);
                const isOpen = open === session.id;
                return (
                  <Fragment key={session.id}>
                    <tr className={isOpen ? '' : LINE}>
                      <th scope="row" className="pr-4 text-left font-normal">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={isOpen ? `recap-${session.id}` : undefined}
                          onClick={() => setOpen(isOpen ? null : session.id)}
                          className="flex w-full cursor-pointer items-baseline gap-2 rounded py-2 text-left font-medium tabular-nums hover:underline"
                        >
                          <span aria-hidden="true" className="w-3 text-slate-500">
                            {isOpen ? '▾' : '▸'}
                          </span>
                          {row.when}
                        </button>
                      </th>
                      {row.figures ? (
                        <>
                          <td className={CELL}>{row.figures.joined}</td>
                          <td className={CELL}>{row.figures.focus}</td>
                          <td className={CELL}>{row.figures.average}</td>
                          <td className={CELL}>{row.figures.silent}</td>
                        </>
                      ) : (
                        <td colSpan={4} className="py-2 pl-4 text-slate-500 dark:text-slate-400">
                          Nobody joined
                        </td>
                      )}
                      <td className={CELL}>{row.unlocks}</td>
                      <td className={CELL}>{row.protectionOffs}</td>
                    </tr>
                    {isOpen ? (
                      <tr className={LINE}>
                        <td
                          id={`recap-${session.id}`}
                          colSpan={7}
                          className="pb-4 whitespace-normal"
                        >
                          <RecapCard classId={classId} session={session} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {list.loaded && list.nextBefore !== null
        ? (retry('earlier', "Couldn't load earlier sessions.") ?? (
            <button
              type="button"
              onClick={() => void read(list, 'earlier')}
              disabled={list.reading !== null}
              className={`mt-4 ${BUTTON}`}
            >
              {list.reading === 'earlier' ? 'Loading…' : 'Show earlier'}
            </button>
          ))
        : null}
    </main>
  );
}
