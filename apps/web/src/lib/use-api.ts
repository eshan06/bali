'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { type ApiClient, createApiClient } from './api-client';
import { getAccessToken, signOut } from './auth';
import { config } from './config';

/**
 * The one sign-out action, shared by every client that can see a 401 — the API
 * client and the SSE stream alike: clear the token and route to /login. A
 * definitive 401 is its only caller; network blips and other errors never reach
 * it. Sharing it keeps the honesty rule in one place instead of re-inlined.
 */
export function useSignOut(): () => void {
  const router = useRouter();
  return useCallback(() => {
    signOut();
    router.replace('/login');
  }, [router]);
}

/**
 * An API client bound to the current token, with the one sign-out rule wired in:
 * a definitive 401 clears the token and routes to /login. Every other failure
 * (network, 409, …) throws for the caller to show and retry — never a sign-out.
 */
export function useApi(): ApiClient {
  const onUnauthorized = useSignOut();
  return useMemo(
    () =>
      createApiClient({
        baseUrl: config.apiUrl,
        getToken: getAccessToken,
        onUnauthorized,
      }),
    [onUnauthorized],
  );
}
