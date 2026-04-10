'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { Class, ClassSession } from '@bali/shared';

export default function DashboardPage() {
  const router = useRouter();
  const [classes, setClasses] = useState<Class[]>([]);
  const [activeSession, setActiveSession] = useState<ClassSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<{ classes: Class[] }>('/classes'),
      api.get<{ session: ClassSession | null }>('/sessions/active'),
    ]).then(([classRes, sessionRes]) => {
      setClasses(classRes.classes);
      setActiveSession(sessionRes.session);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="h-32 bg-gray-200 rounded" />
    </div>;
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {activeSession && (
        <div className="rounded-xl bg-green-50 border border-green-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-800">Active Session</p>
              <p className="mt-1 text-lg font-semibold text-green-900">{activeSession.className}</p>
              <p className="text-sm text-green-700">
                Started {new Date(activeSession.startedAt).toLocaleTimeString()}
              </p>
            </div>
            <button
              onClick={() => router.push('/dashboard/session/')}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
            >
              View Session
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl bg-white border border-gray-200 p-6">
          <p className="text-sm text-gray-500">Total Classes</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{classes.length}</p>
        </div>
        <div className="rounded-xl bg-white border border-gray-200 p-6">
          <p className="text-sm text-gray-500">Total Students</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            {classes.reduce((sum, c) => sum + (c.studentCount || 0), 0)}
          </p>
        </div>
        <div className="rounded-xl bg-white border border-gray-200 p-6">
          <p className="text-sm text-gray-500">Session Status</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            {activeSession ? 'Active' : 'No Session'}
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Your Classes</h2>
          <Link
            href="/dashboard/classes/new/"
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
          >
            Create Class
          </Link>
        </div>

        {classes.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-500">No classes yet. Create your first class to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((cls) => (
              <Link
                key={cls.id}
                href={`/dashboard/classes/${cls.id}/`}
                className="block rounded-xl bg-white border border-gray-200 p-6 hover:border-primary-300 hover:shadow-sm transition-all"
              >
                <h3 className="font-semibold text-gray-900">{cls.name}</h3>
                {cls.period && <p className="text-sm text-gray-500 mt-1">{cls.period}</p>}
                <p className="text-sm text-gray-500 mt-2">{cls.studentCount || 0} students</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
