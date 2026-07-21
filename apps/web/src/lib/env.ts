/**
 * Web public-env contract. NEXT_PUBLIC_* values are inlined at BUILD time, so a
 * forgotten build arg bakes in as an empty string and silently breaks the deployed
 * app (e.g. empty Cognito → a portal where no teacher can sign in — the exact trap
 * the docker-compose web service used to fall into).
 *
 * `assertWebEnv()` is called from next.config.ts so a misconfigured PRODUCTION build
 * fails loudly instead of shipping a broken bundle. It is a no-op in dev/test.
 */

const REQUIRED_IN_PROD = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
  'NEXT_PUBLIC_COGNITO_CLIENT_ID',
  'NEXT_PUBLIC_COGNITO_DOMAIN',
] as const;

export function assertWebEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const missing = REQUIRED_IN_PROD.filter((k) => !process.env[k]?.trim());
  const problems: string[] = [];
  if (missing.length) {
    problems.push(
      `Missing required build args: ${missing.join(', ')}. ` +
        `NEXT_PUBLIC_* are inlined at build time — pass them to the production build.`,
    );
  }
  // A non-URL API base silently drops the API origin from the CSP connect-src (→ a portal
  // that loads but can't reach the API). Fail loudly at build instead.
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiUrl) {
    try {
      const u = new URL(apiUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
      problems.push(`NEXT_PUBLIC_API_URL must be an absolute http(s) URL (got "${apiUrl}").`);
    }
  }
  // The dev-token auth bypass must never be inlined into a production bundle.
  if (process.env.NEXT_PUBLIC_ALLOW_DEV_TOKENS === '1') {
    problems.push(
      `NEXT_PUBLIC_ALLOW_DEV_TOKENS=1 in a production build would ship the dev-token ` +
        `auth bypass. Unset it for prod (it is dev-only).`,
    );
  }
  if (problems.length) {
    throw new Error(
      `[bali/web] Refusing to build for production:\n  - ${problems.join('\n  - ')}`,
    );
  }
}
