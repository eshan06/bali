'use client';

import { useEffect } from 'react';

/**
 * Root error boundary — the last resort when even the root layout fails to render.
 * It must render its own <html>/<body> (it replaces the layout). Calm, non-technical
 * copy in keeping with the product voice; wire `console.error` to an error tracker.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 32,
          textAlign: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          background: '#F7F5F2',
          color: '#211F1B',
        }}
      >
        <svg width="48" height="48" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" stroke="#BCDCCA" strokeWidth="3" />
          <path d="M 10 2.5 A 7.5 7.5 0 1 1 3.5 13.75" stroke="#2C6F51" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: 360, fontSize: 14, lineHeight: '20px', color: '#5B564E', margin: 0 }}>
          This page hit a snag. Your classes and sessions are safe — try again.
        </p>
        <button
          onClick={reset}
          style={{
            border: 'none',
            borderRadius: 10,
            background: '#245A43',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            padding: '10px 20px',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
