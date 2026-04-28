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
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-white/40 rounded-xl w-48" />
        <div className="h-32 bg-white/40 rounded-2xl" />
      </div>
    );
  }

  const totalStudents = classes.reduce((sum, c) => sum + (c.studentCount || 0), 0);

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Dashboard</h1>

      {activeSession && (
        <div className="glass-card rounded-2xl p-6 ring-1 ring-green-200/60">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-green-700">Active session</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{activeSession.className}</p>
              <p className="text-sm text-gray-600">
                Started {new Date(activeSession.startedAt).toLocaleTimeString()}
              </p>
            </div>
            <button
              onClick={() => router.push('/dashboard/session/')}
              className="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 transition-colors"
            >
              View session
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total classes" value={classes.length} />
        <StatCard label="Total students" value={totalStudents} />
        <StatCard
          label="Session status"
          value={activeSession ? 'Active' : 'No session'}
        />
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Your classes</h2>
          <Link
            href="/dashboard/classes/new/"
            className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 transition-colors"
          >
            Create class
          </Link>
        </div>

        {classes.length === 0 ? (
          <div className="glass-card-soft rounded-2xl p-14 text-center">
            <p className="text-gray-600">No classes yet. Create your first class to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {classes.map((cls) => (
              <Link
                key={cls.id}
                href={`/dashboard/classes/${cls.id}/`}
                className="glass-card block rounded-2xl p-6 hover:bg-white/70 transition-colors"
              >
                <h3 className="font-semibold text-gray-900">{cls.name}</h3>
                {cls.period && <p className="text-sm text-gray-500 mt-1">{cls.period}</p>}
                <p className="text-sm text-gray-500 mt-2">{cls.studentCount || 0} students</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass-card rounded-2xl p-6">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
