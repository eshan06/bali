import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { PDFJS_CSP, PDFJS_SCRIPTS } from './lib/csp';
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

  it('lets the page reach the deck bucket its build names, and none without one (M5)', () => {
    const before = process.env.NEXT_PUBLIC_DECK_BUCKET_URL;
    const connect = () =>
      /connect-src ([^;]+)/.exec(
        middleware(new NextRequest('http://localhost:3000/slides')).headers.get(
          'Content-Security-Policy',
        ) ?? '',
      )?.[1];
    try {
      delete process.env.NEXT_PUBLIC_DECK_BUCKET_URL;
      expect(connect()).not.toContain('amazonaws');
      process.env.NEXT_PUBLIC_DECK_BUCKET_URL =
        'https://bali-decks-dev-eshshah.s3.us-east-1.amazonaws.com';
      expect(connect()?.split(' ')).toContain(
        'https://bali-decks-dev-eshshah.s3.us-east-1.amazonaws.com',
      );
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_DECK_BUCKET_URL;
      else process.env.NEXT_PUBLIC_DECK_BUCKET_URL = before;
    }
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

  it("gives PDF.js's worker and its decoders their own CSP, never the page's (M6)", () => {
    expect(PDFJS_SCRIPTS).toHaveLength(3);
    for (const file of PDFJS_SCRIPTS) {
      const response = middleware(new NextRequest(`http://localhost:3000/pdfjs/${file}`));
      expect(response.headers.get('Content-Security-Policy')).toBe(PDFJS_CSP);
      // No page renders there, so Next is handed no nonce.
      expect(forwardedCsp(response)).toBeNull();
    }
  });

  it("keeps the page's CSP, starting workers from its own origin alone, on any other path", () => {
    // Beside them, and under /pdfjs/ but none of them: a 404 page there is still a page.
    for (const path of [
      '/',
      '/pdfjs',
      '/pdfjs-check',
      '/classes/pdfjs/',
      '/pdfjs/nope.mjs',
      '/pdfjs/LICENSE',
      '/pdfjs/pdf.worker.min.mjs/x',
    ]) {
      const csp = middleware(new NextRequest(`http://localhost:3000${path}`)).headers.get(
        'Content-Security-Policy',
      );
      expect(csp, path).toMatch(/script-src 'self' 'nonce-/);
      expect(csp, path).toContain("worker-src 'self';");
    }
  });

  it('runs on pages and on the worker, not on built assets or prefetches', () => {
    const [rule] = config.matcher;
    const pages = new RegExp(`^${rule.source}$`);
    expect(pages.test('/classes/abc/reports')).toBe(true);
    expect(pages.test('/pdfjs/pdf.worker.min.mjs')).toBe(true);
    expect(pages.test('/_next/static/chunks/main.js')).toBe(false);
    for (const icon of ['/icon.svg', '/icon.png', '/apple-icon.png']) {
      expect(pages.test(icon)).toBe(false);
    }
    expect(rule.missing.map((m) => m.key)).toEqual(['next-router-prefetch', 'purpose']);
  });
});
