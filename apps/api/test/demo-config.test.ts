import { describe, expect, it } from 'vitest';

import { createCall, normalizeBase } from '../scripts/demo/http.js';
import {
  type DemoActorSpec,
  passwordVar,
  resolveRemoteConfig,
  usernameVar,
} from '../scripts/demo/world.js';

/*
 * The demo's pure configuration layer. Split out from demo-world.test.ts on
 * purpose: these touch no database and no socket, and paying for a PGlite
 * instance, a Fastify app and a listening port per case cost ~27s a run on each
 * CI lane — and, on the real-Postgres lane, a throwaway database apiece.
 */

const TEACHER: DemoActorSpec = { key: 'teacher', displayName: 'Ms. Rivera', role: 'teacher' };
const ANA: DemoActorSpec = { key: 'ana', displayName: 'Ana', role: 'student' };

describe('resolveRemoteConfig', () => {
  const specs = [TEACHER, ANA];

  const complete = (): NodeJS.ProcessEnv => ({
    DEMO_API_URL: 'https://api.example.test',
    DEMO_COGNITO_CLIENT_ID: 'client-id',
    DEMO_PASSWORD: 'shared-password',
    [usernameVar('teacher')]: 'teacher@example.test',
    [usernameVar('ana')]: 'ana@example.test',
  });

  it('reads credentials from the environment, with a shared password fallback', () => {
    const config = resolveRemoteConfig(complete(), specs);

    expect(config.base).toBe('https://api.example.test');
    expect(config.clientId).toBe('client-id');
    expect(config.credentials.get('ana')).toEqual({
      username: 'ana@example.test',
      password: 'shared-password',
    });
    // Nothing to run the sweep with, so the deployment's own cron must.
    expect(config.internalKey).toBeUndefined();
  });

  it('lets a per-actor password override the shared one', () => {
    const env = { ...complete(), [passwordVar('ana')]: 'ana-only' };

    expect(resolveRemoteConfig(env, specs).credentials.get('ana')?.password).toBe('ana-only');
  });

  it('names every missing variable at once, not just the first', () => {
    const env: NodeJS.ProcessEnv = { DEMO_API_URL: 'https://api.example.test' };

    const err = (() => {
      try {
        resolveRemoteConfig(env, specs);
        return null;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(err?.message).toContain('DEMO_COGNITO_CLIENT_ID');
    expect(err?.message).toContain(usernameVar('teacher'));
    expect(err?.message).toContain(usernameVar('ana'));
    expect(err?.message).toContain('DEMO_PASSWORD');
  });

  it('rejects a non-numeric sweep wait rather than silently waiting forever', () => {
    expect(() => resolveRemoteConfig({ ...complete(), DEMO_SWEEP_WAIT_MS: 'soon' }, specs)).toThrow(
      /DEMO_SWEEP_WAIT_MS/,
    );
  });

  it('defaults the region to AWS_REGION when the demo does not set one', () => {
    expect(resolveRemoteConfig({ ...complete(), AWS_REGION: 'eu-west-2' }, specs).region).toBe(
      'eu-west-2',
    );
  });

  it('falls back past an EMPTY region rather than building a hostless endpoint', () => {
    // '' is not nullish, so `??` would keep it and produce
    // https://cognito-idp..amazonaws.com — a DNS error instead of a fallback.
    const env = { ...complete(), DEMO_COGNITO_REGION: '', AWS_REGION: 'eu-west-2' };

    expect(resolveRemoteConfig(env, specs).region).toBe('eu-west-2');
  });

  it('falls back past an EMPTY per-actor password to the shared one', () => {
    const env = { ...complete(), [passwordVar('ana')]: '' };

    expect(resolveRemoteConfig(env, specs).credentials.get('ana')?.password).toBe(
      'shared-password',
    );
  });
});

describe('normalizeBase', () => {
  it('drops a trailing slash so paths concatenate cleanly', () => {
    expect(normalizeBase('https://api.example.test/')).toBe('https://api.example.test');
  });

  it('assumes https for a bare host, the shape a platform URL variable usually has', () => {
    expect(normalizeBase('api.example.test')).toBe('https://api.example.test');
  });

  it.each(['http://', 'https://', 'not a url', '', '   '])(
    'refuses %o rather than silently pointing the demo somewhere else',
    (raw) => {
      expect(() => normalizeBase(raw)).toThrow(/not a usable API base URL/);
    },
  );

  it('keeps an explicit port, so a local server is addressable', () => {
    expect(normalizeBase('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001');
    expect(normalizeBase('http://localhost:3001')).toBe('http://localhost:3001');
  });

  it('refuses plain http to a remote host, which would put the token on the wire', () => {
    // Every request carries a bearer token and some carry the sweep key.
    expect(() => normalizeBase('http://api.example.test')).toThrow(/plain http/);
    expect(normalizeBase('https://api.example.test')).toBe('https://api.example.test');
  });

  it('rejects a sweep wait above the setTimeout ceiling', () => {
    const env = {
      DEMO_API_URL: 'https://api.example.test',
      DEMO_COGNITO_CLIENT_ID: 'client-id',
      DEMO_PASSWORD: 'pw',
      [usernameVar('teacher')]: 't@example.test',
      [usernameVar('ana')]: 'a@example.test',
      DEMO_SWEEP_WAIT_MS: String(2 ** 31),
    };

    expect(() => resolveRemoteConfig(env, [TEACHER, ANA])).toThrow(/DEMO_SWEEP_WAIT_MS/);
  });
});

describe('createCall', () => {
  const responds =
    (body: string, status = 200): typeof fetch =>
    () =>
      Promise.resolve(new Response(body, { status }));

  it('names the request when a 200 is not JSON', async () => {
    // A proxy or captive portal answering 200 with HTML would otherwise die as
    // a bare SyntaxError naming no request at all.
    const call = createCall('https://api.example.test', responds('<html>hi</html>'));

    const err = await call('GET', '/v1/me').then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toContain('GET /v1/me');
    expect(err?.message).toContain('200 but not JSON');
    expect(err?.message).toContain('<html>');
  });

  it('names the status that actually came back, not a hardcoded 200', async () => {
    const call = createCall('https://api.example.test', responds('<html>hi</html>', 201));

    await expect(call('POST', '/v1/thing', { expectStatus: 201 })).rejects.toThrow(
      /→ 201 but not JSON/,
    );
  });

  it('returns null for an empty body rather than throwing', async () => {
    const call = createCall('https://api.example.test', responds(''));

    await expect(call('POST', '/v1/thing')).resolves.toBeNull();
  });

  it('attaches the response body to an unexpected status', async () => {
    const call = createCall('https://api.example.test', responds('{"error":"nope"}', 409));

    await expect(call('POST', '/v1/classes')).rejects.toThrow(/409 \(wanted 200\).*nope/s);
  });

  it('carries the unexpected status on the error, for a caller to act on', async () => {
    const call = createCall('https://api.example.test', responds('{"error":"expired"}', 401));

    await expect(call('GET', '/v1/sessions/x')).rejects.toMatchObject({ status: 401 });
  });
});
