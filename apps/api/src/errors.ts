import {
  API_ERROR_STATUS,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiErrorReason,
} from '@bali/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';

/*
 * Step 6 — the error shape and the validation layer. Everything the API rejects
 * leaves through here in one JSON shape (API-surface decision 4), and no request
 * body is trusted: `parse` validates input before a handler touches the
 * database.
 */

/** An error that carries an API error code; the handler renders it to the wire shape. */
export class ApiError extends Error {
  /** A 429's wait in whole seconds, sent as `Retry-After` (ISSUES #1). */
  retryAfter?: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    /** Which refusal this is, when the code alone does not say (`API_ERROR_REASONS`). */
    readonly reason?: ApiErrorReason,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): number {
    return API_ERROR_STATUS[this.code];
  }

  static badInput(message: string, details?: unknown, reason?: ApiErrorReason): ApiError {
    return new ApiError('bad_input', message, details, reason);
  }
  static unauthorized(message = 'authentication required'): ApiError {
    return new ApiError('unauthorized', message);
  }
  static forbidden(message = 'not allowed', reason?: ApiErrorReason): ApiError {
    return new ApiError('forbidden', message, undefined, reason);
  }
  static notFound(message = 'not found', reason?: ApiErrorReason): ApiError {
    return new ApiError('not_found', message, undefined, reason);
  }
  static conflict(message: string, reason?: ApiErrorReason): ApiError {
    return new ApiError('conflict', message, undefined, reason);
  }
  static rateLimited(message = 'over budget', retryAfter?: number): ApiError {
    return Object.assign(new ApiError('rate_limited', message), { retryAfter });
  }
  static unavailable(message = 'temporarily unavailable'): ApiError {
    return new ApiError('unavailable', message);
  }
}

function body(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  reason?: ApiErrorReason,
): ApiErrorBody {
  return {
    error: {
      code,
      ...(reason === undefined ? {} : { reason }),
      message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

/** Flatten a ZodError into `[{ path, message }]` — safe to send, no values echoed. */
function zodDetails(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/**
 * Validate `data` against `schema`, throwing a 400 ApiError with per-field
 * details on failure. Use for every body, params, and query object before it
 * reaches the database. `reason` names the refusal where a 400 on the endpoint
 * can also mean something else (`API_ERROR_REASONS`).
 */
export function parse<T>(schema: ZodType<T>, data: unknown, reason?: ApiErrorReason): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw ApiError.badInput('invalid request', zodDetails(result.error), reason);
  }
  return result.data;
}

/** The parts of a request a route parses, each with the zod schema it parses it with. */
export interface RequestSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * What the route's handler parses (`parseRequest`), on the route table for
     * the API snapshot (`contracts/openapi.json`, O1). Never Fastify's own
     * validation: a handler parses in its own order, after its auth checks,
     * and refuses in the one error shape.
     */
    parses?: RequestSchemas;
  }
}

/**
 * `parse` for one part of a request, with the schema its route declares in
 * `config.parses`. Any other schema is a bug — a 500, which the route's own
 * tests meet first — so the API snapshot never misses what a route parses.
 */
export function parseRequest<T>(
  request: FastifyRequest,
  part: keyof RequestSchemas,
  schema: ZodType<T>,
  reason?: ApiErrorReason,
): T {
  if (request.routeOptions.config.parses?.[part] !== schema) {
    const route = `${request.method} ${request.routeOptions.url ?? request.url}`;
    throw new Error(`${route} parses a ${part} its route does not declare in config.parses`);
  }
  return parse(schema, request[part], reason);
}

/**
 * Install the single error path: the error handler (maps ApiError, Zod errors,
 * Fastify's own 4xx, and anything unexpected to the shape) and the not-found
 * handler (an unknown route is a 404 in the same shape, not Fastify's default).
 */
export function registerErrors(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send(body('not_found', `no route for ${request.method} ${request.url}`));
  });

  app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) {
      if (error.retryAfter !== undefined) reply.header('retry-after', String(error.retryAfter));
      reply.status(error.status).send(body(error.code, error.message, error.details, error.reason));
      return;
    }
    if (error instanceof ZodError) {
      reply.status(400).send(body('bad_input', 'invalid request', zodDetails(error)));
      return;
    }
    // Fastify's own validation (schema-based) and malformed-JSON errors carry a
    // statusCode; surface them as bad_input rather than a bare 400.
    const fastifyErr = error as { statusCode?: unknown; message?: unknown };
    const statusCode =
      typeof fastifyErr.statusCode === 'number' ? fastifyErr.statusCode : undefined;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      const code: ApiErrorCode = statusCode === 401 ? 'unauthorized' : 'bad_input';
      const message = typeof fastifyErr.message === 'string' ? fastifyErr.message : 'bad request';
      reply.status(statusCode).send(body(code, message));
      return;
    }
    // Anything else is a bug: log it with the request, return an opaque 500 —
    // never leak internals to the client (rule 5 is honest failure, not detail).
    request.log.error({ err: error }, 'unhandled error');
    reply.status(500).send(body('internal', 'internal error'));
  });
}
