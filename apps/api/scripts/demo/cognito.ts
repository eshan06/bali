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
 * encoded, truncated or transliterated in whatever way that layer prints. So no
 * text that comes back is copied into what this module throws, and none of it
 * is compared with the password either: every earlier attempt to recognise an
 * echo of the password, by scrubbing it out or by checking what looked like it,
 * missed some way an echo can be written.
 *
 * What this module throws is a plain Error whose message is built from:
 *   - its own fixed wording;
 *   - the caller's configuration: the username, the endpoint, the timeout;
 *   - the HTTP status, when it is an integer from 100 to 599;
 *   - WORDS OF ITS OWN, chosen by what came back: an error code on a failure
 *     or its causes, Cognito's error type, a challenge name or the response's
 *     media type that is exactly one of the words in `KNOWN_WORDS` selects that
 *     word. Anything else is said to be unrecognised, and is not printed;
 *   - two fixed messages of Node's fetch, recognised by exact match and never
 *     copied: a proxy refusing the tunnel (only its status is kept, on the same
 *     terms as a response's) and a refused redirect.
 * The password is used in the request body and nowhere else. No error from
 * outside is attached as its `cause`: an object can print differently from the
 * way it looked when it was read, and a string cannot. And a redirect is
 * refused rather than followed, since following a 307 would send the body — the
 * password — to wherever it pointed.
 *
 * What a message can still tell a reader about what came back, stated rather
 * than implied: which of this module's fixed outcomes happened, which of its
 * words came back, and the status numbers. Every character of it is this
 * module's own, the caller's configuration, or one of those numbers. If
 * something echoes the password into a field a word is read from, and the
 * echo, read the way that field is read, is exactly one of the words, that
 * word prints: the same text a genuine answer prints, whatever the password
 * is.
 *
 * The cost is every message and body from outside — Cognito's message text, a
 * proxy page, the fetch layer's own descriptions — and the name of any code,
 * type or challenge that is not in the lists. The error type with fixed words
 * for the common ones, the status, the media type and the error codes stand in.
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
 * The words this module can print for what came back. Each is chosen by an
 * exact match: a value that differs in any way — case, spacing, one character
 * more or less — is unrecognised, and is not printed.
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
  'UND_ERR_ABORT',
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
  'UND_ERR_RESPONSE',
  'UND_ERR_RES_EXCEEDED_MAX_SIZE',
  'UND_ERR_REQ_RETRY',
  'UND_ERR_INVALID_ARG',
  'ABORT_ERR',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
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

/** Every word the module can print for a value from outside, by the field it is read from. */
export const KNOWN_WORDS: Readonly<
  Record<'codes' | 'types' | 'challenges' | 'mediaTypes', ReadonlySet<string>>
> = {
  codes: KNOWN_CODES,
  types: KNOWN_TYPES,
  challenges: KNOWN_CHALLENGES,
  mediaTypes: KNOWN_MEDIA_TYPES,
};

/** `value` when it is exactly one of `words`; undefined for anything else. */
function recognised(value: unknown, words: ReadonlySet<string>): string | undefined {
  return typeof value === 'string' && words.has(value) ? value : undefined;
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
  /** Codes in KNOWN_CODES, nearest first, without repeats. */
  codes: string[];
  /** A code that was a string but not in KNOWN_CODES; it is not printed. */
  unrecognised: boolean;
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
function examineFailure(err: unknown): FailureFacts {
  const facts: FailureFacts = { codes: [], unrecognised: false, redirected: false };
  const seen = new Set<unknown>();
  let level: unknown[] = [err];
  while (level.length > 0) {
    const next: unknown[] = [];
    for (const node of level) {
      if (seen.size >= MAX_NODES) break;
      if (node === null || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);

      const raw = read(node, 'code');
      const code = recognised(raw, KNOWN_CODES);
      if (code === undefined) facts.unrecognised ||= typeof raw === 'string';
      else if (!facts.codes.includes(code)) facts.codes.push(code);

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
 * with fixed words for some, and whether it also carried a code this module
 * does not know. When none of its codes is known, why nothing more is said is
 * said too.
 */
function describeFailure(facts: FailureFacts): string {
  const said = facts.codes.map((code) => {
    const hint =
      code === 'UND_ERR_ABORTED' && facts.proxyStatus !== undefined
        ? `the HTTPS proxy refused the tunnel with HTTP ${facts.proxyStatus}`
        : CODE_HINTS.get(code);
    return hint === undefined ? code : `${code} (${hint})`;
  });
  if (facts.unrecognised) said.push('an error code this module does not recognise');
  if (facts.codes.length > 0) return said.join(', ');
  return (
    `${said[0] ?? 'no error code'}, and the fetch layer's own text is withheld — it can quote ` +
    'the request, which holds the password'
  );
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
 * Cognito's `__type` when the body carries a non-empty one, without the
 * namespace (`ns#Name`) or the suffix (`Name:detail`) the AWS JSON protocols
 * allow around it. Only compared with KNOWN_TYPES, never printed.
 */
function errorTypeOf(text: string): string | undefined {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  const raw = read(body, '__type');
  if (typeof raw !== 'string' || raw === '') return undefined;
  return raw.split(':')[0]?.split('#').pop() ?? '';
}

/** The response's media type, lowercased and without parameters. Only compared, never printed. */
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
 * error type when it is a known one, otherwise the status, the media type when
 * it is a known one, and whether the body named an error type at all.
 */
function describeResponse(res: unknown, text: string): string {
  const status = read(res, 'status');
  const statusLine =
    typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? `HTTP ${status}`
      : 'an invalid HTTP status';
  const named = errorTypeOf(text);
  const type = recognised(named, KNOWN_TYPES);
  if (type !== undefined) {
    const hint = TYPE_HINTS.get(type);
    return hint === undefined ? `${type} (${statusLine})` : `${type} (${statusLine}): ${hint}`;
  }
  const media = recognised(mediaTypeOf(res), KNOWN_MEDIA_TYPES);
  return (
    `${statusLine}${media === undefined ? '' : ` (${media})`}, ` +
    (named === undefined
      ? 'with no Cognito error type'
      : 'with an error type this module does not recognise') +
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
 *   - a Cognito error (bad credentials, flow not enabled) reports its type
 *     when it is a known one, and otherwise its status and media type;
 *   - a network failure reports its known error codes, a timeout reports
 *     itself, and a refused redirect says so;
 *   - a challenge (NEW_PASSWORD_REQUIRED, MFA) is a failure, named when it is a
 *     known one, because an unfinished sign-in yields no token and needs an
 *     operator, not a retry;
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
    const facts = examineFailure(err);
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
            describeFailure(examineFailure(err)),
    );
  }

  if (read(res, 'ok') !== true) {
    throw new Error(`Cognito sign-in failed for ${username} — ${describeResponse(res, text)}`);
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
    const challenge = recognised(body.ChallengeName, KNOWN_CHALLENGES);
    throw new Error(
      `Cognito sign-in for ${username} needs ` +
        (challenge === undefined
          ? 'a challenge this module does not recognise'
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
