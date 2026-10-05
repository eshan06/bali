import localFont from 'next/font/local';

/*
 * The portal's two families (DESIGN.md §3): Instrument Sans, and JetBrains Mono for join codes,
 * self-hosted through next/font, since the CSP has no font-src and a nonce-only style-src
 * (src/lib/csp.ts): the files ship from the portal's own origin, and the @font-face rules ride in
 * its stylesheet. The latin subset of each variable font, from @fontsource-variable 5.3.0, OFL
 * (fonts/OFL.txt). The fallbacks are the token file's own stacks.
 */
export const instrumentSans = localFont({
  src: './fonts/instrument-sans-latin-wght-normal.woff2',
  weight: '400 700',
  variable: '--font-instrument-sans',
  fallback: ['-apple-system', 'SF Pro Text', 'Segoe UI', 'sans-serif'],
});

export const jetBrainsMono = localFont({
  src: './fonts/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  variable: '--font-jetbrains-mono',
  fallback: ['ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
});
