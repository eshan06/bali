import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ClassDetail } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { createApiClient } from './api-client';
import { CLASS_NAME_MAX, createClass } from './classes';
import {
  CANT_CREATE,
  CANT_REACH,
  NO_CLASS_NAME,
  TOO_MANY_TRIES,
  TOO_MANY_TRIES_MINUTE,
} from './errors';

/** The API client over a fetch that answers `status` with `body`, every request recorded. */
function api(status: number, body: unknown, headers: Record<string, string> = {}) {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'tok',
    fetchImpl: (url, init) => {
      sent.push({ url: url as string, init });
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        }),
      );
    },
  });
  return { client, sent };
}

const klass: ClassDetail = {
  id: '01924b2c-0000-7000-8000-000000000002',
  name: 'Period 4 Biology',
  joinCode: 'KWX49Q',
  createdAt: '2026-10-05T14:00:00.000Z',
  liveSessionId: null,
};

describe('createClass', () => {
  it('sends the name and answers with the class the server made', async () => {
    const { client, sent } = api(200, klass);
    expect(await createClass(client, 'Period 4 Biology')).toEqual({ kind: 'created', klass });
    expect(sent[0]?.url).toBe('http://api/v1/classes');
    expect(sent[0]?.init?.method).toBe('POST');
    expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({ name: 'Period 4 Biology' });
  });

  it('answers every failure in words, never the API’s log line for a 5xx or a timeout', async () => {
    const unreachable = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(await createClass(unreachable, 'Period 4')).toEqual({
      kind: 'failed',
      message: CANT_REACH,
    });
    const busy = api(429, { error: { code: 'rate_limited', message: 'too many requests' } });
    expect(await createClass(busy.client, 'Period 4')).toEqual({
      kind: 'failed',
      message: TOO_MANY_TRIES,
    });
    const waiting = api(
      429,
      { error: { code: 'rate_limited', message: 'too many requests' } },
      { 'retry-after': '30' },
    );
    expect(await createClass(waiting.client, 'Period 4')).toEqual({
      kind: 'failed',
      message: TOO_MANY_TRIES_MINUTE,
    });
    for (const status of [500, 502, 408]) {
      const broken = api(status, { error: { code: 'internal', message: 'internal error' } });
      expect(await createClass(broken.client, 'Period 4'), String(status)).toEqual({
        kind: 'failed',
        message: CANT_CREATE,
      });
    }
    // An answer that isn't JSON (a proxy's page): no class to show, so the same words.
    const garbled = api(200, '<html>');
    expect(await createClass(garbled.client, 'Period 4')).toEqual({
      kind: 'failed',
      message: CANT_CREATE,
    });
  });

  it('says a refusal as errText says it, the server’s sentence when it has no words of its own', async () => {
    const conflict = api(409, {
      error: { code: 'conflict', message: 'teacher is not assigned to a school' },
    });
    expect(await createClass(conflict.client, 'Period 4')).toEqual({
      kind: 'failed',
      message: 'teacher is not assigned to a school',
    });
  });

  it('holds a name to the API’s own limit, so its 400 for a longer one is never met', () => {
    const route = readFileSync(
      fileURLToPath(new URL('../../../api/src/routes/classes.ts', import.meta.url)),
      'utf8',
    );
    expect(route).toContain(
      `const CreateBody = z.object({ name: z.string().trim().min(1).max(${CLASS_NAME_MAX}) });`,
    );
  });

  it('holds the form’s words (D2e): no em-dash, no exclamation mark, a way on', () => {
    expect(NO_CLASS_NAME).toBe('Enter a name for the class.');
    expect(CANT_CREATE).toBe(
      "Bali couldn't finish creating the class. If it isn't in your list above, try again.",
    );
    for (const words of [NO_CLASS_NAME, CANT_CREATE]) expect(words).not.toMatch(/[—–!]/);
  });
});
