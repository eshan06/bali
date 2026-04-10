'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { SessionAttendanceSummary } from '@bali/shared';

export default function SessionHistoryPage() {
  const { classId } = useParams<{ classId: string }>();
  const [sessions, setSessions] = useState<SessionAttendanceSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ sessions: SessionAttendanceSummary[] }>(`/classes/${classId}/sessions`)
      .then(res => setSessions(res.sessions))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [classId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Session History</h1>
        <Link href={`/dashboard/classes/${classId}/`}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          Back to Class
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center text-gray-500">
          No past sessions yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {sessions.map(s => (
            <Link
              key={s.sessionId}
              href={`/dashboard/classes/${classId}/sessions/${s.sessionId}/`}
              className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <div>
                <p className="font-medium text-gray-900">
                  {new Date(s.startedAt).toLocaleDateString()} &mdash;{' '}
                  {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {s.endedAt && ` to ${new Date(s.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                </p>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-green-600">{s.presentCount} present</span>
                <span className="text-yellow-600">{s.lateCount} late</span>
                <span className="text-red-600">{s.absentCount} absent</span>
                <span className="text-gray-500">{s.totalCount} total</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
