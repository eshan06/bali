import { formatWithOptions, inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';

import { cognitoEndpoint, fetchCognitoAccessToken, KNOWN_WORDS } from '../scripts/demo/cognito.js';
import { readableForms } from './helpers/readable.js';

/*
 * The exit demo's real-Cognito sign-in. It is the one piece of the deployed-API
 * run that cannot be exercised locally end-to-end, so its contract is pinned
 * here: the right call shape goes out, a token comes back, and every failure
 * path throws something an operator can act on rather than returning a
 * token-shaped nothing.
 *
 * And none of them may carry the password. The module's rule is that nothing it
 * throws carries text from outside — the response, the fetch layer — so the
 * tests below load each channel listed in CHANNELS with text and assert that
 * none of it arrives: not the password — raw, or with JS/JSON escapes,
 * percent-encoding and HTML entities undone — and not a canary sitting beside
 * it, which catches the encodings no decoder here undoes. Where a value from
 * outside does choose what prints — a code, an error type, a challenge name, a
 * media type — WORD_FIELDS checks that what prints is a word of the module's
 * own, and that the message is the same whatever the password is.
 */

const config = { region: 'us-east-1', clientId: 'app-client-id' };
const creds = { username: 'demo-ana@example.test', password: 'hunter2-not-real' };
const ENDPOINT = 'https://cognito-idp.us-east-1.amazonaws.com/';

type FetchImpl = () => Promise<unknown>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Sign in and return what was thrown, failing the test if nothing was. */
async function thrownBy(fetchImpl: FetchImpl, credentials = creds): Promise<Error> {
  const outcome = await fetchCognitoAccessToken(
    { ...config, fetchImpl: fetchImpl as unknown as typeof fetch },
    credentials,
  ).then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
}

/**
 * Everything a transcript could show of a thrown error: exactly what the demo's
 * top-level handler prints (`console.error` formats at inspect's default depth),
 * a full-depth inspect with hidden properties too, and message and stack alone.
 */
function printedForms(err: Error): string[] {
  return [
    formatWithOptions({}, '\n❌ SIMULATION FAILED:', err),
    inspect(err, { depth: null, showHidden: true }),
    err.message,
    err.stack ?? '',
  ];
}

/**
 * Could a reader of anything printed about `err` recover `secret`? Compared
 * after folding compatibility forms and case: an echo that normalised a
 * fullwidth password, or changed its case, has leaked it.
 */
function exposes(err: Error, secret: string): boolean {
  const canonical = (text: string) => text.normalize('NFKC').toUpperCase();
  const wanted = canonical(secret);
  return printedForms(err).some((text) =>
    readableForms(text).some((form) => canonical(form).includes(wanted)),
  );
}

/** The thrown error carries its message and stack and nothing else. */
function expectNothingAttached(err: Error): void {
  expect(err.cause).toBeUndefined();
  expect(Reflect.ownKeys(err).filter((key) => key !== 'message' && key !== 'stack')).toEqual([]);
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
    expect(url).toBe(ENDPOINT);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-target']).toBe('AWSCognitoIdentityProviderService.InitiateAuth');
    // No AWS credentials are involved — that is why the demo needs no SDK.
    expect(Object.keys(headers).join(' ')).not.toMatch(/authorization|x-amz-security-token/i);
    // A redirect would re-send this body, password and all, wherever it pointed.
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string)).toEqual({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: 'app-client-id',
      AuthParameters: { USERNAME: creds.username, PASSWORD: creds.password },
    });
  });

  it('reports Cognito’s error type with a fixed explanation, and none of its message text', async () => {
    // Cognito's own messages quote request values back ("Value 'x' at
    // 'clientId' failed to satisfy constraint"), so they are never printed; the
    // type says what went wrong, in words this module owns.
    const err = await thrownBy(() =>
      Promise.resolve(
        jsonResponse(400, {
          __type: 'NotAuthorizedException',
          message: 'Incorrect username or password.',
        }),
      ),
    );

    expect(err.message).toBe(
      'Cognito sign-in failed for demo-ana@example.test — NotAuthorizedException (HTTP 400): ' +
        'a wrong username or password, a disabled or locked-out user, or an app client that ' +
        'requires a secret',
    );
    expectNothingAttached(err);
  });

  it('points at ALLOW_USER_PASSWORD_AUTH when Cognito rejects a parameter', async () => {
    const err = await thrownBy(() =>
      Promise.resolve(
        jsonResponse(400, {
          __type: 'InvalidParameterException',
          message: 'USER_PASSWORD_AUTH flow not enabled for this client',
        }),
      ),
    );

    expect(err.message).toBe(
      'Cognito sign-in failed for demo-ana@example.test — InvalidParameterException (HTTP 400): ' +
        'most often, ALLOW_USER_PASSWORD_AUTH is not enabled on the app client, or the client ' +
        'id is malformed',
    );
  });

  it('does not print a validation message quoting the request back', async () => {
    // The body real Cognito returned for a malformed client id (probed against
    // us-east-1): its message quotes the request's own value. Here that value
    // is a client id; the same mechanism is why no message text is printed.
    const err = await thrownBy(() =>
      Promise.resolve(
        new Response(
          '{"__type":"InvalidParameterException","message":"1 validation error detected: ' +
            "Value 'bad client id!' at 'clientId' failed to satisfy constraint: Member must " +
            'satisfy regular expression pattern: [\\\\w+]+"}',
          { status: 400, headers: { 'content-type': 'application/x-amz-json-1.1' } },
        ),
      ),
    );

    expect(err.message).not.toContain('bad client id!');
    expect(err.message).toContain('InvalidParameterException (HTTP 400)');
  });

  it('names an error type it has no explanation for', async () => {
    const err = await thrownBy(() =>
      Promise.resolve(jsonResponse(400, { __type: 'LimitExceededException', message: 'x' })),
    );

    expect(err.message).toBe(
      'Cognito sign-in failed for demo-ana@example.test — LimitExceededException (HTTP 400)',
    );
  });

  it.each([
    [
      'NotAuthorizedException',
      // With PreventUserExistenceErrors on — the console's default — a user
      // that does not exist is reported this way too.
      'a wrong username or password, a disabled or locked-out user, or an app client that ' +
        'requires a secret',
    ],
    [
      'InvalidParameterException',
      'most often, ALLOW_USER_PASSWORD_AUTH is not enabled on the app client, or the client id ' +
        'is malformed',
    ],
    ['ResourceNotFoundException', 'no app client with this id in this region'],
    ['UserNotFoundException', 'no such user in this pool'],
    ['UserNotConfirmedException', 'the user has not been confirmed'],
    ['PasswordResetRequiredException', 'the user must reset their password first'],
    ['TooManyRequestsException', 'Cognito is throttling sign-ins; wait, then re-run'],
  ])('explains %s in fixed words', async (type, hint) => {
    const err = await thrownBy(() => Promise.resolve(jsonResponse(400, { __type: type })));

    expect(err.message).toBe(
      `Cognito sign-in failed for demo-ana@example.test — ${type} (HTTP 400): ${hint}`,
    );
  });

  it.each([
    ['a namespace', 'com.amazonaws.cognito.identity.idp.model#ResourceNotFoundException'],
    ['a suffix', 'ResourceNotFoundException:http://internal.amazon.com/coral/'],
  ])('reads an error type spelled with %s', async (_label, type) => {
    // Both spellings are allowed by the AWS JSON protocols.
    const err = await thrownBy(() => Promise.resolve(jsonResponse(400, { __type: type })));

    expect(err.message).toBe(
      'Cognito sign-in failed for demo-ana@example.test — ResourceNotFoundException (HTTP 400): ' +
        'no app client with this id in this region',
    );
  });

  it('reads an empty error type as none', async () => {
    const err = await thrownBy(() => Promise.resolve(jsonResponse(400, { __type: '' })));

    expect(err.message).toBe(
      'Cognito sign-in failed for demo-ana@example.test — HTTP 400 (text/plain), with no ' +
        'Cognito error type; its body is withheld, since a proxy can quote the request it refused',
    );
  });

  it('says an error type it does not recognise was there, without printing it', async () => {
    const err = await thrownBy(() =>
      Promise.resolve(jsonResponse(400, { __type: 'SomeFutureException', message: 'x' })),
    );

    expect(err.message).toBe(
      'Cognito sign-in failed for demo-ana@example.test — HTTP 400 (text/plain), with an error ' +
        'type this module does not recognise; its body is withheld, since a proxy can quote the ' +
        'request it refused',
    );
  });

  it('reports a body that is not a Cognito error by its status and media type only', async () => {
    const err = await thrownBy(() =>
      Promise.resolve(
        new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      ),
    );

    expect(err.message).toBe(
      'Cognito sign-in failed for demo-ana@example.test — HTTP 502 (text/html), with no ' +
        'Cognito error type; its body is withheld, since a proxy can quote the request it refused',
    );
  });

  it('says an empty body is empty, rather than withheld', async () => {
    // A real 413 from Cognito arrives with content-length 0.
    const err = await thrownBy(() => Promise.resolve(new Response('', { status: 413 })));

    expect(err.message).toBe(
      'Cognito sign-in failed for demo-ana@example.test — HTTP 413 (text/plain), with no ' +
        'Cognito error type and an empty body',
    );
  });

  it('reads a media type in any case, with spaces and parameters around it', async () => {
    const err = await thrownBy(
      resolve(
        fakeResponse({
          ok: false,
          status: 403,
          contentType: ' Text/HTML ; Charset=UTF-8',
          text: () => Promise.resolve('<html>blocked</html>'),
        }),
      ),
    );

    expect(err.message).toContain('— HTTP 403 (text/html), with no Cognito error type');
  });

  it.each([
    ['a fraction', 400.5],
    ['one that carries digits from outside', 100.20262026],
    ['one below the range', 42],
    ['one above it', 600],
  ])('reads a status that is %s as invalid', async (_label, status) => {
    const err = await thrownBy(
      resolve(fakeResponse({ ok: false, status, text: () => Promise.resolve('') })),
    );

    expect(err.message).toContain('— an invalid HTTP status, with no Cognito error type');
  });

  it('prints no part of an error body, not even the start of one', async () => {
    // A preview cut at a fixed length prints the prefix of a password that
    // straddles the cut, whatever is redacted afterwards.
    const err = await thrownBy(() =>
      Promise.resolve(new Response(`${'y'.repeat(190)}${creds.password}`, { status: 403 })),
    );

    expect(err.message).not.toContain(creds.password.slice(0, 4));
    expect(err.message).not.toContain('yyyy');
    expect(err.message).toContain('HTTP 403');
  });

  it('fails loudly on an unfinished challenge instead of returning nothing', async () => {
    // A temporary password leaves the account in NEW_PASSWORD_REQUIRED: there is
    // no token, and no amount of retrying produces one — it needs an operator.
    const err = await thrownBy(() =>
      Promise.resolve(jsonResponse(200, { ChallengeName: 'NEW_PASSWORD_REQUIRED' })),
    );

    expect(err.message).toBe(
      'Cognito sign-in for demo-ana@example.test needs challenge NEW_PASSWORD_REQUIRED — ' +
        'finish it once in the AWS console (a temporary password must be reset before the ' +
        'account can be used unattended), then re-run.',
    );
  });

  it.each([
    ['a name it does not know', 'PASSKEY_REGISTRATION'],
    ['a known name in another case', 'new_password_required'],
  ])('does not print a challenge with %s', async (_label, name) => {
    const err = await thrownBy(() => Promise.resolve(jsonResponse(200, { ChallengeName: name })));

    expect(err.message).toBe(
      'Cognito sign-in for demo-ana@example.test needs a challenge this module does not ' +
        'recognise — finish it once in the AWS console (a temporary password must be reset ' +
        'before the account can be used unattended), then re-run.',
    );
  });

  it.each([
    ['no AuthenticationResult at all', {}],
    ['an empty AuthenticationResult', { AuthenticationResult: {} }],
    ['an empty token', { AuthenticationResult: { AccessToken: '' } }],
    ['a token that is not a string', { AuthenticationResult: { AccessToken: 12345 } }],
    ['a JSON null body', null],
    ['a JSON array body', [{ AccessToken: 'nested-in-the-wrong-place' }]],
  ])('treats a 200 with %s as a failure, never as a token', async (_label, body) => {
    const err = await thrownBy(() => Promise.resolve(jsonResponse(200, body)));

    expect(err.message).toBe('Cognito sign-in for demo-ana@example.test returned no access token');
  });

  it('names the request when a 200 is not JSON', async () => {
    const err = await thrownBy(() => Promise.resolve(new Response('<html>ok</html>')));

    expect(err.message).toBe('Cognito sign-in for demo-ana@example.test returned non-JSON body');
  });

  it('reports a timeout as a timeout', async () => {
    // The shape AbortSignal.timeout really rejects with.
    const err = await thrownBy(() =>
      Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    );

    expect(err.message).toBe(
      `Cognito sign-in for demo-ana@example.test did not answer within 30000ms (${ENDPOINT})`,
    );
    expectNothingAttached(err);
  });

  it('does NOT report a DNS failure as a timeout — that points at the wrong thing', async () => {
    // A mistyped region fails resolution instantly; blaming Cognito's latency
    // would send the operator looking in the wrong place. The shape Node's
    // fetch really produces (measured on Node 22): a bare `TypeError: fetch
    // failed` whose readable half is a system error on `cause`.
    const dns = new TypeError('fetch failed', {
      cause: Object.assign(
        new Error('getaddrinfo ENOTFOUND cognito-idp.us-east-99.amazonaws.com'),
        {
          errno: -3008,
          code: 'ENOTFOUND',
          syscall: 'getaddrinfo',
          hostname: 'cognito-idp.us-east-99.amazonaws.com',
        },
      ),
    });

    const err = await thrownBy(() => Promise.reject(dns));

    expect(err.message).toBe(
      `Cognito sign-in for demo-ana@example.test could not reach ${ENDPOINT}: ` +
        'ENOTFOUND (the host does not resolve — check the region)',
    );
    expectNothingAttached(err);
  });

  it('reports the codes inside an AggregateError', async () => {
    // A host whose addresses all refuse arrives as an AggregateError with an
    // EMPTY message and the per-address failures on `errors` (measured shape).
    const refused = (address: string) =>
      Object.assign(new Error(`connect ECONNREFUSED ${address}:443`), {
        code: 'ECONNREFUSED',
        syscall: 'connect',
        address,
        port: 443,
      });
    const aggregate = Object.assign(
      new AggregateError([refused('10.0.0.1'), refused('10.0.0.2')], ''),
      { code: 'ECONNREFUSED' },
    );

    const err = await thrownBy(() =>
      Promise.reject(new TypeError('fetch failed', { cause: aggregate })),
    );

    expect(err.message).toBe(
      `Cognito sign-in for demo-ana@example.test could not reach ${ENDPOINT}: ECONNREFUSED`,
    );
  });

  it('reads codes from members even when the AggregateError itself has none', async () => {
    const aggregate = new AggregateError(
      [Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })],
      '',
    );

    const err = await thrownBy(() =>
      Promise.reject(new TypeError('fetch failed', { cause: aggregate })),
    );

    expect(err.message).toMatch(/could not reach .*: ETIMEDOUT$/);
  });

  it('says plainly when a failure carries no error code at all', async () => {
    const err = await thrownBy(() => Promise.reject(new Error('something went wrong')));

    expect(err.message).toBe(
      `Cognito sign-in for demo-ana@example.test could not reach ${ENDPOINT}: no error code, ` +
        "and the fetch layer's own text is withheld — it can quote the request, which holds the " +
        'password',
    );
  });

  it('says a code it does not recognise was there, without printing it', async () => {
    const future = Object.assign(new Error('x'), { code: 'EFUTURE_FAILURE' });
    const alone = await thrownBy(reject(new TypeError('fetch failed', { cause: future })));
    const beside = await thrownBy(
      reject(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('y'), { code: 'ECONNRESET', cause: future }),
        }),
      ),
    );

    expect(alone.message).toBe(
      `Cognito sign-in for demo-ana@example.test could not reach ${ENDPOINT}: an error code ` +
        "this module does not recognise, and the fetch layer's own text is withheld — it can " +
        'quote the request, which holds the password',
    );
    expect(beside.message).toBe(
      `Cognito sign-in for demo-ana@example.test could not reach ${ENDPOINT}: ECONNRESET, an ` +
        'error code this module does not recognise',
    );
  });

  it('takes only a string for a code: a DOMException’s numeric one is no code at all', async () => {
    const err = await thrownBy(
      reject(new TypeError('fetch failed', { cause: new DOMException('cancelled', 'AbortError') })),
    );

    expect(err.message).toMatch(/could not reach .*: no error code, and the fetch layer's own/);
  });

  it('reports a timeout of the fetch layer’s own by its code, not as the deadline', async () => {
    // Only AbortSignal.timeout's TimeoutError means the deadline set here
    // passed; undici's connect timeout is a failure with a code of its own.
    const err = await thrownBy(
      reject(
        Object.assign(new Error('Connect Timeout Error'), {
          name: 'ConnectTimeoutError',
          code: 'UND_ERR_CONNECT_TIMEOUT',
        }),
      ),
    );

    expect(err.message).toBe(
      `Cognito sign-in for demo-ana@example.test could not reach ${ENDPOINT}: ` +
        'UND_ERR_CONNECT_TIMEOUT',
    );
  });

  it('names the code when the response body is cut short', async () => {
    // undici rejects `.text()` with `TypeError: terminated` when a response is
    // cut short — an ordinary flaky network — with a SocketError on `cause`.
    const terminated = new TypeError('terminated', {
      cause: Object.assign(new Error('other side closed'), {
        name: 'SocketError',
        code: 'UND_ERR_SOCKET',
      }),
    });

    const err = await thrownBy(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.reject(terminated) }),
    );

    expect(err.message).toBe(
      'Cognito sign-in for demo-ana@example.test could not read the response from ' +
        `${ENDPOINT}: UND_ERR_SOCKET`,
    );
    expectNothingAttached(err);
  });

  it('reports a body that stalls past the deadline as a timeout', async () => {
    // The deadline still applies while the body streams, and the rejection is
    // the same DOMException the headers would have produced.
    const err = await thrownBy(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.reject(
            new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
          ),
      }),
    );

    expect(err.message).toBe(
      'Cognito sign-in for demo-ana@example.test did not finish answering within 30000ms ' +
        `(${ENDPOINT})`,
    );
  });
});

