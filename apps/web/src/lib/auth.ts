import { config } from './config';
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

/** Kick off sign-in: stash a fresh verifier + state, redirect to the hosted UI. */
export async function startLogin(): Promise<void> {
  const verifier = createCodeVerifier();
  const state = createState();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
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

/** Forget the token. The Cognito hosted-UI session is separate (logout URL). */
export function signOut(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // sessionStorage unavailable — nothing to clear
  }
}
