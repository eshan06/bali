'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { StudentProfile } from '@bali/shared';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const STATUS_COLORS: Record<string, string> = {
  present: '#22c55e',
  late: '#f59e0b',
  absent: '#ef4444',
  excused: '#8b5cf6',
};

const STATUS_BG: Record<string, string> = {
  present: 'bg-green-100 text-green-700',
  late: 'bg-yellow-100 text-yellow-700',
  absent: 'bg-red-100 text-red-700',
  excused: 'bg-purple-100 text-purple-700',
};

export default function StudentProfilePage() {
  const { classId, studentId } = useParams<{ classId: string; studentId: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  const loadProfile = () => {
    api.get<StudentProfile>(`/classes/${classId}/students/${studentId}`)
      .then(data => {
        setProfile(data);
        setNotes(data.student.notes || '');
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadProfile(); }, [classId, studentId]);

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      await api.put(`/classes/${classId}/students/${studentId}/notes`, { notes });
      setEditingNotes(false);
      loadProfile();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingNotes(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="h-32 bg-gray-200 rounded" />
        <div className="h-64 bg-gray-200 rounded" />
      </div>
    );
  }

  if (!profile) return <p className="text-gray-500">Student not found.</p>;

  const { student, classes, device, attendanceHistory, attendanceStats, blockingStatus } = profile;

  // Build chart data from recent sessions (last 20, reversed for chronological)
  const chartData = attendanceHistory.slice(0, 20).reverse().map((r, i) => ({
    name: new Date(r.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    status: r.status,
    value: 1,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/dashboard/classes/${classId}/`)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {student.firstName} {student.lastName}
            </h1>
            <p className="text-sm text-gray-500">
              Enrolled {new Date(student.enrolledAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Attendance Rate</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{attendanceStats.rate}%</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Present</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{attendanceStats.present}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Late</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">{attendanceStats.late}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Absent</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{attendanceStats.absent}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-500 uppercase">Excused</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">{attendanceStats.excused}</p>
        </div>
      </div>

      {/* Info Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Contact Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Contact Info</h3>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-500">Email</p>
              <p className="text-sm text-gray-900">{student.email || 'Not provided'}</p>
            </div>
            {student.externalId && (
              <div>
                <p className="text-xs text-gray-500">External ID</p>
                <p className="text-sm text-gray-900">{student.externalId}</p>
              </div>
            )}
          </div>
        </div>

        {/* Device Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Device</h3>
          {device ? (
            <div className="space-y-2">
              <div>
                <p className="text-xs text-gray-500">Device ID</p>
                <p className="text-sm text-gray-900 font-mono">{device.deviceId}</p>
              </div>
              {device.friendlyName && (
                <div>
                  <p className="text-xs text-gray-500">Name</p>
                  <p className="text-sm text-gray-900">{device.friendlyName}</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No device assigned</p>
          )}
        </div>

        {/* Blocking Status */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Blocking Status</h3>
          {blockingStatus ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`inline-flex h-2.5 w-2.5 rounded-full ${
                  blockingStatus.isBlocked ? 'bg-green-500' : 'bg-gray-300'
                }`} />
                <p className="text-sm text-gray-900">
                  {blockingStatus.isBlocked ? 'Active — apps blocked' : 'Not blocking'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">
                  Reported by {blockingStatus.reportedBy} at{' '}
                  {new Date(blockingStatus.reportedAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No active session</p>
          )}
        </div>
      </div>

      {/* Classes Enrolled */}
      {classes.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Classes Enrolled ({classes.length})</h3>
          <div className="flex flex-wrap gap-2">
            {classes.map(c => (
              <Link
                key={c.id}
                href={`/dashboard/classes/${c.id}/`}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium border transition-all ${
                  c.id === classId
                    ? 'bg-blue-100 text-blue-700 border-blue-300'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {c.name}{c.period ? ` (${c.period})` : ''}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Attendance History */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Attendance History</h3>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setView('chart')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                view === 'chart' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Chart
            </button>
            <button
              onClick={() => setView('table')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                view === 'table' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Table
            </button>
          </div>
        </div>

        {attendanceHistory.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No attendance records yet.
          </div>
        ) : view === 'chart' ? (
          <div className="p-5">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barCategoryGap="20%">
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm text-xs">
                        <p className="font-medium">{d.name}</p>
                        <p className="capitalize" style={{ color: STATUS_COLORS[d.status] }}>{d.status}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={STATUS_COLORS[entry.status] || '#d1d5db'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-3">
              {Object.entries(STATUS_COLORS).map(([status, color]) => (
                <div key={status} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs text-gray-500 capitalize">{status}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Check-in</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Override</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Blocking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {attendanceHistory.map(r => (
                <tr key={r.sessionId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {new Date(r.startedAt).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BG[r.status] || 'bg-gray-100 text-gray-700'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {r.checkInAt ? new Date(r.checkInAt).toLocaleTimeString() : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {r.isOverride ? 'Yes' : '-'}
                  </td>
                  <td className="px-4 py-3">
                    {r.blockingStatus === 'active' && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-700">
                        Active
                      </span>
                    )}
                    {r.blockingStatus === 'inactive' && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
                        Inactive
                      </span>
                    )}
                    {r.blockingStatus === 'student_override' && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">
                        Student Override
                      </span>
                    )}
                    {r.blockingStatus === 'disabled' && (
                      <span className="text-sm text-gray-400">-</span>
                    )}
                    {r.blockingStatus === 'no_data' && (
                      <span className="text-sm text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Notes */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Notes</h3>
          {!editingNotes && (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Edit
            </button>
          )}
        </div>
        <div className="p-5">
          {editingNotes ? (
            <div className="space-y-3">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={4}
                placeholder="Add notes about this student..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {savingNotes ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditingNotes(false); setNotes(student.notes || ''); }}
                  className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600 whitespace-pre-wrap">
              {student.notes || 'No notes yet.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
