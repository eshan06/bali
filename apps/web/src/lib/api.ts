export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider = async () => null;

export function setTokenProvider(fn: TokenProvider): void {
  tokenProvider = fn;
}

/** Invoked on a 401 from an authenticated request so an expired/revoked session is
 *  handled centrally (clear auth + bounce to /login) instead of every page silently
 *  hanging on "Loading…". The registered handler dedupes a burst of 401s itself. */
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler = () => {};
export function setUnauthorizedHandler(fn: UnauthorizedHandler): void {
  unauthorizedHandler = fn;
}

export async function getToken(): Promise<string | null> {
  return tokenProvider();
}

/** A hung (not refused) upstream must not spin a teacher action forever or stall an SSR
 *  render of the public /p and /t pages. Abort after 15s (matches the iOS client). */
const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await tokenProvider();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'timeout', 'The server took too long to respond. Please try again.');
    }
    throw new ApiError(0, 'network', 'Couldn’t reach the server. Check your connection and try again.');
  }
  clearTimeout(timer);
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    // A 401 means the token expired/was revoked mid-use — let the app re-auth centrally.
    // (403 bootstrap_required is expected during provisioning and is handled by callers.)
    if (res.status === 401) unauthorizedHandler();
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
