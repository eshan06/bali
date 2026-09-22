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
 * encoded or truncated in whatever way that layer prints. So that text is not
 * scrubbed; it is not used. Scrubbing has to know every place the password can
 * hide and every way it can be written down, and it did not.
 *
 * What this module throws is a plain Error whose message is built from:
 *   - its own fixed wording;
 *   - the caller's configuration: the username, the endpoint, the timeout;
 *   - the HTTP status, when it is an integer from 100 to 599;
 *   - TOKENS read from outside — the error codes on a failure and its causes,
 *     Cognito's error type, a challenge name, the response's media type —
 *     admitted by `token`: one of this module's own known words, unless it and
 *     the password contain one another, or an unknown identifier that repeats
 *     no four characters of the password;
 *   - two fixed messages of Node's fetch, recognised by exact match and never
 *     copied: a proxy refusing the tunnel (only its status is kept, on the same
 *     terms as a response's) and a refused redirect.
 * No error from outside is attached as its `cause`: an object can print
 * differently from the way it looked when it was checked, and a string cannot.
 * And a redirect is refused rather than followed, since following a 307 would
 * send the body — the password — to wherever it pointed.
 *
 * The boundary, stated rather than implied: this defends against the password
 * being ECHOED — quoted, escaped, truncated, case-changed, normalised, or with
 * separators swapped — by something downstream. It does not defend against a
 * party that deliberately encodes it into a token's alphabet (unpadded base32
 * is a valid error code); such a party already holds the password and has
 * better ways to publish it than a demo's transcript.
 *
 * The cost is every message and body from outside: Cognito's message text, a
 * proxy page, the fetch layer's own descriptions. The error type with fixed
 * words for the common ones, the status, the media type and the error codes
 * stand in for them. And whether a token is shown depends on the password: an
 * unknown one is withheld when it shares four consecutive characters with it,
 * a known word only when one of the two contains the other. A reader who could
 * guess the token learns that much.
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
 * The shapes an UNKNOWN token from outside must have. None of them has any
 * quoting or escape syntax, so there is nothing to decode: whatever a token
 * holds of the password, it holds in plain characters, where `token` sees it.
 */
/** An error code or a challenge name: `ENOTFOUND`, `NEW_PASSWORD_REQUIRED`. */
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
/** A Cognito error type: `NotAuthorizedException`. */
const ERROR_TYPE = /^[A-Z][A-Za-z0-9]{1,63}$/;
/** A media type without its parameters: `text/html`. */
const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]{0,62}\/[a-z0-9][a-z0-9.+-]{0,62}$/;

/*
 * Words this module knows, by exact match. When one of them prints, what
 * prints is this module's own word, the same text for every password, so they
 * are not held to the four-character rule that unknown tokens are: a password
 * with "tion" in it would otherwise hide every error type Cognito has. They are
 * held to a narrower one instead, `echoesKnownWord`.
 */