/*
 * The leak matrix. Each channel is a place outside text can arrive; each is
 * loaded with a canary, then the password in some encoding, then the canary
 * again. For every password and every encoding the thrown error must show
 * neither: the password under any of the decodings `readableForms` applies, nor
 * the canary — which also covers the encodings (base64) no decoder here undoes.
 */
const CANARY = 'outside-text-q7z';

const PASSWORDS = [
  'hunter2-not-real',
  'pa"ss\\word',
  'Bali\'"`2026!',
  'hunt\u0007er2-not-real',
  'pässwörd-ünï-2026',
  'Correct Horse Battery 9',
];

const ENCODINGS: [string, (password: string) => string][] = [
  ['verbatim', (p) => p],
  ['JSON-escaped', (p) => JSON.stringify(p).slice(1, -1)],
  [
    '\\u-escaped',
    (p) =>
      [...p].map((c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}}`).join(''),
  ],
  ['percent-encoded', (p) => Buffer.from(p).toString('hex').replace(/../g, '%$&')],
  ['HTML entities', (p) => [...p].map((c) => `&#${c.codePointAt(0) ?? 0};`).join('')],
  ['inspect-quoted', (p) => inspect(p)],
  ['base64', (p) => Buffer.from(p).toString('base64')],
];

/** A response a fetch layer might hand back: only what the module reads. */
function fakeResponse(fields: {
  ok: boolean;
  status: number;
  contentType?: string;
  text: () => Promise<string>;
}): unknown {
  return {
    ok: fields.ok,
    status: fields.status,
    headers: { get: (name: string) => (name === 'content-type' ? fields.contentType : null) },
    text: fields.text,
  };
}

const reject =
  (err: Error): FetchImpl =>
  () =>
    Promise.reject(err);
const resolve =
  (res: unknown): FetchImpl =>
  () =>
    Promise.resolve(res);
const failingBody = (err: Error): FetchImpl =>
  resolve(fakeResponse({ ok: true, status: 200, text: () => Promise.reject(err) }));

/** Where outside text can arrive — one freshly built carrier per call. */
const CHANNELS: [string, (text: string) => FetchImpl][] = [
  ['a fetch rejection’s own message', (t) => reject(new TypeError(t))],
  [
    'the message on its cause',
    (t) =>
      reject(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error(t), { code: 'ECONNRESET' }),
        }),
      ),
  ],
  [
    'an AggregateError member',
    (t) =>
      reject(
        new TypeError('fetch failed', {
          cause: new AggregateError([Object.assign(new Error(t), { code: 'ECONNREFUSED' })], ''),
        }),
      ),
  ],
  [
    'an own property holding the request',
    (t) => reject(Object.assign(new TypeError('fetch failed'), { request: { body: t } })),
  ],
  [
    'a symbol-keyed property',
    (t) => reject(Object.assign(new TypeError('fetch failed'), { [Symbol('requestBody')]: t })),
  ],
  [
    'a Map and a Set',
    (t) =>
      reject(
        Object.assign(new TypeError('fetch failed'), {
          request: new Map([['body', t]]),
          tried: new Set([t]),
        }),
      ),
  ],
  [
    'a named property on a Buffer',
    (t) =>
      reject(
        Object.assign(new TypeError('fetch failed'), {
          chunk: Object.assign(Buffer.from('abcd'), { body: t }),
        }),
      ),
  ],
  [
    'URLSearchParams and a boxed String',
    (t) =>
      reject(
        Object.assign(new TypeError('fetch failed'), {
          query: new URLSearchParams({ PASSWORD: t }),
          boxed: new String(t),
        }),
      ),
  ],
  [
    'a stack materialized before the throw',
    (t) => {
      const inner = new Error(t);
      void inner.stack;
      return reject(new TypeError('fetch failed', { cause: inner }));
    },
  ],
  [
    'a custom inspect',
    (t) => reject(Object.assign(new TypeError('fetch failed'), { [inspect.custom]: () => t })),
  ],
  [
    'a getter that answers differently on the second read',
    (t) => {
      let reads = 0;
      const err = new TypeError('fetch failed');
      Object.defineProperty(err, 'detail', {
        enumerable: true,
        get: () => (reads++ === 0 ? '' : t),
      });
      return reject(err);
    },
  ],
  [
    'a node shared between a deep and a shallow path',
    (t) => {
      const shared = { deep: { leak: t } };
      return reject(
        Object.assign(new TypeError('fetch failed'), {
          b: { b1: { b2: { b3: shared } } },
          a: shared,
        }),
      );
    },
  ],
  [
    'a timeout’s message and cause',
    (t) => reject(Object.assign(new DOMException(t, 'TimeoutError'), { cause: new Error(t) })),
  ],
  ['a body read’s rejection', (t) => failingBody(new TypeError(t))],
  [
    'a body read’s cause',
    (t) =>
      failingBody(
        new TypeError('terminated', {
          cause: Object.assign(new Error(t), { code: 'UND_ERR_SOCKET' }),
        }),
      ),
  ],
  ['a body read’s timeout', (t) => failingBody(new DOMException(t, 'TimeoutError'))],
  [
    'an error response’s JSON message',
    (t) => resolve(jsonResponse(400, { __type: 'NotAuthorizedException', message: t, Message: t })),
  ],
  [
    'an error response’s raw text inside JSON quotes',
    (t) => resolve(new Response(`{"__type":"X","message":"echo: ${t}"}`, { status: 403 })),
  ],
  [
    'an HTML block page',
    (t) =>
      resolve(
        new Response(`<html>blocked: ${t}</html>`, {
          status: 403,
          headers: { 'content-type': 'text/html' },
        }),
      ),
  ],
  [
    // Placed so that a 200-character preview would show the whole leading
    // canary: a cut landing inside it would make this channel pass vacuously.
    'a long body a preview would cut',
    (t) => resolve(new Response(`${'y'.repeat(150)}${t}`, { status: 403 })),
  ],
  ['an error type field', (t) => resolve(jsonResponse(400, { __type: t }))],
  [
    'a content-type header',
    (t) =>
      resolve(
        fakeResponse({ ok: false, status: 400, contentType: t, text: () => Promise.resolve('') }),
      ),
  ],
  ['a 200 that is not JSON', (t) => resolve(new Response(`not json: ${t}`))],
  ['a challenge name', (t) => resolve(jsonResponse(200, { ChallengeName: t }))],
  [
    'the other fields of a 200 with no token',
    (t) => resolve(jsonResponse(200, { AuthenticationResult: { IdToken: t }, Session: t })),
  ],
];

