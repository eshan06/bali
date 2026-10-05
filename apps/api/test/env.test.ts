import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { testEnvVars } from './helpers/env.js';

/*
 * The boot's own schema (`src/env.ts`), read as the server reads it: the module
 * parses `process.env` when it is imported, so each case stubs the variables and
 * imports a fresh copy.
 */
async function bootWith(authAudience: string) {
  vi.resetModules();
  for (const [name, value] of Object.entries({ ...testEnvVars, AUTH_AUDIENCE: authAudience })) {
    vi.stubEnv(name, value);
  }
  return (await import('../src/env.js')).env;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AUTH_AUDIENCE: the app clients whose tokens are accepted', () => {
  it('one id is that one client, as it always was', async () => {
    expect((await bootWith('web-client')).AUTH_AUDIENCE).toEqual(['web-client']);
  });

  it('a comma-separated list is each client it names, spaces around them dropped', async () => {
    expect((await bootWith('web-client, phone-client')).AUTH_AUDIENCE).toEqual([
      'web-client',
      'phone-client',
    ]);
  });

  it('an empty entry, or no id at all, fails the boot rather than drop a client', async () => {
    for (const value of ['web-client,,phone-client', 'web-client,', ' ', '']) {
      await expect(bootWith(value), value).rejects.toThrow(/AUTH_AUDIENCE/);
    }
  });
});

describe('INTERNAL_API_KEY: long enough not to be guessed (Phase 6 S3)', () => {
  async function bootWithKey(key: string) {
    vi.resetModules();
    for (const [name, value] of Object.entries({ ...testEnvVars, INTERNAL_API_KEY: key })) {
      vi.stubEnv(name, value);
    }
    return (await import('../src/env.js')).env;
  }

  it('a key under 32 characters fails the boot', async () => {
    for (const key of ['x'.repeat(31), 'test-internal-key-0123456789', '']) {
      await expect(bootWithKey(key), key).rejects.toThrow(/INTERNAL_API_KEY/);
    }
  });

  it('32 characters boots, and so does what `openssl rand -hex 32` gives', async () => {
    expect((await bootWithKey('k'.repeat(32))).INTERNAL_API_KEY).toHaveLength(32);
    expect((await bootWithKey('ab'.repeat(32))).INTERNAL_API_KEY).toHaveLength(64);
  });
});

describe('APNS_*: the "class started" push key (N5)', () => {
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const keyed = { APNS_KEY_P8: pem, APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'H535678UF8' };
  const unset = { APNS_KEY_P8: '', APNS_KEY_ID: '', APNS_TEAM_ID: '', APNS_TOPIC: '' };

  async function bootWithApns(vars: Record<string, string>) {
    vi.resetModules();
    for (const [name, value] of Object.entries({ ...testEnvVars, ...unset, ...vars })) {
      vi.stubEnv(name, value);
    }
    return (await import('../src/env.js')).env;
  }

  it('unset (or blank) is push off, and boots', async () => {
    const env = await bootWithApns({});
    expect([env.APNS_KEY_P8, env.APNS_KEY_ID, env.APNS_TEAM_ID, env.APNS_TOPIC]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('the three together boot, the key’s line breaks as they are or written \\n', async () => {
    expect((await bootWithApns(keyed)).APNS_KEY_P8).toBe(pem);
    const oneLine = { ...keyed, APNS_KEY_P8: pem.replace(/\n/g, '\\n') };
    expect((await bootWithApns(oneLine)).APNS_KEY_P8).toBe(pem);
  });

  it('one or two of the three fail the boot', async () => {
    for (const missing of ['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID']) {
      await expect(bootWithApns({ ...keyed, [missing]: '' }), missing).rejects.toThrow(
        /set together or not at all/,
      );
    }
  });

  it('a key that is not a P-256 private key fails the boot, and the error never echoes it', async () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    for (const key of ['not-a-key', rsa]) {
      const message = await bootWithApns({ ...keyed, APNS_KEY_P8: key }).then(
        () => 'booted',
        (e: Error) => e.message,
      );
      expect(message).toMatch(/APNS_KEY_P8: is not a P-256 private key/);
      expect(message).not.toContain(key.split('\n')[1] ?? key);
    }
  });

  it('a key id or team id that is not 10 capitals or numerals fails the boot', async () => {
    await expect(bootWithApns({ ...keyed, APNS_KEY_ID: 'abc123defg' })).rejects.toThrow(
      /APNS_KEY_ID/,
    );
    await expect(bootWithApns({ ...keyed, APNS_TEAM_ID: 'H535678UF' })).rejects.toThrow(
      /APNS_TEAM_ID/,
    );
  });
});
