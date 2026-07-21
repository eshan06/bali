import type { Metadata } from 'next';
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import '@/styles/globals.css';

const instrument = Instrument_Sans({
  subsets: ['latin'],
  weight: 'variable',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
});

const jbmono = JetBrains_Mono({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-jbmono',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const TITLE = 'Bali — Focus sessions for your classroom';
const DESCRIPTION =
  'Students tap a desk tag and their distractions rest until the bell. Teachers see one calm grid. The emergency exit is always one hold away.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: '%s · Bali' },
  description: DESCRIPTION,
  applicationName: 'Bali',
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    siteName: 'Bali',
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrument.variable} ${jbmono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
