import { describe, expect, it } from 'vitest';

import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from 'next/constants';

import config, { nextConfig, securityHeaders } from '../../next.config';

import { checkBuildEnv, contentSecurityPolicy, type CspOptions } from './csp';

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
    // Parses, but its origin is the string 'null': every call would be refused.
    expect(() => contentSecurityPolicy({ ...BASE, apiUrl: 'mailto:x@y' })).toThrow(/http\(s\)/);
    expect(() => contentSecurityPolicy({ ...BASE, sentryDsn: 'javascript:alert(1)' })).toThrow();
    // A blank API would drop it from connect-src.
    expect(() => contentSecurityPolicy({ ...BASE, apiUrl: ' ' })).toThrow(/blank/);
  });
});

describe('checkBuildEnv: a production build refuses an origin the CSP cannot hold', () => {
  const GOOD = {
    NEXT_PUBLIC_API_URL: 'https://api.bali.example',
    NEXT_PUBLIC_COGNITO_DOMAIN: 'https://bali-dev.auth.us-east-1.amazoncognito.com',
    NEXT_PUBLIC_SENTRY_DSN: 'https://publickey@o123.ingest.us.sentry.io/456',
  };

  it('passes configured http(s) URLs, and Cognito or Sentry left unset or blank', () => {
    expect(() => checkBuildEnv(GOOD)).not.toThrow();
    expect(() => checkBuildEnv({ NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001' })).not.toThrow();
    expect(() =>
      checkBuildEnv({ ...GOOD, NEXT_PUBLIC_COGNITO_DOMAIN: '', NEXT_PUBLIC_SENTRY_DSN: ' ' }),
    ).not.toThrow();
  });

  it('requires the API URL: unset, the portal would call its localhost default', () => {
    expect(() => checkBuildEnv({ ...GOOD, NEXT_PUBLIC_API_URL: undefined })).toThrow(
      /set NEXT_PUBLIC_API_URL/,
    );
    expect(() => checkBuildEnv({ ...GOOD, NEXT_PUBLIC_API_URL: ' ' })).toThrow(
      /set NEXT_PUBLIC_API_URL/,
    );
  });

  it('names each variable that is no http(s) URL', () => {
    for (const name of Object.keys(GOOD)) {
      for (const bad of ['not a url', 'mailto:x@y', 'javascript:alert(1)']) {
        expect(() => checkBuildEnv({ ...GOOD, [name]: bad })).toThrow(
          `${name} is not an http(s) URL`,
        );
      }
    }
  });

  it('runs on a production build only, never on next start', () => {
    const before = process.env.NEXT_PUBLIC_API_URL;
    process.env.NEXT_PUBLIC_API_URL = 'mailto:x@y';
    try {
      expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(/NEXT_PUBLIC_API_URL/);
      expect(config(PHASE_PRODUCTION_SERVER)).toBe(nextConfig);
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_API_URL;
      else process.env.NEXT_PUBLIC_API_URL = before;
    }
  });
});

describe('next.config headers()', () => {
  it('sends the fixed security headers with every response', async () => {
    const rules = await config(PHASE_PRODUCTION_SERVER).headers?.();
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
