/*
 * The exit demo's token source when it runs against a deployed API: a real
 * Cognito sign-in, exactly as a phone does it.
 *
 * USER_PASSWORD_AUTH is an *unauthenticated* Cognito call — it takes the app
 * client id (public, like the portal's PKCE client) and the user's own
 * credentials, never an AWS key — so the demo needs no SDK, no IAM role, and no
 * signing code: one POST, one access token. The pool's app client must have
 * ALLOW_USER_PASSWORD_AUTH enabled; that is the one AWS-side prerequisite.
 *
 * Nothing here ever logs or returns a password: a failure reports Cognito's own
 * error type and message, which name the problem without echoing the secret.
 */

/** Cognito's JSON-1.1 error shape, as far as we read it. */
interface CognitoError {
  __type?: string;
  message?: string;
  Message?: string;
}

interface InitiateAuthResponse {
  AuthenticationResult?: { AccessToken?: string };
  ChallengeName?: string;
}

export interface CognitoAuthConfig {
  /** The pool's region, e.g. `us-east-1`. */
  region: string;
  /** The app client id — the same value the API validates as AUTH_AUDIENCE. */
  clientId: string;
  /** Injection point for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface CognitoCredentials {
  username: string;
  password: string;
}

/** The endpoint for a region — exported so callers can report what they called. */
export function cognitoEndpoint(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

function describeError(status: number, body: string): string {
  let parsed: CognitoError | null = null;
  try {
    parsed = JSON.parse(body) as CognitoError;
  } catch {
    // Not JSON — fall through and report the raw body below.
  }
  const type = parsed?.__type;
  const message = parsed?.message ?? parsed?.Message;
  if (type ?? message) return `${type ?? 'error'}: ${message ?? '(no message)'}`;
  return `HTTP ${status}: ${body.slice(0, 200)}`;
}

/**
 * Sign one test user in and return their access token.
 *
 * Throws with an actionable message on every failure path, so a misconfigured
 * pool fails the demo loudly rather than producing a token-shaped nothing:
 *   - a Cognito error (bad credentials, flow not enabled) reports its own type;
 *   - a challenge (NEW_PASSWORD_REQUIRED, MFA) names the challenge, because an
 *     unfinished sign-in yields no token and needs an operator, not a retry;
 *   - a 200 with no AccessToken is treated as a failure, never as an empty token.
 */
export async function fetchCognitoAccessToken(
  config: CognitoAuthConfig,
  credentials: CognitoCredentials,
): Promise<string> {
  const doFetch = config.fetchImpl ?? fetch;
  const res = await doFetch(cognitoEndpoint(config.region), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.clientId,
      AuthParameters: { USERNAME: credentials.username, PASSWORD: credentials.password },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Cognito sign-in failed for ${credentials.username} — ${describeError(res.status, text)}`,
    );
  }

  let body: InitiateAuthResponse;
  try {
    body = JSON.parse(text) as InitiateAuthResponse;
  } catch {
    throw new Error(`Cognito sign-in for ${credentials.username} returned non-JSON body`);
  }

  if (body.ChallengeName) {
    throw new Error(
      `Cognito sign-in for ${credentials.username} needs challenge ${body.ChallengeName} — ` +
        'finish it once in the AWS console (a temporary password must be reset before the ' +
        'account can be used unattended), then re-run.',
    );
  }

  const token = body.AuthenticationResult?.AccessToken;
  if (!token) {
    throw new Error(`Cognito sign-in for ${credentials.username} returned no access token`);
  }
  return token;
}
