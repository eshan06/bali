'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import {
  Class, Student, TeacherApp, BlockingPreset,
  SYSTEM_PROTECTED_BUNDLE_IDS, SUGGESTED_APPS,
} from '@bali/shared';

export default function ClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const [cls, setCls] = useState<Class & { students: Student[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [addError, setAddError] = useState('');

  // Blocking config state
  const [blockingPreset, setBlockingPreset] = useState<BlockingPreset>('none');
  const [teacherApps, setTeacherApps] = useState<TeacherApp[]>([]);
  const [customSelectedIds, setCustomSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddApp, setShowAddApp] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newAppBundleId, setNewAppBundleId] = useState('');
  const [savingBlocking, setSavingBlocking] = useState(false);
  const [blockingSaved, setBlockingSaved] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const loadClass = () => {
    api.get<Class & { students: Student[] }>(`/classes/${classId}`)
      .then(setCls)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadClass(); }, [classId]);

  // Load blocking config + teacher apps
  useEffect(() => {
    api.get<{ config: { preset: BlockingPreset; customApps: TeacherApp[] } }>(`/classes/${classId}/blocking-config`)
      .then(res => {
        setBlockingPreset(res.config.preset);
        setCustomSelectedIds(new Set(res.config.customApps.map(a => a.id)));
      })
      .catch(console.error);

    api.get<{ apps: TeacherApp[] }>('/blocking/teacher-apps')
      .then(res => setTeacherApps(res.apps))
      .catch(console.error);
  }, [classId]);

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    try {
      await api.post(`/classes/${classId}/students`, { firstName, lastName, email: email || undefined });
      setFirstName(''); setLastName(''); setEmail('');
      setShowAddForm(false);
      loadClass();
    } catch (err: any) {
      setAddError(err.message);
    }
  };

  const handleRemoveStudent = async (studentId: string) => {
    if (!confirm('Remove this student from the class?')) return;
    await api.delete(`/classes/${classId}/students/${studentId}`);
    loadClass();
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
      setTimeout(() => setBlockingSaved(false), 2000);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingBlocking(false);
    }
  };

  const toggleCustomApp = (appId: string) => {
    setCustomSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(appId)) next.delete(appId);
      else next.add(appId);
      return next;
    });
  };

  const addCustomApp = async () => {
    if (!newAppBundleId || !newAppName) return;
    if ((SYSTEM_PROTECTED_BUNDLE_IDS as readonly string[]).includes(newAppBundleId)) {
      alert('Phone and iMessage cannot be blocked.');
      return;
    }
    try {
      const app = await api.post<TeacherApp>('/blocking/teacher-apps', {
        bundleId: newAppBundleId,
        appName: newAppName,
      });
      setTeacherApps(prev => [...prev, app]);
      setCustomSelectedIds(prev => new Set([...prev, app.id]));
      setNewAppName('');
      setNewAppBundleId('');
      setShowAddApp(false);
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="h-64 bg-gray-200 rounded" />
    </div>;
  }

  if (!cls) return <p className="text-gray-500">Class not found.</p>;

  // Filter teacher apps by search
  const filteredApps = searchQuery
    ? teacherApps.filter(a => a.appName.toLowerCase().includes(searchQuery.toLowerCase()))
    : teacherApps;

  // Suggested apps that exist in teacher's catalog
  const suggestedInCatalog = SUGGESTED_APPS
    .map(s => teacherApps.find(a => a.bundleId === s.bundleId))
    .filter(Boolean) as TeacherApp[];

  const presets: { key: BlockingPreset; title: string; desc: string }[] = [
    { key: 'full_focus', title: 'Full Focus', desc: 'Blocks everything except essential apps (Phone, Messages, Calculator, Camera, Clock, Safari, Notes)' },
    { key: 'no_social_media', title: 'No Social Media', desc: 'Blocks Instagram, TikTok, Snapchat, Facebook, Twitter/X, YouTube' },
    { key: 'no_games', title: 'No Games', desc: 'Blocks Brawl Stars, Among Us, Minecraft, Roblox, and more' },
    { key: 'custom', title: 'Custom', desc: 'Choose exactly which apps to block' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cls.name}</h1>
          {cls.period && <p className="text-gray-500">{cls.period}</p>}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/dashboard/classes/${classId}/sessions/`}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Session History
          </Link>
          <Link
            href={`/dashboard/classes/${classId}/edit/`}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Edit
          </Link>
        </div>
      </div>

      {cls.description && (
        <p className="text-gray-600">{cls.description}</p>
      )}

      {/* ── App Blocking ── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">App Blocking</h2>
          <p className="text-sm text-gray-500 mt-1">
            Choose a blocking policy for this class. It will be applied automatically when you start a session.
          </p>
        </div>

        <div className="p-5 space-y-5">
          {/* Preset cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {presets.map(p => (
              <button
                key={p.key}
                onClick={() => setBlockingPreset(p.key)}
                className={`text-left rounded-xl border-2 p-4 transition-all ${
                  blockingPreset === p.key
                    ? p.key === 'full_focus'
                      ? 'border-red-500 bg-red-50'
                      : p.key === 'no_social_media'
                      ? 'border-orange-500 bg-orange-50'
                      : p.key === 'no_games'
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <p className={`font-semibold text-sm ${
                  blockingPreset === p.key ? 'text-gray-900' : 'text-gray-700'
                }`}>{p.title}</p>
                <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{p.desc}</p>
              </button>
            ))}
          </div>

          {/* "None" toggle */}
          {blockingPreset !== 'none' && (
            <button
              onClick={() => setBlockingPreset('none')}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Disable blocking for this class
            </button>
          )}

          {/* Custom mode controls */}
          {blockingPreset === 'custom' && (
            <div className="space-y-4 border-t border-gray-100 pt-5">
              {/* Search */}
              <input
                type="text"
                placeholder="Search apps to block..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              />

              {/* Suggested apps */}
              {!searchQuery && suggestedInCatalog.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Suggested</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedInCatalog.map(app => {
                      const selected = customSelectedIds.has(app.id);
                      return (
                        <button
                          key={app.id}
                          onClick={() => toggleCustomApp(app.id)}
                          className={`rounded-full px-3.5 py-1.5 text-sm font-medium border transition-all ${
                            selected
                              ? 'bg-red-100 text-red-700 border-red-300'
                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {app.appName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Search results */}
              {searchQuery && (
                <div className="flex flex-wrap gap-2">
                  {filteredApps.length > 0 ? (
                    filteredApps.map(app => {
                      const selected = customSelectedIds.has(app.id);
                      return (
                        <button
                          key={app.id}
                          onClick={() => toggleCustomApp(app.id)}
                          className={`rounded-full px-3.5 py-1.5 text-sm font-medium border transition-all ${
                            selected
                              ? 'bg-red-100 text-red-700 border-red-300'
                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {app.appName}
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm text-gray-400">No apps match "{searchQuery}"</p>
                  )}
                </div>
              )}

              {/* Blocked apps display */}
              {customSelectedIds.size > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">
                    Blocked Apps ({customSelectedIds.size})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {teacherApps
                      .filter(a => customSelectedIds.has(a.id))
                      .map(app => (
                        <span
                          key={app.id}
                          className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-700 border border-red-200 px-3 py-1.5 text-sm font-medium"
                        >
                          {app.appName}
                          <button
                            onClick={() => toggleCustomApp(app.id)}
                            className="hover:text-red-900"
                          >
                            x
                          </button>
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {/* Add custom app */}
              {!showAddApp ? (
                <button
                  onClick={() => setShowAddApp(true)}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  + Add custom app
                </button>
              ) : (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">App name</label>
                    <input
                      type="text"
                      placeholder="e.g. Discord"
                      value={newAppName}
                      onChange={e => setNewAppName(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Bundle ID</label>
                    <input
                      type="text"
                      placeholder="e.g. com.hammerandchisel.discord"
                      value={newAppBundleId}
                      onChange={e => setNewAppBundleId(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={addCustomApp}
                    disabled={!newAppName || !newAppBundleId}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-900 disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setShowAddApp(false); setNewAppName(''); setNewAppBundleId(''); }}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Save button */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={saveBlockingConfig}
              disabled={savingBlocking}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {savingBlocking ? 'Saving...' : 'Apply to Class'}
            </button>
            {blockingSaved && (
              <span className="text-sm text-green-600 font-medium">Saved</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Invite Link ── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Student Invite Link</h2>
          <p className="text-sm text-gray-500 mt-1">
            Share this link with students so they can join this class from the Bali app.
          </p>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-3">
            <div className="flex-1 rounded-lg bg-gray-50 border border-gray-200 px-4 py-2.5 text-sm text-gray-700 font-mono truncate">
              {typeof window !== 'undefined'
                ? `${window.location.origin}/join/${classId}`
                : `/join/${classId}`}
            </div>
            <button
              onClick={() => {
                const link = `${window.location.origin}/join/${classId}`;
                navigator.clipboard.writeText(link);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              }}
              className="rounded-lg bg-gray-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-900 transition-colors"
            >
              {linkCopied ? 'Copied' : 'Copy Link'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Students will need the Bali app installed to use this link. Coming soon.
          </p>
        </div>
      </div>

      {/* ── Students ── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Students ({cls.students.length})</h2>
          <div className="flex gap-2">
            <Link
              href={`/dashboard/classes/${classId}/students/import/`}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Import CSV
            </Link>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
            >
              Add Student
            </button>
          </div>
        </div>

        {showAddForm && (
          <form onSubmit={handleAddStudent} className="p-4 bg-gray-50 border-b border-gray-100">
            {addError && <p className="text-sm text-red-600 mb-2">{addError}</p>}
            <div className="flex gap-3">
              <input
                required placeholder="First name" value={firstName}
                onChange={e => setFirstName(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none"
              />
              <input
                required placeholder="Last name" value={lastName}
                onChange={e => setLastName(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none"
              />
              <input
                placeholder="Email (optional)" value={email}
                onChange={e => setEmail(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none"
              />
              <button type="submit" className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm text-white hover:bg-primary-700">
                Add
              </button>
            </div>
          </form>
        )}

        {cls.students.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No students yet. Add students manually or import via CSV.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {cls.students.map((s: any) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">
                    <Link
                      href={`/dashboard/classes/${classId}/students/${s.id}/`}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {s.firstName} {s.lastName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{s.email || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemoveStudent(s.id)}
                      className="text-sm text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
