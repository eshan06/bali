'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { AttendanceRecord } from '@bali/shared';

const statusColors: Record<string, string> = {
  present: 'bg-green-100 text-green-800',
  late: 'bg-yellow-100 text-yellow-800',
  absent: 'bg-red-100 text-red-800',
  excused: 'bg-blue-100 text-blue-800',
  pending: 'bg-gray-100 text-gray-600',
};

export default function SessionDetailPage() {
  const { classId, sessionId } = useParams<{ classId: string; sessionId: string }>();
  const [attendance, setAttendance] = useState<{
    sessionId: string; startedAt: string; endedAt?: string;
    students: AttendanceRecord[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.get<any>(`/sessions/${sessionId}/attendance`)
      .then(setAttendance)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [sessionId]);

  const handleOverride = async (studentId: string, status: string) => {
    await api.put(`/sessions/${sessionId}/attendance/${studentId}`, { status });
    load();
  };

  if (loading) return <div className="animate-pulse h-64 bg-gray-200 rounded-xl" />;
  if (!attendance) return <p className="text-gray-500">Session not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Session Attendance</h1>
          <p className="text-gray-500">
            {new Date(attendance.startedAt).toLocaleString()}
            {attendance.endedAt && ` — ${new Date(attendance.endedAt).toLocaleTimeString()}`}
          </p>
        </div>
        <Link href={`/dashboard/classes/${classId}/sessions/`}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          Back
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Student</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Check-in Time</th>
              <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase text-right">Override</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {attendance.students.map((s: any) => (
              <tr key={s.studentId} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  {s.firstName} {s.lastName}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[s.status] || statusColors.pending}`}>
                    {s.status}
                  </span>
                  {s.isOverride && <span className="ml-1 text-xs text-gray-400">(manual)</span>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {s.checkInAt ? new Date(s.checkInAt).toLocaleTimeString() : '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  <select
                    value={s.status}
                    onChange={e => handleOverride(s.studentId, e.target.value)}
                    className="text-sm rounded border border-gray-300 px-2 py-1"
                  >
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="absent">Absent</option>
                    <option value="excused">Excused</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
