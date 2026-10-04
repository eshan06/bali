import { NextResponse, type NextRequest } from 'next/server';

import { config as webConfig } from './lib/config';
import { contentSecurityPolicy } from './lib/csp';

/*
 * Every page gets a CSP with a fresh nonce (Phase 6, S4). Next reads the nonce from the request's
 * own Content-Security-Policy header and stamps it on each script it renders, which is why the
 * pages render per request (the root layout's `dynamic`): a page built ahead would carry no nonce.
 * The headers that never change ride on every response from next.config.ts's `headers()`.
 */
export function middleware(request: NextRequest) {
  const csp = contentSecurityPolicy({
    apiUrl: webConfig.apiUrl,
    cognitoDomain: webConfig.cognito.domain,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    nonce: btoa(crypto.randomUUID()),
    dev: process.env.NODE_ENV === 'development',
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Pages only: built assets carry no script of their own, and a prefetch renders no HTML.
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
