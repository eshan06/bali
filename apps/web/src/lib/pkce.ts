/**
 * PKCE (RFC 7636) helpers for the Cognito authorization-code flow with a public
 * client — no client secret, so the code interception protection comes from the
 * verifier/challenge pair. Pure functions over the Web Crypto API, so they are
 * unit-testable against the RFC's own test vector.
 */

/** base64url without padding (RFC 4648 §5). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A high-entropy code verifier: 43 base64url chars from 32 random bytes (§4.1). */
export function createCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** The S256 code challenge for a verifier: base64url(SHA-256(verifier)) (§4.2). */
export async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** A random opaque `state`, binding the callback to this sign-in attempt (CSRF). */
export function createState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
