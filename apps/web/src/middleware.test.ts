import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { config, middleware } from './middleware';

/** The CSP Next reads its nonce from: the forwarded request's, as middleware passes it on. */
function forwardedCsp(response: Response): string | null {
  return response.headers.get('x-middleware-request-content-security-policy');
}

describe('middleware', () => {
  it('sends the same CSP to Next (for the nonce) and to the browser', () => {
    const response = middleware(new NextRequest('http://localhost:3000/'));
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(forwardedCsp(response)).toBe(csp);
  });

  it("never lets a request's own CSP header choose the nonce Next stamps", () => {
    const request = new NextRequest('http://localhost:3000/', {
      headers: { 'Content-Security-Policy': "script-src 'nonce-attacker'" },
    });
    const response = middleware(request);
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).not.toContain('attacker');
    expect(forwardedCsp(response)).toBe(csp);
  });

  it('mints a fresh nonce per request', () => {
    const nonce = () =>
      /'nonce-([^']+)'/.exec(
        middleware(new NextRequest('http://localhost:3000/')).headers.get(
          'Content-Security-Policy',
        ) ?? '',
      )?.[1];
    expect(nonce()).toBeTruthy();
    expect(nonce()).not.toBe(nonce());
  });

  it('runs on pages, not on built assets or prefetches', () => {
    const [rule] = config.matcher;
    const pages = new RegExp(`^${rule.source}$`);
    expect(pages.test('/classes/abc/reports')).toBe(true);
    expect(pages.test('/_next/static/chunks/main.js')).toBe(false);
    for (const icon of ['/icon.svg', '/icon.png', '/apple-icon.png']) {
      expect(pages.test(icon)).toBe(false);
    }
    expect(rule.missing.map((m) => m.key)).toEqual(['next-router-prefetch', 'purpose']);
  });
});
