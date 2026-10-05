'use client';

import type { ClassDetail, MeResponse } from '@bali/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Blocks } from '@/components/blocks';
import { InviteCode } from '@/components/invite-code';
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
  // Set by a redeem (T2): the classes heading takes focus once the account is read as a teacher.
  const redeemed = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

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

  // The account teaches now (T2): who it is, read again, so the classes view shows; no reload.
  const onTeacher = useCallback(() => {
    redeemed.current = true;
    setMe(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!redeemed.current || me?.user.role !== 'teacher') return;
    redeemed.current = false;
    heading.current?.focus();
  }, [me]);

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

  if (me === null || me.user.role !== 'teacher') {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        {me ? (
          // Not a teacher yet, as `/v1/me` says: the invite code, in place of the classes or a 403.
          <InviteCode onTeacher={onTeacher} />
        ) : error ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p role="alert" className="text-sm">
              Couldn't load your account.{' '}
              <span className="text-slate-600 dark:text-slate-300">{error}</span>
            </p>
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors hover:bg-slate-100 motion-reduce:transition-none dark:border-slate-700 dark:hover:bg-slate-900"
            >
              Try again
            </button>
          </div>
        ) : (
          <p role="status" className="text-sm text-slate-500">
            Loading…
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 ref={heading} tabIndex={-1} className="mb-6 text-2xl font-semibold">
        Your classes
      </h1>

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

      {me.classes.length === 0 ? (
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

      <Blocks />
    </main>
  );
}