describe('the two fixed messages of Node’s fetch it recognises', () => {
  // Measured through this environment's HTTPS proxy with NODE_USE_ENV_PROXY=1:
  // a refused tunnel arrives as `fetch failed` → DOMException "Request was
  // cancelled." → an AbortError coded UND_ERR_ABORTED whose message is
  // undici's fixed "Proxy response (NNN) !== 200 when HTTP Tunneling".
  const tunnelRefused = (message: string) =>
    new TypeError('fetch failed', {
      cause: Object.assign(new DOMException('Request was cancelled.', 'Error'), {
        cause: Object.assign(new Error(message), { name: 'AbortError', code: 'UND_ERR_ABORTED' }),
      }),
    });

  it('names a proxy refusing the tunnel, and its status', async () => {
    const err = await thrownBy(
      reject(tunnelRefused('Proxy response (502) !== 200 when HTTP Tunneling')),
    );

    expect(err.message).toBe(
      `Cognito sign-in for demo-ana@example.test could not reach ${ENDPOINT}: ` +
        'UND_ERR_ABORTED (the HTTPS proxy refused the tunnel with HTTP 502)',
    );
  });

  it.each([
    ['text after it', 'Proxy response (502) !== 200 when HTTP Tunneling: hunter2-not-real'],
    ['text before it', 'hunter2-not-real Proxy response (502) !== 200 when HTTP Tunneling'],
    ['a status no HTTP response has', 'Proxy response (999) !== 200 when HTTP Tunneling'],
  ])('keeps only an exact match of that message — not with %s', async (_label, message) => {
    const err = await thrownBy(reject(tunnelRefused(message)));

    expect(err.message).toBe(
      `Cognito sign-in for demo-ana@example.test could not reach ${ENDPOINT}: ` +
        'UND_ERR_ABORTED (the request was cancelled before an answer — most often an HTTPS ' +
        'proxy refusing the tunnel)',
    );
  });

  it('gives the status to the code it explains, not to a neighbour', async () => {
    const err = await thrownBy(
      reject(
        Object.assign(tunnelRefused('Proxy response (502) !== 200 when HTTP Tunneling'), {
          code: 'ECONNRESET',
        }),
      ),
    );

    expect(err.message).toBe(
      `Cognito sign-in for demo-ana@example.test could not reach ${ENDPOINT}: ` +
        'ECONNRESET, UND_ERR_ABORTED (the HTTPS proxy refused the tunnel with HTTP 502)',
    );
  });

  it('names a refused redirect', async () => {
    // What `redirect: 'error'` produces (measured): no code, a fixed message.
    const err = await thrownBy(
      reject(new TypeError('fetch failed', { cause: new Error('unexpected redirect') })),
    );

    expect(err.message).toBe(
      `Cognito sign-in for demo-ana@example.test got a redirect from ${ENDPOINT}, refused so ` +
        'the password is not sent on',
    );
  });

  it('does not take a message that merely contains those words for it', async () => {
    const err = await thrownBy(
      reject(
        new TypeError('fetch failed', {
          cause: new Error('unexpected redirect to https://evil.example/?pw=hunter2-not-real'),
        }),
      ),
    );

    expect(err.message).toMatch(/: no error code, and the fetch layer's own/);
  });
});

describe('what it throws carries no text from outside', () => {
  it.each(CHANNELS)('through %s', async (_channel, carrying) => {
    const failures: string[] = [];
    for (const password of PASSWORDS) {
      for (const [encoding, encode] of ENCODINGS) {
        const err = await thrownBy(carrying(`${CANARY} ${encode(password)} ${CANARY}`), {
          username: creds.username,
          password,
        });
        const label = `${encoding} ${JSON.stringify(password)}`;
        if (exposes(err, password)) failures.push(`${label}: the password is readable`);
        if (printedForms(err).some((text) => text.toLowerCase().includes(CANARY))) {
          failures.push(`${label}: outside text got through`);
        }
        if (err.cause !== undefined) failures.push(`${label}: a cause is attached`);
      }
    }
    expect(failures).toEqual([]);
  });
});

/*
 * The fields a word is read from. Whatever arrives in one — an echo of the
 * password in any rendering, or anything else — the message must be one the
 * module prints for a value that has nothing to do with the password: the one
 * for a value it does not recognise, or the one for a word of its own. That
 * holds by construction, since what prints is chosen from KNOWN_WORDS; these
 * tests check the construction: for every word, for echoes of passwords of
 * every kind, and for the echoes that got past the designs before this one.
 */
const WORD_FIELDS: [string, keyof typeof KNOWN_WORDS, (value: string) => FetchImpl][] = [
  [
    'an error code',
    'codes',
    (v) =>
      reject(new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: v }) })),
  ],
  [
    'an AggregateError member’s code',
    'codes',
    (v) =>
      reject(
        new TypeError('fetch failed', {
          cause: new AggregateError([Object.assign(new Error('x'), { code: v })], ''),
        }),
      ),
  ],
  [
    'a body read’s code',
    'codes',
    (v) =>
      failingBody(
        new TypeError('terminated', { cause: Object.assign(new Error('x'), { code: v }) }),
      ),
  ],
  ['an error type', 'types', (v) => resolve(jsonResponse(400, { __type: v }))],
  ['a challenge name', 'challenges', (v) => resolve(jsonResponse(200, { ChallengeName: v }))],
  [
    'a media type',
    'mediaTypes',
    (v) =>
      resolve(
        fakeResponse({ ok: false, status: 400, contentType: v, text: () => Promise.resolve('') }),
      ),
  ],
];

