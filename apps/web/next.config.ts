import type { NextConfig } from 'next';
import { assertWebEnv } from './src/lib/env';

// Fail a misconfigured production build loudly instead of shipping a broken bundle
// (empty Cognito args, or the dev-token bypass left on). No-op in dev/test.
assertWebEnv();

const isProd = process.env.NODE_ENV === 'production';

// connect-src must allow the API (incl. the SSE stream) and the Cognito endpoints
// Amplify talks to. NEXT_PUBLIC_API_URL is known at build time.
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? '').origin;
  } catch {
    return '';
  }
})();
const connectSrc = [
  "'self'",
  apiOrigin,
  'https://*.amazonaws.com', // cognito-idp / cognito-identity
  'https://*.amazoncognito.com', // hosted-UI domain
]
  .filter(Boolean)
  .join(' ');

// App has no inline-eval and no third-party scripts; 'unsafe-inline' is required only
// for Next's hydration bootstrap + the design system's inline styles. Applied in prod
// only — `next dev` needs eval/websocket for fast-refresh.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ...(isProd
    ? [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' },
      ]
    : []),
];

const nextConfig: NextConfig = {
  transpilePackages: ['@bali/shared'],
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Token/identifier-bearing public pages: never leak the URL in a referrer.
      { source: '/p/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      { source: '/t/:code*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ];
  },
};

export default nextConfig;
