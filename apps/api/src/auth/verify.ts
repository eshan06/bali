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

/** Claims that carry a name someone chose, best first. */
const NAME_CLAIMS = ['name', 'preferred_username'];

/**
 * Claims that carry the pool's own identifier for the user — `username` in an
 * access token, `cognito:username` in an id token. Usable as a last resort only
 * when the pool's usernames happen to be readable (an email, say).
 */
const IDENTIFIER_CLAIMS = ['cognito:username', 'username'];

/** A grid cell, not an essay. */
const MAX_DISPLAY_NAME = 64;

/**
 * Nothing a reader would see: whitespace, default-ignorable characters (the
 * joiners, Hangul fillers, variation selectors), and two symbols drawn as blank
 * space, the blank braille cell and the musical null notehead.
 */
const INVISIBLE = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\u2800\u{1D159}]*$/u;

/**
 * A dashed UUID, in either case: what a pool configured with
 * `UsernameAttributes: ['email']` (or phone) gives every user as a username.
 */
const UUID_USERNAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cognito's built-in social providers, by the name it puts in front of a
 * federated user's subject (`Google_110293847566123450987`), and the shape of
 * the subject each one hands out. Keyed in lower case: a case-insensitive pool
 * can spell the prefix either way.
 */
const FEDERATED_SUBJECTS = new Map([
  // Google's `sub` and Facebook's app-scoped id are long decimal numbers (21
  // and 15-17 digits); requiring ten keeps a name that ends in a date, such as
  // google_20290101.
  ['google', /^\d{10,}$/],
  ['facebook', /^\d{10,}$/],
  ['loginwithamazon', /^amzn1\.account\.[a-z0-9]+$/i],
  ['signinwithapple', /^\d+\.[0-9a-f]+\.\d+$/i],
]);

/**
 * A federated username: a built-in provider's name, an underscore, and a
 * subject in that provider's shape. Both halves are required, so a student who
 * is actually called `google_fan_2029` keeps their name.
 *
 * A custom SAML or OIDC provider's name is whatever the pool's owner chose, so
 * its users cannot be told from anyone else's by shape; they are not caught
 * here, and read as the pool spells them.
 */
function isFederatedUsername(value: string): boolean {
  const split = value.indexOf('_');
  if (split <= 0) return false;
  const subject = FEDERATED_SUBJECTS.get(value.slice(0, split).toLowerCase());
  return subject !== undefined && subject.test(value.slice(split + 1));
}

/**
 * An identifier no human would recognise: a bare UUID — which is what a pool
 * configured with `UsernameAttributes: ['email']` gives every user — or a
 * federated username such as `Google_110293847566123450987`.
 *
 * Storing one of these would be a worse answer than storing nothing: the grid's
 * own fallback prints eight characters of a UUID, where a stored UUID would
 * print all thirty-six and a federated username a provider's long subject — and
 * because the fill never overwrites, it would stay.
 *
 * The test is anchored on the provider, not on what the tail looks like,
 * because a FALSE positive costs exactly what this change exists to fix: a
 * rejected username leaves the teacher looking at a UUID prefix. A rule that
 * read any long tail with digits in it as a federated subject would throw away
 * `ana_rodriguez2029` and `p_kowalski1987` — a surname and a year.
 */
function isOpaqueIdentifier(value: string): boolean {
  return UUID_USERNAME.test(value) || isFederatedUsername(value);
}

/**
 * Trim, drop control characters, and clamp — the value is an attribute the
 * student can set on themselves, and it lands in a teacher's grid and in logs,
 * where a bidi override or an ANSI escape would be someone else's cursor.
 *
 * Zero-width joiner and non-joiner are kept: they are `\p{Cf}` too, but they
 * carry meaning in Persian, Arabic and Indic names and inside emoji sequences.
 *
 * Line and paragraph separators (U+2028, U+2029) go too: a log viewer can
 * break a line on them.
 *
 * A lone surrogate half passes TypeScript happily and then reaches Postgres,
 * which stores it as U+FFFD — and the fill would never replace it. So lone
 * halves in the claim are dropped (`\p{Cs}`; a proper pair is one code point
 * and is kept), and the clamp counts code POINTS, so its cut never makes one.
 *
 * A name made only of what INVISIBLE lists — joiners, a Hangul filler, a blank
 * braille cell, a null notehead — counts as no name at all. Stored, it would blank the
 * student's cell in the grid for good, and outrank the readable username.
 */
function cleanClaim(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const stripped = value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, (char) =>
    char === '\u200c' || char === '\u200d' ? char : '',
  );
  // Trimmed again after the cut, which can land just after a space.
  const clamped = [...stripped.trim()].slice(0, MAX_DISPLAY_NAME).join('').trim();
  return INVISIBLE.test(clamped) ? undefined : clamped;
}

/**
 * The best display name the token itself carries, or undefined.
 *
 * Cognito puts profile attributes in the ID token, so an access token — which is
 * what every client here sends (the portal stores `access_token` and nothing
 * else; the exit demo signs in for `AuthenticationResult.AccessToken`) — carries
 * the username and, absent a pre-token-generation Lambda that adds one, no
 * `name`. Reading `name` alone therefore found nothing on every request this
 * system actually makes, so every row `/v1/me` provisioned kept a NULL
 * `display_name` and the live grid fell back to eight characters of a UUID.
 *
 * A real name wins wherever one exists. Failing that the pool's own identifier
 * is used, but only when it is something a teacher could read: an opaque one
 * would be worse than the UUID prefix it replaced, and the fill that stores it
 * never overwrites.
 */
export function displayNameFromClaims(claims: JWTPayload): string | undefined {
  for (const claim of NAME_CLAIMS) {
    const value = cleanClaim(claims[claim]);
    if (value !== undefined) return value;
  }
  for (const claim of IDENTIFIER_CLAIMS) {
    const value = cleanClaim(claims[claim]);
    if (value !== undefined && !isOpaqueIdentifier(value)) return value;
  }
  return undefined;
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
