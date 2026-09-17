import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ApiError } from '../errors.js';
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

/** Pull the token out of `Authorization: Bearer <token>`, strictly. */
function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (\S+)$/.exec(header);
  return match ? match[1]! : null;
}

/**
 * Wire authentication onto the app: a `request.auth` slot and an `authenticate`
 * preHandler that rejects anything without a valid token before the handler
 * runs. Decorated synchronously so routes can reference `app.authenticate` the
 * moment `buildApp` returns.
 */
export function registerAuth(app: FastifyInstance, verify: TokenVerifier): void {
  app.decorateRequest('auth', null);

  const authenticate: AsyncPreHandler = async (request) => {
    const token = bearerToken(request.headers.authorization);
    if (token === null) {
      throw ApiError.unauthorized('missing bearer token');
    }
    request.auth = await verify(token);
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
