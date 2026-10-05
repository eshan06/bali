import { createPrivateKey, type KeyObject, sign } from 'node:crypto';
import { type ClientHttp2Session, connect, constants } from 'node:http2';

import type { PushEnvironment } from '@bali/shared';

import type { Env } from '../env.js';

/*
 * An APNs client (N5; ARCHITECTURE, "Push: a doorbell for students"): HTTP/2
 * with token auth, Node's own http2 and crypto, no dependency. It sends one
 * alert to one device token and says how it went; who gets one is
 * class-started.ts's. The transport is a seam, so tests send to a fake.
 */

export const DEFAULT_APNS_TOPIC = 'com.bali.Bali';

/** Where a token's pushes go, by the APNs environment its app was built for. */
export const APNS_ORIGINS: Record<PushEnvironment, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
};

export interface ApnsConfig {
  key: KeyObject;
  keyId: string;
  teamId: string;
  topic: string;
}

/** The APNs configuration, or undefined when push is off (the key unset, env.ts). */
export function apnsConfig(env: Env): ApnsConfig | undefined {
  if (env.APNS_KEY_P8 === undefined || env.APNS_KEY_ID === undefined) return undefined;
  if (env.APNS_TEAM_ID === undefined) return undefined;
  return {
    key: createPrivateKey(env.APNS_KEY_P8),
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    topic: env.APNS_TOPIC ?? DEFAULT_APNS_TOPIC,
  };
}

/**
 * Apple refuses a provider token older than an hour and one refreshed more
 * often than every 20 minutes; a new one every 50 sits between.
 */
export const JWT_LIFETIME_MS = 50 * 60_000;

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** An ES256 provider token: the key id in its header, the team and the issue time in its claims. */
export function signProviderToken(config: ApnsConfig, now: Date): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }));
  const claims = base64url(
    JSON.stringify({ iss: config.teamId, iat: Math.floor(now.getTime() / 1000) }),
  );
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: config.key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${claims}.${base64url(signature)}`;
}

export interface ApnsRequest {
  origin: string;
  path: string;
  headers: Record<string, string>;
  /** The payload as JSON text. */
  json: string;
}
/** APNs's answer: its status, and its `reason` when it refused. */
export interface ApnsResponse {
  status: number;
  reason?: string;
}
export interface ApnsTransport {
  send(request: ApnsRequest): Promise<ApnsResponse>;
  close(): void;
}

/** An alert for one token. */
export interface ApnsAlert {
  token: string;
  environment: PushEnvironment;
  /** The JSON payload, `aps` and all. */
  payload: object;
  /** Same id, one notification on the phone: ≤ 64 bytes. */
  collapseId: string;
  /** After this, APNs drops the alert rather than deliver it late. */
  expiresAt: Date;
}

/** `delivered`, or refused by APNs: `gone` when the token is dead for good (delete it). */
export type ApnsResult =
  | { outcome: 'delivered' }
  | { outcome: 'refused'; status: number; reason: string | undefined; gone: boolean };

export interface ApnsClient {
  send(alert: ApnsAlert): Promise<ApnsResult>;
  close(): void;
}

/** A token APNs reports dead for good: 410, `BadDeviceToken` or `Unregistered`. */
function isGone(response: ApnsResponse): boolean {
  return (
    response.status === 410 ||
    response.reason === 'BadDeviceToken' ||
    response.reason === 'Unregistered'
  );
}

export function createApnsClient(
  config: ApnsConfig,
  transport: ApnsTransport,
  clock: () => Date = () => new Date(),
): ApnsClient {
  let cached: { jwt: string; at: number } | undefined;
  const providerToken = (): string => {
    const now = clock();
    if (!cached || now.getTime() - cached.at >= JWT_LIFETIME_MS) {
      cached = { jwt: signProviderToken(config, now), at: now.getTime() };
    }
    return cached.jwt;
  };

  return {
    async send(alert) {
      const response = await transport.send({
        origin: APNS_ORIGINS[alert.environment],
        path: `/3/device/${alert.token}`,
        headers: {
          authorization: `bearer ${providerToken()}`,
          'apns-topic': config.topic,
          'apns-push-type': 'alert',
          'apns-priority': '10',
          'apns-expiration': String(Math.floor(alert.expiresAt.getTime() / 1000)),
          'apns-collapse-id': alert.collapseId,
        },
        json: JSON.stringify(alert.payload),
      });
      if (response.status === 200) return { outcome: 'delivered' };
      // A token Apple calls expired is signed afresh for the next send.
      if (response.reason === 'ExpiredProviderToken') cached = undefined;
      return {
        outcome: 'refused',
        status: response.status,
        reason: response.reason,
        gone: isGone(response),
      };
    },
    close: () => transport.close(),
  };
}

/** How long one send may take before it is abandoned: well inside the shutdown deadline. */
export const APNS_REQUEST_TIMEOUT_MS = 5_000;

/**
 * The real transport: one HTTP/2 connection per APNs host, opened on first
 * use and again after it drops. Unref'd, so an idle connection never holds a
 * finished process open.
 */
export function http2Transport(timeoutMs = APNS_REQUEST_TIMEOUT_MS): ApnsTransport {
  const sessions = new Map<string, ClientHttp2Session>();
  const sessionFor = (origin: string): ClientHttp2Session => {
    const open = sessions.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const session = connect(origin);
    session.unref();
    const forget = () => {
      if (sessions.get(origin) === session) sessions.delete(origin);
    };
    session.on('error', forget);
    session.on('goaway', forget);
    session.on('close', forget);
    sessions.set(origin, session);
    return session;
  };

  return {
    send: ({ origin, path, headers, json }) =>
      new Promise<ApnsResponse>((resolve, reject) => {
        const stream = sessionFor(origin).request({
          ':method': 'POST',
          ':path': path,
          ...headers,
        });
        // A wall clock from the send, connecting included, and every way the
        // stream can stop settles the promise once.
        const fail = (error: Error) => {
          clearTimeout(timer);
          reject(error);
        };
        const timer = setTimeout(() => {
          stream.close(constants.NGHTTP2_CANCEL);
          fail(new Error('APNs request timed out'));
        }, timeoutMs);
        let status: number | undefined;
        let data = '';
        stream.setEncoding('utf8');
        stream.on('response', (answer) => {
          status = Number(answer[':status']);
        });
        stream.on('data', (chunk: string) => {
          data += chunk;
        });
        stream.on('end', () => {
          if (status === undefined) return fail(new Error('APNs stream ended with no answer'));
          let reason: string | undefined;
          try {
            reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined;
          } catch {
            reason = undefined;
          }
          clearTimeout(timer);
          resolve({ status, reason });
        });
        stream.on('error', fail);
        stream.on('close', () => fail(new Error('APNs stream closed with no answer')));
        stream.end(json);
      }),
    close: () => {
      for (const session of sessions.values()) session.close();
      sessions.clear();
    },
  };
}
