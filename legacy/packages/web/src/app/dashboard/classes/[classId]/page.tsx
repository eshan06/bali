'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api-client';
import {
  Class,
  Student,
  TeacherApp,
  BlockingPreset,
  TeacherClassInvite,
  Device,
  SessionAttendanceSummary,
  SYSTEM_PROTECTED_BUNDLE_IDS,
  SUGGESTED_APPS,
} from '@bali/shared';

const BRAND = '#2E5BD0';

const PRESET_LABELS: Record<BlockingPreset, string> = {
  none: 'No blocking',
  full_focus: 'Full Focus',
  no_social_media: 'No Social Media',
  no_games: 'No Games',
  custom: 'Custom',
};

const PRESETS: {
  key: Exclude<BlockingPreset, 'none'>;
  title: string;
  desc: string;
}[] = [
  {
    key: 'full_focus',
    title: 'Full Focus',
    desc: 'Only Phone, Messages, Calculator, Camera, Clock, Safari, and Notes stay open.',
  },
  {
    key: 'no_social_media',
    title: 'No Social Media',
    desc: 'Blocks Instagram, TikTok, Snapchat, Facebook, Twitter/X, and YouTube.',
  },
  {
    key: 'no_games',
    title: 'No Games',
    desc: 'Blocks Brawl Stars, Among Us, Minecraft, Roblox, and other popular games.',
  },
  {
    key: 'custom',
    title: 'Custom',
    desc: 'Hand-pick exactly which apps this class should block during sessions.',
  },
];

function periodLabel(period?: string | null): string | null {
  if (!period) return null;
  const trimmed = period.trim();
  if (!trimmed) return null;
  return /^period\b/i.test(trimmed) ? trimmed : `Period ${trimmed}`;
}

