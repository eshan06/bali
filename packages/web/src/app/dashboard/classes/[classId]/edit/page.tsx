'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { Class } from '@bali/shared';

const BRAND = '#2E5BD0';

export default function EditClassPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const [name, setName] = useState('');
  const [period, setPeriod] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<Class>(`/classes/${classId}`).then((cls) => {
      setName(cls.name);
      setPeriod(cls.period || '');
      setDescription(cls.description || '');
    });
  }, [classId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.put(`/classes/${classId}`, {
        name,
        period: period || undefined,
        description: description || undefined,
      });
      router.push(`/dashboard/classes/${classId}/`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async () => {
    if (!confirm('Archive this class? You can restore it later.')) return;
    await api.delete(`/classes/${classId}`);
    router.push('/dashboard/classes/');
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <header className="space-y-2">
        <p
          className="text-[11px] font-black uppercase tracking-[0.22em]"
          style={{ color: BRAND }}
        >
          Settings
        </p>
        <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gray-900 leading-[1.05]">
          Edit class
        </h1>
        <p className="text-sm md:text-base text-gray-500 max-w-xl">
          Update the class name, period, or description. Roster, blocking, and
          devices stay where they are.
        </p>
      </header>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="surface-card rounded-2xl p-7 space-y-5"
      >
        <FormField label="Class name" required>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </FormField>
        <FormField label="Period">
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </FormField>
        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
          />
        </FormField>
        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 shadow-sm"
            style={{ backgroundColor: BRAND }}
          >
            {loading ? 'Saving…' : 'Save changes'}
          </button>
          <Link
            href={`/dashboard/classes/${classId}/`}
            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-6 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Danger zone */}
      <section className="surface-card rounded-2xl p-7 space-y-3">
        <header>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
            Danger zone
          </p>
          <h2 className="mt-1 text-lg font-black tracking-tight text-gray-900">
            Archive this class
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Hides the class from the dashboard. Roster and history are
            preserved and can be restored later.
          </p>
        </header>
        <button
          onClick={handleArchive}
          className="inline-flex items-center rounded-full border border-red-200 bg-white px-5 py-2 text-sm font-bold text-red-600 hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors"
        >
          Archive class
        </button>
      </section>
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
