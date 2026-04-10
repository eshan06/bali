'use client';

import { useState, useEffect, useCallback } from 'react';
import { signIn, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { signInWithRedirect } from 'aws-amplify/auth';
import { Teacher } from '@bali/shared';
import { api, setTokenProvider } from '@/lib/api-client';

interface AuthState {
  user: Teacher | null;
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
      const teacher = await api.get<Teacher>('/auth/me');
      setState({ user: teacher, isLoading: false, isAuthenticated: true });
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

  return {
    ...state,
    loginWithEmail,
    loginWithGoogle,
    logout,
    getToken,
  };
}