/** The carrier for the field called `label`. */
function field(label: string): (value: string) => FetchImpl {
  const found = WORD_FIELDS.find(([name]) => name === label);
  if (found === undefined) throw new Error(`no field ${label}`);
  return found[2];
}

/** A value no list holds. */
const UNRECOGNISED = 'NOT_A_WORD_THIS_MODULE_KNOWS';

/** The message thrown for a sign-in answered by `carrying`. */
async function messageFor(carrying: FetchImpl, password = creds.password): Promise<string> {
  return (await thrownBy(carrying, { username: creds.username, password })).message;
}

/**
 * Every message a field can produce for a value that has nothing to do with the
 * password: an empty one, an unrecognised one, and each word of its list.
 */
async function passwordFreeMessages(
  carrying: (value: string) => FetchImpl,
  words: ReadonlySet<string>,
): Promise<Set<string>> {
  const messages = new Set([
    await messageFor(carrying('')),
    await messageFor(carrying(UNRECOGNISED)),
  ]);
  for (const word of words) messages.add(await messageFor(carrying(word)));
  return messages;
}

const ECHO_PASSWORDS = [
  'Bali#Summer2026',
  'Tr0ub4dor:Horse',
  'Blue/Sky;2026',
  'Correct#Horse#Battery9',
  'HUNTER2_NOT_REAL',
  'Kelvin2026Horse',
  // Fullwidth, as typed with an IME in full-width mode, and mathematical bold:
  // a normalising echo writes them in ASCII.
  'ＳＵＭＭＥＲ＿２０２６',
  'Ｂａｌｉ＃Ｓｕｍｍｅｒ２０２６',
  '\u{1D40F}\u{1D41A}\u{1D42C}\u{1D42C}\u{1D430}\u{1D428}\u{1D42B}\u{1D41D}\u{1D7D0}\u{1D7CE}\u{1D7D0}\u{1D7D4}',
  'Pässwörd',
  'q-7-z-k-2-w-x',
  // Each of these got an echo past the design before this one: letters no
  // decomposition turns into ASCII, a combining mark that upper-cases to a
  // letter, a capital sharp s, another script.
  'Þórður-9Æsir',
  'Łódź-Øre1',
  'aͅbͅcͅdͅeͅ',
  'ẞa-ẞo-ẞu-1',
  'Пароль-секрет',
  // Words of the module's own inside a password, one that is one, and one with
  // no letter or digit in it at all.
  'Bali#NotAuthorizedException',
  'ENOTFOUND_2026',
  'PASSWORD',
  '!@#$%^&*',
];

