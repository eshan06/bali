import { config, type WebConfig } from './config';
import { codeChallengeFor, createCodeVerifier, createState } from './pkce';

/**
 * The Cognito hosted-UI authorization-code flow with PKCE, client-side. Tokens
 * live in sessionStorage (per tab), and the API is called with the ACCESS token
 * (auth decision 2 verifies its client_id). Browser-only — imported from client
 * components.
 */

const VERIFIER_KEY = 'bali.pkce.verifier';
const STATE_KEY = 'bali.pkce.state';
const TOKEN_KEY = 'bali.access_token';
const SIGNED_OUT_KEY = 'bali.signed_out';

/** Kick off sign-in: stash a fresh verifier + state, redirect to the hosted UI. */
export async function startLogin(): Promise<void> {
  const verifier = createCodeVerifier();
  const state = createState();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.removeItem(SIGNED_OUT_KEY);
  const challenge = await codeChallengeFor(verifier);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.cognito.clientId,
    redirect_uri: config.cognito.redirectUri,
    scope: config.cognito.scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location.assign(`${config.cognito.domain}/oauth2/authorize?${params.toString()}`);
}

/** Finish sign-in from the callback query: verify state, exchange the code. */
export async function completeLogin(query: URLSearchParams): Promise<void> {
  const code = query.get('code');
  const state = query.get('state');
  const storedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!code || !state || state !== storedState || !verifier) {
    throw new Error('invalid sign-in callback');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.cognito.clientId,
    code,
    redirect_uri: config.cognito.redirectUri,
    code_verifier: verifier,
  });
  const res = await fetch(`${config.cognito.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error('token exchange failed');
  const tokens = (await res.json()) as { access_token: string };
  sessionStorage.setItem(TOKEN_KEY, tokens.access_token);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

/** The current access token, or null when signed out. Safe in any context. */
export function getAccessToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Forget the token. The Cognito hosted-UI session is separate: `endSession` ends both. */
export function signOut(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // sessionStorage unavailable — nothing to clear
  }
}

/** How the last Sign out went, for the sign-in page to say: both ended, or this tab's only. */
export type SignedOut = 'ended' | 'local';

/**
 * The hosted UI's `/logout`, which ends the Cognito session and returns to `/login` on the
 * redirect URI's origin: the sign-out URL registered on the web app client (docs/WEB.md). Null
 * when the portal has no hosted UI configured.
 */
export function logoutUrl(cognito: WebConfig['cognito'] = config.cognito): string | null {
  if (!cognito.domain || !cognito.clientId) return null;
  try {
    const params = new URLSearchParams({
      client_id: cognito.clientId,
      logout_uri: new URL('/login', cognito.redirectUri).toString(),
    });
    return `${cognito.domain}/logout?${params.toString()}`;
  } catch {
    return null;
  }
}

/**
 * Sign out (S4a): forget the token, then send the browser to the hosted UI's `/logout`, so the
 * next Sign in on a shared computer asks who it is instead of opening the last account. When it
 * can't be sent there, the token is still gone and the caller routes to /login, which says the
 * sign-in page may still remember the account. Returns which of the two it did.
 */
export function endSession(
  url: string | null = logoutUrl(),
  go: (to: string) => void = (to) => window.location.assign(to),
): SignedOut {
  signOut();
  if (url) {
    remember('ended');
    try {
      go(url);
      return 'ended';
    } catch {
      // fall through: signed out here only, and said so
    }
  }
  remember('local');
  return 'local';
}

function remember(said: SignedOut): void {
  try {
    sessionStorage.setItem(SIGNED_OUT_KEY, said);
  } catch {
    // sessionStorage unavailable — the sign-in page just says nothing
  }
}

/**
 * How the last Sign out in this tab went, until the next Sign in forgets it (`startLogin`): read,
 * never taken, so a page drawn twice (React's dev mode, a reload) still says it. Null for none.
 */
export function signedOut(): SignedOut | null {
  try {
    const said = sessionStorage.getItem(SIGNED_OUT_KEY);
    return said === 'ended' || said === 'local' ? said : null;
  } catch {
    return null;
  }
}