/** Error codes of Node's network, DNS and TLS layers, and of undici. */
const KNOWN_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'EPROTO',
  'UND_ERR_ABORTED',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_DESTROYED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_HEADERS_OVERFLOW',
  'UND_ERR_RESPONSE_STATUS_CODE',
  'UND_ERR_INFO',
  'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH',
  'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
  'UND_ERR_NOT_SUPPORTED',
  'UND_ERR_PRX_TLS',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_PACKET_LENGTH_TOO_LONG',
  'ERR_INVALID_URL',
]);
/** The error types InitiateAuth documents, and the AWS-wide ones it can return. */
const KNOWN_TYPES = new Set([
  'NotAuthorizedException',
  'InvalidParameterException',
  'ResourceNotFoundException',
  'UserNotFoundException',
  'UserNotConfirmedException',
  'PasswordResetRequiredException',
  'TooManyRequestsException',
  'InternalErrorException',
  'InvalidUserPoolConfigurationException',
  'InvalidLambdaResponseException',
  'UnexpectedLambdaException',
  'UserLambdaValidationException',
  'InvalidSmsRoleAccessPolicyException',
  'InvalidSmsRoleTrustRelationshipException',
  'InvalidEmailRoleAccessPolicyException',
  'ForbiddenException',
  'UnsupportedOperationException',
  'LimitExceededException',
  'AccessDeniedException',
  'ThrottlingException',
  'ValidationException',
  'SerializationException',
  'UnrecognizedClientException',
  'InternalFailure',
  'ServiceUnavailable',
]);
/** Cognito's ChallengeNameType. */
const KNOWN_CHALLENGES = new Set([
  'NEW_PASSWORD_REQUIRED',
  'SMS_MFA',
  'EMAIL_OTP',
  'SMS_OTP',
  'SOFTWARE_TOKEN_MFA',
  'SELECT_MFA_TYPE',
  'MFA_SETUP',
  'PASSWORD_VERIFIER',
  'CUSTOM_CHALLENGE',
  'SELECT_CHALLENGE',
  'DEVICE_SRP_AUTH',
  'DEVICE_PASSWORD_VERIFIER',
  'ADMIN_NO_SRP_AUTH',
  'PASSWORD',
  'PASSWORD_SRP',
  'WEB_AUTHN',
]);
/** Media types a Cognito endpoint, or something in front of it, answers with. */
const KNOWN_MEDIA_TYPES = new Set([
  'application/x-amz-json-1.1',
  'application/x-amz-json-1.0',
  'application/json',
  'text/html',
  'text/plain',
  'text/xml',
  'application/xml',
]);

/**
 * Text reduced to what survives the ways an echo can rewrite it: decomposed,
 * which folds compatibility forms (a fullwidth 'Ｓ' is 'S', a ligature its
 * letters) and splits accents off their letters; case folded by upper-casing —
 * the direction that merges the most: 'ß' and 'SS', 'ı' and 'i' and 'I'; and
 * then stripped of everything but letters and digits, in any script — the
 * split-off accents, and the separators, so an echo that swapped them for its
 * own compares equal.
 */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** An unknown token repeating this many consecutive characters of the password is withheld. */
const SHARED_RUN = 4;

/**
 * Does `value` repeat any run of SHARED_RUN characters of the password — the
 * whole of a shorter one — once both are folded? A truncated echo still prints
 * most of the password; an echo that changed its case, normalised it or swapped
 * its separators still prints it.
 */
function repeatsPassword(value: string, password: string): boolean {
  const text = fold(value);
  const secret = fold(password);
  const run = Math.min(SHARED_RUN, secret.length);
  for (let start = 0; start + run <= secret.length; start++) {
    if (text.includes(secret.slice(start, start + run))) return true;
  }
  return false;
}

/**
 * Could an echo of the password have produced this known word? Only if one is
 * a folded part of the other: the word cut out of a longer password
 * ('Bali#NotAuthorizedException' split at '#'), or a password that is itself
 * part of the word. Any other overlap is the word being what it is.
 */
function echoesKnownWord(word: string, password: string): boolean {
  const folded = fold(word);
  const secret = fold(password);
  return folded.includes(secret) || secret.includes(folded);
}

/**
 * The text to print for a token from outside, or undefined to withhold it.
 * Callers pass the text they will print — a fragment cut out of a longer value
 * is checked as the fragment, since that is what a reader would see.
 *
 * A known word is printed unless an echo of the password could have produced
 * it. An unknown value must have its channel's identifier shape — which keeps
 * out a body, a message, anything with a quote or a space in it — and must
 * repeat no run of four characters of the password: the shape cannot stop a
 * password that is itself identifier-shaped, whole or in part.
 */
function token(
  value: unknown,
  known: ReadonlySet<string>,
  shape: RegExp,
  password: string,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (known.has(value))
    return password !== '' && echoesKnownWord(value, password) ? undefined : value;
  if (!shape.test(value)) return undefined;
  return password !== '' && repeatsPassword(value, password) ? undefined : value;
}

/**
 * `node[key]`, or undefined when reading it throws. Every property of an
 * outside object is read through this or inside a try of its own: a getter or a
 * Proxy trap on a lookalike must never replace the operator's one actionable
 * line with an unrelated exception.
 */
