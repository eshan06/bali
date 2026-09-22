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
 * That is enforced rather than asserted — see `safeCause`, which checks what
 * would actually be printed before anything is attached to a thrown error.
 */

import { inspect } from 'node:util';

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
 * and any node can be walked at most MAX_WALK_DEPTH + 1 times (depths 4 down to 0).
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

/**
 * An error's `name`, or '' when reading it throws. The timeout branch below
 * reads this inside the same catch everything else here is guarded for.
 */
function nameOf(err: unknown): string {
  try {
    return err instanceof Error && typeof err.name === 'string' ? err.name : '';
  } catch {
    return '';
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
    if (depth > MAX_WALK_DEPTH) return;
    // Even `instanceof` is a call: it reads the prototype chain, which a Proxy
    // can trap and throw from. Guarding each node rather than the walk means a
    // hostile one costs its own subtree and nothing else.
    try {
      if (!(node instanceof Error) || !shouldVisit(node, depth)) return;
      const message = messageOf(node);
      if (message && !found.includes(message)) found.push(message);
      // A host resolving to several addresses that all refuse the connection
      // arrives as an AggregateError whose own message is EMPTY, with the real
      // per-address failures on `errors` — walking `cause` alone would report
      // "fetch failed" and nothing else, which is what this function exists to
      // stop.
      for (const inner of membersOf(node)) visit(inner, depth + 1);
      visit(causeOf(node), depth + 1);
    } catch {
      // This node resisted inspection; its siblings are still worth reading.
    }
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

/**
 * An object's own enumerable keys — symbols included, because `inspect` prints
 * a symbol-keyed property just as plainly as a named one. None when even asking
 * throws (a Proxy `ownKeys` trap).
 *
 * A typed array's indices are dropped: they are one key per byte and hold
 * numbers, not text. Its NAMED properties are kept, which is the whole point —
 * `inspect` prints them right beside the hex (`<Buffer 61 62, body: '…'>`), so
 * skipping the object wholesale would leak exactly what this walk exists to
 * catch.
 */
function ownKeysOf(node: object): (string | symbol)[] {
  try {
    const keys = Reflect.ownKeys(node).filter((key) =>
      Object.prototype.propertyIsEnumerable.call(node, key),
    );
    if (!ArrayBuffer.isView(node)) return keys;
    return keys.filter((key) => typeof key === 'symbol' || !/^\d+$/.test(key));
  } catch {
    return [];
  }
}

/** A hostile iterator must not be followed forever; a real error graph is tiny. */
const MAX_COLLECTION_ENTRIES = 1_000;

/**
 * Scrub a secret out of a caught error and its whole cause chain, in place.
 *
 * Redacting only the message we throw is not enough: the caught error rides
 * along as `cause`, and Node prints the entire chain whenever an error is
 * inspected — which is exactly what the demo's top-level handler does — so the
 * secret would land in the transcript one line below the redacted copy.
 * Scrubbing the objects themselves also covers anything else that inspects them
 * later, and keeps the real error attached as the cause rather than a lookalike.
 *
 * This is BEST EFFORT and deliberately not the guarantee. A walk can only cover
 * carriers it was told to look in, and `inspect` prints things no property walk
 * reaches — a `Headers` or `URLSearchParams` whose contents live in internal
 * slots, a `[util.inspect.custom]` of someone else's design. An earlier version
 * of this module claimed to cover "everything inspect prints"; it did not, and
 * the claim is what made the gaps invisible. `safeCause` below is where the
 * promise is actually kept: it checks the rendered text and refuses to attach
 * anything the secret survived in.
 *
 * What this walk does cover: messages and stacks, own enumerable properties
 * (symbol-keyed ones included), AggregateError members, named properties hung
 * on a typed array, and the contents of a Map or a Set.
 *
 * It never throws, and it always returns. Each node is guarded on its own, so
 * one hostile object costs its own subtree rather than the rest of the walk —
 * abandoning the walk would leave every node after it unscrubbed.
 */
function redactInPlace(err: unknown, secret: string): void {
  const shouldScrub = newVisitMemo();
  const scrub = (node: unknown, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || node === null || typeof node !== 'object') return;
    try {
      if (!shouldScrub(node, depth)) return;
      scrubNode(node, secret, scrub, depth);
    } catch {
      // A prototype trap, a hostile getter, a frozen object: this node keeps
      // whatever it holds, and `safeCause` catches it if it mattered.
    }
  };
  scrub(err, 0);
}

type Scrubber = (node: unknown, depth: number) => void;

/** One node of the walk: its own text, then everything hanging off it. */
function scrubNode(node: object, secret: string, scrub: Scrubber, depth: number): void {
  if (node instanceof Error) {
    try {
      node.message = redact(node.message, secret);
      // `inspect` prints an Error's STACK, not its message. V8 formats that
      // string lazily and then caches it, so a stack already materialized by
      // some logger above us keeps the pre-scrub message forever. Rewriting the
      // message and leaving the stack alone only looked correct because nothing
      // in the demo reads `.stack` first.
      if (typeof node.stack === 'string') node.stack = redact(node.stack, secret);
    } catch {
      // A frozen error cannot be scrubbed; the message we throw is redacted
      // regardless, and there is nothing else useful to do here.
    }
    for (const inner of membersOf(node)) scrub(inner, depth + 1);
    scrub(causeOf(node), depth + 1);
  }

  // Inspect prints a Map's and a Set's contents in full, so a request body
  // parked in one leaks exactly as a property would. Collect first, then
  // rewrite: replacing entries under the iterator is not worth reasoning about
  // on an error path.
  if (node instanceof Map) scrubMap(node, secret, scrub, depth);
  else if (node instanceof Set) scrubSet(node, secret, scrub, depth);

  // Messages are not the only thing printed: inspecting an error prints its
  // enumerable own properties too, so a client that hangs the request body off
  // the error puts the secret there rather than in any message. Keys are read
  // one at a time, each in its own guard — `Object.entries` runs every getter at
  // once, so one that throws would abandon the whole node.
  for (const key of ownKeysOf(node)) {
    let value: unknown;
    try {
      value = (node as Record<string | symbol, unknown>)[key];
    } catch {
      // A getter that throws yields nothing to scrub and nothing to print.
      continue;
    }
    if (typeof value === 'string') {
      try {
        (node as Record<string | symbol, unknown>)[key] = redact(value, secret);
      } catch {
        // Frozen or getter-only, as above.
      }
    } else {
      scrub(value, depth + 1);
    }
  }
}

/** Redact a Map's string keys and values; recurse into the rest. */
function scrubMap(
  node: Map<unknown, unknown>,
  secret: string,
  scrub: Scrubber,
  depth: number,
): void {
  const rewritten: [unknown, unknown, unknown][] = [];
  try {
    let seen = 0;
    for (const [key, value] of node) {
      if (++seen > MAX_COLLECTION_ENTRIES) break;
      const newKey = typeof key === 'string' ? redact(key, secret) : key;
      const newValue = typeof value === 'string' ? redact(value, secret) : value;
      if (newKey !== key || newValue !== value) rewritten.push([key, newKey, newValue]);
      if (typeof key !== 'string') scrub(key, depth + 1);
      if (typeof value !== 'string') scrub(value, depth + 1);
    }
    // Rewriting a key moves the entry to the end, and two keys that redact to
    // the same text collapse into one. Both are fine on an error being printed.
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
  const rewritten: [string, string][] = [];
  try {
    let seen = 0;
    for (const member of node) {
      if (++seen > MAX_COLLECTION_ENTRIES) break;
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

/**
 * The cause to attach to a thrown error: the real one when scrubbing it
 * demonstrably worked, and a redacted rendering of it when it did not.
 *
 * This is where "a password never leaves this module" stops being a claim about
 * how thorough the walk is and becomes a check on the thing that actually
 * reaches a transcript. `inspect` is what Node runs when the demo's top-level
 * handler prints the failure, so asking it directly covers every carrier at
 * once — the symbol-keyed property, the `Headers` whose contents live in
 * internal slots, the stack some logger froze before we got here — including
 * the ones nobody has thought of yet.
 *
 * On a miss the real error is dropped rather than attached: a string with the
 * secret taken out of it keeps everything an operator can act on and has
 * nowhere left to hide one.
 */
function safeCause(err: unknown, secret: string): unknown {
  redactInPlace(err, secret);
  if (!secret) return err;

  let printed: string;
  try {
    printed = inspect(err, { depth: null });
  } catch {
    return new Error('the original error could not be inspected, so it is not attached');
  }

  const cleaned = redact(printed, secret);
  if (cleaned === printed) return err;
  return new Error(cleaned);
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
    // Only a timeout is reported as one: a mistyped region fails DNS instantly,
    // and telling the operator to look at Cognito's latency would point them
    // away from the thing they actually got wrong.
    //
    // The detail comes from the fetch layer, so it is redacted before being
    // interpolated: this module promises a password never leaves it, and an
    // interceptor or a future client that echoed the request body would
    // otherwise put DEMO_PASSWORD straight into a CI transcript. Structural,
    // not incidental.
    const message =
      nameOf(err) === 'TimeoutError'
        ? `Cognito sign-in for ${credentials.username} did not answer within ${timeoutMs}ms ` +
          `(${cognitoEndpoint(config.region)})`
        : `Cognito sign-in for ${credentials.username} could not reach ` +
          `${cognitoEndpoint(config.region)}: ` +
          redact(detailOf(err), credentials.password);

    // Deliberate, and the one place in this repo that overrides a lint rule.
    // `safeCause` attaches the caught error itself in every ordinary case; it
    // substitutes a redacted rendering of it ONLY when inspecting the real
    // object would print the password. Keeping the object would defeat the
    // single promise this module exists to make, and the rendering carries the
    // same text an operator reads.
    // eslint-disable-next-line preserve-caught-error -- see the note above
    throw new Error(message, { cause: safeCause(err, credentials.password) });
  }

  const text = await res.text();
  if (!res.ok) {
    // `describeError` may quote the body verbatim, and the body is not always
    // Cognito's: a corporate proxy or WAF block page can echo the request it
    // rejected, which is the one we just posted the password in.
    throw new Error(
      `Cognito sign-in failed for ${credentials.username} — ` +
        redact(describeError(res.status, text), credentials.password),
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
