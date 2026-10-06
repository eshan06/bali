import { MAX_SESSION_MINUTES } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { createApiClient } from './api-client';
import { CANT_ADD_TIME, CANT_MAKE_CODE, CANT_REACH, TOO_MANY_TRIES } from './errors';
import {
  bellTime,
  codeMoved,
  DEFAULT_MINUTES,
  EXTEND_PRESETS,
  extendAttemptFor,
  extendSession,
  keepUnanswered,
  laterBell,
  LENGTH_PRESETS,
  parseMinutes,
  pickFor,
  regenerateCode,
  rememberedMinutes,
  rememberMinutes,
} from './session-controls';

/** The API client over a fetch that answers `status` with `body`, every request recorded. */
function api(status: number, body: unknown, headers: Record<string, string> = {}) {
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'tok',
    fetchImpl: (url, init) => {
      sent.push({ url: url as string, init });
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        }),
      );
    },
  });
  return { client, sent };
}
const unreachable = createApiClient({
  baseUrl: 'http://api',
  getToken: () => 'tok',
  fetchImpl: () => Promise.reject(new Error('offline')),
});
const SESSION = '01924b2c-0000-7000-8000-000000000001';
const CLASS = '01924b2c-0000-7000-8000-000000000002';

describe('parseMinutes', () => {
  it('takes a whole number of minutes from 1 to the route’s cap, spaces around it allowed', () => {
    expect(parseMinutes('50')).toBe(50);
    expect(parseMinutes(' 90 ')).toBe(90);
    expect(parseMinutes('1')).toBe(1);
    expect(parseMinutes(String(MAX_SESSION_MINUTES))).toBe(MAX_SESSION_MINUTES);
    expect(parseMinutes('025')).toBe(25);
  });

  it('refuses anything else, so no Start is sent with it', () => {
    for (const typed of [
      '',
      ' ',
      '0',
      '-5',
      '12.5',
      '1e2',
      'abc',
      '45 min',
      String(MAX_SESSION_MINUTES + 1),
    ]) {
      expect(parseMinutes(typed), JSON.stringify(typed)).toBeNull();
    }
  });

  it('offers 25, 50 and 75, picks 50 with nothing remembered, and adds 5 or 10', () => {
    expect([...LENGTH_PRESETS]).toEqual([25, 50, 75]);
    expect(DEFAULT_MINUTES).toBe(50);
    expect([...EXTEND_PRESETS]).toEqual([5, 10]);
  });
});

describe('the remembered pick', () => {
  /** A storage of its own per test: what is set is read back, nothing else is in it. */
  const fake = () => {
    const items = new Map<string, string>();
    return {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      items,
    } as unknown as Storage & { items: Map<string, string> };
  };

  it('remembers each class’s last pick apart from the others, and reads none back as null', () => {
    const storage = fake();
    expect(rememberedMinutes(CLASS, storage)).toBeNull();
    rememberMinutes(CLASS, 75, storage);
    rememberMinutes(SESSION, 90, storage);
    expect(rememberedMinutes(CLASS, storage)).toBe(75);
    expect(rememberedMinutes(SESSION, storage)).toBe(90);
    expect([...storage.items.keys()]).toEqual([
      `bali.session-minutes.${CLASS}`,
      `bali.session-minutes.${SESSION}`,
    ]);
  });

  it('reads a value that isn’t a length as none', () => {
    const storage = fake();
    for (const kept of ['', 'abc', '0', '481', '12.5']) {
      storage.setItem(`bali.session-minutes.${CLASS}`, kept);
      expect(rememberedMinutes(CLASS, storage), kept).toBeNull();
    }
  });

  it('opens the picker on the remembered length: a preset itself, any other under Other, else the default', () => {
    expect(pickFor(null)).toEqual({ pick: DEFAULT_MINUTES, other: '' });
    expect(pickFor(25)).toEqual({ pick: 25, other: '' });
    expect(pickFor(75)).toEqual({ pick: 75, other: '' });
    expect(pickFor(90)).toEqual({ pick: 'other', other: '90' });
    expect(pickFor(1)).toEqual({ pick: 'other', other: '1' });
  });

  it('works without storage, and when storage throws', () => {
    expect(rememberedMinutes(CLASS, null)).toBeNull();
    expect(() => rememberMinutes(CLASS, 50, null)).not.toThrow();
    const refusing = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    } as unknown as Storage;
    expect(rememberedMinutes(CLASS, refusing)).toBeNull();
    expect(() => rememberMinutes(CLASS, 50, refusing)).not.toThrow();
  });
});

