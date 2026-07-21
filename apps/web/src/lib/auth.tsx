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
import { api, setTokenProvider, setUnauthorizedHandler } from './api';

/** Same Cognito pool/client/flows the legacy web client proved out. */
const poolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
const redirect = process.env.NEXT_PUBLIC_REDIRECT_URI ?? 'http://localhost:3000/auth/callback';

const DEV_TOKEN_KEY = 'bali.devToken';
// Dev-only auth bypass. Co-gated on NODE_ENV so a production build strips the button
// and the codepath even if NEXT_PUBLIC_ALLOW_DEV_TOKENS leaks in from a stray .env.local.
const devTokensAllowed =
  process.env.NEXT_PUBLIC_ALLOW_DEV_TOKENS === '1' && process.env.NODE_ENV !== 'production';

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
    // On a 401 from any authed request, drop the stale session. Only bounce to /login
    // from inside the portal — a stale token on a public page (landing, /p, /t) must
    // not yank the visitor away.
    let handling = false; // dedupe a burst of concurrent 401s into one teardown
    setUnauthorizedHandler(() => {
      if (handling) return;
      handling = true;
      if (devTokensAllowed) window.localStorage.removeItem(DEV_TOKEN_KEY);
      // Drop Amplify's cached session so the rejected token isn't re-sent on /login.
      void amplifySignOut().catch(() => {});
      setTeacher(null);
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/app')) {
        window.location.assign('/login');
      }
    });
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
