import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

import { cognitoEndpoint, fetchCognitoAccessToken } from '../scripts/demo/cognito.js';

/*
 * The exit demo's real-Cognito sign-in. It is the one piece of the deployed-API
 * run that cannot be exercised locally end-to-end, so its contract is pinned
 * here: the right call shape goes out, a token comes back, and every failure
 * path throws something an operator can act on rather than returning a
 * token-shaped nothing.
 */

const config = { region: 'us-east-1', clientId: 'app-client-id' };
const creds = { username: 'demo-ana@example.test', password: 'hunter2-not-real' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Undo standard string escaping. A transcript that merely ESCAPED the password
 * has still leaked it — anyone reading it can decode it back — so the
 * assertions above check the decoded text too.
 */
function unescaped(text: string): string {
  const named: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' };
  return text.replace(
    /\\(u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
    (_match, escape: string) => {
      if (escape.startsWith('u') || escape.startsWith('x')) {
        return String.fromCodePoint(Number.parseInt(escape.replace(/^u\{?|^x|\}$/g, ''), 16));
      }
      return named[escape] ?? escape;
    },
  );
}

describe('fetchCognitoAccessToken', () => {
  it('posts an unauthenticated USER_PASSWORD_AUTH InitiateAuth and returns the access token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { AuthenticationResult: { AccessToken: 'the-access-token' } }),
      );

    const token = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds);

    expect(token).toBe('the-access-token');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(cognitoEndpoint('us-east-1'));
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-target']).toBe('AWSCognitoIdentityProviderService.InitiateAuth');
    // No AWS credentials are involved — that is why the demo needs no SDK.
    expect(Object.keys(headers).join(' ')).not.toMatch(/authorization|x-amz-security-token/i);
    expect(JSON.parse(init.body as string)).toEqual({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: 'app-client-id',
      AuthParameters: { USERNAME: creds.username, PASSWORD: creds.password },
    });
  });

  it('reports Cognito’s own error type and message, without echoing the password', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        __type: 'NotAuthorizedException',
        message: 'Incorrect username or password.',
      }),
    );

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toContain('NotAuthorizedException');
    expect(err?.message).toContain('Incorrect username or password.');
    expect(err?.message).toContain(creds.username);
    // The one thing that must never reach a log line or a CI transcript.
    expect(err?.message).not.toContain(creds.password);
  });

  it('names the flow when the app client has USER_PASSWORD_AUTH disabled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        __type: 'InvalidParameterException',
        message: 'Auth flow not enabled for this client',
      }),
    );

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /Auth flow not enabled/,
    );
  });

  it('fails loudly on an unfinished challenge instead of returning nothing', async () => {
    // A temporary password leaves the account in NEW_PASSWORD_REQUIRED: there is
    // no token, and no amount of retrying produces one — it needs an operator.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ChallengeName: 'NEW_PASSWORD_REQUIRED' }));

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /NEW_PASSWORD_REQUIRED/,
    );
  });

  it('treats a 200 with no access token as a failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { AuthenticationResult: {} }));

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /no access token/,
    );
  });

  it('reports a timeout as a timeout', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), {
      name: 'TimeoutError',
    });
    const fetchImpl = vi.fn().mockRejectedValue(timeout);

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /did not answer within 30000ms/,
    );
  });

  it('does NOT report a DNS failure as a timeout — that points at the wrong thing', async () => {
    // A mistyped DEMO_COGNITO_REGION fails resolution instantly; blaming
    // Cognito's latency would send the operator looking in the wrong place.
    // The shape Node's fetch really produces: a bare `TypeError: fetch failed`
    // whose readable half lives on `cause`. An error carrying ENOTFOUND in its
    // own message would pass this test while the real path stayed vague.
    const dns = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('getaddrinfo ENOTFOUND cognito-idp.us-east-99.amazonaws.com'),
    });
    const fetchImpl = vi.fn().mockRejectedValue(dns);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).not.toMatch(/did not answer within/);
    expect(err?.message).toMatch(/ENOTFOUND/);
    expect(err?.message).toContain('cognito-idp.us-east-1.amazonaws.com');
    expect(err?.message).not.toContain(creds.password);
  });

  it('redacts the password out of a fetch-layer message that quoted it', async () => {
    // A client that echoed the request body would otherwise put DEMO_PASSWORD
    // into a CI transcript; the module's promise has to hold structurally.
    const chatty = Object.assign(new Error(`request failed: {"PASSWORD":"${creds.password}"}`), {
      name: 'TypeError',
    });
    const fetchImpl = vi.fn().mockRejectedValue(chatty);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    // Inspect the WHOLE error, cause chain included: asserting only on
    // `.message` is what let a leak through `{ cause: err }` pass review — the
    // demo's top-level handler prints the inspected error, so that is the thing
    // that actually reaches a CI transcript.
    const printed = inspect(err, { depth: null });
    expect(printed).not.toContain(creds.password);
    expect(printed).toContain('<redacted>');
  });

  it('redacts a password that the fetch layer JSON-escaped', async () => {
    // A quoted body escapes `"` and `\\`, so an exact-substring match alone
    // would print such a password in full.
    const awkward = { username: creds.username, password: 'pa"ss\\word' };
    const escaped = JSON.stringify(awkward.password).slice(1, -1);
    const chatty = Object.assign(new TypeError('fetch failed'), {
      cause: new Error(`body was {"PASSWORD":"${escaped}"}`),
    });
    const fetchImpl = vi.fn().mockRejectedValue(chatty);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, awkward).then(
      () => null,
      (e: unknown) => e as Error,
    );

    const printed = inspect(err, { depth: null });
    expect(printed).not.toContain(awkward.password);
    expect(printed).not.toContain(escaped);
    expect(printed).toContain('<redacted>');
  });

  it('redacts a password hung off the error as a property, not just a message', async () => {
    // Inspecting an error prints its enumerable own properties, so a client
    // that attaches the request leaks through a path no message-only scrub
    // reaches.
    const chatty = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('socket hang up'), {
        request: { body: `{"PASSWORD":"${creds.password}"}` },
      }),
    });
    const fetchImpl = vi.fn().mockRejectedValue(chatty);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(err, { depth: null })).not.toContain(creds.password);
  });

  it('reports the per-address failures inside an AggregateError', async () => {
    // A host resolving to several addresses that all refuse arrives as an
    // AggregateError with an EMPTY message: walking `cause` alone reports
    // "fetch failed" and buries the reason.
    const aggregate = new AggregateError(
      [new Error('connect ECONNREFUSED 10.0.0.1:443'), new Error('connect ECONNREFUSED ::1:443')],
      '',
    );
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: aggregate }));

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toContain('ECONNREFUSED');
  });

  it('redacts a password buried in an AggregateError member', async () => {
    const aggregate = new AggregateError([new Error(`sent {"PASSWORD":"${creds.password}"}`)], '');
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: aggregate }));

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(err, { depth: null })).not.toContain(creds.password);
  });

  it('keeps the timeout path free of the password too', async () => {
    const timeout = Object.assign(new TypeError('fetch failed'), {
      name: 'TimeoutError',
      cause: new Error(`sending {"PASSWORD":"${creds.password}"}`),
    });
    const fetchImpl = vi.fn().mockRejectedValue(timeout);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(err, { depth: null })).not.toContain(creds.password);
  });

  it('redacts a shared node the walk reached at the bottom of its budget first', async () => {
    // The walk is depth-bounded AND memoized. `b` is enumerated first
    // (insertion order), reaching `shared` with no budget left for its
    // children; a memo that only remembered *that* `shared` was seen then made
    // that truncated visit final, so the shallow `a` path — which had the
    // budget — returned early and the password below it was never scrubbed.
    // Shared nodes are ordinary in undici's error graphs.
    const shared = { deep: { leak: `{"PASSWORD":"${creds.password}"}` } };
    const err = Object.assign(new TypeError('fetch failed'), {
      b: { b1: { b2: { b3: shared } } },
      a: shared,
    });
    const fetchImpl = vi.fn().mockRejectedValue(err);

    const caught = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(caught, { depth: null })).not.toContain(creds.password);
  });

  it('still names the real failure when an own getter on the error throws', async () => {
    // The scrub runs from inside the catch that builds the one message naming
    // what the operator got wrong. Reading properties through
    // `Object.entries` ran every getter at once, so one that threw replaced
    // that message with an unrelated exception.
    const hostile = new TypeError('fetch failed');
    Object.defineProperty(hostile, 'request', {
      enumerable: true,
      get() {
        throw new Error('getter exploded');
      },
    });
    const fetchImpl = vi.fn().mockRejectedValue(hostile);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toContain('could not reach');
    expect(err?.message).toContain('cognito-idp.us-east-1.amazonaws.com');
    expect(err?.message).not.toContain('getter exploded');
  });

  it('still names the real failure when `errors` is not iterable', async () => {
    // `AggregateError.errors` is an ordinary writable own property, so both
    // walks iterating it unguarded could throw out of the catch block.
    const aggregate = new AggregateError([new Error('connect ECONNREFUSED 10.0.0.1:443')], '');
    (aggregate as unknown as { errors: unknown }).errors = 42;
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: aggregate }));

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toContain('could not reach');
    expect(err?.message).not.toMatch(/not iterable/);
  });

  it('still names the real failure when `cause` itself throws on read', async () => {
    // `cause` is an ordinary own property, forgeable exactly like `errors` —
    // and `detailOf` walks it with no try above it.
    const hostile = new TypeError('fetch failed');
    Object.defineProperty(hostile, 'cause', {
      enumerable: false,
      get() {
        throw new Error('cause exploded');
      },
    });
    const fetchImpl = vi.fn().mockRejectedValue(hostile);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toContain('could not reach');
    expect(err?.message).not.toContain('cause exploded');
  });

  it('redacts a password carried in a Map or a Set, not just a string property', async () => {
    // `inspect` prints both in full, so a body parked in one reaches a
    // transcript exactly as a property would.
    const fetchImpl = vi.fn().mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('socket hang up'), {
          request: new Map([['body', `{"PASSWORD":"${creds.password}"}`]]),
          tried: new Set([`auth as ${creds.password}`]),
        }),
      }),
    );

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    const printed = inspect(err, { depth: null });
    expect(printed).not.toContain(creds.password);
    expect(printed).toContain('<redacted>');
  });

  it('redacts a password hung on a Buffer as a named property', async () => {
    // Skipping typed arrays wholesale was wrong: `inspect` prints the named
    // properties on one right beside the hex — `<Buffer 61 62, body: '…'>` —
    // so the bytes being unreadable says nothing about what rides along with
    // them.
    const chunk = Object.assign(Buffer.from('abcd'), {
      body: `{"PASSWORD":"${creds.password}"}`,
    });
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new TypeError('fetch failed'), { chunk }));

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(err, { depth: null })).not.toContain(creds.password);
  });

  it('redacts a password on a symbol-keyed property', async () => {
    // `Object.keys` never returns symbols, but `inspect` prints them in full —
    // and undici keys plenty of its own state with symbols.
    const hostile = new TypeError('fetch failed');
    (hostile as unknown as Record<symbol, string>)[Symbol('requestBody')] =
      `{"PASSWORD":"${creds.password}"}`;
    const fetchImpl = vi.fn().mockRejectedValue(hostile);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(err, { depth: null })).not.toContain(creds.password);
  });

  it('redacts a stack that was already materialized before the scrub', async () => {
    // `inspect` prints an Error's stack, not its message. V8 formats it lazily
    // and caches it, so anything that read `.stack` first froze the un-redacted
    // message into it — rewriting `message` alone then changes nothing that is
    // printed.
    const inner = new Error(`request body {"PASSWORD":"${creds.password}"}`);
    void inner.stack;
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: inner }));

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(err, { depth: null })).not.toContain(creds.password);
  });

  it('redacts carriers no property walk reaches, via the printed-text check', async () => {
    // A Headers and a URLSearchParams keep their contents in internal slots:
    // `Object.keys` is empty for both, yet `inspect` prints every pair. This is
    // what safeCause exists for — it asks what would actually be printed
    // instead of trusting the walk to have known about them.
    const fetchImpl = vi.fn().mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        headers: new Headers({ 'x-pw': creds.password }),
        query: new URLSearchParams({ PASSWORD: creds.password }),
        boxed: new String(`{"PASSWORD":"${creds.password}"}`),
      }),
    );

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    const printed = inspect(err, { depth: null });
    expect(printed).not.toContain(creds.password);
    // The operator still gets the failure, not a blank.
    expect(err?.message).toContain('could not reach');
  });

  it('one hostile node does not stop the rest of the walk being scrubbed', async () => {
    // A prototype trap throws out of `instanceof` itself. Abandoning the walk
    // there left everything after it unscrubbed — worse than never having
    // guarded it.
    const fetchImpl = vi.fn().mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        first: new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error('proto trap exploded');
            },
          },
        ),
        second: { pw: `{"PASSWORD":"${creds.password}"}` },
      }),
    );

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(err, { depth: null })).not.toContain(creds.password);
    expect(err?.message).toContain('could not reach');
    expect(err?.message).not.toContain('proto trap exploded');
  });

  it('still names the real failure when `name` throws on read', async () => {
    // The timeout branch reads `err.name` inside the same catch everything else
    // here is guarded for.
    const hostile = new TypeError('fetch failed');
    Object.defineProperty(hostile, 'name', {
      get() {
        throw new Error('name exploded');
      },
    });
    const fetchImpl = vi.fn().mockRejectedValue(hostile);

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(err?.message).toContain('could not reach');
    expect(err?.message).not.toContain('name exploded');
  });

  it('redacts a password echoed back inside an error response body', async () => {
    // A corporate proxy or WAF block page can quote the request it rejected —
    // the one this module just posted the password in.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(`<html>blocked: {"PASSWORD":"${creds.password}"}</html>`, { status: 403 }),
      );

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(err, { depth: null })).not.toContain(creds.password);
    expect(err?.message).toContain('403');
  });

  it.each([
    ['a quote and a backslash', 'pa"ss\\word'],
    ['every quote style at once', 'Bali\'"`2026!'],
    ['a control character', 'hunt\u0007er2'],
  ])('redacts a password the printer escaped — %s', async (_label, password) => {
    // The secret reaches the transcript already QUOTED, and each printer
    // escapes differently. Searching for the raw form alone found nothing and
    // called that clean, so a password containing `"` and `\` sat in a
    // transcript that looked redacted — recoverable by anyone who un-escapes
    // what they are reading. The carrier here is one no property walk reaches,
    // so the printed-text check is the only thing standing between the password
    // and the transcript.
    const awkward = { username: creds.username, password };
    const fetchImpl = vi.fn().mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        query: new URLSearchParams({ PASSWORD: password }),
      }),
    );

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, awkward).then(
      () => null,
      (e: unknown) => e as Error,
    );

    const printed = inspect(err, { depth: null });
    expect(printed).not.toContain(password);
    // And not as the printer wrote it either: undo the escaping and look again.
    expect(unescaped(printed)).not.toContain(password);
    expect(err?.message).toContain('could not reach');
  });

  it('does not leak, or go silent, when reading the response body fails', async () => {
    // undici rejects `.text()` with `TypeError: terminated` whenever a response
    // is cut short — an ordinary flaky network, not a hostile input. That await
    // sat outside every guard, so the rejection bypassed all of this module:
    // the password printed, and the operator lost the line naming Cognito.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.reject(
          Object.assign(new TypeError('terminated'), {
            cause: new Error(`socket closed while replaying {"PASSWORD":"${creds.password}"}`),
          }),
        ),
    });

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    expect(inspect(err, { depth: null })).not.toContain(creds.password);
    expect(err?.message).toContain('could not read the response');
    expect(err?.message).toContain('cognito-idp.us-east-1.amazonaws.com');
    expect(err?.message).toContain('terminated');
  });

  it('redacts a password straddling the error body’s truncation point', async () => {
    // `describeError` keeps the first 200 characters. Redacting its OUTPUT left
    // a password that straddled the cut printed as a prefix.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(`${'y'.repeat(190)}${creds.password}`, { status: 403 }));

    const err = await fetchCognitoAccessToken({ ...config, fetchImpl }, creds).then(
      () => null,
      (e: unknown) => e as Error,
    );

    // The prefix that used to survive, not just the whole secret.
    expect(err?.message).not.toContain(creds.password.slice(0, 10));
    expect(err?.message).toContain('403');
  });

  it('survives a non-JSON error body (a proxy or gateway page)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>502 Bad Gateway</html>', { status: 502 }));

    await expect(fetchCognitoAccessToken({ ...config, fetchImpl }, creds)).rejects.toThrow(
      /HTTP 502/,
    );
  });
});
