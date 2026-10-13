import localFont from 'next/font/local';

/*
 * The portal's two families (DESIGN.md §3): Instrument Sans, and JetBrains Mono for join codes,
 * self-hosted through next/font, since the CSP has no font-src and a style-src of 'self' and the
 * nonce (src/lib/csp.ts): the files ship from the portal's own origin, and the @font-face rules
 * ride in its stylesheet. The latin subset of each variable font, from @fontsource-variable 5.3.0,
 * OFL (fonts/OFL.txt); a glyph outside it falls to the stack's next face. The fallbacks are the
 * token file's own stacks, exactly: no metric-matched Arial ahead of them (`adjustFontFallback`),
 * which would also catch those glyphs. The mono face is not preloaded: most pages have no code.
 */
export const instrumentSans = localFont({
  src: './fonts/instrument-sans-latin-wght-normal.woff2',
  weight: '400 700',
  variable: '--font-instrument-sans',
  fallback: ['-apple-system', 'SF Pro Text', 'Segoe UI', 'sans-serif'],
  adjustFontFallback: false,
});

/*
 * Instrument Sans's italic, for Reports' framing line in v2's look (DESIGN.md §1, Its call; the
 * plan step DESIGN.md §7 asks of a font is PV4): the same package and version as the upright,
 * @fontsource-variable/instrument-sans 5.3.0, its latin `wght` italic file
 * (files/instrument-sans-latin-wght-italic.woff2), under the same OFL. A family of its own, so it
 * is not preloaded on every page, as next/font preloads every file of one family; globals.css sets
 * it on `italic`, `em` and `i`, so italic text is this face, never the upright slanted.
 */
export const instrumentSansItalic = localFont({
  src: './fonts/instrument-sans-latin-wght-italic.woff2',
  weight: '400 700',
  style: 'italic',
  variable: '--font-instrument-sans-italic',
  fallback: ['-apple-system', 'SF Pro Text', 'Segoe UI', 'sans-serif'],
  adjustFontFallback: false,
  preload: false,
});

export const jetBrainsMono = localFont({
  src: './fonts/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  variable: '--font-jetbrains-mono',
  fallback: ['ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
  adjustFontFallback: false,
  preload: false,
});
