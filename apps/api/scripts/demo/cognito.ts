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
  /** A stalled sign-in must name Cognito, not sit on undici's 300s default. */
  timeoutMs?: number;
}

export interface CognitoCredentials {
  username: string;
  password: string;
}

/** How many hops from the thrown error either walk below is willing to take. */
const MAX_WALK_DEPTH = 4;

/**
 * The memo both walks share: "have we already covered this node with at least
 * this much budget left?"
 *
 * Remembering only *that* a node was seen is not enough when the walk is also
 * depth-bounded. A node reached first at the bottom of the budget is explored
 * with nothing left for its children; a plain seen-set then turns that
 * truncated visit into the final word, so a later, shallower path to the same
 * node — which did have the budget — returns early and its children are never
 * covered. Error graphs from undici share nodes routinely, so this is the
 * ordinary case, not an exotic one. Keying on the shallowest depth seen fixes
 * it and still terminates: a cycle re-enters strictly deeper and is refused,
 * and any node can be re-walked at most MAX_WALK_DEPTH times.
 */
function newVisitMemo(): (node: object, depth: number) => boolean {
  const shallowest = new Map<object, number>();
  return (node: object, depth: number): boolean => {
    const before = shallowest.get(node);
    if (before !== undefined && before <= depth) return false;
    shallowest.set(node, depth);
    return true;
  };
}

/**
 * An AggregateError's members, or nothing at all.
 *
 * `errors` is an ordinary writable own property, so a lookalike or a subclass
 * can leave it non-iterable or behind a getter that throws. Both walks run from
 * inside the `catch` that produces this module's one actionable message, so a
 * throw here would replace "could not reach cognito-idp…: ENOTFOUND" with an
 * unrelated exception — the operator loses the only line that names their
 * mistake. Returning nothing is always better than that.
 */
function membersOf(err: Error): unknown[] {
  if (!(err instanceof AggregateError)) return [];
  try {
    return Array.isArray(err.errors) ? err.errors : [];
  } catch {
    return [];
  }
}

/**
 * An error's cause, or nothing when reading it throws. `cause` is an ordinary
 * own property too, so it is exactly as forgeable as `errors` above — and
 * `detailOf` runs with no net under it.
 */
function causeOf(err: Error): unknown {
  try {
    return err.cause;
  } catch {
    return undefined;
  }
}

/** An error's message when it is readable, '' when reading it throws or it is not a string. */
function messageOf(err: Error): string {
  try {
    return typeof err.message === 'string' ? err.message.trim() : '';
  } catch {
    return '';
  }
}

/**
 * The readable detail of a failure, cause chain included. Node's fetch reports
 * every network error as a bare `TypeError: fetch failed` and puts the part
 * worth reading — ENOTFOUND, ECONNREFUSED, a TLS message — on `err.cause`, so
 * the top-level message alone says nothing an operator can act on.
 */
function detailOf(err: unknown): string {
  const found: string[] = [];
  const shouldVisit = newVisitMemo();
  const visit = (node: unknown, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || !(node instanceof Error) || !shouldVisit(node, depth)) return;
    const message = messageOf(node);
    if (message && !found.includes(message)) found.push(message);
    // A host resolving to several addresses that all refuse the connection
    // arrives as an AggregateError whose own message is EMPTY, with the real
    // per-address failures on `errors` — walking `cause` alone would report
    // "fetch failed" and nothing else, which is what this function exists to
    // stop.
    for (const inner of membersOf(node)) visit(inner, depth + 1);
    visit(causeOf(node), depth + 1);
  };
  visit(err, 0);
  if (found.length > 0) return found.join(' — ');
  try {
    return String(err);
  } catch {
    // A `toString` that throws leaves nothing to report but the shape.
    return '(an error that cannot be printed)';
  }
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

