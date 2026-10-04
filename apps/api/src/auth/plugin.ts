import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ApiError } from '../errors.js';
import type { Limiter } from '../limits.js';
import type { AuthedIdentity, TokenVerifier } from './verify.js';

/** An async Fastify preHandler; Fastify awaits the returned promise. */
type AsyncPreHandler = (request: FastifyRequest) => Promise<void>;

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler that requires a valid Bearer token; attaches request.auth. */
    authenticate: AsyncPreHandler;
  }
  interface FastifyRequest {
    /** The verified identity, set by `authenticate`; null on unauthenticated routes. */
    auth: AuthedIdentity | null;
  }
}

/** Pull the token out of `Authorization: Bearer <token>` (scheme is case-insensitive per RFC 6750). */
function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (\S+)$/i.exec(header);
  return match ? match[1]! : null;
}

/**
 * Wire authentication onto the app: a `request.auth` slot and an `authenticate`
 * preHandler that rejects anything without a valid token before the handler
 * runs, and spends the request's rate limit (ISSUES #1) once it knows who is
 * asking. Decorated synchronously so routes can reference `app.authenticate`
 * the moment `buildApp` returns.
 */
export function registerAuth(app: FastifyInstance, verify: TokenVerifier, limits: Limiter): void {
  app.decorateRequest('auth', null);

  const authenticate: AsyncPreHandler = async (request) => {
    let identity: AuthedIdentity;
    try {
      const token = bearerToken(request.headers.authorization);
      if (token === null) {
        throw ApiError.unauthorized('missing bearer token');
      }
      identity = await verify(token);
    } catch (err) {
      // No one is signed in: their address's budget, the 401 within it. A key
      // set out of reach (503) is ours, not the caller's, and costs nothing.
      if (err instanceof ApiError && err.code === 'unauthorized') limits.unsigned(request);
      throw err;
    }
    // Signed in: the verified account's own budget, never its address's.
    limits.signedIn(identity.sub);
    request.auth = identity;
  };

  app.decorate('authenticate', authenticate);
}

/**
 * Assert a request is authenticated and narrow the type. For handlers behind
 * `authenticate`, where `auth` is guaranteed set — the throw is a safety net,
 * not an expected path.
 */
export function requireAuth(request: FastifyRequest): AuthedIdentity {
  if (request.auth === null) {
    throw ApiError.unauthorized();
  }
  return request.auth;
}
