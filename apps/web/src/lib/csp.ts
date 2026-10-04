/*
 * The portal's Content-Security-Policy (Phase 6, S4). The access token lives in sessionStorage
 * (WEB.md), where any script on the page can read it, so this policy is its defence: no script
 * runs but the portal's own, each carrying the request's nonce, and nothing leaves for an origin
 * the build wasn't configured with. Every origin the portal talks to is listed here, and only
 * those: a new one is added here, or the browser refuses it (docs/WEB.md).
 */

export interface CspOptions {
  /** NEXT_PUBLIC_API_URL: every API call and the live grid's stream. */
  apiUrl: string;
  /** NEXT_PUBLIC_COGNITO_DOMAIN: the token exchange, and the hosted UI's pages. Blank = none. */
  cognitoDomain: string;
  /** NEXT_PUBLIC_SENTRY_DSN: its ingest host takes error reports. Unset or blank = monitoring off. */
  sentryDsn?: string | undefined;
  /** This response's nonce: Next stamps it on every script it renders. */
  nonce: string;
  /** `next dev` only: its fast refresh evaluates code and injects styles without a nonce. */
  dev: boolean;
}

/**
 * The http(s) origin a configured URL names (a DSN's key and path go); null when it is unset or
 * blank. Anything else throws: an origin of `null` would silently block every call.
 */
function originOf(url: string | undefined): string | null {
  if (url === undefined || url.trim() === '') return null;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`not an http(s) URL: ${parsed.protocol}`);
  }
  return parsed.origin;
}

/**
 * A production build's check of the origins the CSP is built from (next.config.ts), so a bad one
 * fails the build rather than every page: the API's URL must be set (unset, the portal would
 * call its localhost default) and be an http(s) URL; Cognito's and Sentry's, when set, too.
 */
export function checkBuildEnv(env: Record<string, string | undefined>): void {
  const urls = {
    NEXT_PUBLIC_API_URL: env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_COGNITO_DOMAIN: env.NEXT_PUBLIC_COGNITO_DOMAIN,
    NEXT_PUBLIC_SENTRY_DSN: env.NEXT_PUBLIC_SENTRY_DSN,
  };
  for (const [name, value] of Object.entries(urls)) {
    let origin: string | null;
    try {
      origin = originOf(value);
    } catch {
      throw new Error(`${name} is not an http(s) URL: the CSP needs its origin`);
    }
    if (origin === null && name === 'NEXT_PUBLIC_API_URL') {
      throw new Error('set NEXT_PUBLIC_API_URL for a production build: the API the portal calls');
    }
  }
}

export function contentSecurityPolicy(options: CspOptions): string {
  const nonce = `'nonce-${options.nonce}'`;
  const api = originOf(options.apiUrl);
  if (api === null) throw new Error('the API URL is blank: the portal could call nothing');
  const cognito = originOf(options.cognitoDomain);
  const sentry = originOf(options.sentryDsn);
  const list = (...sources: (string | null | false)[]) =>
    sources.filter((s): s is string => typeof s === 'string').join(' ');

  const directives: Record<string, string> = {
    'default-src': "'self'",
    // 'strict-dynamic': a chunk Next's nonce'd scripts load runs too; 'self' is only the
    // fallback for a browser without it.
    'script-src': list("'self'", nonce, "'strict-dynamic'", options.dev && "'unsafe-eval'"),
    // Production styles are Tailwind's stylesheet, from 'self'; dev injects <style> tags.
    'style-src': list("'self'", options.dev ? "'unsafe-inline'" : nonce),
    // Style attributes only, never a <style> element: Next's built-in 404 and error pages style
    // by attribute. An attribute selects nothing, and any URL in it still meets img-src.
    'style-src-attr': "'unsafe-inline'",
    'connect-src': list("'self'", api, cognito, sentry),
    'img-src': "'self' data:",
    'object-src': "'none'",
    'base-uri': "'self'",
    'form-action': list("'self'", cognito),
    'frame-ancestors': "'none'",
  };
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ');
}