/** A password's words, split at anything that is not a letter or a digit. */
const wordsOf = (p: string) => p.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '');

/** Letters with no decomposition, as an echo that folds to ASCII writes them. */
const IN_ASCII: Record<string, string> = {
  Þ: 'TH',
  þ: 'th',
  Ð: 'D',
  ð: 'd',
  Đ: 'D',
  đ: 'd',
  Æ: 'AE',
  æ: 'ae',
  Ø: 'O',
  ø: 'o',
  Ł: 'L',
  ł: 'l',
  Œ: 'OE',
  œ: 'oe',
  ß: 'ss',
  ẞ: 'SS',
  // The Cyrillic letters the passwords above use, romanised.
  П: 'P',
  а: 'a',
  р: 'r',
  о: 'o',
  л: 'l',
  ь: '',
  с: 's',
  е: 'e',
  к: 'k',
  т: 't',
};

const ECHOES: [string, (password: string) => string][] = [
  ['verbatim', (p) => p],
  ['upper-cased', (p) => p.toUpperCase()],
  ['lower-cased, then upper-cased', (p) => p.toLowerCase().toUpperCase()],
  ['NFKC-normalised', (p) => p.normalize('NFKC')],
  ['cut short', (p) => p.slice(0, -2)],
  ['cut at the front', (p) => p.slice(2)],
  [
    'accents stripped, separators swapped, upper-cased',
    (p) =>
      p
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\p{L}\p{N}]/gu, '_')
        .toUpperCase(),
  ],
  [
    'written in ASCII, separators swapped, upper-cased',
    (p) =>
      [...p.normalize('NFKD').replace(/\p{M}/gu, '')]
        .map((char) => IN_ASCII[char] ?? char)
        .join('')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .toUpperCase(),
  ],
  ['its first word', (p) => wordsOf(p)[0] ?? p],
  ['its last word', (p) => wordsOf(p).at(-1) ?? p],
];

