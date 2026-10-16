import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

import { checkBuildEnv, PDFJS_DIR, PDFJS_SCRIPTS } from './src/lib/csp';

/**
 * Sent with every response, assets included (Phase 6, S4). The CSP is per request, with its
 * nonce, so it is set in src/middleware.ts instead. HSTS is ignored over plain http, so it is
 * harmless on localhost.
 */
export const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The portal uses none of these; nothing it embeds or loads gets them either.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
];

export const nextConfig: NextConfig = {
  headers: () => Promise.resolve([{ source: '/:path*', headers: securityHeaders }]),
  // @bali/shared ships as TypeScript/ESM; let Next transpile it in-app rather
  // than requiring a prebuilt dist.
  transpilePackages: ['@bali/shared'],
  // The monorepo root lints everything with `eslint .`, so skip Next's own
  // lint-during-build (which would need eslint-config-next we don't install).
  eslint: { ignoreDuringBuilds: true },
  // @bali/shared uses NodeNext `.js` import specifiers that actually resolve to
  // `.ts` sources; webpack doesn't do that mapping on its own, so teach it.
  webpack: (config: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      ...config.resolve.extensionAlias,
    };
    return config;
  },
};

/**
 * A production build's check that PDF.js's worker and decoders are in `public/pdfjs/` (M6), which
 * `npm run build` copies first (its `prebuild`, scripts/pdfjs-assets.mjs): a build run another way,
 * a bare `next build`, would deploy none, and every deck would fail to open. `webDir` is the
 * portal's folder, where every build runs.
 */
export function checkPdfjsScripts(webDir: string = process.cwd()): void {
  const missing = PDFJS_SCRIPTS.filter(
    (name) => !existsSync(join(webDir, 'public', PDFJS_DIR, name)),
  );
  if (missing.length > 0) {
    throw new Error(
      `public${PDFJS_DIR} lacks ${missing.join(', ')}: build with \`npm run build\`, whose prebuild copies PDF.js's files there`,
    );
  }
}

// A production build checks the CSP's origins first: a bad one fails the build, not every page.
// Then PDF.js's files: none, and it fails rather than deploy a presenter that can't open a deck.
// Only the build: `next start` reads this file too, with the build's values already baked in.
export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    checkBuildEnv(process.env);
    checkPdfjsScripts();
  }
  return nextConfig;
}
