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
