import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { createServer, type Http2Server, type IncomingHttpHeaders } from 'node:http2';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  APNS_ORIGINS,
  type ApnsConfig,
  type ApnsRequest,
  type ApnsResponse,
  type ApnsTransport,
  apnsConfig,
  createApnsClient,
  http2Transport,
  JWT_LIFETIME_MS,
  signProviderToken,
} from '../src/push/apns.js';
import { testEnv } from './helpers/env.js';

/*
 * The APNs client (N5): its provider token, the request it builds for one
 * alert, how it reads APNs's answer, and the HTTP/2 transport against a local
 * server — no network.
 */

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const config: ApnsConfig = {
  key: privateKey,
  keyId: 'ABC123DEFG',
  teamId: 'H535678UF8',
  topic: 'com.bali.Bali',
};
const TOKEN = 'ab'.repeat(32);

/** A fake transport: records each request, answers from `answer`. */
function fakeTransport(answer: (r: ApnsRequest) => ApnsResponse = () => ({ status: 200 })) {
  const sent: ApnsRequest[] = [];
  let closed = false;
  const transport: ApnsTransport = {
    send: (request) => {
      sent.push(request);
      return Promise.resolve(answer(request));
    },
    close: () => {
      closed = true;
    },
  };
  return { transport, sent, closed: () => closed };
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString()) as object;

const alert = {
  token: TOKEN,
  environment: 'sandbox' as const,
  payload: { aps: { alert: { title: 'Maths has started' } } },
  collapseId: '0192f0c6-0000-7000-8000-000000000000',
  expiresAt: new Date('2026-10-05T09:10:00Z'),
};

describe('the provider token', () => {
  it('is ES256 with the key id in its header and the team and issue time as its claims', () => {
    const jwt = signProviderToken(config, new Date('2026-10-05T09:00:00.900Z'));
    const [header, claims, signature] = jwt.split('.') as [string, string, string];
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(decode(claims)).toEqual({ iss: 'H535678UF8', iat: 1_791_190_800 });
    // A JWS signature is the raw r‖s pair, 64 bytes, never DER.
    const raw = Buffer.from(signature, 'base64url');
    expect(raw).toHaveLength(64);
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' },
      raw,
    );
    expect(valid).toBe(true);
  });

  it('is reused until it is 50 minutes old, then signed afresh — inside Apple’s hour', async () => {
    const { transport, sent } = fakeTransport();
    let now = new Date('2026-10-05T09:00:00Z');
    const client = createApnsClient(config, transport, () => now);
    const bearer = () => sent.at(-1)?.headers.authorization;

    await client.send(alert);
    const first = bearer();
    now = new Date(now.getTime() + JWT_LIFETIME_MS - 1000);
    await client.send(alert);
    expect(bearer()).toBe(first);
    now = new Date(now.getTime() + 1000);
    await client.send(alert);
    expect(bearer()).not.toBe(first);
    expect(JWT_LIFETIME_MS).toBeLessThan(60 * 60_000);
    expect(JWT_LIFETIME_MS).toBeGreaterThanOrEqual(20 * 60_000);
  });

  it('is signed afresh after APNs calls it expired', async () => {
    let refuse = true;
    const { transport, sent } = fakeTransport(() =>
      refuse ? { status: 403, reason: 'ExpiredProviderToken' } : { status: 200 },
    );
    let now = new Date('2026-10-05T09:00:00Z');
    const client = createApnsClient(config, transport, () => now);
    expect(await client.send(alert)).toMatchObject({ outcome: 'refused', gone: false });
    refuse = false;
    now = new Date(now.getTime() + 1000);
    await client.send(alert);
    expect(sent[1]?.headers.authorization).not.toBe(sent[0]?.headers.authorization);
  });
});

