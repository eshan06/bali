'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import type { Device, BlockingSnapshot } from '@bali/shared';

const BRAND = '#2E5BD0';

type CheckInResult =
  | {
      ok: true;
      data: {
        success: boolean;
        deviceId: string;
        studentId: string | null;
        studentName: string | null;
        sessionId: string;
        classId: string;
        attendanceStatus: 'present' | 'late';
        checkInTime: string;
        blockingPolicy: BlockingSnapshot;
      };
    }
  | { ok: false; error: string; code?: string };

type PolicyResult =
  | {
      ok: true;
      data: {
        blockingActive: boolean;
        mode: string | null;
        classId: string | null;
        sessionId: string | null;
        blockedApps: { bundleId: string; appName: string }[];
        allowedApps: { bundleId: string; appName: string }[];
        message?: string;
      };
    }
  | { ok: false; error: string };

type ReportResult = { ok: true; status: string } | { ok: false; error: string };

export default function SimulatorPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  // Tap panel
  const [tapDeviceId, setTapDeviceId] = useState('');
  const [tapBusy, setTapBusy] = useState(false);
  const [tapResult, setTapResult] = useState<CheckInResult | null>(null);

  // Policy panel
  const [policyStudentId, setPolicyStudentId] = useState('');
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyResult, setPolicyResult] = useState<PolicyResult | null>(null);

  // Report panel
  const [reportBusy, setReportBusy] = useState(false);
  const [reportResult, setReportResult] = useState<ReportResult | null>(null);

  useEffect(() => {
    api.get<{ devices: Device[] }>('/devices')
      .then((r) => {
        setDevices(r.devices);
        if (r.devices.length > 0) setTapDeviceId(r.devices[0].deviceId);
      })
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, []);

  const tapDevice = devices.find((d) => d.deviceId === tapDeviceId);

  async function sendTap() {
    if (!tapDeviceId.trim()) return;
    setTapBusy(true);
    setTapResult(null);
    try {
      const data = await api.post<CheckInResult extends { ok: true; data: infer D } ? D : never>(
        '/dev/simulator/check-in',
        { deviceId: tapDeviceId.trim(), timestamp: new Date().toISOString() }
      );
      setTapResult({ ok: true, data: data as any });
    } catch (err: any) {
      setTapResult({ ok: false, error: err.message ?? 'Request failed' });
    } finally {
      setTapBusy(false);
    }
  }

  async function fetchPolicy() {
    const fromTap = tapResult?.ok ? tapResult.data.studentId : null;
    const target = (policyStudentId.trim() || fromTap || '').trim();
    if (!target) return;
    setPolicyBusy(true);
    setPolicyResult(null);
    try {
      const data = await api.get<any>(`/dev/simulator/policy/${target}`);
      setPolicyResult({ ok: true, data });
    } catch (err: any) {
      setPolicyResult({ ok: false, error: err.message ?? 'Request failed' });
    } finally {
      setPolicyBusy(false);
    }
  }

  async function reportStatus(applied: boolean) {
    if (!tapResult?.ok) return;
    const { sessionId, studentId } = tapResult.data;
    if (!sessionId || !studentId) return;
    setReportBusy(true);
    setReportResult(null);
    try {
      await api.post(
        `/dev/simulator/blocking-status/${sessionId}/${studentId}`,
        { isBlocked: applied }
      );
      setReportResult({ ok: true, status: applied ? 'applied' : 'failed' });
    } catch (err: any) {
      setReportResult({ ok: false, error: err.message ?? 'Request failed' });
    } finally {
      setReportBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="surface-card-hero rounded-3xl h-32" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="surface-card rounded-2xl h-80" />
          <div className="surface-card rounded-2xl h-80" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="surface-card-hero rounded-3xl p-7 md:p-9">
        <p
          className="text-[11px] font-black uppercase tracking-[0.22em]"
          style={{ color: BRAND }}
        >
          Developer · Simulator
        </p>
        <h1 className="mt-2 text-3xl md:text-4xl font-black tracking-tight text-gray-900 leading-tight">
          Device & student-app simulator
        </h1>
        <p className="mt-2 text-sm md:text-base text-gray-500 max-w-2xl">
          Drive the full check-in / blocking-policy flow without real hardware
          or the iOS app. Authenticated calls go through the same handlers
          firmware will hit in production.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* TAP PANEL */}
        <section className="surface-card rounded-2xl p-7 space-y-5">
          <header>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
              Hardware tap
            </p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-gray-900">
              Simulate a device tap
            </h2>
          </header>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Device
            </label>
            {devices.length > 0 ? (
              <select
                value={tapDeviceId}
                onChange={(e) => setTapDeviceId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.deviceId}>
                    {d.deviceId}
                    {d.friendlyName ? ` — ${d.friendlyName}` : ''}
                    {d.studentName ? ` (${d.studentName})` : ' · unassigned'}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={tapDeviceId}
                onChange={(e) => setTapDeviceId(e.target.value)}
                placeholder="device_demo_001"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            )}
            {tapDevice && (
              <p className="mt-1.5 text-xs text-gray-500">
                {tapDevice.studentName
                  ? `Assigned to ${tapDevice.studentName}`
                  : 'Not assigned to a student'}
              </p>
            )}
          </div>

          <button
            onClick={sendTap}
            disabled={!tapDeviceId.trim() || tapBusy}
            className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {tapBusy ? 'Tapping…' : 'Simulate tap → check in'}
          </button>

          {tapResult && (
            <div
              className={`rounded-xl p-4 text-sm border ${
                tapResult.ok
                  ? 'border-green-200 bg-green-50 text-green-900'
                  : 'border-red-200 bg-red-50 text-red-900'
              }`}
            >
              {tapResult.ok ? (
                <div className="space-y-1.5">
                  <p className="font-bold">
                    Check-in received · {tapResult.data.attendanceStatus.toUpperCase()}
                  </p>
                  <p>
                    {tapResult.data.studentName ?? 'Student'} ·{' '}
                    {new Date(tapResult.data.checkInTime).toLocaleTimeString()}
                  </p>
                  <p className="text-xs text-green-700/80">
                    session {tapResult.data.sessionId.slice(0, 8)}…
                  </p>
                </div>
              ) : (
                <p className="font-medium">{tapResult.error}</p>
              )}
            </div>
          )}
        </section>

        {/* iOS POLICY PANEL */}
        <section className="surface-card rounded-2xl p-7 space-y-5">
          <header>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
              iOS app
            </p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-gray-900">
              Fetch current blocking policy
            </h2>
          </header>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
              Student ID
            </label>
            <input
              type="text"
              value={policyStudentId}
              onChange={(e) => setPolicyStudentId(e.target.value)}
              placeholder={
                tapResult?.ok && tapResult.data.studentId
                  ? tapResult.data.studentId
                  : 'paste a student id, or tap first'
              }
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          <button
            onClick={fetchPolicy}
            disabled={
              policyBusy ||
              (!policyStudentId.trim() && !(tapResult?.ok && tapResult.data.studentId))
            }
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
          >
            {policyBusy ? 'Fetching…' : 'Fetch policy'}
          </button>

          {policyResult && policyResult.ok && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900">
                  {policyResult.data.blockingActive ? 'Blocking active' : 'No active blocking'}
                </span>
                {policyResult.data.mode && (
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: 'rgba(46, 91, 208, 0.10)', color: BRAND }}
                  >
                    {policyResult.data.mode}
                  </span>
                )}
              </div>
              {policyResult.data.message && (
                <p className="text-gray-500">{policyResult.data.message}</p>
              )}
              {policyResult.data.blockedApps.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Blocked
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {policyResult.data.blockedApps.map((a) => (
                      <span
                        key={a.bundleId}
                        className="rounded-full bg-red-100 text-red-700 border border-red-200 px-2.5 py-0.5 text-xs font-medium"
                      >
                        {a.appName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {policyResult.data.allowedApps.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Allowed (full focus)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {policyResult.data.allowedApps.map((a) => (
                      <span
                        key={a.bundleId}
                        className="rounded-full bg-green-100 text-green-700 border border-green-200 px-2.5 py-0.5 text-xs font-medium"
                      >
                        {a.appName}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {policyResult && !policyResult.ok && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              {policyResult.error}
            </div>
          )}
        </section>

        {/* REPORT BACK PANEL */}
        <section className="surface-card rounded-2xl p-7 space-y-5 lg:col-span-2">
          <header>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
              Status report
            </p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-gray-900">
              Report blocking status back to the teacher
            </h2>
            <p className="mt-1 text-sm text-gray-500 max-w-2xl">
              Uses the session/student from the most recent successful tap. Lets you confirm
              the active session page picks up the iOS app's status updates.
            </p>
          </header>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => reportStatus(true)}
              disabled={!tapResult?.ok || reportBusy}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              Report blocking applied
            </button>
            <button
              onClick={() => reportStatus(false)}
              disabled={!tapResult?.ok || reportBusy}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
            >
              Report blocking failed
            </button>
            {reportResult && (
              <span
                className={`text-sm font-medium ${
                  reportResult.ok ? 'text-green-700' : 'text-red-700'
                }`}
              >
                {reportResult.ok
                  ? `Sent · status=${reportResult.status}`
                  : reportResult.error}
              </span>
            )}
          </div>

          {!tapResult?.ok && (
            <p className="text-xs text-gray-400">
              Run a successful tap first to enable the report buttons.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
