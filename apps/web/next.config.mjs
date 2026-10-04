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