export default function ClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const [cls, setCls] = useState<(Class & { students: Student[] }) | null>(null);
  const [loading, setLoading] = useState(true);

  // Blocking config state
  const [blockingPreset, setBlockingPreset] = useState<BlockingPreset>('none');
  const [teacherApps, setTeacherApps] = useState<TeacherApp[]>([]);
  const [customSelectedIds, setCustomSelectedIds] = useState<Set<string>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddApp, setShowAddApp] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newAppBundleId, setNewAppBundleId] = useState('');
  const [savingBlocking, setSavingBlocking] = useState(false);
  const [blockingSaved, setBlockingSaved] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const [invites, setInvites] = useState<TeacherClassInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const [devices, setDevices] = useState<Device[]>([]);
  const [recentSessions, setRecentSessions] = useState<
    SessionAttendanceSummary[]
  >([]);

  const loadClass = useCallback(() => {
    api
      .get<Class & { students: Student[] }>(`/classes/${classId}`)
      .then(setCls)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [classId]);

  useEffect(() => {
    loadClass();
  }, [loadClass]);

  const loadInvites = useCallback(() => {
    api
      .get<{ invites: TeacherClassInvite[] }>(`/classes/${classId}/invites`)
      .then((res) => setInvites(res.invites))
      .catch(console.error);
  }, [classId]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  // Blocking config + teacher apps
  useEffect(() => {
    api
      .get<{
        config: { preset: BlockingPreset; customApps: TeacherApp[] };
      }>(`/classes/${classId}/blocking-config`)
      .then((res) => {
        setBlockingPreset(res.config.preset);
        setCustomSelectedIds(new Set(res.config.customApps.map((a) => a.id)));
      })
      .catch(console.error);

    api
      .get<{ apps: TeacherApp[] }>('/blocking/teacher-apps')
      .then((res) => setTeacherApps(res.apps))
      .catch(console.error);
  }, [classId]);

  // Devices + recent sessions for the lightweight panels
  useEffect(() => {
    api
      .get<{ devices: Device[] }>('/devices')
      .then((res) => setDevices(res.devices))
      .catch(() => setDevices([]));
    api
      .get<{ sessions: SessionAttendanceSummary[] }>(
        `/classes/${classId}/sessions`
      )
      .then((res) => setRecentSessions(res.sessions.slice(0, 5)))
      .catch(() => setRecentSessions([]));
  }, [classId]);

  const handleRemoveStudent = async (studentId: string) => {
    if (!confirm('Remove this student from the class?')) return;
    await api.delete(`/classes/${classId}/students/${studentId}`);
    loadClass();
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    setInviting(true);
    try {
      await api.post(`/classes/${classId}/invites`, {
        email: inviteEmail.trim(),
      });
      setInviteEmail('');
      loadInvites();
    } catch (err: any) {
      setInviteError(err.message || 'Could not send invite');
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!confirm('Revoke this invite?')) return;
    try {
      await api.delete(`/classes/${classId}/invites/${inviteId}`);
      loadInvites();
    } catch (err: any) {
      alert(err.message || 'Could not revoke invite');
    }
  };

  const saveBlockingConfig = async () => {
    setSavingBlocking(true);
    setBlockingSaved(false);
    try {
      await api.put(`/classes/${classId}/blocking-config`, {
        preset: blockingPreset,
        appIds: blockingPreset === 'custom' ? [...customSelectedIds] : [],
      });
      setBlockingSaved(true);
      setTimeout(() => setBlockingSaved(false), 3000);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingBlocking(false);
    }
  };

  const toggleCustomApp = (appId: string) => {
    setCustomSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  };

  const addCustomApp = async () => {
    if (!newAppBundleId || !newAppName) return;
    if (
      (SYSTEM_PROTECTED_BUNDLE_IDS as readonly string[]).includes(newAppBundleId)
    ) {
      alert('Phone and iMessage cannot be blocked.');
      return;
    }
    try {
      const app = await api.post<TeacherApp>('/blocking/teacher-apps', {
        bundleId: newAppBundleId,
        appName: newAppName,
      });
      setTeacherApps((prev) => [...prev, app]);
      setCustomSelectedIds((prev) => new Set([...prev, app.id]));
      setNewAppName('');
      setNewAppBundleId('');
      setShowAddApp(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) return <ClassDetailSkeleton />;

  if (!cls) {
    return (
      <div className="surface-card rounded-3xl px-8 py-20 text-center space-y-3">
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
          Class not found
        </h2>
        <p className="text-gray-500">
          The class you're looking for has been removed or you don't have access.
        </p>
        <Link
          href="/dashboard/classes/"
          className="inline-flex items-center rounded-full px-6 py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm mt-2"
          style={{ backgroundColor: BRAND }}
        >
          Back to Classes
        </Link>
      </div>
    );
  }

  const filteredApps = searchQuery
    ? teacherApps.filter((a) =>
        a.appName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : teacherApps;

  const suggestedInCatalog = SUGGESTED_APPS.map((s) =>
    teacherApps.find((a) => a.bundleId === s.bundleId)
  ).filter(Boolean) as TeacherApp[];

  const deviceByStudent = new Map(
    devices.filter((d) => d.studentId).map((d) => [d.studentId!, d])
  );
  const studentsWithDevice = cls.students.filter((s) =>
    deviceByStudent.has(s.id)
  ).length;

  return (
    <div className="space-y-8">
      {/* ── 1. CLASS HEADER ───────────────────────────────────────────── */}
      <ClassHeader
        cls={cls}
        classId={classId}
        presetLabel={PRESET_LABELS[blockingPreset]}
      />

      {/* ── 2. APP BLOCKING ──────────────────────────────────────────── */}
      <BlockingSection
        preset={blockingPreset}
        onPresetChange={setBlockingPreset}
        customSelectedIds={customSelectedIds}
        toggleCustomApp={toggleCustomApp}
        teacherApps={teacherApps}
        filteredApps={filteredApps}
        suggestedInCatalog={suggestedInCatalog}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showAddApp={showAddApp}
        setShowAddApp={setShowAddApp}
        newAppName={newAppName}
        setNewAppName={setNewAppName}
        newAppBundleId={newAppBundleId}
        setNewAppBundleId={setNewAppBundleId}
        addCustomApp={addCustomApp}
        savingBlocking={savingBlocking}
        blockingSaved={blockingSaved}
        onSave={saveBlockingConfig}
      />

      {/* ── 3. STUDENT JOIN ──────────────────────────────────────────── */}
      <StudentJoinSection
        classId={classId}
        linkCopied={linkCopied}
        codeCopied={codeCopied}
        onLinkCopy={() => {
          navigator.clipboard.writeText(
            `${window.location.origin}/join/${classId}`
          );
          setLinkCopied(true);
          setTimeout(() => setLinkCopied(false), 2000);
        }}
        onCodeCopy={() => {
          navigator.clipboard.writeText(String(classId));
          setCodeCopied(true);
          setTimeout(() => setCodeCopied(false), 2000);
        }}
      />

      {/* ── 4. STUDENTS ──────────────────────────────────────────────── */}
      <StudentsSection
        cls={cls}
        classId={classId}
        deviceByStudent={deviceByStudent}
        studentsWithDevice={studentsWithDevice}
        invites={invites}
        inviteEmail={inviteEmail}
        setInviteEmail={setInviteEmail}
        inviting={inviting}
        inviteError={inviteError}
        onInvite={handleInvite}
        onRevokeInvite={handleRevokeInvite}
        onRemoveStudent={handleRemoveStudent}
      />

      {/* ── 5. RECENT SESSIONS ───────────────────────────────────────── */}
      <RecentSessionsSection
        classId={classId}
        sessions={recentSessions}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Class header                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function ClassHeader({
  cls,
  classId,
  presetLabel,
}: {
  cls: Class & { students: Student[] };
  classId: string;
  presetLabel: string;
}) {
  const eyebrow = periodLabel(cls.period) ?? 'Class';
  const studentCount = cls.students.length;
  const blockingOn = (cls.blockingPreset ?? 'none') !== 'none';

  return (
    <section className="surface-card-hero rounded-3xl p-7 md:p-9">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div className="space-y-3 min-w-0">
          <p
            className="text-[11px] font-black uppercase tracking-[0.22em]"
            style={{ color: BRAND }}
          >
            {eyebrow}
          </p>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gray-900 leading-[1.05] truncate">
            {cls.name}
          </h1>
          {cls.description && (
            <p className="text-sm md:text-base text-gray-500 max-w-xl leading-relaxed">
              {cls.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
              {studentCount} {studentCount === 1 ? 'student' : 'students'}
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
              style={{
                backgroundColor: blockingOn
                  ? 'rgba(46, 91, 208, 0.10)'
                  : '#f3f4f6',
                color: blockingOn ? BRAND : '#6b7280',
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor: blockingOn ? BRAND : '#9ca3af',
                }}
              />
              {presetLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
          <Link
            href={`/dashboard/classes/${classId}/edit/`}
            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Edit Class
          </Link>
          <Link
            href={`/dashboard/classes/${classId}/sessions/`}
            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Session History
          </Link>
          <Link
            href={`/dashboard/session/?classId=${classId}`}
            className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            <IconPlay className="h-3.5 w-3.5" />
            Start Session
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  App Blocking                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

function BlockingSection({
  preset,
  onPresetChange,
  customSelectedIds,
  toggleCustomApp,
  teacherApps,
  filteredApps,
  suggestedInCatalog,
  searchQuery,
  setSearchQuery,
  showAddApp,
  setShowAddApp,
  newAppName,
  setNewAppName,
  newAppBundleId,
  setNewAppBundleId,
  addCustomApp,
  savingBlocking,
  blockingSaved,
  onSave,
}: {
  preset: BlockingPreset;
  onPresetChange: (p: BlockingPreset) => void;
  customSelectedIds: Set<string>;
  toggleCustomApp: (id: string) => void;
  teacherApps: TeacherApp[];
  filteredApps: TeacherApp[];
  suggestedInCatalog: TeacherApp[];
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  showAddApp: boolean;
  setShowAddApp: (b: boolean) => void;
  newAppName: string;
  setNewAppName: (s: string) => void;
  newAppBundleId: string;
  setNewAppBundleId: (s: string) => void;
  addCustomApp: () => void;
  savingBlocking: boolean;
  blockingSaved: boolean;
  onSave: () => void;
}) {
  return (
    <section className="surface-card rounded-2xl p-7 space-y-6">
      <header className="space-y-1.5">
        <p
          className="text-[11px] font-black uppercase tracking-[0.18em]"
          style={{ color: BRAND }}
        >
          Focus
        </p>
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
          App Blocking
        </h2>
        <p className="text-sm text-gray-500 max-w-2xl">
          Choose the focus policy this class will use when sessions start.
          You can change it any time — new sessions pick it up automatically.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PRESETS.map((p) => {
          const selected = preset === p.key;
          return (
            <button
              key={p.key}
              onClick={() => onPresetChange(p.key)}
              aria-pressed={selected}
              className={`relative text-left rounded-2xl border-2 p-4 transition-all ${
                selected
                  ? 'border-brand bg-brand/[0.06] shadow-sm'
                  : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
              }`}
              style={selected ? { borderColor: BRAND } : undefined}
            >
              {selected && (
                <span
                  className="absolute top-3 right-3 h-5 w-5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: BRAND }}
                >
                  <svg
                    className="h-3 w-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                </span>
              )}
              <p
                className={`pr-6 text-sm font-black tracking-tight ${
                  selected ? 'text-gray-900' : 'text-gray-800'
                }`}
              >
                {p.title}
              </p>
              <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
                {p.desc}
              </p>
            </button>
          );
        })}
      </div>

      {preset !== 'none' && (
        <button
          onClick={() => onPresetChange('none')}
          className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
        >
          Disable blocking for this class
        </button>
      )}

      {preset === 'custom' && (
        <div className="space-y-5 border-t border-gray-100 pt-6">
          <input
            type="text"
            placeholder="Search apps to block…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
          />

          {!searchQuery && suggestedInCatalog.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Suggested
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestedInCatalog.map((app) => (
                  <AppChip
                    key={app.id}
                    label={app.appName}
                    selected={customSelectedIds.has(app.id)}
                    onClick={() => toggleCustomApp(app.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {searchQuery && (
            <div className="flex flex-wrap gap-2">
              {filteredApps.length > 0 ? (
                filteredApps.map((app) => (
                  <AppChip
                    key={app.id}
                    label={app.appName}
                    selected={customSelectedIds.has(app.id)}
                    onClick={() => toggleCustomApp(app.id)}
                  />
                ))
              ) : (
                <p className="text-sm text-gray-400">
                  No apps match “{searchQuery}”
                </p>
              )}
            </div>
          )}

          {customSelectedIds.size > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Blocked apps ({customSelectedIds.size})
              </p>
              <div className="flex flex-wrap gap-2">
                {teacherApps
                  .filter((a) => customSelectedIds.has(a.id))
                  .map((app) => (
                    <span
                      key={app.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-red-50 text-red-700 border border-red-200 px-3 py-1 text-xs font-bold"
                    >
                      {app.appName}
                      <button
                        onClick={() => toggleCustomApp(app.id)}
                        aria-label={`Remove ${app.appName}`}
                        className="hover:text-red-900"
                      >
                        ×
                      </button>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {!showAddApp ? (
            <button
              onClick={() => setShowAddApp(true)}
              className="text-sm font-bold text-brand hover:underline"
            >
              + Add custom app
            </button>
          ) : (
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    App name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Discord"
                    value={newAppName}
                    onChange={(e) => setNewAppName(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                    Bundle ID
                  </label>
                  <input
                    type="text"
                    placeholder="com.hammerandchisel.discord"
                    value={newAppBundleId}
                    onChange={(e) => setNewAppBundleId(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={addCustomApp}
                  disabled={!newAppName || !newAppBundleId}
                  className="rounded-full px-5 py-2 text-sm font-bold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                  style={{ backgroundColor: BRAND }}
                >
                  Add app
                </button>
                <button
                  onClick={() => {
                    setShowAddApp(false);
                    setNewAppName('');
                    setNewAppBundleId('');
                  }}
                  className="rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <button
          onClick={onSave}
          disabled={savingBlocking}
          className="inline-flex items-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 shadow-sm"
          style={{ backgroundColor: BRAND }}
        >
          {savingBlocking ? 'Saving…' : 'Save blocking policy'}
        </button>
        {blockingSaved && (
          <span className="text-sm font-medium text-green-700 inline-flex items-center gap-1.5">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.4}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
            Blocking policy saved. New sessions will use this policy.
          </span>
        )}
      </div>
    </section>
  );
}

function AppChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-3.5 py-1.5 text-sm font-bold border transition-all ${
        selected
          ? 'bg-red-50 text-red-700 border-red-200'
          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Student Join (link / code / QR)                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function StudentJoinSection({
  classId,
  linkCopied,
  codeCopied,
  onLinkCopy,
  onCodeCopy,
}: {
  classId: string;
  linkCopied: boolean;
  codeCopied: boolean;
  onLinkCopy: () => void;
  onCodeCopy: () => void;
}) {
  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/join/${classId}`
      : `/join/${classId}`;
  return (
    <section className="surface-card rounded-2xl p-7 space-y-6">
      <header className="space-y-1.5">
        <p
          className="text-[11px] font-black uppercase tracking-[0.18em]"
          style={{ color: BRAND }}
        >
          Join
        </p>
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
          Student Join
        </h2>
        <p className="text-sm text-gray-500 max-w-2xl">
          Students can join this class using the link, the class code, or by
          scanning the QR code with the Bali app.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        <div className="md:col-span-2 space-y-4">
          <CopyField
            label="Invite link"
            value={link}
            onCopy={onLinkCopy}
            copied={linkCopied}
            mono
          />
          <CopyField
            label="Class code"
            value={String(classId)}
            onCopy={onCodeCopy}
            copied={codeCopied}
            mono
          />
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
            {typeof window !== 'undefined' && (
              <QRCodeSVG value={link} size={144} level="M" />
            )}
          </div>
          <p className="text-xs text-gray-500">Scan with the Bali app</p>
        </div>
      </div>
    </section>
  );
}

function CopyField({
  label,
  value,
  onCopy,
  copied,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <div
          className={`flex-1 min-w-0 rounded-xl bg-gray-50 border border-gray-100 px-4 py-2.5 text-sm text-gray-700 truncate ${
            mono ? 'font-mono' : ''
          }`}
        >
          {value}
        </div>
        <button
          onClick={onCopy}
          className="rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Students roster                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function StudentsSection({
  cls,
  classId,
  deviceByStudent,
  studentsWithDevice,
  invites,
  inviteEmail,
  setInviteEmail,
  inviting,
  inviteError,
  onInvite,
  onRevokeInvite,
  onRemoveStudent,
}: {
  cls: Class & { students: Student[] };
  classId: string;
  deviceByStudent: Map<string, Device>;
  studentsWithDevice: number;
  invites: TeacherClassInvite[];
  inviteEmail: string;
  setInviteEmail: (s: string) => void;
  inviting: boolean;
  inviteError: string;
  onInvite: (e: React.FormEvent) => void;
  onRevokeInvite: (id: string) => void;
  onRemoveStudent: (id: string) => void;
}) {
  const total = cls.students.length;
  const unassigned = total - studentsWithDevice;
  const pendingInvites = invites.filter((i) => i.status === 'pending');

  return (
    <section className="surface-card rounded-2xl overflow-hidden">
      <header className="p-7 pb-5 space-y-1.5">
        <p
          className="text-[11px] font-black uppercase tracking-[0.18em]"
          style={{ color: BRAND }}
        >
          Roster
        </p>
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900">
          Students
        </h2>
        <p className="text-sm text-gray-500">
          Invite students by email. They'll see a pending invite on their
          dashboard the next time they sign in.
        </p>
      </header>

      <div className="px-7 pb-5 space-y-3">
        <form onSubmit={onInvite} className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            required
            placeholder="student@school.edu"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          <button
            type="submit"
            disabled={inviting || !inviteEmail.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            <IconPlus className="h-3.5 w-3.5" />
            {inviting ? 'Sending…' : 'Add Student'}
          </button>
        </form>
        {inviteError && <p className="text-sm text-red-600">{inviteError}</p>}
      </div>

      {pendingInvites.length > 0 && (
        <div className="px-7 pb-5 space-y-2 border-b border-gray-100">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
            Pending invites ({pendingInvites.length})
          </p>
          <ul className="rounded-xl border border-gray-100 bg-gray-50/60 divide-y divide-gray-100">
            {pendingInvites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">
                    {inv.email}
                  </p>
                  <p className="text-xs text-gray-500">
                    Invited {new Date(inv.invitedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
                    Pending
                  </span>
                  <button
                    onClick={() => onRevokeInvite(inv.id)}
                    className="text-xs font-medium text-gray-400 hover:text-red-600 transition-colors"
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-7 pb-3 pt-2 flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
          {total === 0
            ? 'Enrolled'
            : `Enrolled (${total} · ${studentsWithDevice} with device${
                unassigned > 0 ? `, ${unassigned} without` : ''
              })`}
        </p>
      </div>

      {cls.students.length === 0 ? (
        <div className="px-8 py-12 text-center space-y-2">
          <p className="text-base font-bold text-gray-900">No students yet</p>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            Invite a student by email above, or share the link, code, or QR
            from the join section.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {cls.students.map((s) => {
            const device = deviceByStudent.get(s.id);
            return (
              <li
                key={s.id}
                className="flex items-center gap-4 px-7 py-4 hover:bg-gray-50 transition-colors"
              >
                <Link
                  href={`/dashboard/classes/${classId}/students/${s.id}/`}
                  className="flex-1 min-w-0 group"
                >
                  <p className="font-bold text-gray-900 group-hover:text-brand transition-colors truncate">
                    {s.firstName} {s.lastName}
                  </p>
                  <p className="text-sm text-gray-500 truncate">
                    {s.email || (
                      <span className="text-gray-400">No email</span>
                    )}
                  </p>
                </Link>
                <span
                  className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${
                    device
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-gray-200 bg-gray-50 text-gray-500'
                  }`}
                >
                  {device ? 'Device assigned' : 'No device'}
                </span>
                <button
                  onClick={() => onRemoveStudent(s.id)}
                  className="text-xs font-medium text-gray-400 hover:text-red-600 transition-colors"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {total > 0 && unassigned > 0 && (
        <div className="px-7 py-3 text-xs text-gray-500 border-t border-gray-100 flex items-center justify-between gap-3">
          <span>{unassigned} student(s) don't have a device yet.</span>
          <Link
            href="/dashboard/devices/"
            className="font-bold text-brand hover:underline whitespace-nowrap"
          >
            Manage devices →
          </Link>
        </div>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Recent sessions                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

function RecentSessionsSection({
  classId,
  sessions,
}: {
  classId: string;
  sessions: SessionAttendanceSummary[];
}) {
  return (
    <section className="surface-card rounded-2xl p-7 space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div className="space-y-1.5 min-w-0">
          <p
            className="text-[11px] font-black uppercase tracking-[0.18em]"
            style={{ color: BRAND }}
          >
            History
          </p>
          <h2 className="text-xl md:text-2xl font-black tracking-tight text-gray-900">
            Recent sessions
          </h2>
        </div>
        {sessions.length > 0 && (
          <Link
            href={`/dashboard/classes/${classId}/sessions/`}
            className="text-xs font-bold text-brand hover:underline whitespace-nowrap"
          >
            View all →
          </Link>
        )}
      </header>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-10 text-center">
          <p className="text-sm font-bold text-gray-900">No sessions yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Start a session to begin tracking attendance.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {sessions.map((s) => (
            <li key={s.sessionId}>
              <Link
                href={`/dashboard/classes/${classId}/sessions/${s.sessionId}/`}
                className="flex items-center justify-between gap-4 py-3 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 group-hover:text-brand transition-colors">
                    {new Date(s.startedAt).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(s.startedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {s.endedAt &&
                      ` – ${new Date(s.endedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`}
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-3 text-xs font-bold">
                  <span className="text-green-700">{s.presentCount} present</span>
                  <span className="text-amber-700">{s.lateCount} late</span>
                  <span className="text-red-700">{s.absentCount} absent</span>
                </div>
                <span className="text-xs font-bold text-gray-400 group-hover:text-brand transition-colors">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Loading skeleton                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

function ClassDetailSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="surface-card-hero rounded-3xl h-48" />
      <div className="surface-card rounded-2xl h-72" />
      <div className="surface-card rounded-2xl h-56" />
      <div className="surface-card rounded-2xl h-64" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Tiny atoms                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

function IconPlus({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.4}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconPlay({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
