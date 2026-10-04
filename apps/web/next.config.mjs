/* global process, URL */
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

// The CSP's origins (src/lib/csp.ts): one that is no http(s) URL fails the build here, not every
// page. Unset means the default (the API) or none (Cognito, Sentry); a blank API is an error.
for (const name of [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_COGNITO_DOMAIN',
  'NEXT_PUBLIC_SENTRY_DSN',
]) {
  const value = process.env[name]?.trim();
  if (value === undefined || (value === '' && name !== 'NEXT_PUBLIC_API_URL')) continue;
  const url = URL.canParse(value) ? new URL(value) : null;
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:') {
    throw new Error(`${name} is not an http(s) URL: the CSP needs its origin`);
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
  // @bali/shared ships as TypeScript/ESM; let Next transpile it in-app rather
  // than requiring a prebuilt dist.
  transpilePackages: ['@bali/shared'],
  // The monorepo root lints everything with `eslint .`, so skip Next's own
  // lint-during-build (which would need eslint-config-next we don't install).
  eslint: { ignoreDuringBuilds: true },
  // @bali/shared uses NodeNext `.js` import specifiers that actually resolve to
  // `.ts` sources; webpack doesn't do that mapping on its own, so teach it.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      ...config.resolve.extensionAlias,
    };
    return config;
  },
};

export default nextConfig;