describe('what prints for a value from outside is a word of the module’s own', () => {
  it('holds only words in each list: no spaces, quotes or free text', () => {
    // Every entry prints verbatim, so each list must hold only its field's
    // identifiers; a sentence added by mistake would print as it stands.
    const shapes: Record<keyof typeof KNOWN_WORDS, RegExp> = {
      codes: /^[A-Z][A-Z0-9_]+$/,
      types: /^[A-Z][A-Za-z]+$/,
      challenges: /^[A-Z][A-Z_]+$/,
      mediaTypes: /^[a-z]+\/[a-z0-9.+-]+$/,
    };
    for (const [list, shape] of Object.entries(shapes) as [keyof typeof KNOWN_WORDS, RegExp][]) {
      expect(KNOWN_WORDS[list].size, list).toBeGreaterThan(0);
      for (const word of KNOWN_WORDS[list]) expect(word, list).toMatch(shape);
    }
  });

  it.each(WORD_FIELDS)(
    'through %s, each word of its list prints as itself',
    async (_f, list, carrying) => {
      for (const word of KNOWN_WORDS[list]) {
        expect(await messageFor(carrying(word)), word).toContain(word);
      }
    },
  );

  it.each(WORD_FIELDS)(
    'through %s, no echo of any password prints anything else',
    async (_f, list, carrying) => {
      const allowed = await passwordFreeMessages(carrying, KNOWN_WORDS[list]);
      const failures: string[] = [];
      for (const password of ECHO_PASSWORDS) {
        for (const [echo, shape] of ECHOES) {
          const message = await messageFor(carrying(shape(password)), password);
          if (!allowed.has(message))
            failures.push(`${echo} ${JSON.stringify(password)}: ${message}`);
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it.each(WORD_FIELDS)(
    'through %s, the message is the same whatever the password',
    async (_f, list, carrying) => {
      const [word = ''] = KNOWN_WORDS[list];
      for (const value of [word, UNRECOGNISED]) {
        const messages = new Set<string>();
        for (const password of ['', 'x', '\u{1F512}\u{1F511}', ...ECHO_PASSWORDS]) {
          messages.add(await messageFor(carrying(value), password));
        }
        expect([...messages], value).toHaveLength(1);
      }
    },
  );

  it.each(WORD_FIELDS)(
    'through %s, a word is taken only as spelled',
    async (_f, list, carrying) => {
      // The media type is lower-cased and trimmed before it is compared, as a
      // header is; everything else is compared as it arrived.
      const [word = ''] = KNOWN_WORDS[list];
      const unrecognised = await messageFor(carrying(UNRECOGNISED));
      const variants = [`${word}x`, `x${word}`, `${word} ${CANARY}`, `${CANARY} ${word}`];
      if (list !== 'mediaTypes') variants.push(word.toLowerCase(), ` ${word}`, `${word} `);
      for (const variant of variants) {
        expect(await messageFor(carrying(variant)), JSON.stringify(variant)).toBe(unrecognised);
      }
    },
  );

  it.each([
    ['written in ASCII', 'Þórður-9Æsir', 'THORDUR_9AESIR'],
    ['with its Polish letters written in ASCII', 'Łódź-łąka', 'LODZ_LAKA'],
    ['romanised', 'Пароль-секрет', 'PAROL_SEKRET'],
    ['with a combining ypogegrammeni stripped', 'aͅbͅcͅdͅeͅ', 'ABCDE'],
    ['with a capital sharp s lowered, then raised', 'ẞa-ẞo-ẞu-1', 'SSA_SSO_SSU_1'],
  ])('prints nothing of a password echoed %s', async (_label, password, echo) => {
    // Each printed whole through the design before this one: what it compared
    // with the password, an echo could write some other way.
    for (const [name, , carrying] of WORD_FIELDS) {
      expect(await messageFor(carrying(echo), password), name).toBe(
        await messageFor(carrying(UNRECOGNISED)),
      );
    }
  });

  it.each([
    [
      'a word cut out of it',
      'an error type',
      'Bali#NotAuthorizedException',
      'NotAuthorizedException',
    ],
    ['written in ASCII as a word', 'a challenge name', 'Pässwørd', 'PASSWORD'],
  ])(
    'prints for an echo of the password that is %s what a genuine answer prints',
    async (_label, name, password, word) => {
      // What a message can still carry from an echo, and why it is accepted:
      // the word is the module's own, and a genuine answer prints the same
      // text whatever the password is — so it says which word came back, and
      // nothing else.
      const carrying = field(name);
      const echo = name === 'an error type' ? password : word;
      expect(await messageFor(carrying(echo), password)).toBe(
        await messageFor(carrying(word), 'an-unrelated-password-9'),
      );
    },
  );

  it('refuses a status that is not an HTTP status', async () => {
    const err = await thrownBy(
      resolve(
        fakeResponse({
          ok: false,
          status: 'hunter2-not-real' as unknown as number,
          text: () => Promise.resolve(''),
        }),
      ),
    );

    expect(exposes(err, creds.password)).toBe(false);
    expect(err.message).toContain('an invalid HTTP status');
  });
});

describe('the regressions reported against the scrubbing version', () => {
  // Each input below is the one that reproduced the leak or the false report
  // against the module this replaced (d8ec93a); each is kept verbatim.
  const escaped = '\\u0068\\u0075\\u006e\\u0074\\u0065\\u0072\\u0032-not-real';

  it('a 403 whose JSON message \\u-escapes the password does not print it once parsed', async () => {
    const err = await thrownBy(
      resolve(new Response(`{"__type":"X","message":"echo: ${escaped}"}`, { status: 403 })),
    );

    expect(exposes(err, creds.password)).toBe(false);
    expect(err.message).toContain('HTTP 403');
  });

  it('a fetch-layer cause that \\u-escapes the password is not printed in the message', async () => {
    const err = await thrownBy(
      reject(new TypeError('fetch failed', { cause: new Error(`sent {"PASSWORD":"${escaped}"}`) })),
    );

    expect(exposes(err, creds.password)).toBe(false);
    expect(err.message).toContain('could not reach');
  });

  it('a challenge name quoting the password is not printed', async () => {
    const err = await thrownBy(
      resolve(
        jsonResponse(200, {
          ChallengeName: `NEW_PASSWORD_REQUIRED (sent PASSWORD=${creds.password})`,
        }),
      ),
    );

    expect(exposes(err, creds.password)).toBe(false);
    expect(err.message).toContain('needs a challenge');
  });

  it('a benign failure holding a \\u{FFFFFF} literal is still reported for what it is', async () => {
    // The scrubbing version decoded that literal with String.fromCodePoint, got
    // a RangeError, and reported the error "could not be inspected".
    const err = await thrownBy(
      reject(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('getaddrinfo ENOTFOUND host (config had \\u{FFFFFF})'), {
            code: 'ENOTFOUND',
          }),
        }),
      ),
    );

    expect(err.message).toBe(
      `Cognito sign-in for demo-ana@example.test could not reach ${ENDPOINT}: ` +
        'ENOTFOUND (the host does not resolve — check the region)',
    );
  });
});

describe('hostile objects never cost the operator’s one actionable line', () => {
  it('an own getter that throws', async () => {
    const hostile = new TypeError('fetch failed');
    Object.defineProperty(hostile, 'code', {
      enumerable: true,
      get() {
        throw new Error('getter exploded');
      },
    });

    const err = await thrownBy(reject(hostile));

    expect(err.message).toContain(`could not reach ${ENDPOINT}`);
    expect(err.message).not.toContain('getter exploded');
  });

  it('`errors` that is not an array, and `cause` that throws on read', async () => {
    const aggregate = new AggregateError([], '');
    (aggregate as unknown as { errors: unknown }).errors = 42;
    const hostile = new TypeError('fetch failed');
    Object.defineProperty(hostile, 'cause', {
      get() {
        throw new Error('cause exploded');
      },
    });

    for (const failure of [new TypeError('fetch failed', { cause: aggregate }), hostile]) {
      const err = await thrownBy(reject(failure));
      expect(err.message).toContain(`could not reach ${ENDPOINT}`);
      expect(err.message).not.toMatch(/exploded|not iterable/);
    }
  });

  it('a `name` that throws is not taken for a timeout', async () => {
    const hostile = new TypeError('fetch failed');
    Object.defineProperty(hostile, 'name', {
      get() {
        throw new Error('name exploded');
      },
    });

    const err = await thrownBy(reject(hostile));

    expect(err.message).toContain(`could not reach ${ENDPOINT}`);
  });

  it('a Proxy whose every trap throws, and a revoked one', async () => {
    const trap = () => {
      throw new Error('trap exploded');
    };
    const hostile = new Proxy(new TypeError('fetch failed'), {
      get: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
      getOwnPropertyDescriptor: trap,
      has: trap,
    });
    const { proxy: revoked, revoke } = Proxy.revocable(new Error('x'), {});
    revoke();

    // And as `errors` itself: Array.isArray throws on a revoked Proxy, and
    // slicing a trapped one runs its traps.
    const revokedErrors = new AggregateError([], '');
    (revokedErrors as unknown as { errors: unknown }).errors = revoked;
    const trappedErrors = new AggregateError([], '');
    (trappedErrors as unknown as { errors: unknown }).errors = new Proxy([], { get: trap });

    for (const failure of [
      hostile,
      new TypeError('fetch failed', { cause: revoked }),
      new TypeError('fetch failed', { cause: revokedErrors }),
      new TypeError('fetch failed', { cause: trappedErrors }),
    ]) {
      const err = await thrownBy(reject(failure));
      expect(err.message).toContain(`could not reach ${ENDPOINT}`);
      expect(err.message).not.toContain('exploded');
    }
  });

  it('a cause chain that loops back on itself is walked once', async () => {
    // Two errors, each the other's cause. The node budget counts distinct nodes,
    // so without the visited-once rule this walk would never end.
    const reads = new Map<string, number>();
    const node = (name: string): Error =>
      Object.defineProperty(new TypeError(name), 'code', {
        get: () => {
          reads.set(name, (reads.get(name) ?? 0) + 1);
          return 'ECONNRESET';
        },
      });
    const a = node('a');
    const b = node('b');
    Object.defineProperty(a, 'cause', { value: b });
    Object.defineProperty(b, 'cause', { value: a });

    const err = await thrownBy(reject(a));

    expect(err.message).toMatch(/: ECONNRESET$/);
    expect(Object.fromEntries(reads)).toEqual({ a: 1, b: 1 });
  });

  it('a graph far larger than the walk’s budget is cut off, not walked', async () => {
    // Every node counts the reads of its `code`: an AggregateError of 32, each
    // of 32 more — over a thousand nodes, of which the walk visits its budget.
    let reads = 0;
    const counted = <T extends Error>(node: T): T =>
      Object.defineProperty(node, 'code', {
        get: () => {
          reads++;
          return 'ECONNREFUSED';
        },
      });
    const leaf = () => counted(new Error('x'));
    const wide = () => counted(new AggregateError(Array.from({ length: 32 }, leaf), ''));
    const root = counted(new AggregateError(Array.from({ length: 32 }, wide), ''));

    const err = await thrownBy(reject(new TypeError('fetch failed', { cause: root })));

    expect(err.message).toMatch(/: ECONNREFUSED$/);
    expect(reads).toBeLessThanOrEqual(32);
  });

  it('an `errors` array whose own methods are hostile runs none of them', async () => {
    // Reviewers' inputs: an array can carry its own `slice`, a species
    // constructor, or an iterator, and whatever they return — a foreign error
    // quoting the request, a non-iterable, an endless iterator — must never
    // reach the operator. The members are copied out by index instead.
    const echo = () => {
      throw new Error(`request: {"PASSWORD":"${creds.password}"}`);
    };
    const throwingIterable = { [Symbol.iterator]: echo };
    const endless = {
      *[Symbol.iterator]() {
        for (;;) yield new Error('again');
      },
    };
    const withSlice = (slice: () => unknown) =>
      Object.assign([Object.assign(new Error('m'), { code: 'ECONNREFUSED' })], { slice });
    const species = Object.assign([new Error('m')], {
      constructor: { [Symbol.species]: echo },
    });
    const trapped = new Proxy([new Error('m')], {
      get: (target, key, receiver) =>
        key === 'slice' || key === Symbol.iterator
          ? echo
          : (Reflect.get(target, key, receiver) as unknown),
    });

    for (const errors of [
      withSlice(() => throwingIterable),
      withSlice(() => 42),
      withSlice(() => endless),
      species,
      trapped,
    ]) {
      for (const carrier of [
        reject(Object.assign(new TypeError('fetch failed'), { errors })),
        failingBody(Object.assign(new TypeError('terminated'), { errors })),
      ]) {
        const err = await thrownBy(carrier);
        expect(err.message).toMatch(/^Cognito sign-in for demo-ana@example\.test /);
        expect(exposes(err, creds.password)).toBe(false);
      }
    }
  });

  it('a `message` that is not a string', async () => {
    // Compared against fixed messages only when it is a string: a Symbol would
    // make the comparison itself throw.
    const odd = Object.defineProperty(new TypeError('fetch failed'), 'message', {
      value: Symbol('message'),
    });

    const err = await thrownBy(reject(odd));

    expect(err.message).toContain(`could not reach ${ENDPOINT}: no error code`);
  });

  it('an AggregateError with 300,000 members reads only its budget of them', async () => {
    // Uncapped, copying the members out overflows the call stack when they are
    // handed on — a RangeError in place of the operator's line.
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const aggregate = new AggregateError(
      Array.from({ length: 300_000 }, () => refused),
      '',
    );

    const err = await thrownBy(reject(new TypeError('fetch failed', { cause: aggregate })));

    expect(err.message).toMatch(/: ECONNREFUSED$/);
  });

  it('a response whose fields throw on read', async () => {
    const trap = () => {
      throw new Error('response exploded');
    };
    const response = {
      get ok(): boolean {
        return trap();
      },
      get status(): number {
        return trap();
      },
      headers: { get: trap },
      text: () => Promise.resolve(''),
    };

    const err = await thrownBy(resolve(response));

    expect(err.message).toBe(
      'Cognito sign-in failed for demo-ana@example.test — an invalid HTTP status, with no ' +
        'Cognito error type and an empty body',
    );
  });

  it('a response whose `ok` is truthy but not `true` is not a success', async () => {
    const lookalike = {
      ok: 'true',
      status: 200,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({ AuthenticationResult: { AccessToken: 't' } })),
    };

    const err = await thrownBy(resolve(lookalike));

    expect(err.message).toBe(
      'Cognito sign-in failed for demo-ana@example.test — HTTP 200, with no Cognito error ' +
        'type; its body is withheld, since a proxy can quote the request it refused',
    );
  });

  it('a fetch that resolves to nothing, or throws before it returns', async () => {
    const nothing = await thrownBy(() => Promise.resolve(undefined));
    expect(nothing.message).toContain(`could not read the response from ${ENDPOINT}`);

    const sync = await thrownBy(() => {
      throw new Error('thrown synchronously');
    });
    expect(sync.message).toContain(`could not reach ${ENDPOINT}`);
    expect(sync.message).not.toContain('thrown synchronously');
  });
});

describe('the decoder these assertions rely on', () => {
  // An assertion that cannot see through an encoding passes vacuously, so the
  // decoder is pinned too.
  it.each([
    ['\\u escapes', '\\u0068\\u0075', 'hu'],
    ['braced \\u escapes', '\\u{68}\\u{1F600}', 'h\u{1F600}'],
    ['escapes stacked twice', '\\\\u0068', 'h'],
    ['\\x escapes', '\\x68\\x75', 'hu'],
    ['percent-encoding', '%68%C3%A4', 'hä'],
    ['HTML references', '&#104;&#x75;&quot;', 'hu"'],
    ['inspect quoting', inspect('pa"ss\\wo\'rd`'), 'pa"ss\\wo\'rd`'],
  ])('reads through %s', (_label, text, plain) => {
    expect(readableForms(text).some((form) => form.includes(plain))).toBe(true);
  });

  it('leaves an escape naming no code point as written, rather than throwing', () => {
    expect(readableForms('a \\u{FFFFFF} b &#99999999; c')).toContain(
      'a \\u{FFFFFF} b &#99999999; c',
    );
  });
});
