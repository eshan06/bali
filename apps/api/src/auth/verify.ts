import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

import type { Env } from '../env.js';
import { ApiError } from '../errors.js';

/*
 * JWT verification (auth decision 2). We check the signature against the pool's
 * public keys, the issuer, expiry, and the app client id — with math, no
 * per-request database call. The distinction that matters: a token the pool
 * would reject (bad signature, expired, wrong issuer/audience) is a real "no" →
 * 401, but failing to *reach* the key set is transient → 503, so the client
 * keeps its session and retries instead of being logged out (honesty rule).
 */

/** The verified identity attached to a request. `sub` is the Cognito user id. */
export interface AuthedIdentity {
  sub: string;
  claims: JWTPayload;
}

export type TokenVerifier = (token: string) => Promise<AuthedIdentity>;

interface VerifierConfig {
  issuer: string;
  audience: string;
  getKey: JWTVerifyGetKey;
}

/**
 * Build a verifier from a key resolver. Cognito issues both id tokens (the app
 * client id is in `aud`) and access tokens (it's in `client_id`, with no `aud`),
 * so we verify the signature/issuer/expiry with jose and then check the client
 * id against either claim ourselves.
 */
export function createVerifier(config: VerifierConfig): TokenVerifier {
  return async (token: string): Promise<AuthedIdentity> => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, config.getKey, { issuer: config.issuer }));
    } catch (err) {
      // jose's JOSEError subclasses mean the token itself is bad → 401. Anything
      // else (e.g. the JWKS fetch failed) is infrastructure → 503, not a logout.
      if (err instanceof joseErrors.JOSEError) {
        throw ApiError.unauthorized('invalid token');
      }
      throw ApiError.unavailable('could not verify token');
    }

    const clientId = typeof payload.client_id === 'string' ? payload.client_id : undefined;
    const audiences = toAudienceList(payload.aud);
    if (clientId !== config.audience && !audiences.includes(config.audience)) {
      throw ApiError.unauthorized('token was not issued for this app');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw ApiError.unauthorized('token has no subject');
    }

    return { sub: payload.sub, claims: payload };
  };
}

function toAudienceList(aud: JWTPayload['aud']): string[] {
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud)) return aud;
  return [];
}

/**
 * The production verifier: a remote JWKS the pool publishes. jose caches the key
 * set and only refetches on an unknown key id, so steady-state verification
 * makes no network call (auth decision 2).
 */
export function createCognitoVerifier(env: Env): TokenVerifier {
  return createVerifier({
    issuer: env.AUTH_ISSUER,
    audience: env.AUTH_AUDIENCE,
    getKey: createRemoteJWKSet(new URL(env.AUTH_JWKS_URI)),
  });
}
