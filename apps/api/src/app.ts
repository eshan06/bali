import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { corsOrigins } from './env';
import { HttpError } from './domain';
import { authRoutes } from './routes/auth';
import { publicRoutes } from './routes/public';
import { teacherRoutes } from './routes/teacher';
import { manageRoutes } from './routes/manage';
import { reportRoutes } from './routes/reports';
import { studentRoutes } from './routes/student';

/**
 * Which upstream hops are allowed to set X-Forwarded-For — i.e. when `req.ip` may be
 * believed. `TRUSTED_PROXIES` takes exactly what Fastify/proxy-addr take: a comma-separated
 * list of IPs, CIDRs or the names `loopback` / `linklocal` / `uniquelocal`, or a plain hop
 * count, or `none`/empty to trust nothing.
 *
 * Default `loopback`, because the topology is not pinned in this repo and that is the one
 * setting that is safe everywhere: a cloudflared tunnel (`scripts/demo.sh --tunnel`) and a
 * same-host nginx both connect from 127.0.0.1, so their forwarded client address is honoured,
 * while a phone hitting the dev box directly over the LAN is NOT trusted and so cannot forge
 * one. Off-host proxies (an ALB, a separate nginx) must be named explicitly — e.g.
 * `TRUSTED_PROXIES=10.0.0.0/8` — or every unauthenticated caller collapses onto the proxy's
 * own address and shares one rate-limit bucket.
 */
function trustedProxies(): boolean | number | string[] {
  const raw = (process.env.TRUSTED_PROXIES ?? 'loopback').trim();
  if (raw === '' || raw.toLowerCase() === 'none') return false; // direct exposure: req.ip is the TCP peer
  if (/^\d+$/.test(raw)) return Number(raw); // hop count: trust the N proxies nearest us
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'production'
        ? true
        : process.env.NODE_ENV === 'test'
          ? false
          : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    // Trust X-Forwarded-* only from the hops named by TRUSTED_PROXIES (see above) — never
    // from any peer, which is what `true` used to mean here. proxy-addr walks the forwarded
    // chain outwards from the socket and stops at the first hop we do NOT trust, so `req.ip`
    // is the nearest address the caller could not have forged: the real client behind a known
    // proxy, the raw TCP peer otherwise. Entries a client stuffs into X-Forwarded-For sit
    // further left in the chain and are dropped. That is what makes req.ip safe to log and
    // safe to rate-limit on; see keyGenerator below.
    trustProxy: trustedProxies(),
    // Let app.close() drain long-lived SSE streams on deploy instead of hanging.
    forceCloseConnections: true,
  });

  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
  });

  // Baseline security headers on every JSON response (SSE hijacks the reply and is
  // unaffected). Kept minimal — this is a JSON API behind a TLS-terminating proxy; HSTS
  // is only emitted in production. CORS (above) governs cross-origin access, not these.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
  });

  // Opt-in rate limiting (student write routes carry `config.rateLimit`). Keyed by the
  // VERIFIED Cognito sub, not the raw Authorization header: the header is caller-chosen
  // and public routes never validate it, so keying on it handed anyone a fresh quota per
  // invented token. Running at preHandler instead of the plugin's default onRequest is
  // what makes that possible — `authenticate` has populated req.identity by then, so a
  // classroom of 28 phones behind one school IP still gets a bucket each.
  //
  // Unauthenticated callers (the two public GETs) fall back to req.ip, which the pinned
  // trustProxy above makes BOTH unforgeable and per-client: a forged X-Forwarded-For from
  // an untrusted peer is ignored, and a trusted proxy's forwarded client address is kept,
  // so one parent refreshing their link cannot lock every desk-tag lookup in the school out
  // of a single shared bucket. Keying on req.socket.remoteAddress instead would be equally
  // unforgeable but would collapse exactly that way behind any proxy. Misconfiguring
  // TRUSTED_PROXIES fails safe in the same direction — an unnamed proxy just means everyone
  // behind it shares that proxy's bucket; it never lets a caller mint fresh buckets.
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
    // `?? 'unknown-peer'`: req.ip is undefined if the socket is already gone mid-request.
    keyGenerator: (req) => req.identity?.sub ?? req.ip ?? 'unknown-peer',
    // The builder's return value is THROWN — hand back an HttpError so the app's
    // error handler renders the standard {error, message} envelope with a 429.
    errorResponseBuilder: () =>
      new HttpError(429, 'rate_limited', 'Too many requests — give it a moment and try again.'),
  });

  // Action endpoints (refocus, end, approve…) are legitimately body-less; treat an
  // empty JSON body as undefined instead of erroring like Fastify's default parser.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '' || body === undefined) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(Object.assign(err as Error, { statusCode: 400 }), undefined);
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: 'invalid_body', message: err.issues[0]?.message ?? 'Invalid request' });
    }
    const fe = err as { statusCode?: unknown; message?: unknown };
    const statusCode = typeof fe.statusCode === 'number' && fe.statusCode >= 400 ? fe.statusCode : 500;
    if (statusCode >= 500) app.log.error(err);
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal' : 'bad_request',
      message: statusCode >= 500 ? 'Something went wrong' : String(fe.message ?? 'Bad request'),
    });
  });

  // Encapsulated registration: hooks (auth preHandlers) stay scoped per module.
  await app.register(async (instance) => publicRoutes(instance));
  await app.register(async (instance) => authRoutes(instance));
  await app.register(async (instance) => teacherRoutes(instance));
  await app.register(async (instance) => manageRoutes(instance));
  await app.register(async (instance) => reportRoutes(instance));
  await app.register(async (instance) => studentRoutes(instance));

  return app;
}
