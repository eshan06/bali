'use client';

import { ArrowLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { RecapCard } from '@/components/recap-card';
import { CARD, EMPTY_TRAY, TRAY } from '@/components/tray';
import { getAccessToken } from '@/lib/auth';
import { FIRST_READ, type ReadAt, readSessions, sessionRow, startRead } from '@/lib/reports';
import { useApi } from '@/lib/use-api';

/** The page's column, under the bar: room for a session and its six figures on one row (§5). */
const PAGE = 'mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-10';

/** Back to the class: brand ink and an arrow, as the class page's links across the portal. */
const NAV_LINK =
  'inline-flex items-center gap-2 rounded-xs text-body font-semibold text-text-brand underline-offset-2 hover:underline';

/**
 * A session's row, from the list's width where the session and its six figures fit side by side
 * (a 1024 px window included), under the column names; narrower, each figure sits under its own
 * name, three to a row and then two, so no column is ever off the edge or smaller than the scale.
 */
const ROW = '@4xl:grid-cols-[minmax(0,1fr)_repeat(6,5.5rem)]';
/** The figures' names, in the columns' order: the column names and each figure's own say these. */
const COLUMNS = ['Joined', 'Focus time', 'Average', 'Silent', 'Unlocks', 'Protection off'] as const;
const [JOINED, FOCUS, AVERAGE, SILENT, UNLOCKS, PROTECTION_OFFS] = COLUMNS;

/**
 * A class's reports (R5; in Soft premium, D2g): R3's sessions, a page at a time, each a card in the
 * tray that opens its recap (R4's card fed by R2) inside it. A list, not a table, so it reflows by
 * its own width (DESIGN.md §8): never a table that scrolls sideways.
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
      {retry('newest', "Couldn't load the sessions.")}

      {list.loaded && list.sessions.length === 0 && list.nextBefore === null ? (
        <p className={`mt-6 text-body ${EMPTY_TRAY}`}>
          No reports yet. When a session ends, its report shows here.
        </p>
      ) : null}
      {list.sessions.length > 0 ? (
        <div className="mt-6 @container">
          {/* The column names, once, for the eye; each figure carries its own for a screen reader. */}
          <div
            aria-hidden="true"
            className={`hidden gap-x-3 px-6 pb-3 text-label text-text-tertiary uppercase @4xl:grid @4xl:items-end ${ROW}`}
          >
            <span>Session</span>
            {COLUMNS.map((name) => (
              <span key={name} className="text-right">
                {name}
              </span>
            ))}
          </div>
          <ul aria-label="Sessions, newest first" className={TRAY}>
            {list.sessions.map((session) => {
              const row = sessionRow(session);
              const isOpen = open === session.id;
              return (
                <li key={session.id} className={CARD}>
                  <div className={`grid gap-3 @4xl:items-center ${ROW}`}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? `recap-${session.id}` : undefined}
                      onClick={() => setOpen(isOpen ? null : session.id)}
                      className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-sm text-left text-body font-semibold tabular-nums hover:underline"
                    >
                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                        className={`shrink-0 text-text-tertiary transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      />
                      {row.when}
                    </button>
                    <dl className="grid grid-cols-2 gap-3 @sm:grid-cols-3 @4xl:col-span-6 @4xl:grid-cols-subgrid @4xl:items-center">
                      {row.figures ? (
                        <>
                          <Figure label={JOINED} value={row.figures.joined} />
                          <Figure label={FOCUS} value={row.figures.focus} />
                          <Figure label={AVERAGE} value={row.figures.average} />
                          <Figure label={SILENT} value={row.figures.silent} />
                        </>
                      ) : (
                        // No zeros for a session nobody joined, as its recap says (R5).
                        <div className="col-span-full @4xl:col-span-4">
                          <dt className="sr-only">{JOINED}</dt>
                          <dd className="text-body text-text-secondary">Nobody joined</dd>
                        </div>
                      )}
                      <Figure label={UNLOCKS} value={row.unlocks} />
                      <Figure label={PROTECTION_OFFS} value={row.protectionOffs} />
                    </dl>
                  </div>
                  {isOpen ? (
                    <div id={`recap-${session.id}`} className="mt-4 border-t border-border-default">
                      <RecapCard classId={classId} session={session} />
                    </div>
                  ) : null}
                </li>
              );
            })}
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

/**
 * A session's figure in `data`: its name above it on a narrow row, and on a wide one only for a
 * screen reader, the column names above the tray saying it for the eye.
 */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="@4xl:text-right">
      <dt className="text-label text-text-tertiary uppercase @4xl:sr-only">{label}</dt>
      <dd className="mt-1 text-data tabular-nums @4xl:mt-0">{value}</dd>
    </div>
  );
}
