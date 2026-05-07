'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { Device, Student } from '@bali/shared';

const BRAND = '#2E5BD0';

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [friendlyName, setFriendlyName] = useState('');
  const [error, setError] = useState('');

  const [assigningDevice, setAssigningDevice] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [allStudents, setAllStudents] = useState<Student[]>([]);

  const loadDevices = () => {
    api
      .get<{ devices: Device[] }>('/devices')
      .then((res) => setDevices(res.devices))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/devices', { deviceId, friendlyName: friendlyName || undefined });
      setDeviceId('');
      setFriendlyName('');
      setShowRegister(false);
      loadDevices();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAssign = async (deviceIdStr: string, studentId: string) => {
    await api.put(`/devices/${deviceIdStr}/assign`, { studentId });
    setAssigningDevice(null);
    loadDevices();
  };

  const handleUnassign = async (deviceIdStr: string) => {
    await api.put(`/devices/${deviceIdStr}/unassign`);
    loadDevices();
  };

  const startAssign = async (deviceIdStr: string) => {
    setAssigningDevice(deviceIdStr);
    try {
      const res = await api.get<{ classes: Array<{ id: string }> }>('/classes');
      const students: Student[] = [];
      for (const c of res.classes) {
        const sRes = await api.get<{ students: Student[] }>(`/classes/${c.id}/students`);
        for (const s of sRes.students) {
          if (!students.find((existing) => existing.id === s.id)) {
            students.push(s);
          }
        }
      }
      setAllStudents(students);
    } catch (err) {
      console.error(err);
    }
  };

  const assignedCount = devices.filter((d) => d.studentId).length;
  const unassignedCount = devices.length - assignedCount;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="surface-card-hero rounded-3xl p-7 md:p-9">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="space-y-2.5 min-w-0">
            <p
              className="text-[11px] font-black uppercase tracking-[0.22em]"
              style={{ color: BRAND }}
            >
              Hardware
            </p>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gray-900 leading-[1.05]">
              Devices
            </h1>
            <p className="text-sm md:text-base text-gray-500 max-w-xl">
              Register Bali tap devices, assign each one to a student, and
              monitor when they last checked in.
            </p>
          </div>
          <button
            onClick={() => setShowRegister((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            {showRegister ? 'Cancel' : 'Register device'}
          </button>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StatCard label="Total devices" value={devices.length} />
        <StatCard label="Assigned" value={assignedCount} />
        <StatCard label="Unassigned" value={unassignedCount} />
      </section>

      {/* Register form */}
      {showRegister && (
        <form
          onSubmit={handleRegister}
          className="surface-card rounded-2xl p-6 space-y-4"
        >
          <header>
            <h2 className="text-lg font-black tracking-tight text-gray-900">
              Register a new device
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Each device tap event references this ID. Friendly name is for
              your reference (e.g. "Room 101 doorway").
            </p>
          </header>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              required
              placeholder="Device ID (e.g. device_demo_001)"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <input
              placeholder="Friendly name (optional)"
              value={friendlyName}
              onChange={(e) => setFriendlyName(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center rounded-full px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            Register
          </button>
        </form>
      )}

      {/* Device list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="surface-card rounded-2xl h-20 animate-pulse" />
          ))}
        </div>
      ) : devices.length === 0 ? (
        <div className="surface-card rounded-3xl px-8 py-16 text-center space-y-4">
          <h3 className="text-2xl font-black tracking-tight text-gray-900">
            No devices yet
          </h3>
          <p className="text-gray-500 max-w-sm mx-auto">
            Register your first Bali device to start mapping taps to students.
          </p>
          <button
            onClick={() => setShowRegister(true)}
            className="inline-flex items-center rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            Register device
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {devices.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              onAssign={() => startAssign(d.deviceId)}
              onUnassign={() => handleUnassign(d.deviceId)}
            />
          ))}
        </ul>
      )}

      {/* Assign modal */}
      {assigningDevice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setAssigningDevice(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-black tracking-tight mb-1">Assign device</h2>
            <p className="text-xs text-gray-500 font-mono mb-4">{assigningDevice}</p>
            <input
              placeholder="Search students…"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <div className="max-h-64 overflow-auto rounded-xl border border-gray-100 divide-y divide-gray-100">
              {allStudents
                .filter((s) =>
                  `${s.firstName} ${s.lastName}`
                    .toLowerCase()
                    .includes(studentSearch.toLowerCase())
                )
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleAssign(assigningDevice, s.id)}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-medium text-gray-900">
                      {s.firstName} {s.lastName}
                    </span>
                    {s.email && (
                      <span className="text-gray-400 ml-2">{s.email}</span>
                    )}
                  </button>
                ))}
              {allStudents.length === 0 && (
                <p className="px-3 py-6 text-sm text-gray-500 text-center">
                  No students found. Add students to a class first.
                </p>
              )}
            </div>
            <button
              onClick={() => setAssigningDevice(null)}
              className="mt-4 w-full rounded-full border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-card rounded-2xl p-6">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
        {label}
      </p>
      <p className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-gray-900 leading-none">
        {value}
      </p>
    </div>
  );
}

function DeviceCard({
  device: d,
  onAssign,
  onUnassign,
}: {
  device: Device;
  onAssign: () => void;
  onUnassign: () => void;
}) {
  const isAssigned = !!d.studentId;
  const lastCheckInLabel = d.lastCheckInAt ? relativeTime(d.lastCheckInAt) : null;
  const blockingState = describeBlocking(d);

  return (
    <li className="surface-card rounded-2xl p-6 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
            {d.friendlyName ?? 'Device'}
          </p>
          <h3 className="mt-1 font-mono text-base font-bold text-gray-900 truncate">
            {d.deviceId}
          </h3>
        </div>
        <span
          className={`flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
            isAssigned
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-gray-200 bg-gray-50 text-gray-500'
          }`}
        >
          {isAssigned ? 'Assigned' : 'Unassigned'}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Student
          </dt>
          <dd className="mt-0.5 font-medium text-gray-900 truncate">
            {d.studentName ?? <span className="text-gray-400">—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Last check-in
          </dt>
          <dd className="mt-0.5 font-medium text-gray-900">
            {lastCheckInLabel ?? <span className="text-gray-400">Never</span>}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
            Blocking
          </dt>
          <dd className="mt-1">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${blockingState.tint}`}
            >
              {blockingState.label}
            </span>
          </dd>
        </div>
      </dl>

      <div className="flex gap-2 pt-1">
        {isAssigned ? (
          <button
            onClick={onUnassign}
            className="flex-1 rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Unassign
          </button>
        ) : (
          <button
            onClick={onAssign}
            className="flex-1 rounded-full px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            Assign to student
          </button>
        )}
      </div>
    </li>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function describeBlocking(d: Device): { label: string; tint: string } {
  if (!d.studentId) {
    return {
      label: 'No student',
      tint: 'bg-gray-50 text-gray-500 border-gray-200',
    };
  }
  if (d.lastBlockingApplied === undefined || d.lastBlockingApplied === null) {
    return {
      label: 'No reports yet',
      tint: 'bg-gray-50 text-gray-500 border-gray-200',
    };
  }
  if (d.lastBlockingApplied) {
    return {
      label: `Applied · ${relativeTime(d.lastBlockingReportedAt)}`,
      tint: 'bg-green-50 text-green-700 border-green-200',
    };
  }
  return {
    label: `Off · ${relativeTime(d.lastBlockingReportedAt)}`,
    tint: 'bg-amber-50 text-amber-700 border-amber-200',
  };
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
