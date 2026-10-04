import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { endSession, getAccessToken, logoutUrl, signedOut, startLogin } from './auth';

/** A sessionStorage for the node test runner: one tab's, emptied before each test. */
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

const COGNITO = {
  domain: 'https://bali-dev.auth.us-east-1.amazoncognito.com',
  clientId: 'web-client',
  redirectUri: 'http://localhost:3000/auth/callback',
  scopes: 'openid email profile',
};

beforeEach(() => {
  vi.stubGlobal('sessionStorage', fakeStorage());
  sessionStorage.setItem('bali.access_token', 'tok');
});
afterEach(() => vi.unstubAllGlobals());

describe('logoutUrl (S4a)', () => {
  it('is the hosted UI’s /logout, with the client and /login on the redirect’s origin', () => {
    const url = new URL(logoutUrl(COGNITO)!);
    expect(`${url.origin}${url.pathname}`).toBe(`${COGNITO.domain}/logout`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'web-client',
      logout_uri: 'http://localhost:3000/login',
    });
  });

  it('is none without a hosted UI configured, or with a redirect URI that is no URL', () => {
    expect(logoutUrl({ ...COGNITO, domain: '' })).toBeNull();
    expect(logoutUrl({ ...COGNITO, clientId: '' })).toBeNull();
    expect(logoutUrl({ ...COGNITO, redirectUri: 'not a url' })).toBeNull();
  });
});

describe('endSession (S4a)', () => {
  it('forgets the token, then sends the browser to end the Cognito session', () => {
    const go = vi.fn(() => {
      // The token is gone before the browser leaves.
      expect(getAccessToken()).toBeNull();
    });
    expect(endSession('https://idp/logout?x=1', go)).toBe('ended');
    expect(go).toHaveBeenCalledWith('https://idp/logout?x=1');
    expect(getAccessToken()).toBeNull();
    expect(signedOut()).toBe('ended');
    expect(signedOut()).toBe('ended'); // read, never taken: a page drawn twice still says it
  });

  it('is forgotten by the next Sign in', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    endSession(null, vi.fn());
    await startLogin();
    expect(assign).toHaveBeenCalledOnce();
    expect(signedOut()).toBeNull();
  });

  it('still signs out here, and says so, when there is no hosted UI to send it to', () => {
    const go = vi.fn();
    expect(endSession(null, go)).toBe('local');
    expect(go).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeNull();
    expect(signedOut()).toBe('local');
  });

  it('still signs out here, and says so, when the browser can’t be sent there', () => {
    const go = vi.fn(() => {
      throw new Error('blocked');
    });
    expect(endSession('https://idp/logout', go)).toBe('local');
    expect(getAccessToken()).toBeNull();
    expect(signedOut()).toBe('local');
  });

  it('signs out even where sessionStorage throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    expect(endSession(null, vi.fn())).toBe('local');
    expect(signedOut()).toBeNull();
  });
});
