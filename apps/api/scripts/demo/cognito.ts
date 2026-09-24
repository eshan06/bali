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
  /** The app client id — one of those the API accepts (AUTH_AUDIENCE). */
  clientId: string;
  /** Injection point for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** A stalled sign-in must name Cognito, not sit on undici's 300s default. */
  timeoutMs?: number;
}

export interface CognitoCredentials {
  username: string;
  password: string;
}

/**
 * The readable detail of a failure, cause chain included. Node's fetch reports
 * every network error as a bare `TypeError: fetch failed` and puts the part
 * worth reading — ENOTFOUND, ECONNREFUSED, a TLS message — on `err.cause`, so
 * the top-level message alone says nothing an operator can act on.
 */
function detailOf(err: unknown): string {
  const found: string[] = [];
  const visited = new Set<unknown>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 4 || !(node instanceof Error) || visited.has(node)) return;
    visited.add(node);
    const message = node.message.trim();
    if (message && !found.includes(message)) found.push(message);
    // A host resolving to several addresses that all refuse the connection
    // arrives as an AggregateError whose own message is EMPTY, with the real
    // per-address failures on `errors` — walking `cause` alone would report
    // "fetch failed" and nothing else, which is what this function exists to
    // stop.
    if (node instanceof AggregateError) {
      for (const inner of node.errors) visit(inner, depth + 1);
    }
    visit(node.cause, depth + 1);
  };
  visit(err, 0);
  return found.length > 0 ? found.join(' — ') : String(err);
}

/**
 * Remove a secret from text that is about to be thrown or printed — in both the
 * raw form and the JSON-escaped one, since a client that echoes the request body
 * quotes it, and a password containing `"` or `\` would otherwise sail straight
 * through an exact-substring match.
 */
function redact(text: string, secret: string): string {
  if (!secret) return text;
  let out = text.split(secret).join('<redacted>');
  const escaped = JSON.stringify(secret).slice(1, -1);
  if (escaped !== secret) out = out.split(escaped).join('<redacted>');
  return out;
}

/**
 * Scrub a secret out of a caught error and its whole cause chain, in place.
 *
 * Redacting only the message we throw is not enough: the caught error rides
 * along as `cause`, and Node prints the entire chain whenever an error is
 * inspected — which is exactly what the demo's top-level handler does — so the
 * secret would land in the transcript one line below the redacted copy.
 * Scrubbing the objects themselves also covers anything else that inspects them
 * later, and keeps the real error attached as the cause rather than a
 * lookalike.
 */
function redactInPlace(err: unknown, secret: string): void {
  const visited = new Set<object>();
  const scrub = (node: unknown, depth: number): void => {
    if (depth > 4 || node === null || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);

    if (node instanceof Error) {
      try {
        node.message = redact(node.message, secret);
      } catch {
        // A frozen error cannot be scrubbed; the message we throw is redacted
        // regardless, and there is nothing else useful to do here.
      }
      if (node instanceof AggregateError) {
        for (const inner of node.errors) scrub(inner, depth + 1);
      }
      scrub(node.cause, depth + 1);
    }

    // Messages are not the only thing printed: inspecting an error prints its
    // enumerable own properties too, so a client that hangs the request body
    // off the error puts the secret there rather than in any message.
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        try {
          (node as Record<string, unknown>)[key] = redact(value, secret);
        } catch {
          // Frozen, as above.
        }
      } else {
        scrub(value, depth + 1);
      }
    }
  };
  scrub(err, 0);
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
  const timeoutMs = config.timeoutMs ?? 30_000;
  let res: Response;
  try {
    res = await doFetch(cognitoEndpoint(config.region), {
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
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Before anything else: the fetch layer's error may quote the request body,
    // so scrub the secret out of it and its causes while it is still ours.
    redactInPlace(err, credentials.password);
    // Only a timeout is reported as one: a mistyped region fails DNS instantly,
    // and telling the operator to look at Cognito's latency would point them
    // away from the thing they actually got wrong.
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(
        `Cognito sign-in for ${credentials.username} did not answer within ${timeoutMs}ms ` +
          `(${cognitoEndpoint(config.region)})`,
        { cause: err },
      );
    }
    // The detail comes from the fetch layer, so redact before interpolating:
    // this module promises a password never leaves it, and an interceptor or a
    // future client that echoed the request body would otherwise put
    // DEMO_PASSWORD straight into a CI transcript. Structural, not incidental.
    const detail = detailOf(err);
    throw new Error(
      `Cognito sign-in for ${credentials.username} could not reach ` +
        `${cognitoEndpoint(config.region)}: ${redact(detail, credentials.password)}`,
      { cause: err },
    );
  }

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
