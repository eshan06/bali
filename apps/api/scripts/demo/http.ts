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

/**
 * A caller bound to one API base URL. An unexpected status throws with the body
 * attached: against a deployed API the body is usually the whole diagnosis
 * (`teacher access required`, `session not found`), and swallowing it would turn
 * a clear failure into a mystery.
 */
export function createCall(base: string, fetchImpl: typeof fetch = fetch): Call {
  return async function call<T>(method: string, path: string, opts: CallOpts = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.internalKey) headers['x-internal-key'] = opts.internalKey;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const want = opts.expectStatus ?? 200;
    if (res.status !== want) {
      throw new Error(`${method} ${path} → ${res.status} (wanted ${want}): ${text}`);
    }
    return (text ? JSON.parse(text) : null) as T;
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
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
