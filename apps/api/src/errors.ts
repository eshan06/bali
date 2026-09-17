import { API_ERROR_STATUS, type ApiErrorBody, type ApiErrorCode } from '@bali/shared';
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
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get status(): number {
    return API_ERROR_STATUS[this.code];
  }

  static badInput(message: string, details?: unknown): ApiError {
    return new ApiError('bad_input', message, details);
  }
  static unauthorized(message = 'authentication required'): ApiError {
    return new ApiError('unauthorized', message);
  }
  static forbidden(message = 'not allowed'): ApiError {
    return new ApiError('forbidden', message);
  }
  static notFound(message = 'not found'): ApiError {
    return new ApiError('not_found', message);
  }
  static conflict(message: string): ApiError {
    return new ApiError('conflict', message);
  }
  static rateLimited(message = 'over budget'): ApiError {
    return new ApiError('rate_limited', message);
  }
  static unavailable(message = 'temporarily unavailable'): ApiError {
    return new ApiError('unavailable', message);
  }
}

function body(code: ApiErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Flatten a ZodError into `[{ path, message }]` — safe to send, no values echoed. */
function zodDetails(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/**
 * Validate `data` against `schema`, throwing a 400 ApiError with per-field
 * details on failure. Use for every body, params, and query object before it
 * reaches the database.
 */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw ApiError.badInput('invalid request', zodDetails(result.error));
  }
  return result.data;
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
      reply.status(error.status).send(body(error.code, error.message, error.details));
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
