import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { PortalBar } from '@/components/portal-bar';

import './globals.css';

// Rendered per request, so each page carries its CSP nonce (src/middleware.ts).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Bali — teacher portal',
  description: 'Live classroom focus grid.',
  // From public/, not app/icon.*: Next builds those as static routes, which the CSP's
  // every-route-dynamic check refuses (.github/scripts/web-routes-dynamic.sh).
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: { url: '/apple-icon.png', sizes: '180x180' },
  },
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
