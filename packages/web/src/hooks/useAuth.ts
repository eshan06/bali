'use client';

import { useState, useEffect, useCallback } from 'react';
import { signIn, signOut, getCurrentUser, fetchAuthSession, signInWithRedirect } from 'aws-amplify/auth';
import { SessionUser } from '@bali/shared';
import { api, setTokenProvider } from '@/lib/api-client';

interface AuthState {
  user: SessionUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() || null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setTokenProvider(getToken);
  }, [getToken]);

  const loadUser = useCallback(async () => {
    try {
      await getCurrentUser();
      const me = await api.get<SessionUser>('/auth/me');
      setState({ user: me, isLoading: false, isAuthenticated: true });
    } catch {
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const loginWithEmail = async (email: string, password: string) => {
    await signIn({ username: email, password });
    await loadUser();
  };

  const loginWithGoogle = async () => {
    await signInWithRedirect({ provider: 'Google' });
  };

  const logout = async () => {
    await signOut();
    setState({ user: null, isLoading: false, isAuthenticated: false });
  };

  const refresh = useCallback(async () => {
    await fetchAuthSession({ forceRefresh: true });
    await loadUser();
  }, [loadUser]);

  return {
    ...state,
    role: state.user?.role ?? null,
    loginWithEmail,
    loginWithGoogle,
    logout,
    getToken,
    refresh,
  };
}
