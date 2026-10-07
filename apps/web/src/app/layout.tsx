import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { PortalBar } from '@/components/portal-bar';

import { instrumentSans, jetBrainsMono } from './fonts';

import './globals.css';

// Rendered per request, so each page carries its CSP nonce (src/middleware.ts).
export const dynamic = 'force-dynamic';

/** The browser's own chrome in the page colour (surface-page; tokens.test.ts): always light. */
export const viewport: Viewport = { themeColor: '#f7f5f2' };

export const metadata: Metadata = {
  title: 'Bali teacher portal',
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
    <html lang="en" className={`${instrumentSans.variable} ${jetBrainsMono.variable}`}>
      <body className="min-h-dvh bg-surface-page font-sans text-text-primary antialiased tabular-nums">
        <PortalBar />
        {children}
      </body>
    </html>
  );
}
