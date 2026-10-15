'use client';

import { isUnlockReason, type SessionReportUnlock } from '@bali/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import { RecapBody } from '@/components/recap-card';
import { CELL, FIGURE, HEAD, LABEL, TABLE_BOX } from '@/components/reports-list';
import { useMe } from '@/components/shell';
import { NAV_LINK } from '@/components/text-link';
import { reasonWords } from '@/components/unlock-popups';
import { getAccessToken } from '@/lib/auth';
import { nameOf, sessionWhen } from '@/lib/recap';
import { readSessionPage, type SessionPage } from '@/lib/reports';
import { bellTime } from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

/**
 * A session's report on its own page (PV14): read as it opens, and again by Try again, its class
 * named as the shell's one read of the account names it (none when the class isn't the teacher's).
 */
export function SessionReportPage({ classId, sessionId }: { classId: string; sessionId: string }) {
  const api = useApi();
  const router = useRouter();
  const { me } = useMe();
  const [page, setPage] = useState<SessionPage>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    let live = true;
    void readSessionPage(api, classId, sessionId).then((next) => {
      if (live) setPage(next);
    });
    return () => {
      live = false;
    };
  }, [api, classId, sessionId, attempt, router]);

  return (
    <SessionReport
      classId={classId}
      className={me?.classes.find((c) => c.id === classId)?.name ?? null}
      page={page}
      onRetry={() => {
        setPage({ kind: 'loading' });
        setAttempt((n) => n + 1);
      }}
    />
  );
}

/**
 * The page as its state draws it (ReportOpened; ReportStates' "Loading this session…" and
 * "Couldn't load this session."; ReportPageStates and ReportPhone, intermediate states drawn on the
 * canvas first): the way back to Reports with its class picked, then the session's day over its
 * times, its recap card ("This session", the class page's recap) and its Unlocks table, none when
 * there were none, as the card says. Its Questions card is L7c's.
 */
export function SessionReport({
  classId,
  className,
  page,
  onRetry,
}: {
  classId: string;
  /** The class's name; null when the account doesn't list the class: the way back says Reports. */
  className: string | null;
  page: SessionPage;
  onRetry: () => void;
}) {
  return (
    <main className="flex flex-col gap-5.5">
      <Link
        href={`/reports?class=${encodeURIComponent(classId)}`}
        className={`self-start ${NAV_LINK}`}
      >
        <ArrowLeft size={16} aria-hidden="true" />
        {className === null ? 'Reports' : `Reports · ${className}`}
      </Link>
      {page.kind === 'loading' ? (
        <p role="status" className="text-body text-text-secondary">
          Loading this session…
        </p>
      ) : page.kind === 'error' ? (
        <div className={CARD_ALONE}>
          <p role="alert" className="text-body">
            <span className="block font-semibold">Couldn&apos;t load this session.</span>
            <span className="text-text-secondary">{page.message}</span>
          </p>
          <Button variant="secondary" onClick={onRetry} className="mt-3.5">
            Try again
          </Button>
        </div>
      ) : (
        <Report page={page} />
      )}
    </main>
  );
}

/** The session read: its day and times, its recap card, and its unlocks. */
function Report({ page }: { page: Extract<SessionPage, { kind: 'ready' }> }) {
  const cardId = useId();
  const { day, times } = sessionWhen(page.session);
  return (
    <>
      <header>
        <h1 className="text-page-title">{day}</h1>
        <p className="mt-0.5 text-meta text-text-secondary">{times}</p>
      </header>
      <section
        aria-labelledby={cardId}
        className={`@container flex flex-col gap-4.5 ${CARD_ALONE}`}
      >
        <h2 id={cardId} className="text-section-label text-text-tertiary uppercase">
          This session
        </h2>
        <RecapBody
          session={page.session}
          report={page.report}
          events={page.events}
          roster={page.roster}
        />
      </section>
      {page.report.unlocks.length > 0 ? <UnlocksTable unlocks={page.report.unlocks} /> : null}
    </>
  );
}

/**
 * Every unlock R2 lists, oldest first (ReportOpened's Unlocks): who, when and the reason now (A20),
 * in the tile's words, "No reason given" in the tertiary ink; in v2.css's table, in its box that
 * scrolls sideways on a narrow page.
 */
export function UnlocksTable({ unlocks }: { unlocks: readonly SessionReportUnlock[] }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={LABEL}>
        Unlocks · {unlocks.length}
      </h2>
      <div className={TABLE_BOX}>
        <table aria-labelledby={id} className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} text-left`}>
                Student
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                When
              </th>
              <th scope="col" className={`${HEAD} text-left`}>
                Reason
              </th>
            </tr>
          </thead>
          <tbody className="[&>tr:last-child>*]:border-b-0">
            {unlocks.map((u) => {
              // One this tab doesn't know (a newer build's) reads as none, as the tile reads it.
              const reason = isUnlockReason(u.reason) ? u.reason : null;
              return (
                <tr key={u.eventId}>
                  {/* The board's `<b>`, bold as it renders. */}
                  <th scope="row" className={`${CELL} text-left font-bold`}>
                    {nameOf(u.student)}
                  </th>
                  <td className={FIGURE}>{bellTime(u.occurredAt)}</td>
                  <td className={reason === null ? `${CELL} text-text-tertiary` : CELL}>
                    {reasonWords(reason)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
