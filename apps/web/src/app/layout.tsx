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

export const metadata: Metadata = {
  title: 'Bali — Focus sessions for your classroom',
  description:
    'Students tap a desk tag and their distractions rest until the bell. Teachers see one calm grid. The emergency exit is always one hold away.',
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
