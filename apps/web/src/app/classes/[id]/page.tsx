'use client';

import type { ClassDetail, RosterResponse, StartSessionResponse } from '@bali/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { getAccessToken } from '@/lib/auth';
import { errText } from '@/lib/errors';
import { useApi } from '@/lib/use-api';
import { LiveGrid } from '@/components/live-grid';

export default function ClassDetailPage() {
  const api = useApi();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const classId = params.id;

  const [klass, setKlass] = useState<ClassDetail | null>(null);
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.get<ClassDetail>(`/v1/classes/${classId}`).then(
      (c) => {
        setKlass(c);
        // Recover the live grid across a reload. `sessionId` is otherwise seeded
        // only by the Start response, so refreshing mid-lesson dropped the grid
        // and offered to start a session that was already running — which reads
        // as the session having ended.
        setSessionId((cur) => cur ?? c.liveSessionId);
      },
      (e: unknown) => setError(errText(e)),
    );
    api
      .get<RosterResponse>(`/v1/classes/${classId}/roster`)
      .then(setRoster, (e: unknown) => setError(errText(e)));
  }, [api, classId]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    load();
  }, [load, router]);

  function startSession() {
    setBusy(true);
    api.post<StartSessionResponse>(`/v1/classes/${classId}/sessions`, { durationMinutes: 25 }).then(
      (res) => {
        setBusy(false);
        setSessionId(res.session.id);
      },
      (e: unknown) => {
        setBusy(false);
        setError(errText(e));
      },
    );
  }

  function endSession() {
    if (!sessionId) return;
    setBusy(true);
    api.post(`/v1/sessions/${sessionId}/end`).then(
      () => {
        setBusy(false);
        setSessionId(null);
      },
      (e: unknown) => {
        setBusy(false);
        setError(errText(e));
      },
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-slate-500 hover:underline">
        ← All classes
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{klass?.name ?? '…'}</h1>
        {klass ? (
          <p className="text-sm text-slate-500">
            Join code: <span className="font-mono font-medium">{klass.joinCode}</span>
          </p>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6">
        {sessionId === null ? (
          <button
            type="button"
            onClick={startSession}
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Start 25-min session
          </button>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Live grid</h2>
              <button
                type="button"
                onClick={endSession}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700"
              >
                End session
              </button>
            </div>
            <LiveGrid sessionId={sessionId} />
          </div>
        )}
      </div>

      <section className="mt-10">
        <h2 className="mb-2 text-lg font-medium">Roster</h2>
        {roster === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : roster.students.length === 0 ? (
          <p className="text-sm text-slate-500">No students have joined yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
            {roster.students.map((s) => (
              <li key={s.enrollmentId} className="py-2">
                {s.displayName ?? s.studentId.slice(0, 8)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
