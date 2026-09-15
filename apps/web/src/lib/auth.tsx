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
import { Button } from '@/components/bali/Button';
import { ApiError, api, setTokenProvider, setUnauthorizedHandler } from './api';

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

/** Drop a Cognito session the app isn't using: Amplify's signIn and signInWithRedirect
 *  both throw UserAlreadyAuthenticatedException while one exists, which would make /login
 *  reject the teacher's correct password. */
async function clearStaleSession(): Promise<void> {
  try {
    await getCurrentUser();
    await amplifySignOut();
  } catch {
    /* nothing signed in */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [teacher, setTeacher] = useState<MeTeacher | null>(null);
  /** Set when /me failed for a reason other than 401 — the session is still good, we just
   *  couldn't reach the API. Distinct from `teacher === null` ("not signed in"). */
  const [authError, setAuthError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

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
    setAuthError(null);
  }, []);

  // A 401 is torn down centrally by the unauthorized handler (it signs Amplify out and
  // bounces). Anything else means the API was unreachable, not that the session is gone —
  // nulling the teacher there would redirect to a /login that still holds a valid Cognito
  // session and so refuses the correct password. Hold a retryable error instead.
  const onLoadFailure = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) return;
    setAuthError(err instanceof Error ? err.message : 'Couldn’t reach the server.');
  }, []);

  useEffect(() => {
    configureAmplify();
    setTokenProvider(cognitoToken);
    loadMe()
      .catch(onLoadFailure)
      .finally(() => setLoading(false));
  }, [loadMe, onLoadFailure]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      teacher,
      signInWithPassword: async (email, password) => {
        configureAmplify();
        // Signed in to Cognito but not to Bali (a transient /me failure, a non-teacher
        // account): clear that session first or Amplify rejects the sign-in outright.
        if (!teacher) await clearStaleSession();
        await amplifySignIn({ username: email, password });
        await loadMe();
      },
      signInWithGoogle: async () => {
        configureAmplify();
        if (!teacher) await clearStaleSession();
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

  // Inside the portal, a reachability failure gets its own retry surface: rendering the
  // children would let AppShell see `teacher === null` and bounce to /login. Public pages
  // (landing, /p, /t) must never be yanked away by it.
  const blocked =
    !!authError && typeof window !== 'undefined' && window.location.pathname.startsWith('/app');

  const retry = () => {
    setRetrying(true);
    loadMe()
      .catch(onLoadFailure)
      .finally(() => setRetrying(false));
  };

  return (
    <AuthContext.Provider value={value}>
      {blocked ? (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="text-[15px] font-semibold leading-5">Couldn’t reach Bali</div>
          <div className="max-w-[360px] text-[13px] leading-[18px] text-ink-tertiary">
            {authError} You’re still signed in — this is a connection problem.
          </div>
          <Button type="button" variant="secondary" size="sm" loading={retrying} onClick={retry}>
            Try again
          </Button>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
