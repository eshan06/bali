'use client';

import type { ClassDetail, MeResponse } from '@bali/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { getAccessToken } from '@/lib/auth';
import { errText } from '@/lib/errors';
import { useApi } from '@/lib/use-api';

export default function HomePage() {
  const api = useApi();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.get<MeResponse>('/v1/me').then(setMe, (e: unknown) => setError(errText(e)));
  }, [api]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    load();
  }, [load, router]);

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    api.post<ClassDetail>('/v1/classes', { name: trimmed }).then(
      () => {
        setName('');
        setBusy(false);
        load();
      },
      (err: unknown) => {
        setBusy(false);
        setError(errText(err));
      },
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Your classes</h1>

      <form onSubmit={onCreate} className="mb-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New class name"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          Create
        </button>
      </form>

      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {me === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : me.classes.length === 0 ? (
        <p className="text-sm text-slate-500">No classes yet. Create one above.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {me.classes.map((c) => (
            <li key={c.id}>
              <Link
                href={`/classes/${c.id}`}
                className="block px-1 py-3 text-sm hover:text-slate-500"
              >
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
