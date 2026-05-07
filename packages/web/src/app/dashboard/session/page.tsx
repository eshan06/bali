'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api-client';
import { usePolling } from '@/hooks/usePolling';
import {
  Class, ClassSession, AttendanceRecord, DeviceBlockingStatus, TeacherApp,
  BlockingPreset, ClassBlockingConfig, POLLING_INTERVAL_MS,
  SOCIAL_MEDIA_BUNDLE_IDS, GAME_BUNDLE_IDS, FULL_FOCUS_ALLOWED_BUNDLE_IDS,
} from '@bali/shared';

const statusColors: Record<string, string> = {
  present: 'bg-green-100 text-green-800 border-green-200',
  late: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  absent: 'bg-red-100 text-red-800 border-red-200',
  excused: 'bg-blue-100 text-blue-800 border-blue-200',
  pending: 'bg-gray-50 text-gray-500 border-gray-200',
};

const presetLabels: Record<string, string> = {
  full_focus: 'Full Focus',
  no_social_media: 'No Social Media',
  no_games: 'No Games',
  custom: 'Custom',
  none: 'Off',
};

export default function ActiveSessionPage() {
  const searchParams = useSearchParams();
  const preselectClassId = searchParams.get('classId');
  const [classes, setClasses] = useState<Class[]>([]);
  const [session, setSession] = useState<ClassSession | null>(null);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [blockingConfig, setBlockingConfig] = useState<ClassBlockingConfig | null>(null);

  // Load initial state
  useEffect(() => {
    Promise.all([
      api.get<{ classes: Class[] }>('/classes'),
      api.get<{ session: ClassSession | null }>('/sessions/active'),
    ]).then(([classRes, sessionRes]) => {
      setClasses(classRes.classes);
      setSession(sessionRes.session);
      // Pre-select a class if it was passed via ?classId= and is in the list
      if (preselectClassId && !sessionRes.session) {
        const match = classRes.classes.find(c => c.id === preselectClassId);
        if (match) setSelectedClassId(match.id);
      }
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, [preselectClassId]);

  // Load blocking config for the session's class
  useEffect(() => {
    if (!session) { setBlockingConfig(null); return; }
    api.get<{ config: ClassBlockingConfig }>(`/classes/${session.classId}/blocking-config`)
      .then(res => setBlockingConfig(res.config))
      .catch(console.error);
  }, [session?.classId]);

  // Poll attendance and device blocking status while session is active
  const fetchAttendance = useCallback(async () => {
    if (!session) return null;
    const attendance = await api.get<{ students: AttendanceRecord[] }>(`/sessions/${session.id}/attendance`);
    let deviceStatuses: DeviceBlockingStatus[] = [];
    try {
      const res = await api.get<{ statuses: DeviceBlockingStatus[] }>(`/sessions/${session.id}/device-status`);
      deviceStatuses = res.statuses;
    } catch {
      // table may not exist yet
    }
    return { students: attendance.students, deviceStatuses };
  }, [session]);

  const { data: attendanceData } = usePolling(fetchAttendance, POLLING_INTERVAL_MS, !!session);

  const students = attendanceData?.students || [];
  const deviceStatuses = attendanceData?.deviceStatuses || [];
  const deviceStatusMap = new Map(deviceStatuses.map(d => [d.studentId, d]));
  const presentCount = students.filter(s => s.status === 'present').length;
  const lateCount = students.filter(s => s.status === 'late').length;
  const checkedInCount = presentCount + lateCount;

  const startSession = async () => {
    if (!selectedClassId) return;
    setStarting(true);
    try {
      const s = await api.post<ClassSession>('/sessions/start', { classId: selectedClassId });
      setSession(s);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setStarting(false);
    }
  };

  const endSession = async () => {
    if (!session || !confirm('End this session? Students without check-ins will be marked absent.')) return;
    setEnding(true);
    try {
      await api.post(`/sessions/${session.id}/end`);
      setSession(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setEnding(false);
    }
  };

  const handleOverride = async (studentId: string, status: string) => {
    if (!session) return;
    await api.put(`/sessions/${session.id}/attendance/${studentId}`, { status });
  };

  const toggleStudentBlocking = async (studentId: string, currentlyBlocked: boolean) => {
    if (!session) return;
    await api.put(`/sessions/${session.id}/device-status/${studentId}`, { isBlocked: !currentlyBlocked });
  };

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="h-64 bg-gray-200 rounded" />
    </div>;
  }

  // No active session — show start form
  if (!session) {
    const selectedClass = classes.find(c => c.id === selectedClassId);
    const selectedPreset = selectedClass?.blockingPreset || 'none';

    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Start a Session</h1>
        <div className="max-w-md glass-card rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Class</label>
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none"
            >
              <option value="">Choose a class...</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.period ? ` (${c.period})` : ''}</option>
              ))}
            </select>
          </div>
          {selectedClassId && selectedPreset !== 'none' && (
            <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Blocking: {presetLabels[selectedPreset] || selectedPreset}
            </div>
          )}
          {selectedClassId && selectedPreset === 'none' && (
            <div className="flex items-center gap-2 text-sm text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-gray-300" />
              No blocking configured —
              <a href={`/dashboard/classes/${selectedClassId}`} className="text-blue-600 hover:underline">set up</a>
            </div>
          )}
          <button
            onClick={startSession}
            disabled={!selectedClassId || starting}
            className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-white font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {starting ? 'Starting...' : 'Start Session'}
          </button>
        </div>
      </div>
    );
  }

  // Active session view
  const elapsed = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 60000);

  return (
    <div className="space-y-6">
      {/* Session header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{session.className}</h1>
          <p className="text-gray-500">
            Started {new Date(session.startedAt).toLocaleTimeString()} ({elapsed} min ago)
          </p>
        </div>
        <div className="flex items-center gap-3">
          {session.blockingEnabled && (
            <span className="flex items-center gap-2 rounded-lg bg-red-100 px-4 py-2 text-sm font-medium text-red-700">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Blocking Active
            </span>
          )}
          <button
            onClick={endSession}
            disabled={ending}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {ending ? 'Ending...' : 'End Session'}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-xl bg-white border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{students.length}</p>
          <p className="text-xs text-gray-500">Total</p>
        </div>
        <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{presentCount}</p>
          <p className="text-xs text-green-600">Present</p>
        </div>
        <div className="rounded-xl bg-yellow-50 border border-yellow-200 p-4 text-center">
          <p className="text-2xl font-bold text-yellow-700">{lateCount}</p>
          <p className="text-xs text-yellow-600">Late</p>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-700">{students.length - checkedInCount}</p>
          <p className="text-xs text-gray-500">Waiting</p>
        </div>
      </div>

      {/* Blocking summary */}
      {session.blockingEnabled && blockingConfig && blockingConfig.preset !== 'none' && (() => {
        const preset = blockingConfig.preset;
        if (preset === 'full_focus') {
          const allowed = ['Phone', 'Messages', 'Calculator', 'Camera', 'Clock', 'Safari', 'Notes'];
          return (
            <div className="bg-red-50 rounded-xl border border-red-200 px-5 py-3">
              <p className="text-sm font-medium text-red-800">Full Focus — all apps blocked except:</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {allowed.map(name => (
                  <span key={name} className="rounded-full bg-green-100 text-green-700 border border-green-200 px-2.5 py-0.5 text-xs font-medium">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          );
        }
        if (preset === 'no_social_media') {
          const apps = ['Instagram', 'TikTok', 'Snapchat', 'Facebook', 'Twitter/X', 'YouTube'];
          return (
            <div className="bg-orange-50 rounded-xl border border-orange-200 px-5 py-3">
              <p className="text-sm font-medium text-orange-800">No Social Media — blocking:</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {apps.map(name => (
                  <span key={name} className="rounded-full bg-red-100 text-red-700 border border-red-200 px-2.5 py-0.5 text-xs font-medium">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          );
        }
        if (preset === 'no_games') {
          const apps = ['Brawl Stars', 'Among Us', 'Minecraft', 'Roblox'];
          return (
            <div className="bg-purple-50 rounded-xl border border-purple-200 px-5 py-3">
              <p className="text-sm font-medium text-purple-800">No Games — blocking:</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {apps.map(name => (
                  <span key={name} className="rounded-full bg-red-100 text-red-700 border border-red-200 px-2.5 py-0.5 text-xs font-medium">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          );
        }
        if (preset === 'custom' && blockingConfig.customApps.length > 0) {
          return (
            <div className="bg-blue-50 rounded-xl border border-blue-200 px-5 py-3">
              <p className="text-sm font-medium text-blue-800">Custom — blocking:</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {blockingConfig.customApps.map(app => (
                  <span key={app.id} className="rounded-full bg-red-100 text-red-700 border border-red-200 px-2.5 py-0.5 text-xs font-medium">
                    {app.appName}
                  </span>
                ))}
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* Attendance grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {students.map((s: any) => {
          const blockStatus = deviceStatusMap.get(s.studentId);
          const isBlocked = blockStatus?.isBlocked ?? false;
          const reportedBy = blockStatus?.reportedBy;

          return (
            <div
              key={s.studentId}
              className={`rounded-xl border p-4 transition-all ${statusColors[s.status] || statusColors.pending}`}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{s.firstName} {s.lastName}</p>
                {session.blockingEnabled && (
                  <button
                    onClick={() => toggleStudentBlocking(s.studentId, isBlocked)}
                    title={isBlocked ? `Blocked (${reportedBy || 'manual'})` : 'Not blocked'}
                    className={`flex-shrink-0 ml-2 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                      isBlocked
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-200 text-gray-400 hover:bg-gray-300'
                    }`}
                  >
                    {isBlocked ? 'B' : 'U'}
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs capitalize">{s.status}</span>
                {s.checkInAt && (
                  <span className="text-xs opacity-75">
                    {new Date(s.checkInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              {session.blockingEnabled && blockStatus && (
                <p className="text-[10px] mt-1 opacity-60">
                  {isBlocked ? 'Blocked' : 'Unblocked'} via {reportedBy || 'manual'}
                </p>
              )}
              <select
                value={s.status}
                onChange={e => handleOverride(s.studentId, e.target.value)}
                className="mt-2 w-full text-xs rounded border border-current/20 bg-transparent px-1 py-0.5"
              >
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="excused">Excused</option>
              </select>
            </div>
          );
        })}
      </div>

      {students.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center text-gray-500">
          No students enrolled in this class yet.
        </div>
      )}
    </div>
  );
}
