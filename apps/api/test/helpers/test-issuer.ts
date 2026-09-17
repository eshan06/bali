import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { createVerifier, type TokenVerifier } from '../../src/auth/verify.js';

/*
 * A local stand-in for Cognito: an RSA keypair whose public half is served as a
 * JWKS, so the real verifier (createVerifier) can be exercised end-to-end with
 * no network and no live pool. This is exactly how production verification
 * works — the only difference is the keys are generated here. Real Cognito
 * config is wired at the hosting step.
 */

export const TEST_ISSUER = 'https://test-issuer.bali.local/pool';
export const TEST_AUDIENCE = 'test-app-client-id';

export interface SignOptions {
  sub?: string;
  /** Cognito access tokens carry the client id here (and no `aud`). */
  clientId?: string;
  /** Cognito id tokens carry the client id here instead. */
  audience?: string;
  issuer?: string;
  /** Seconds from now; negative for an already-expired token. */
  expiresInSeconds?: number;
  extraClaims?: Record<string, unknown>;
}

export interface TestIssuer {
  /** A verifier bound to this issuer's public keys — inject into buildApp. */
  verifier: TokenVerifier;
  /** Mint a signed token. Defaults produce a valid access token for TEST_AUDIENCE. */
  sign(opts?: SignOptions): Promise<string>;
  /** The public JWK, for building a mismatched verifier in tests. */
  publicJwk: JWK;
}

export async function makeTestIssuer(): Promise<TestIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key-1';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  const getKey = createLocalJWKSet({ keys: [publicJwk] });
  const verifier = createVerifier({ issuer: TEST_ISSUER, audience: TEST_AUDIENCE, getKey });

  async function sign(opts: SignOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = opts.expiresInSeconds ?? 3600;
    const claims: Record<string, unknown> = {
      token_use: 'access',
      client_id: opts.clientId ?? (opts.audience ? undefined : TEST_AUDIENCE),
      ...opts.extraClaims,
    };
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid })
      .setSubject(opts.sub ?? 'cognito-user-1')
      .setIssuer(opts.issuer ?? TEST_ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresIn);
    if (opts.audience) jwt.setAudience(opts.audience);
    return jwt.sign(privateKey);
  }

  return { verifier, sign, publicJwk };
}
