'use client';

import { useEffect, useState } from 'react';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api-client';
import type { StudentSelf } from '@bali/shared';

export default function StudentProfilePage() {
  const { user, refresh } = useAuthContext();
  const student = user?.student;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [grade, setGrade] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (student) {
      setFirstName(student.firstName);
      setLastName(student.lastName);
      setGrade(student.grade ?? '');
    }
  }, [student]);

  const dirty =
    !!student &&
    (firstName.trim() !== student.firstName ||
      lastName.trim() !== student.lastName ||
      (grade.trim() || '') !== (student.grade ?? ''));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post<StudentSelf>('/students/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        grade: grade.trim(),
      });
      await refresh();
      setSavedAt(Date.now());
    } catch (err: any) {
      setError(err.message || 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  };

  if (!student) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Profile</h1>
        <p className="text-gray-500 mt-1">Update your name and grade.</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="glass-card rounded-3xl p-8 space-y-5"
      >
        {error && (
          <div className="rounded-xl bg-red-50/90 p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1.5">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-xl bg-white/80 border border-white/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1.5">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-xl bg-white/80 border border-white/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
          <div className="rounded-xl bg-white/40 border border-white/60 px-4 py-2.5 text-sm text-gray-600">
            {student.email}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Email is set by your sign-in method and can&apos;t be changed here.
          </p>
        </div>

        <div>
          <label htmlFor="grade" className="block text-sm font-medium text-gray-700 mb-1.5">
            Grade <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="grade"
            type="text"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            placeholder="e.g. 10th, Sophomore, Year 11"
            className="w-full rounded-xl bg-white/80 border border-white/70 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="text-sm text-gray-500 min-h-[1.25rem]">
            {savedAt && !dirty && !error ? 'Saved' : null}
          </div>
          <button
            type="submit"
            disabled={saving || !dirty || !firstName.trim() || !lastName.trim()}
            className="rounded-xl bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
