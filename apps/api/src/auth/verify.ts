import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

import type { Env } from '../env.js';
import { ApiError } from '../errors.js';

/**
 * jose errors that mean the token itself is bad — a real "no" from the pool.
 * ANYTHING NOT ON THIS LIST is treated as infrastructure (couldn't reach or
 * parse the key set) and maps to 503, so a JWKS timeout or a Cognito 5xx never
 * signs a user out (the auth honesty rule / the v2 regression). The default is
 * the safe one: unknown failure → transient, not logout.
 */
const TOKEN_REJECTION_ERRORS = [
  joseErrors.JWTExpired,
  joseErrors.JWTClaimValidationFailed,
  joseErrors.JWSSignatureVerificationFailed,
  joseErrors.JWTInvalid,
  joseErrors.JWSInvalid,
  joseErrors.JWKSNoMatchingKey,
  joseErrors.JOSEAlgNotAllowed,
  joseErrors.JOSENotSupported,
] as const;

function isTokenRejection(err: unknown): boolean {
  return TOKEN_REJECTION_ERRORS.some((cls) => err instanceof cls);
}

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
      ({ payload } = await jwtVerify(token, config.getKey, {
        issuer: config.issuer,
        // Pin the algorithm rather than trusting the token header / key set to
        // constrain it (defence against alg confusion). Cognito signs RS256.
        algorithms: ['RS256'],
      }));
    } catch (err) {
      // Only a genuine token rejection is a 401; a failure to reach or parse the
      // key set is infrastructure → 503, so a blip never logs anyone out.
      if (isTokenRejection(err)) {
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
