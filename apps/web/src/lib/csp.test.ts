import { describe, expect, it } from 'vitest';

import nextConfig, { securityHeaders } from '../../next.config.mjs';

import { contentSecurityPolicy, type CspOptions } from './csp';

const BASE: CspOptions = {
  apiUrl: 'https://api.bali.example/',
  cognitoDomain: 'https://bali-dev.auth.us-east-1.amazoncognito.com',
  sentryDsn: 'https://publickey@o123.ingest.us.sentry.io/456',
  nonce: 'bm9uY2U=',
  dev: false,
};

/** The policy as directive → its sources. */
function parse(csp: string): Map<string, string[]> {
  return new Map(
    csp.split('; ').map((d) => {
      const [name = '', ...sources] = d.split(' ');
      return [name, sources];
    }),
  );
}

describe('contentSecurityPolicy', () => {
  it('lets the portal reach exactly the configured origins', () => {
    const csp = parse(contentSecurityPolicy(BASE));
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('connect-src')).toEqual([
      "'self'",
      'https://api.bali.example',
      'https://bali-dev.auth.us-east-1.amazoncognito.com',
      // The DSN's host, never its key or project path.
      'https://o123.ingest.us.sentry.io',
    ]);
    expect(csp.get('form-action')).toEqual([
      "'self'",
      'https://bali-dev.auth.us-east-1.amazoncognito.com',
    ]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('img-src')).toEqual(["'self'", 'data:']);
  });

  it('runs only nonced scripts and styles in production, never inline or eval but a style attribute', () => {
    const text = contentSecurityPolicy(BASE);
    const csp = parse(text);
    expect(csp.get('script-src')).toEqual(["'self'", "'nonce-bm9uY2U='", "'strict-dynamic'"]);
    expect(csp.get('style-src')).toEqual(["'self'", "'nonce-bm9uY2U='"]);
    expect(csp.get('style-src-attr')).toEqual(["'unsafe-inline'"]);
    expect(text.replace("style-src-attr 'unsafe-inline'", '')).not.toContain('unsafe');
  });

  it('allows nothing wider than a named origin: no wildcard or bare scheme', () => {
    for (const [name, sources] of parse(contentSecurityPolicy(BASE))) {
      // img-src's data: (checked above) is the one scheme source, for inline images only.
      for (const source of name === 'img-src' ? [] : sources) {
        expect(source).not.toMatch(/\*|^[a-z-]+:$/);
      }
    }
  });

  it('leaves out Cognito and Sentry when they are not configured', () => {
    const csp = parse(contentSecurityPolicy({ ...BASE, cognitoDomain: '', sentryDsn: undefined }));
    expect(csp.get('connect-src')).toEqual(["'self'", 'https://api.bali.example']);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(
      parse(contentSecurityPolicy({ ...BASE, sentryDsn: ' ' })).get('connect-src'),
    ).not.toContain('https://o123.ingest.us.sentry.io');
  });

  it('keeps a local API on its own port', () => {
    const csp = parse(contentSecurityPolicy({ ...BASE, apiUrl: 'http://127.0.0.1:3001' }));
    expect(csp.get('connect-src')).toContain('http://127.0.0.1:3001');
  });

  it('loosens only what next dev needs, in dev', () => {
    const csp = parse(contentSecurityPolicy({ ...BASE, dev: true }));
    expect(csp.get('script-src')).toContain("'unsafe-eval'");
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('fails loudly on a configured URL that is not one', () => {
    expect(() => contentSecurityPolicy({ ...BASE, apiUrl: 'not a url' })).toThrow();
  });
});

describe('next.config headers()', () => {
  it('sends the fixed security headers with every response', async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toEqual([{ source: '/:path*', headers: securityHeaders }]);
    const byKey = Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]));
    expect(byKey).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    expect(byKey['Strict-Transport-Security']).toMatch(/^max-age=\d{8,}/);
    expect(byKey['Permissions-Policy']).toContain('camera=()');
  });
});
