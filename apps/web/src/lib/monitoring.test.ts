import * as Sentry from '@sentry/browser';
import { afterAll, describe, expect, it } from 'vitest';

import { ApiError, createApiClient } from './api-client';
import { captureApiFailure, initMonitoring, templatePath } from './monitoring';

// Everything below is personal data or a secret; none of it may reach Sentry.
const SECRETS = {
  classId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
  sessionId: '0192f3a4-aaaa-7bbb-8ccc-0123456789ef',
  student: 'Ada Lovelace',
  reason: 'left my inhaler in the locker',
  inviteCode: 'K7QXM-P2RTW-9HJZD',
  token: 'eyJhbGciOi.secret-access-token.xyz',
  formValue: 'Period 3 Biology (Mr Darwin)',
};

const sent: string[] = [];
const decoder = new TextDecoder();

/** A transport that records each envelope instead of sending it. */
const fakeTransport: Parameters<typeof initMonitoring>[0]['transport'] = (options) =>
  Sentry.createTransport(options, (request) => {
    sent.push(typeof request.body === 'string' ? request.body : decoder.decode(request.body));
    return Promise.resolve({ statusCode: 200 });
  });

const events = (): string[] => sent.filter((body) => body.includes('"type":"event"'));

/** What the browser calls on an uncaught error and an unhandled rejection. */
type GlobalHandlers = {
  onerror: (msg: string, url: string, line: number, col: number, error: Error) => void;
  onunhandledrejection: (event: { reason: unknown }) => void;
};

afterAll(async () => {
  await Sentry.close();
});

describe('templatePath', () => {
  it('keeps the words of a path and drops its ids and query', () => {
    expect(templatePath(`/v1/classes/${SECRETS.classId}/reports/sessions?before=x`)).toBe(
      '/v1/classes/:id/reports/sessions',
    );
    expect(templatePath('/v1/teacher-invites/redeem')).toBe('/v1/teacher-invites/redeem');
    expect(templatePath('/v1/classes/c1')).toBe('/v1/classes/:id');
  });
});

describe('error monitoring in the portal', () => {
  it('is off without a DSN', () => {
    expect(initMonitoring({ dsn: undefined })).toBe(false);
    expect(initMonitoring({ dsn: '  ' })).toBe(false);
    expect(Sentry.isInitialized()).toBe(false);
    captureApiFailure('GET', '/v1/me', 500);
    expect(sent).toEqual([]);
  });

  it('sends uncaught errors, 5xx and network failures scrubbed, and no 4xx', async () => {
    expect(
      initMonitoring({
        dsn: 'https://publickey@o0.ingest.example.invalid/1',
        environment: 'dev',
        release: 'abc123def',
        transport: fakeTransport,
      }),
    ).toBe(true);
    const client = Sentry.getClient();
    expect(client?.getIntegrationByName('GlobalHandlers')).toBeDefined();
    for (const off of ['Breadcrumbs', 'HttpContext', 'Replay', 'BrowserSession', 'Console']) {
      expect(client?.getIntegrationByName(off)).toBeUndefined();
    }

    // Whatever an integration or a stray call could attach, the scrubber drops.
    Sentry.setUser({ id: 'teacher-sub', email: 'darwin@school.example' });
    Sentry.setExtra('form', { name: SECRETS.formValue, code: SECRETS.inviteCode });
    Sentry.addBreadcrumb({ category: 'ui.input', message: SECRETS.student });
    Sentry.addEventProcessor((event) => ({
      ...event,
      request: {
        url: `https://portal.example/classes/${SECRETS.classId}?code=${SECRETS.inviteCode}`,
        headers: { Authorization: `Bearer ${SECRETS.token}`, Referer: SECRETS.formValue },
        data: { reason: SECRETS.reason },
      },
    }));

    const page = `https://portal.example/classes/${SECRETS.classId}/reports?before=${SECRETS.sessionId}`;
    const handlers = globalThis as unknown as GlobalHandlers;
    handlers.onerror('Uncaught Error', page, 1, 1, new Error(`could not draw ${page}`));
    handlers.onunhandledrejection({
      reason: new Error(`stalled on ${SECRETS.sessionId} at /join?code=${SECRETS.inviteCode}`),
    });

    // The API: a 5xx and a dropped connection are reported; refusals are not.
    const statuses = [500, 503, 400, 403, 404, 409, 429];
    const api = createApiClient({
      baseUrl: 'https://api.example',
      getToken: () => SECRETS.token,
      fetchImpl: () => {
        const status = statuses.shift();
        if (status === undefined) return Promise.reject(new TypeError('Failed to fetch'));
        const body = { error: { code: 'x', message: `${SECRETS.student}: ${SECRETS.reason}` } };
        return Promise.resolve(new Response(JSON.stringify(body), { status }));
      },
    });
    const end = `/v1/sessions/${SECRETS.sessionId}/end`;
    const unlock = { reason: SECRETS.reason, student: SECRETS.student };
    const failures: unknown[] = [];
    for (let i = 0; i < 8; i += 1) {
      failures.push(await api.post(end, unlock).catch((error: unknown) => error));
    }
    // An ApiError nobody caught is not reported again, nor a 4xx at all.
    handlers.onunhandledrejection({ reason: failures[2] });
    expect(failures[2]).toBeInstanceOf(ApiError);

    await Sentry.flush(2000);
    const envelopes = events();
    // Two uncaught, 500, 503 and the network failure; none for the 4xx or the unhandled ApiError.
    expect(envelopes).toHaveLength(5);
    const all = envelopes.join('\n');
    expect(all).toContain('POST /v1/sessions/:id/end: 500');
    expect(all).toContain('POST /v1/sessions/:id/end: 503');
    expect(all).toContain('POST /v1/sessions/:id/end: no answer');
    expect(all).toContain('https://portal.example/classes/:id/reports');
    expect(all).toContain('"release":"abc123def"');
    for (const [what, secret] of Object.entries(SECRETS)) {
      expect(all.includes(secret), `${what} leaked`).toBe(false);
    }
    expect(all).not.toContain('darwin@school.example');
    for (const body of envelopes) {
      const event = JSON.parse(body.split('\n')[2] ?? '{}') as Record<string, unknown>;
      for (const key of ['request', 'user', 'extra', 'breadcrumbs', 'transaction']) {
        expect(event[key], key).toBeUndefined();
      }
    }
    // No session or replay envelopes, only the events.
    expect(sent.every((body) => !/"type":"(session|replay_event|sessions)"/.test(body))).toBe(true);
  });
});