describe('extendAttemptFor', () => {
  let minted = 0;
  const mint = () => `event-${++minted}`;

  it('mints a fresh eventId for a new press', () => {
    expect(extendAttemptFor(null, 5, mint)).toEqual({ minutes: 5, eventId: 'event-1' });
    expect(extendAttemptFor(null, 5).eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resends the attempt whose answer never came for the same minutes, never a new id', () => {
    const unanswered = { minutes: 5, eventId: 'event-sent' };
    expect(extendAttemptFor(unanswered, 5, mint)).toBe(unanswered);
  });

  it('sends other minutes as a new attempt', () => {
    const unanswered = { minutes: 5, eventId: 'event-sent' };
    expect(extendAttemptFor(unanswered, 10, mint).eventId).not.toBe('event-sent');
  });

  it('keeps an attempt unanswered only while no answer came, never after an extend or a refusal', () => {
    const attempt = { minutes: 5, eventId: 'event-sent' };
    expect(keepUnanswered(attempt, { kind: 'failed', message: 'no answer' })).toBe(attempt);
    expect(
      keepUnanswered(attempt, { kind: 'extended', endsAt: '2026-10-05T14:35:00.000Z' }),
    ).toBeNull();
    expect(
      keepUnanswered(attempt, {
        kind: 'refused',
        message: 'past the bell',
        reason: 'session_not_running',
      }),
    ).toBeNull();
  });
});

describe('extendSession', () => {
  const attempt = { minutes: 5, eventId: '0192a3b4-c5d6-7e7f-8a9b-0c1d2e3f4a5b' };
  const session = { id: SESSION, classId: CLASS, endsAt: '2026-10-05T14:35:00.000Z' };

  it('sends the minutes under the eventId, and answers the new bell', async () => {
    const { client, sent } = api(200, { outcome: 'extended', session });
    expect(await extendSession(client, SESSION, attempt)).toEqual({
      kind: 'extended',
      endsAt: session.endsAt,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`http://api/v1/sessions/${SESSION}/extend`);
    expect(sent[0]?.init?.method).toBe('POST');
    expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({
      durationMinutes: 5,
      eventId: attempt.eventId,
    });
  });

  it('says a refusal in its words, keyed on its reason: past the bell, a spent id', async () => {
    const refused = (reason: string) =>
      api(409, { error: { code: 'conflict', reason, message: 'a log line' } }).client;
    expect(await extendSession(refused('session_not_running'), SESSION, attempt)).toEqual({
      kind: 'refused',
      reason: 'session_not_running',
      message: 'This session is past its bell, so no time was added. End it, then start a new one.',
    });
    expect(await extendSession(refused('event_id_conflict'), SESSION, attempt)).toEqual({
      kind: 'refused',
      reason: 'event_id_conflict',
      message: "That didn't go through, so nothing changed. Try again.",
    });
  });

  it('keeps an answer that never came, a timeout, a server error or the budget’s 429, to try again', async () => {
    expect(await extendSession(unreachable, SESSION, attempt)).toEqual({
      kind: 'failed',
      message: CANT_REACH,
    });
    const busy = api(429, { error: { code: 'rate_limited', message: 'too many requests' } });
    expect(await extendSession(busy.client, SESSION, attempt)).toEqual({
      kind: 'failed',
      message: TOO_MANY_TRIES,
    });
    const broken = api(500, { error: { code: 'internal', message: 'internal error' } });
    expect(await extendSession(broken.client, SESSION, attempt)).toEqual({
      kind: 'failed',
      message: CANT_ADD_TIME,
    });
    const slow = api(408, { message: 'request timeout' });
    expect(await extendSession(slow.client, SESSION, attempt)).toEqual({
      kind: 'failed',
      message: CANT_ADD_TIME,
    });
  });
});

describe('regenerateCode', () => {
  const klass = {
    id: CLASS,
    name: 'Period 1',
    joinCode: 'NEWCDE',
    createdAt: '2026-10-01T12:00:00.000Z',
    liveSessionId: null,
  };

  it('asks for a new code and answers the class with it', async () => {
    const { client, sent } = api(200, klass);
    expect(await regenerateCode(client, CLASS, 'OLDCDE')).toEqual({ kind: 'made', klass });
    expect(sent[0]?.url).toBe(`http://api/v1/classes/${CLASS}`);
    expect(sent[0]?.init?.method).toBe('PATCH');
    expect(JSON.parse(sent[0]?.init?.body as string)).toEqual({ regenerateCode: true });
  });

  it('answers every failure in words, with Try again to send it again', async () => {
    expect(await regenerateCode(unreachable, CLASS, 'OLDCDE')).toEqual({
      kind: 'failed',
      message: CANT_REACH,
    });
    const busy = api(429, { error: { code: 'rate_limited', message: 'too many requests' } });
    expect(await regenerateCode(busy.client, CLASS, 'OLDCDE')).toEqual({
      kind: 'failed',
      message: TOO_MANY_TRIES,
    });
    const broken = api(500, { error: { code: 'internal', message: 'internal error' } });
    expect(await regenerateCode(broken.client, CLASS, 'OLDCDE')).toEqual({
      kind: 'failed',
      message: CANT_MAKE_CODE,
    });
    // A refusal the portal never expects (the class gone) still comes back with its message.
    const gone = api(404, {
      error: { code: 'not_found', reason: 'class_not_found', message: 'class not found' },
    });
    expect(await regenerateCode(gone.client, CLASS, 'OLDCDE')).toEqual({
      kind: 'failed',
      message: 'class not found',
    });
  });

  /** The mint answered `status` (its answer lost), the class read after it answered `read`. */
  function lost(status: number, read: { status: number; body: unknown }) {
    const sent: string[] = [];
    const client = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'tok',
      fetchImpl: (_url, init) => {
        sent.push(init?.method ?? 'GET');
        const [code, body] =
          init?.method === 'PATCH'
            ? [status, { error: { code: 'internal', message: 'bad gateway' } }]
            : [read.status, read.body];
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: code,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    });
    return { client, sent };
  }

  it('shows the code Bali holds after an answer that never came (#247’s review)', async () => {
    // The mint landed and its answer was lost: the class read again has the new code.
    const landed = lost(502, { status: 200, body: klass });
    expect(await regenerateCode(landed.client, CLASS, 'OLDCDE')).toEqual({ kind: 'made', klass });
    expect(landed.sent).toEqual(['PATCH', 'GET']);
    // It never landed: the code is the one on screen, and the failure stands.
    const missed = lost(502, { status: 200, body: { ...klass, joinCode: 'OLDCDE' } });
    expect(await regenerateCode(missed.client, CLASS, 'OLDCDE')).toEqual({
      kind: 'failed',
      message: CANT_MAKE_CODE,
    });
    // Unread too: the failure stands, never thrown.
    const dark = lost(502, { status: 503, body: { error: { code: 'unavailable', message: 'x' } } });
    expect(await regenerateCode(dark.client, CLASS, 'OLDCDE')).toEqual({
      kind: 'failed',
      message: CANT_MAKE_CODE,
    });
  });

  it('reads nothing again after a refusal, which minted nothing', async () => {
    const { client, sent } = api(404, {
      error: { code: 'not_found', reason: 'class_not_found', message: 'class not found' },
    });
    await regenerateCode(client, CLASS, 'OLDCDE');
    expect(sent.map((s) => s.init?.method)).toEqual(['PATCH']);
  });

  it('reads the class once more on its own (a cancel after a failure): its code only if moved', async () => {
    expect(await codeMoved(api(200, klass).client, CLASS, 'OLDCDE')).toEqual(klass);
    const still = api(200, { ...klass, joinCode: 'OLDCDE' });
    expect(await codeMoved(still.client, CLASS, 'OLDCDE')).toBeNull();
    expect(still.sent[0]?.url).toBe(`http://api/v1/classes/${CLASS}`);
    // Unread, never thrown: the code on screen stays as it was.
    expect(await codeMoved(unreachable, CLASS, 'OLDCDE')).toBeNull();
    const down = api(503, { error: { code: 'unavailable', message: 'unavailable' } });
    expect(await codeMoved(down.client, CLASS, 'OLDCDE')).toBeNull();
  });
});

describe('the bell', () => {
  it('shows the bell as a clock time in the viewer’s locale and zone', () => {
    const at = '2026-10-05T14:30:00.000Z';
    expect(bellTime(at, { locale: 'en-US', timeZone: 'America/Chicago' })).toBe('9:30 AM');
    expect(bellTime(at, { locale: 'en-GB', timeZone: 'Europe/London' })).toBe('15:30');
  });

  it('keeps the later of two bells, so a stale snapshot never takes an extend back', () => {
    const was = '2026-10-05T14:30:00.000Z';
    const extended = '2026-10-05T14:35:00.000Z';
    expect(laterBell(null, was)).toBe(was);
    expect(laterBell(was, extended)).toBe(extended);
    expect(laterBell(extended, was)).toBe(extended);
    expect(laterBell(was, was)).toBe(was);
  });
});
