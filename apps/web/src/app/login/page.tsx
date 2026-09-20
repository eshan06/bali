'use client';

import { useState } from 'react';

import { startLogin } from '@/lib/auth';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  function onSignIn() {
    setError(null);
    startLogin().catch(() => setError('Could not start sign-in. Check the portal configuration.'));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Bali</h1>
      <p className="text-center text-sm text-slate-500">
        Teacher portal — sign in to see your classes.
      </p>
      <button
        type="button"
        onClick={onSignIn}
        className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
      >
        Sign in
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </main>
  );
}