describe('an alert', () => {
  it('goes to the token’s own host, with the headers APNs needs and the payload as JSON', async () => {
    const { transport, sent } = fakeTransport();
    const client = createApnsClient(config, transport, () => new Date('2026-10-05T09:00:00Z'));
    expect(await client.send(alert)).toEqual({ outcome: 'delivered' });
    await client.send({ ...alert, environment: 'production' });

    expect(sent.map((r) => r.origin)).toEqual([
      'https://api.sandbox.push.apple.com',
      'https://api.push.apple.com',
    ]);
    expect(APNS_ORIGINS).toEqual({
      sandbox: 'https://api.sandbox.push.apple.com',
      production: 'https://api.push.apple.com',
    });
    const [request] = sent as [ApnsRequest];
    expect(request.path).toBe(`/3/device/${TOKEN}`);
    expect(request.headers).toEqual({
      authorization: expect.stringMatching(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/) as string,
      'apns-topic': 'com.bali.Bali',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Date.parse('2026-10-05T09:10:00Z') / 1000),
      'apns-collapse-id': alert.collapseId,
    });
    expect(JSON.parse(request.json)).toEqual(alert.payload);
  });

  it('reads a dead token as gone: 410, BadDeviceToken, Unregistered — and nothing else', async () => {
    const cases: [ApnsResponse, boolean][] = [
      [{ status: 410, reason: 'Unregistered' }, true],
      [{ status: 410 }, true],
      [{ status: 400, reason: 'BadDeviceToken' }, true],
      [{ status: 400, reason: 'BadCollapseId' }, false],
      [{ status: 400, reason: 'DeviceTokenNotForTopic' }, false],
      [{ status: 429, reason: 'TooManyRequests' }, false],
      [{ status: 500, reason: 'InternalServerError' }, false],
    ];
    for (const [response, gone] of cases) {
      const client = createApnsClient(config, fakeTransport(() => response).transport);
      expect(await client.send(alert), JSON.stringify(response)).toEqual({
        outcome: 'refused',
        status: response.status,
        reason: response.reason,
        gone,
      });
    }
  });

  it('closing the client closes its transport', () => {
    const fake = fakeTransport();
    createApnsClient(config, fake.transport).close();
    expect(fake.closed()).toBe(true);
  });
});

describe('apnsConfig', () => {
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('is undefined — push off — when the key is unset', () => {
    expect(apnsConfig(testEnv)).toBeUndefined();
  });

  it('reads the key, ids and topic, the topic com.bali.Bali when unset', () => {
    const env = { ...testEnv, APNS_KEY_P8: pem, APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'H535678UF8' };
    expect(apnsConfig(env)).toMatchObject({
      keyId: 'ABC123DEFG',
      teamId: 'H535678UF8',
      topic: 'com.bali.Bali',
    });
    expect(apnsConfig({ ...env, APNS_TOPIC: 'com.bali.Other' })?.topic).toBe('com.bali.Other');
  });
});

describe('the HTTP/2 transport', () => {
  let server: Http2Server | undefined;
  let transport: ApnsTransport | undefined;
  afterEach(async () => {
    transport?.close();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  /** A local cleartext HTTP/2 server answering every request with `status` and `body`. */
  async function serve(
    answer: { status: number; body?: string; hang?: boolean; reset?: boolean },
    seen: { headers: IncomingHttpHeaders; body: string }[] = [],
  ): Promise<string> {
    server = createServer();
    server.on('stream', (stream, headers) => {
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => (body += chunk));
      stream.on('end', () => {
        seen.push({ headers, body });
        if (answer.hang) return;
        if (answer.reset) return stream.close();
        stream.respond({ ':status': answer.status });
        stream.end(answer.body);
      });
      stream.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const request = (origin: string): ApnsRequest => ({
    origin,
    path: `/3/device/${TOKEN}`,
    headers: { 'apns-topic': 'com.bali.Bali', 'apns-push-type': 'alert' },
    json: '{"aps":{}}',
  });

  it('POSTs the path, headers and body, and answers the status', async () => {
    const seen: { headers: IncomingHttpHeaders; body: string }[] = [];
    const origin = await serve({ status: 200 }, seen);
    transport = http2Transport();
    expect(await transport.send(request(origin))).toEqual({ status: 200, reason: undefined });
    expect(seen[0]?.headers).toMatchObject({
      ':method': 'POST',
      ':path': `/3/device/${TOKEN}`,
      'apns-topic': 'com.bali.Bali',
      'apns-push-type': 'alert',
    });
    expect(seen[0]?.body).toBe('{"aps":{}}');
    // One connection carries the next request too.
    expect(await transport.send(request(origin))).toEqual({ status: 200, reason: undefined });
  });

  it('answers a refusal with APNs’s reason', async () => {
    const origin = await serve({ status: 410, body: '{"reason":"Unregistered","timestamp":1}' });
    transport = http2Transport();
    expect(await transport.send(request(origin))).toEqual({ status: 410, reason: 'Unregistered' });
  });

  it('rejects a request that takes too long, and one that cannot connect', async () => {
    const origin = await serve({ status: 200, hang: true });
    transport = http2Transport(100);
    await expect(transport.send(request(origin))).rejects.toThrow(/timed out/);
    await expect(transport.send(request('http://127.0.0.1:1'))).rejects.toThrow();
  });

  it('rejects a stream the server closes with no answer', async () => {
    const origin = await serve({ status: 200, reset: true });
    transport = http2Transport();
    await expect(transport.send(request(origin))).rejects.toThrow(/no answer/);
  });
});
