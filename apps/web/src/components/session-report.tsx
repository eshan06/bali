'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { QUIET } from '@/components/button';
import { useCountOpened } from '@/components/count';
import { Oops } from '@/components/live-grid';
import { Recap } from '@/components/recap-card';
import { useMe } from '@/components/shell';
import { getAccessToken } from '@/lib/auth';
import { sessionWhen } from '@/lib/recap';
import { readSessionPage, type SessionPage } from '@/lib/reports';
import { useApi } from '@/lib/use-api';

/**
 * A session's report on its own page (PV14; the recap since LO7, as a Reports row opens it): read
 * as it opens, and again by Try again, its class named as the shell's one read of the account names
 * it. It reads no questions, whichever way the lessons switch is set: the page is rebuilt from the
 * lock-only canvas, which draws none (ARCHITECTURE, Web portal, decision 8).
 */
export function SessionReportPage({ classId, sessionId }: { classId: string; sessionId: string }) {
  const api = useApi();
  const router = useRouter();
  const { me } = useMe();
  const [page, setPage] = useState<SessionPage>({ kind: 'loading' });
  // Opened once its read is in, a Try again's too (A3b).
  useCountOpened('portal_report_opened', page.kind === 'ready');

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

  return (
    <SessionReport
      classId={classId}
      className={me?.classes.find((c) => c.id === classId)?.name ?? null}
      page={page}
      onRetry={() => readSessionPage(api, classId, sessionId).then(setPage)}
    />
  );
}

/**
 * The page as its state draws it (ClassEndedStates' "a session's report, on its own page", drawn
 * on the canvas first): the class's name over the day and the times the session ran, This class's
 * reports at the head's end, Reports with the class picked; then the recap, as ClassEnded draws it
 * on the class page. Being read, today's line in its place; not read, why, with Try again, which
 * holds until Bali answers, focus then on the class's name.
 */
export function SessionReport({
  classId,
  className,
  page,
  onRetry,
}: {
  classId: string;
  /** The class's name; null when the account doesn't list the class. */
  className: string | null;
  page: SessionPage;
  /** Read it all again, its failure said until the answer. */
  onRetry: () => unknown;
}) {
  const when = page.kind === 'ready' ? sessionWhen(page.session) : null;
  return (
    <div className="flex flex-col gap-10 max-[760px]:gap-8">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
          <h1
            className={`text-page-title text-balance wrap-anywhere max-[760px]:text-page-title-phone ${className === null ? 'text-text-tertiary' : ''}`}
          >
            {className ?? '…'}
          </h1>
          {/* Its line's place held until the session is read, so nothing under it moves. */}
          <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-meta text-text-secondary">
            {when ? (
              <>
                <span>{when.day}</span>
                <span>{when.times}</span>
              </>
            ) : (
              <>&nbsp;</>
            )}
          </p>
        </div>
        <Link href={`/reports?class=${encodeURIComponent(classId)}`} className={QUIET}>
          This class&apos;s reports
        </Link>
      </header>
      {page.kind === 'loading' ? (
        <p
          role="status"
          className="border-y border-border-default py-3 text-body text-text-secondary"
        >
          Loading this session…
        </p>
      ) : page.kind === 'error' ? (
        <Oops onRetry={onRetry} then={[]}>
          Couldn&apos;t load this session. {page.message}
        </Oops>
      ) : (
        <Recap
          session={page.session}
          report={page.report}
          events={page.events}
          roster={page.roster}
        />
      )}
    </div>
  );
}
