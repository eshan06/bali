'use client';

import { useEffect, useState } from 'react';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api-client';
import type { StudentSelf } from '@bali/shared';

const BRAND = '#2E5BD0';

function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
}

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

  // Hide the success state once the user starts editing again.
  useEffect(() => {
    if (dirty && savedAt) setSavedAt(null);
  }, [dirty, savedAt]);

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
    } catch {
      setError("We couldn't save your changes. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!student) return null;

  const showSuccess = !!savedAt && !dirty && !error;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* ── PROFILE HEADER CARD ───────────────────────────────── */}
      <section className="surface-card rounded-2xl p-6 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div
            className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl flex items-center justify-center text-xl sm:text-2xl font-black text-white shadow-sm flex-shrink-0"
            style={{ backgroundColor: BRAND }}
          >
            {initials(student.firstName, student.lastName)}
          </div>
          <div className="space-y-2 min-w-0">
            <p
              className="text-[11px] font-black uppercase tracking-[0.22em]"
              style={{ color: BRAND }}
            >
              Profile
            </p>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-gray-900 leading-[1.05] truncate">
              {student.firstName} {student.lastName}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {student.grade && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-gray-700">
                  {student.grade}
                </span>
              )}
              <span className="text-sm text-gray-500 truncate">
                {student.email}
              </span>
            </div>
            <p className="text-sm text-gray-500">
              Manage your student profile.
            </p>
          </div>
        </div>
      </section>

      {/* ── FORM CARD ─────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit}
        className="surface-card rounded-2xl p-7 space-y-5"
      >
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {showSuccess && (
          <div className="rounded-xl bg-green-50 border border-green-100 px-4 py-2.5 text-sm text-green-800 inline-flex items-center gap-2">
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
            Profile updated.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="First name" htmlFor="firstName">
            <input
              id="firstName"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </FormField>
          <FormField label="Last name" htmlFor="lastName">
            <input
              id="lastName"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </FormField>
        </div>

        <FormField label="Email">
          <div className="relative">
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-2.5 pr-24 text-sm text-gray-700">
              {student.email}
            </div>
            <span className="absolute inset-y-0 right-3 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <IconLock className="h-3 w-3" />
              Read-only
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            Email comes from your sign-in method and can't be changed here.
          </p>
        </FormField>

        <FormField label="Grade" htmlFor="grade" hint="optional">
          <input
            id="grade"
            type="text"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            placeholder="e.g. 10th, Sophomore, Year 11"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </FormField>

        <div className="flex items-center justify-end pt-3 border-t border-gray-100">
          <button
            type="submit"
            disabled={saving || !dirty || !firstName.trim() || !lastName.trim()}
            className="inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function FormField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5"
      >
        {label}
        {hint && (
          <span className="ml-2 text-gray-400 normal-case tracking-normal font-medium">
            {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

function IconLock({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
      />
    </svg>
  );
}
