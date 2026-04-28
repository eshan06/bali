'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Class } from '@bali/shared';

export default function ClassesPage() {
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ classes: Class[] }>('/classes')
      .then(res => setClasses(res.classes))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Classes</h1>
        <Link
          href="/dashboard/classes/new/"
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
        >
          Create Class
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
      ) : classes.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
          <p className="text-gray-500">No classes yet.</p>
          <Link href="/dashboard/classes/new/" className="mt-2 inline-block text-primary-600 hover:underline">
            Create your first class
          </Link>
        </div>
      ) : (
        <div className="glass-card rounded-2xl divide-y divide-gray-100">
          {classes.map(cls => (
            <Link
              key={cls.id}
              href={`/dashboard/classes/${cls.id}/`}
              className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <div>
                <h3 className="font-medium text-gray-900">{cls.name}</h3>
                {cls.period && <p className="text-sm text-gray-500">{cls.period}</p>}
              </div>
              <div className="text-sm text-gray-500">{cls.studentCount || 0} students</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
