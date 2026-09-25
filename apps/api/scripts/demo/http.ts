/*
 * The one HTTP caller both demo modes use. Every actor in the demo — phone or
 * teacher's browser — speaks to the API through this, so the in-process run and
 * the deployed run exercise exactly the same request path.
 */

export interface CallOpts {
  token?: string;
  internalKey?: string;
  body?: unknown;
  expectStatus?: number;
}

export type Call = <T>(method: string, path: string, opts?: CallOpts) => Promise<T>;

/** A stalled request must become a message, not a stare. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * A caller bound to one API base URL. An unexpected status throws with the body
 * attached: against a deployed API the body is usually the whole diagnosis
 * (`teacher access required`, `session not found`), and swallowing it would turn
 * a clear failure into a mystery.
 */
export function createCall(
  base: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Call {
  return async function call<T>(method: string, path: string, opts: CallOpts = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.internalKey) headers['x-internal-key'] = opts.internalKey;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    let text: string;
    let status: number;
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      status = res.status;
      // Inside the try: a deadline that fires while the body streams must still
      // report the deadline, not a bare AbortError.
      text = await res.text();
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error(`${method} ${path} → no response within ${timeoutMs}ms`, { cause: err });
      }
      throw err;
    }
    const want = opts.expectStatus ?? 200;
    if (status !== want) {
      // The status rides along, so a caller can act on it without reading the words.
      throw Object.assign(new Error(`${method} ${path} → ${status} (wanted ${want}): ${text}`), {
        status,
      });
    }
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      // A proxy or captive portal answering with HTML would otherwise die as a
      // bare SyntaxError naming no request at all. Report the status that
      // actually came back, not a hardcoded 200 — `want` is configurable.
      throw new Error(`${method} ${path} → ${status} but not JSON: ${text.slice(0, 200)}`, {
        cause: err,
      });
    }
  };
}

/**
 * Trim a base URL to the form the caller concatenates paths onto, defaulting a
 * bare host to https (the shape a platform's URL variable usually has).
 *
 * It validates rather than coerces: stripping a trailing slash can turn a typo
 * into something that still parses as a URL, and a demo quietly pointed at the
 * wrong host is worse than one that refuses to start.
 */
export function normalizeBase(raw: string): string {
  const trimmed = raw.trim();
  // Parse before trimming anything off the end: stripping a trailing slash from
  // a scheme-only string ("http://") leaves something that re-parses as a
  // perfectly valid URL pointing at the wrong place.
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`not a usable API base URL: ${JSON.stringify(raw)}`);
  }
  if (!/^https?:$/.test(url.protocol) || url.hostname === '') {
    throw new Error(`not a usable API base URL: ${JSON.stringify(raw)}`);
  }
  // Plain http is fine for a local server and nowhere else: every request
  // carries a bearer token, and some carry the deployment's sweep key. A
  // mistyped host must not put those on the wire in the clear.
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !loopback) {
    throw new Error(
      `refusing to send credentials over plain http to ${url.hostname} — use https ` +
        `(got ${JSON.stringify(raw)})`,
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