function read(node: unknown, key: string): unknown {
  try {
    return (node as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** How many nodes of a failure's graph are looked at, at most. */
const MAX_NODES = 32;

/** undici's own words when an HTTPS proxy refuses the CONNECT for the tunnel. */
const PROXY_REFUSED = /^Proxy response \((\d{3})\) !== 200 when HTTP Tunneling$/;
/** undici's own words when `redirect: 'error'` meets a redirect. */
const REDIRECT_REFUSED = 'unexpected redirect';

/** What a fetch-layer failure's graph says, in forms that cannot quote anything. */
interface FailureFacts {
  /** Codes that `token` admitted, nearest first, without repeats. */
  codes: string[];
  /** The proxy's status, from an exact match of PROXY_REFUSED. */
  proxyStatus?: number;
  /** An exact match of REDIRECT_REFUSED somewhere in the graph. */
  redirected: boolean;
}

/**
 * Read a failure and everything under it, breadth first.
 *
 * Node's fetch reports every network failure as a bare `TypeError: fetch
 * failed` with the part worth reading on `cause` — and on an AggregateError's
 * `errors`, with an empty message, when a host's addresses all refuse — so the
 * whole graph is read: its codes, and its messages ONLY to compare them with
 * the two fixed messages above. No other text is kept.
 *
 * Bounded by MAX_NODES, and each node is visited once — which is also what ends
 * the walk on a graph that cycles. A node's properties are read through `read`,
 * and its members are copied out by index (`membersOf`), so no getter, Proxy
 * trap or iterator of its own runs outside a guard: a node that throws costs
 * what it would have said and nothing else.
 */
function examineFailure(err: unknown, password: string): FailureFacts {
  const facts: FailureFacts = { codes: [], redirected: false };
  const seen = new Set<unknown>();
  let level: unknown[] = [err];
  while (level.length > 0) {
    const next: unknown[] = [];
    for (const node of level) {
      if (seen.size >= MAX_NODES) break;
      if (node === null || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);

      const code = token(read(node, 'code'), KNOWN_CODES, CONSTANT_NAME, password);
      if (code !== undefined && !facts.codes.includes(code)) facts.codes.push(code);

      const message = read(node, 'message');
      if (typeof message === 'string') {
        const status = Number(PROXY_REFUSED.exec(message)?.[1]);
        if (status >= 100 && status <= 599) facts.proxyStatus ??= status;
        if (message === REDIRECT_REFUSED) facts.redirected = true;
      }

      next.push(read(node, 'cause'), ...membersOf(node));
    }
    level = next;
  }
  return facts;
}

/**
 * A node's `errors`, copied out by index when it is a real array (an
 * AggregateError's), else none. Copied rather than sliced or iterated: an
 * array can carry its own `slice`, a species constructor or an iterator, and
 * any of them would run outside code unguarded, whatever it returned.
 */
function membersOf(node: object): unknown[] {
  const members = read(node, 'errors');
  try {
    if (!Array.isArray(members)) return [];
  } catch {
    // A revoked Proxy throws from Array.isArray itself.
    return [];
  }
  const length = read(members, 'length');
  const count = typeof length === 'number' && length > 0 ? Math.min(length, MAX_NODES) : 0;
  const copy: unknown[] = [];
  for (let index = 0; index < count; index++) copy.push(read(members, String(index)));
  return copy;
}

/** Fixed words for the codes an operator most needs explained. */
const CODE_HINTS = new Map([
  ['ENOTFOUND', 'the host does not resolve — check the region'],
  [
    'UND_ERR_ABORTED',
    'the request was cancelled before an answer — most often an HTTPS proxy refusing the tunnel',
  ],
]);

/**
 * What an operator can act on in a failure from the fetch layer: its codes,
 * with fixed words for some. Whether there were codes that were not admitted is
 * not said — saying so would tell a reader that the password shares characters
 * with whatever code they guess was there.
 */
function describeFailure(facts: FailureFacts): string {
  if (facts.codes.length === 0) {
    return (
      "no error code that can be shown, and the fetch layer's own text is withheld — it can " +
      'quote the request, which holds the password'
    );
  }
  return facts.codes
    .map((code) => {
      const hint =
        code === 'UND_ERR_ABORTED' && facts.proxyStatus !== undefined
          ? `the HTTPS proxy refused the tunnel with HTTP ${facts.proxyStatus}`
          : CODE_HINTS.get(code);
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
    // With PreventUserExistenceErrors on (the console's default), a user that
    // does not exist is reported this way too.
    'a wrong username or password, a disabled or locked-out user, or an app client that ' +
      'requires a secret',
  ],
  [
    'InvalidParameterException',
    'most often, ALLOW_USER_PASSWORD_AUTH is not enabled on the app client, or the client ' +
      'id is malformed',
  ],
  ['ResourceNotFoundException', 'no app client with this id in this region'],
  ['UserNotFoundException', 'no such user in this pool'],
  ['UserNotConfirmedException', 'the user has not been confirmed'],
  ['PasswordResetRequiredException', 'the user must reset their password first'],
  ['TooManyRequestsException', 'Cognito is throttling sign-ins; wait, then re-run'],
]);

/**
 * Cognito's `__type` when the body carries one, without the namespace
 * (`ns#Name`) or the suffix (`Name:detail`) the AWS JSON protocols allow around
 * it. Not yet a token: the cut is what gets checked, since it is what prints.
 */
function errorTypeOf(text: string): string | undefined {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  const raw = read(body, '__type');
  if (typeof raw !== 'string') return undefined;
  return raw.split(':')[0]?.split('#').pop() ?? '';
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

/**
 * What an operator can act on in a response that was not a success: Cognito's
 * error type when one can be shown, otherwise the status and media type. As
 * with codes, a type that was withheld reads the same as one that was absent.
 */
function describeResponse(res: unknown, text: string, password: string): string {
  const status = read(res, 'status');
  const statusLine =
    typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? `HTTP ${status}`
      : 'an invalid HTTP status';
  const type = token(errorTypeOf(text), KNOWN_TYPES, ERROR_TYPE, password);
  if (type !== undefined) {
    const hint = TYPE_HINTS.get(type);
    return hint === undefined ? `${type} (${statusLine})` : `${type} (${statusLine}): ${hint}`;
  }
  const media = token(mediaTypeOf(res), KNOWN_MEDIA_TYPES, MEDIA_TYPE, password);
  return (
    `${statusLine}${media === undefined ? '' : ` (${media})`}, with no Cognito error type ` +
    'that can be shown' +
    (text === ''
      ? ' and an empty body'
      : '; its body is withheld, since a proxy can quote the request it refused')
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
 *   - a Cognito error (bad credentials, flow not enabled) reports its type when
 *     `token` admits it — always for a known type, unless it and the password
 *     contain one another — and otherwise its status and media type;
 *   - a network failure reports its error codes on the same terms, a timeout
 *     reports itself, and a refused redirect says so;
 *   - a challenge (NEW_PASSWORD_REQUIRED, MFA) is a failure, named when `token`
 *     admits its name, because an unfinished sign-in yields no token and needs
 *     an operator, not a retry;
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
      // A 307 or 308 would re-send this body, password and all, to wherever it
      // pointed. Cognito never redirects, so a redirect is refused.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Only a timeout is reported as one: a mistyped region fails DNS instantly,
    // and telling the operator to look at Cognito's latency would point them
    // away from the thing they actually got wrong.
    //
    // The caught error is not attached; the header says why. Its codes are in
    // the message, which is what an operator acts on.
    const facts = examineFailure(err, password);
    // eslint-disable-next-line preserve-caught-error -- deliberately not attached, see above
    throw new Error(
      isTimeout(err)
        ? `Cognito sign-in for ${username} did not answer within ${timeoutMs}ms (${endpoint})`
        : facts.redirected
          ? `Cognito sign-in for ${username} got a redirect from ${endpoint}, refused so the ` +
            'password is not sent on'
          : `Cognito sign-in for ${username} could not reach ${endpoint}: ` +
            describeFailure(facts),
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
            describeFailure(examineFailure(err, password)),
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
    const challenge = token(body.ChallengeName, KNOWN_CHALLENGES, CONSTANT_NAME, password);
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
