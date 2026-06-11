'use client';

import { Amplify } from 'aws-amplify';
import {
  fetchAuthSession,
  getCurrentUser,
  signIn as amplifySignIn,
  signInWithRedirect,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setTokenProvider } from './api';

/** Same Cognito pool/client/flows the legacy web client proved out. */
const poolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
const redirect = process.env.NEXT_PUBLIC_REDIRECT_URI ?? 'http://localhost:3000/auth/callback';

const DEV_TOKEN_KEY = 'bali.devToken';
const devTokensAllowed = process.env.NEXT_PUBLIC_ALLOW_DEV_TOKENS === '1';

let configured = false;
function configureAmplify(): void {
  if (configured || !poolId || !clientId) return;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: poolId,
        userPoolClientId: clientId,
        loginWith: domain
          ? {
              oauth: {
                domain,
                scopes: ['openid', 'email', 'profile'],
                redirectSignIn: [redirect],
                redirectSignOut: [redirect.replace(/\/auth\/callback\/?$/, '/login')],
                responseType: 'code',
              },
            }
          : undefined,
      },
    },
  });
  configured = true;
}

export interface MeTeacher {
  id: string;
  name: string;
  displayName: string;
  email: string;
  schoolName: string;
  notifyEmergency: boolean;
  notifyRevoked: boolean;
  notifyWeekly: boolean;
}

interface AuthState {
  loading: boolean;
  teacher: MeTeacher | null;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Dev-only: store a `dev:` token (mirrors the API's ALLOW_DEV_TOKENS mode). */
  devSignIn: ((token: string) => Promise<void>) | null;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function cognitoToken(): Promise<string | null> {
  if (devTokensAllowed && typeof window !== 'undefined') {
    const dev = window.localStorage.getItem(DEV_TOKEN_KEY);
    if (dev) return dev;
  }
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [teacher, setTeacher] = useState<MeTeacher | null>(null);

  useEffect(() => {
    configureAmplify();
    setTokenProvider(cognitoToken);
  }, []);

  const loadMe = useCallback(async (): Promise<void> => {
    const token = await cognitoToken();
    if (!token) {
      setTeacher(null);
      return;
    }
    // Provision/adopt, then read the profile. Bootstrap is idempotent.
    await api.post('/auth/bootstrap', { role: 'teacher' }).catch(() => {});
    const me = await api.get<{ role: string | null; teacher?: MeTeacher }>('/me');
    setTeacher(me.role === 'teacher' && me.teacher ? me.teacher : null);
  }, []);

  useEffect(() => {
    configureAmplify();
    setTokenProvider(cognitoToken);
    loadMe()
      .catch(() => setTeacher(null))
      .finally(() => setLoading(false));
  }, [loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      teacher,
      signInWithPassword: async (email, password) => {
        configureAmplify();
        await amplifySignIn({ username: email, password });
        await loadMe();
      },
      signInWithGoogle: async () => {
        configureAmplify();
        await signInWithRedirect({ provider: 'Google' });
      },
      signOut: async () => {
        if (devTokensAllowed) window.localStorage.removeItem(DEV_TOKEN_KEY);
        try {
          await getCurrentUser();
          await amplifySignOut();
        } catch {
          /* no cognito session — dev token only */
        }
        setTeacher(null);
      },
      devSignIn: devTokensAllowed
        ? async (token: string) => {
            window.localStorage.setItem(DEV_TOKEN_KEY, token);
            await loadMe();
          }
        : null,
      reload: loadMe,
    }),
    [loading, teacher, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
