'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { Device, Student } from '@bali/shared';

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [friendlyName, setFriendlyName] = useState('');
  const [error, setError] = useState('');

  // For assignment modal
  const [assigningDevice, setAssigningDevice] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [allStudents, setAllStudents] = useState<Student[]>([]);

  const loadDevices = () => {
    api.get<{ devices: Device[] }>('/devices')
      .then(res => setDevices(res.devices))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadDevices(); }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/devices', { deviceId, friendlyName: friendlyName || undefined });
      setDeviceId(''); setFriendlyName('');
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
    // Load all students from all classes
    try {
      const res = await api.get<{ classes: Array<{ id: string }> }>('/classes');
      const students: Student[] = [];
      for (const c of res.classes) {
        const sRes = await api.get<{ students: Student[] }>(`/classes/${c.id}/students`);
        for (const s of sRes.students) {
          if (!students.find(existing => existing.id === s.id)) {
            students.push(s);
          }
        }
      }
      setAllStudents(students);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Devices</h1>
        <button
          onClick={() => setShowRegister(!showRegister)}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
        >
          Register Device
        </button>
      </div>

      {showRegister && (
        <form onSubmit={handleRegister} className="glass-card rounded-2xl p-6 space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <input required placeholder="Device ID (e.g., BALI-DEV-0001)" value={deviceId}
              onChange={e => setDeviceId(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
            <input placeholder="Friendly name (optional)" value={friendlyName}
              onChange={e => setFriendlyName(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
            <button type="submit"
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700">
              Register
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center text-gray-500">
          No devices registered yet.
        </div>
      ) : (
        <div className="glass-card rounded-2xl">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Device ID</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Assigned To</th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {devices.map(d => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-gray-900">{d.deviceId}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{d.friendlyName || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    {d.studentName ? (
                      <span className="text-gray-900">{d.studentName}</span>
                    ) : (
                      <span className="text-gray-400">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {d.studentId ? (
                      <button onClick={() => handleUnassign(d.deviceId)}
                        className="text-sm text-red-600 hover:underline">
                        Unassign
                      </button>
                    ) : (
                      <button onClick={() => startAssign(d.deviceId)}
                        className="text-sm text-primary-600 hover:underline">
                        Assign
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Assign modal */}
      {assigningDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAssigningDevice(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Assign Device: {assigningDevice}</h2>
            <input
              placeholder="Search students..."
              value={studentSearch}
              onChange={e => setStudentSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-3 focus:border-primary-500 focus:outline-none"
            />
            <div className="max-h-64 overflow-auto divide-y divide-gray-100">
              {allStudents
                .filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(studentSearch.toLowerCase()))
                .map(s => (
                  <button key={s.id} onClick={() => handleAssign(assigningDevice, s.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
                    {s.firstName} {s.lastName}
                    {s.email && <span className="text-gray-400 ml-2">{s.email}</span>}
                  </button>
                ))}
              {allStudents.length === 0 && (
                <p className="px-3 py-4 text-sm text-gray-500 text-center">No students found. Add students to a class first.</p>
              )}
            </div>
            <button onClick={() => setAssigningDevice(null)}
              className="mt-4 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
