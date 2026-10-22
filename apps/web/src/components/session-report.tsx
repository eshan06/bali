'use client';

import { isUnlockReason, type SessionReportUnlock } from '@bali/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { CARD_ALONE } from '@/components/card';
import { RecapBody } from '@/components/recap-card';
import { ReportQuestions } from '@/components/report-questions';
import { CELL, FIGURE, HEAD, LABEL, TABLE_BOX } from '@/components/reports-list';
import { useMe } from '@/components/shell';
import { NAV_LINK } from '@/components/text-link';
import { TryAgain } from '@/components/try-again';
import { reasonWords } from '@/components/unlock-popups';
import { getAccessToken } from '@/lib/auth';
import { nameOf, sessionWhen } from '@/lib/recap';
import {
  readSessionPage,
  readSessionQuestions,
  type SessionPage,
  type SessionQuestions,
} from '@/lib/reports';
import { bellTime } from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

/**
 * A session's report on its own page (PV14): read as it opens, and again by Try again, its class
 * named as the shell's one read of the account names it (none when the class isn't the teacher's).
 * Its questions (L7c) are read beside it, and again by the page's Try again or the card's own, each
 * failure said until its read again answers (ReportRetryStates).
 */
export function SessionReportPage({ classId, sessionId }: { classId: string; sessionId: string }) {
  const api = useApi();
  const router = useRouter();
  const { me } = useMe();
  const [page, setPage] = useState<SessionPage>({ kind: 'loading' });
  const [questions, setQuestions] = useState<SessionQuestions>({ kind: 'loading' });

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
  }, [api, classId, sessionId, router]);

  // The Questions card's own read, at once with the page's, and again by either Try again: its
  // failure is the card's alone, and only the newest read's answer is drawn, never a slow one's
  // over a read since (santa's review).
  const asked = useRef(0);
  const readQuestions = useCallback(async () => {
    const mine = ++asked.current;
    const next = await readSessionQuestions(api, classId, sessionId);
    if (asked.current === mine) setQuestions(next);
  }, [api, classId, sessionId]);
  useEffect(() => {
    if (!getAccessToken()) return;
    void readQuestions();
    return () => {
      asked.current += 1;
    };
  }, [readQuestions]);

  return (
    <SessionReport
      classId={classId}
      className={me?.classes.find((c) => c.id === classId)?.name ?? null}
      page={page}
      questions={questions}
      // The page drawn as soon as it is read, its questions as theirs are.
      onRetry={() =>
        Promise.all([readSessionPage(api, classId, sessionId).then(setPage), readQuestions()])
      }
      onRetryQuestions={readQuestions}
    />
  );
}

/**
 * The page as its state draws it (ReportOpened; ReportStates' "Loading this session…" and
 * "Couldn't load this session."; ReportPageStates and ReportPhone, intermediate states drawn on the
 * canvas first): the way back to Reports with its class picked, then the session's day over its
 * times, its recap card ("This session", the class page's recap), its Unlocks table, none when
 * there were none, as the card says, and its Questions card (L7c), none when it asked none.
 */
export function SessionReport({
  classId,
  className,
  page,
  questions,
  onRetry,
  onRetryQuestions,
}: {
  classId: string;
  /** The class's name; null when the account doesn't list the class: the way back says Reports. */
  className: string | null;
  page: SessionPage;
  /** The questions it asked, read on their own: shown once the page is read. */
  questions: SessionQuestions;
  /** Read it all again, its failure said until the answer; read, focus on its day. */
  onRetry: () => unknown;
  onRetryQuestions: () => unknown;
}) {
  return (
    <div className="flex flex-col gap-5.5">
      {/* A class's name of one long word breaks rather than pushing past a phone's width. */}
      <Link
        href={`/reports?class=${encodeURIComponent(classId)}`}
        className={`self-start wrap-anywhere ${NAV_LINK}`}
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
          <TryAgain size="md" onRetry={onRetry} then={[]} className="mt-3.5">
            <p role="alert" className="text-body">
              <span className="block font-semibold">Couldn&apos;t load this session.</span>
              <span className="text-text-secondary">{page.message}</span>
            </p>
          </TryAgain>
        </div>
      ) : (
        <>
          <Report page={page} />
          <ReportQuestions questions={questions} onRetry={onRetryQuestions} />
        </>
      )}
    </div>
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
