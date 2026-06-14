'use client';

import { useEffect } from 'react';

/**
 * Error boundary for the /app dashboard subtree — a render error in any page no longer
 * takes down the whole shell. Calm, non-technical copy in keeping with the product voice.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface for monitoring; wire to an error tracker (Sentry) in production.
    console.error('dashboard error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold text-ink-primary">Something went wrong</h1>
      <p className="max-w-sm text-sm text-ink-secondary">
        This screen hit a snag. Your classes and sessions are safe — try again.
      </p>
      <button
        onClick={reset}
        className="rounded-xl bg-action-primary px-5 py-2.5 text-sm font-semibold text-white"
      >
        Try again
      </button>
    </div>
  );
}
