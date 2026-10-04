import type { FastifyInstance } from 'fastify';

/*
 * The response headers every answer carries (Phase 6 S3). HSTS: the API is
 * HTTPS-only on Railway, so a browser that has seen it once never tries plain
 * HTTP; a year, the usual length. `nosniff`: a browser reads a body as the type
 * it is sent as, never a guess. The live stream hijacks its response, so no
 * hook sees it: it spreads these into its own headers (routes/feed.ts).
 */
export const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
} as const;

/**
 * Every response gets `SECURITY_HEADERS`, and every `/v1` one `no-store`: an
 * answer there is someone's own data, as of now, so no browser or proxy keeps a
 * copy. `/healthz` and `/internal` are not `/v1` and keep the default.
 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply) => {
    void reply.headers(SECURITY_HEADERS);
    if (request.url.startsWith('/v1/')) void reply.header('cache-control', 'no-store');
  });
}
