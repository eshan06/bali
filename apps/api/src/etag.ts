import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';

/** Whether a request's `If-None-Match` holds `etag`, compared weakly (RFC 9110, 13.1.2). */
const holds = (ifNoneMatch: string, etag: string) =>
  ifNoneMatch.trim() === '*' ||
  ifNoneMatch.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);

/**
 * Send `body` as JSON under a strong ETag, the hash of the bytes sent, or `304` with no body when the
 * request's `If-None-Match` holds it: what a poller reads (the results, L3r; the presentation, L4),
 * so an unchanged answer costs a header. The tag changes exactly when the body does, so a body
 * holds nothing minted per request.
 */
export function sendTagged(request: FastifyRequest, reply: FastifyReply, body: unknown) {
  const json = JSON.stringify(body);
  const etag = `"${createHash('sha256').update(json).digest('base64url')}"`;
  void reply.header('etag', etag);
  const held = request.headers['if-none-match'];
  if (held !== undefined && holds(held, etag)) return reply.code(304).send();
  return reply.type('application/json; charset=utf-8').send(json);
}
