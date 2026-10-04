import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { PortalBar } from '@/components/portal-bar';

import './globals.css';

// Rendered per request, so each page carries its CSP nonce (src/middleware.ts).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Bali — teacher portal',
  description: 'Live classroom focus grid.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <PortalBar />
        {children}
      </body>
    </html>
  );
}
