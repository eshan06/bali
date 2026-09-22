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
 * The password leaves this module in one place, the request body, and
 * everything that comes back has been downstream of it. Cognito's validation
 * messages quote request values back ("Value 'x' at 'clientId' failed to
 * satisfy constraint"), a proxy or WAF page can quote the request it refused,
 * and a fetch wrapper can hang the request off the error it raises — escaped,
 * encoded or truncated in whatever way that layer prints. So none of that text
 * is used at all, rather than scrubbed: scrubbing has to know every place the
 * password can hide and every way it can be written down, and it did not.
 *
 * What this module throws is a plain Error built only from:
 *   - its own fixed wording;
 *   - the caller's configuration: the username, the endpoint, the timeout;
 *   - TOKENS read from outside — the HTTP status, the error codes on a failure
 *     and its causes, Cognito's error type, a challenge name, the response's
 *     media type — each accepted only in a strict identifier shape and only
 *     when it does not contain the password (see `token`).
 * No error from outside is attached as its `cause`: an object can print
 * differently from the way it looked when it was checked, and a string cannot.
 *
 * The boundary, stated rather than implied: this defends against the password
 * being ECHOED — quoted, escaped, truncated — by something downstream. It does
 * not defend against a party that deliberately encodes it into a token's
 * alphabet (unpadded base32 is a valid error code); such a party already holds
 * the password and has better ways to publish it than a demo's transcript.
 *
 * The cost is Cognito's message text and a proxy page's body. The error type,
 * with fixed words for the common ones, stands in for the first; the status and
 * media type for the second.
 */

/** The fields of InitiateAuth's answer that are read. */
interface InitiateAuthResponse {
  AuthenticationResult?: { AccessToken?: unknown };
  ChallengeName?: unknown;
}

export interface CognitoAuthConfig {
  /** The pool's region, e.g. `us-east-1`. */
  region: string;
  /** The app client id — the same value the API validates as AUTH_AUDIENCE. */
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

/*
 * The shapes a token from outside must have. None of them has any quoting or
 * escape syntax, so there is nothing to decode: a token that held the password
 * would hold it in plain characters, where the containment check sees it.
 */
/** An error code or a challenge name: `ENOTFOUND`, `NEW_PASSWORD_REQUIRED`. */
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
/** A Cognito error type: `NotAuthorizedException`. */
const ERROR_TYPE = /^[A-Z][A-Za-z0-9]{1,63}$/;
/** A media type without its parameters: `text/html`. */
const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]{0,62}\/[a-z0-9][a-z0-9.+-]{0,62}$/;

/**
 * `value` when it is a string of the expected shape that does not contain the
 * password; otherwise undefined.
 *
 * The shape keeps out everything that is not an identifier — a body, a
 * message, anything with a quote or a space in it. The containment check covers
 * what the shape cannot: a password that is itself identifier-shaped fits as
 * easily as a real code. It compares in both cases, because an echo that
 * changed the password's case still prints it.
 */
function token(value: unknown, shape: RegExp, password: string): string | undefined {
  if (typeof value !== 'string' || !shape.test(value)) return undefined;
  if (password === '') return value;
  const echoed =
    value.toLowerCase().includes(password.toLowerCase()) ||
    value.toUpperCase().includes(password.toUpperCase());
  return echoed ? undefined : value;
}

/**
 * `node[key]`, or undefined when reading it throws. Everything read from outside
 * goes through this: a getter or a Proxy trap on a lookalike must never replace
 * the operator's one actionable line with an unrelated exception.
 */
function read(node: unknown, key: string): unknown {
  try {
    return (node as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** How far below a failure its codes are looked for, and how many nodes at most. */
const MAX_DEPTH = 4;
const MAX_NODES = 32;

/**
 * The error codes on a failure and on everything under it, nearest first,
 * without repeats: `ENOTFOUND`, `ECONNREFUSED`, `UND_ERR_SOCKET`.
 *
 * Node's fetch reports every network failure as a bare `TypeError: fetch
 * failed` with the part worth reading on `cause` — and on an AggregateError's
 * `errors`, with an empty message, when a host's addresses all refuse — so the
 * codes are gathered from that whole graph, breadth first. The messages beside
 * them are never read. The walk is bounded and every read guarded, so a graph
 * that cycles, or a node that throws, costs its own codes and nothing else.
 */
function errorCodes(err: unknown, password: string): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let level: unknown[] = [err];
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (node === null || typeof node !== 'object' || seen.has(node)) continue;
      if (seen.size >= MAX_NODES) break;
      seen.add(node);
      const code = token(read(node, 'code'), CONSTANT_NAME, password);
      if (code !== undefined && !codes.includes(code)) codes.push(code);
      next.push(read(node, 'cause'), ...membersOf(node));
    }
    level = next;
  }
  return codes;
}

/** A node's `errors` when it is a real array (an AggregateError's), else none. */
function membersOf(node: object): unknown[] {
  const members = read(node, 'errors');
  try {
    return Array.isArray(members) ? members.slice(0, MAX_NODES) : [];
  } catch {
    // A revoked Proxy throws from Array.isArray itself.
    return [];
  }
}

/** Fixed words for the codes an operator most needs explained. */
const CODE_HINTS = new Map([['ENOTFOUND', 'the host does not resolve — check the region']]);

/** What an operator can act on in a failure from the fetch layer. */
function describeFailure(err: unknown, password: string): string {
  const codes = errorCodes(err, password);
  if (codes.length === 0) {
    return (
      "no error code, and the fetch layer's own text is withheld — it can quote the " +
      'request, which holds the password'
    );
  }
  return codes
    .map((code) => {
      const hint = CODE_HINTS.get(code);
      return hint === undefined ? code : `${code} (${hint})`;
    })
    .join(', ');
}

/** `AbortSignal.timeout` rejects with a DOMException named TimeoutError, headers or body. */
function isTimeout(err: unknown): boolean {
  return read(err, 'name') === 'TimeoutError';
}

/** Fixed words for the Cognito error types an operator is most likely to meet. */
const TYPE_HINTS = new Map([
  [
    'NotAuthorizedException',
    'a wrong password, a disabled or locked-out user, or an app client that requires a secret',
  ],
  [
    'InvalidParameterException',
    'most often, ALLOW_USER_PASSWORD_AUTH is not enabled on the app client',
  ],
  ['ResourceNotFoundException', 'no app client with this id in this region'],
  ['UserNotFoundException', 'no such user in this pool'],
  ['UserNotConfirmedException', 'the user has not been confirmed'],
  ['PasswordResetRequiredException', 'the user must reset their password first'],
  ['TooManyRequestsException', 'Cognito is throttling sign-ins; wait, then re-run'],
]);

/**
 * Cognito's `__type`, without the namespace (`ns#Name`) or the suffix
 * (`Name:detail`) the AWS JSON protocols allow around it. Not yet a token.
 */
function errorTypeOf(text: string): unknown {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  const raw = read(body, '__type');
  if (typeof raw !== 'string') return undefined;
  return raw.split(':')[0]?.split('#').pop();
}

/** The response's media type, lowercased and without parameters. Not yet a token. */
function mediaTypeOf(res: unknown): unknown {
  try {
    const value = (read(res, 'headers') as Headers | undefined)?.get('content-type');
    return typeof value === 'string' ? value.split(';')[0]?.trim().toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/** What an operator can act on in a response that was not a success. */
function describeResponse(res: unknown, text: string, password: string): string {
  const status = read(res, 'status');
  const statusLine =
    typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? `HTTP ${status}`
      : 'an invalid HTTP status';
  const type = token(errorTypeOf(text), ERROR_TYPE, password);
  if (type !== undefined) {
    const hint = TYPE_HINTS.get(type);
    return hint === undefined ? `${type} (${statusLine})` : `${type} (${statusLine}): ${hint}`;
  }
  const media = token(mediaTypeOf(res), MEDIA_TYPE, password);
  return (
    `${statusLine}${media === undefined ? '' : ` (${media})`}, not a Cognito error; ` +
    'its body is withheld, since a proxy can quote the request it refused'
  );
}

/** The endpoint for a region — exported so callers can report what they called. */
export function cognitoEndpoint(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

/**
 * Sign one test user in and return their access token.
 *
 * Throws with an actionable message on every failure path, so a misconfigured
 * pool fails the demo loudly rather than producing a token-shaped nothing:
 *   - a Cognito error (bad credentials, flow not enabled) reports its type;
 *   - a network failure reports its error codes, and a timeout reports itself;
 *   - a challenge (NEW_PASSWORD_REQUIRED, MFA) names the challenge, because an
 *     unfinished sign-in yields no token and needs an operator, not a retry;
 *   - a 200 without a string AccessToken is a failure, never an empty token.
 */
export async function fetchCognitoAccessToken(
  config: CognitoAuthConfig,
  credentials: CognitoCredentials,
): Promise<string> {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 30_000;
  const { username, password } = credentials;
  const endpoint = cognitoEndpoint(config.region);

  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      },
      body: JSON.stringify({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: config.clientId,
        AuthParameters: { USERNAME: username, PASSWORD: password },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Only a timeout is reported as one: a mistyped region fails DNS instantly,
    // and telling the operator to look at Cognito's latency would point them
    // away from the thing they actually got wrong.
    //
    // The caught error is not attached; the header says why. Its codes are in
    // the message, which is what an operator acts on.
    // eslint-disable-next-line preserve-caught-error -- deliberately not attached, see above
    throw new Error(
      isTimeout(err)
        ? `Cognito sign-in for ${username} did not answer within ${timeoutMs}ms (${endpoint})`
        : `Cognito sign-in for ${username} could not reach ${endpoint}: ` +
            describeFailure(err, password),
    );
  }

  // Reading the body can fail on its own: undici rejects it with `TypeError:
  // terminated` when a response is cut short, and the deadline above still
  // applies while it streams.
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    // eslint-disable-next-line preserve-caught-error -- deliberately not attached, as above
    throw new Error(
      isTimeout(err)
        ? `Cognito sign-in for ${username} did not finish answering within ${timeoutMs}ms ` +
            `(${endpoint})`
        : `Cognito sign-in for ${username} could not read the response from ${endpoint}: ` +
            describeFailure(err, password),
    );
  }

  if (read(res, 'ok') !== true) {
    throw new Error(
      `Cognito sign-in failed for ${username} — ${describeResponse(res, text, password)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Cognito sign-in for ${username} returned non-JSON body`);
  }
  // A JSON `null` carries no token, and reading a field off it would throw a
  // TypeError that names no request at all.
  const body: InitiateAuthResponse = typeof parsed === 'object' && parsed !== null ? parsed : {};

  if (body.ChallengeName) {
    const challenge = token(body.ChallengeName, CONSTANT_NAME, password);
    throw new Error(
      `Cognito sign-in for ${username} needs ` +
        (challenge === undefined
          ? 'a challenge (its name is withheld)'
          : `challenge ${challenge}`) +
        ' — finish it once in the AWS console (a temporary password must be reset before the ' +
        'account can be used unattended), then re-run.',
    );
  }

  const accessToken = body.AuthenticationResult?.AccessToken;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new Error(`Cognito sign-in for ${username} returned no access token`);
  }
  return accessToken;
}