/** An object's own enumerable keys, or none when even asking throws (a Proxy trap). */
function ownKeysOf(node: object): string[] {
  try {
    return Object.keys(node);
  } catch {
    return [];
  }
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
 *
 * What it covers, which is everything `util.inspect` prints as text: messages,
 * own enumerable properties, AggregateError members, and the contents of a Map
 * or a Set — inspect prints those in full, so a body parked in one is as
 * readable as any property.
 *
 * The deliberate boundary, stated rather than implied: a secret held as BYTES
 * (a Buffer or any other typed array) is not scrubbed. Inspect renders those as
 * hex rather than text, so the password does not appear in the transcript as
 * itself, and scanning every byte of every buffer on an error path would cost
 * far more than that is worth. Values only a throwing getter can produce are
 * skipped for the same reason they are guarded below: nothing we can rewrite.
 *
 * This function never throws. It runs from inside the `catch` that builds the
 * one message naming what the operator got wrong, and a scrubber that took that
 * message away would do more damage than the leak it prevents.
 */
function redactInPlace(err: unknown, secret: string): void {
  const shouldScrub = newVisitMemo();
  const scrub = (node: unknown, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || node === null || typeof node !== 'object') return;
    // Bytes, not text — the boundary named above. Walking one would also
    // enumerate a key per byte to find nothing.
    if (ArrayBuffer.isView(node)) return;
    if (!shouldScrub(node, depth)) return;

    if (node instanceof Error) {
      try {
        node.message = redact(node.message, secret);
      } catch {
        // A frozen error cannot be scrubbed; the message we throw is redacted
        // regardless, and there is nothing else useful to do here.
      }
      for (const inner of membersOf(node)) scrub(inner, depth + 1);
      scrub(causeOf(node), depth + 1);
    }

    // Inspect prints a Map's and a Set's contents in full, so a request body
    // parked in one leaks exactly as a property would. Collect first, then
    // rewrite: replacing entries under the iterator is not worth reasoning
    // about on an error path.
    if (node instanceof Map) scrubMap(node, secret, scrub, depth);
    else if (node instanceof Set) scrubSet(node, secret, scrub, depth);

    // Messages are not the only thing printed: inspecting an error prints its
    // enumerable own properties too, so a client that hangs the request body
    // off the error puts the secret there rather than in any message. Keys are
    // read one at a time, each in its own guard — `Object.entries` runs every
    // getter at once, so one that throws would abandon the whole walk.
    for (const key of ownKeysOf(node)) {
      let value: unknown;
      try {
        value = (node as Record<string, unknown>)[key];
      } catch {
        // A getter that throws yields nothing to scrub and nothing to print.
        continue;
      }
      if (typeof value === 'string') {
        try {
          (node as Record<string, unknown>)[key] = redact(value, secret);
        } catch {
          // Frozen or getter-only, as above.
        }
      } else {
        scrub(value, depth + 1);
      }
    }
  };

  try {
    scrub(err, 0);
  } catch {
    // The per-node guards above should make this unreachable; it is here so
    // that "never throws" is a property of the function rather than of how
    // carefully its internals were audited.
  }
}

type Scrubber = (node: unknown, depth: number) => void;

/** Redact a Map's string keys and values; recurse into the rest. */
function scrubMap(
  node: Map<unknown, unknown>,
  secret: string,
  scrub: Scrubber,
  depth: number,
): void {
  const rewritten: [unknown, unknown, unknown][] = [];
  try {
    for (const [key, value] of node) {
      const newKey = typeof key === 'string' ? redact(key, secret) : key;
      const newValue = typeof value === 'string' ? redact(value, secret) : value;
      if (newKey !== key || newValue !== value) rewritten.push([key, newKey, newValue]);
      if (typeof key !== 'string') scrub(key, depth + 1);
      if (typeof value !== 'string') scrub(value, depth + 1);
    }
    for (const [oldKey, newKey, newValue] of rewritten) {
      if (newKey !== oldKey) node.delete(oldKey);
      node.set(newKey, newValue);
    }
  } catch {
    // A hostile Map-alike: leave it rather than lose the operator's message.
  }
}

/** Redact a Set's string members; recurse into the rest. */
function scrubSet(node: Set<unknown>, secret: string, scrub: Scrubber, depth: number): void {
  const rewritten: [unknown, string][] = [];
  try {
    for (const member of node) {
      if (typeof member !== 'string') {
        scrub(member, depth + 1);
        continue;
      }
      const cleaned = redact(member, secret);
      if (cleaned !== member) rewritten.push([member, cleaned]);
    }
    for (const [oldMember, cleaned] of rewritten) {
      node.delete(oldMember);
      node.add(cleaned);
    }
  } catch {
    // As above.
  }
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
