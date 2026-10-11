import type { Env } from '../env.js';
import { signV4 } from '../sigv4.js';

/*
 * Deleting a deleted account's Cognito sign-in (2026-10-09): AdminGetUser, then AdminDeleteUser,
 * signed with AWS Signature Version 4 by Node's own crypto (`sigv4.ts`), no dependency (DECISIONS,
 * 2026-10-09). The pool and its region are AUTH_ISSUER's; the key is an IAM user's allowed only
 * these two calls there. `fetch` is a seam, so tests answer for Cognito.
 */

/** A Cognito pool's issuer (`AUTH_ISSUER`): its region, then its pool id. */
export const COGNITO_ISSUER =
  /^https:\/\/cognito-idp\.([a-z0-9-]+)\.amazonaws\.com\/([a-z0-9-]+_[0-9A-Za-z]+)$/;

/** Cognito's refusal: its error type and HTTP status, never its words. */
export class CognitoError extends Error {
  constructor(
    readonly type: string,
    readonly status: number,
  ) {
    super(`Cognito refused: ${type} (${status})`);
    this.name = 'CognitoError';
  }
}

/** What a try found: it deleted the sign-in, it was gone, or its username names another now. */
export type Outcome = 'deleted' | 'gone' | 'not_theirs';
export type DeleteSignIn = (
  signIn: { username: string; sub: string },
  signal: AbortSignal,
) => Promise<Outcome>;

/** Deletes a sign-in from AUTH_ISSUER's pool; undefined, deletion off, while the key is unset. */
export function cognitoDeleter(
  env: Env,
  fetchImpl: typeof fetch = fetch,
  clock: () => Date = () => new Date(),
): DeleteSignIn | undefined {
  const key = {
    accessKeyId: env.COGNITO_DELETER_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.COGNITO_DELETER_SECRET_ACCESS_KEY ?? '',
  };
  // env.ts refuses a key beside an issuer that names no pool.
  const [, region, userPoolId] = COGNITO_ISSUER.exec(env.AUTH_ISSUER) ?? [];
  if (!key.accessKeyId || !key.secretAccessKey || !region || !userPoolId) return undefined;
  const host = `cognito-idp.${region}.amazonaws.com`;

  /** One call's answer, or null for UserNotFoundException; any other refusal throws. */
  const call = async (action: string, username: string, signal: AbortSignal) => {
    const body = JSON.stringify({ UserPoolId: userPoolId, Username: username });
    const target = `AWSCognitoIdentityProviderService.${action}`;
    const own = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': target };
    const request = { method: 'POST', host, path: '/', headers: own };
    const headers = signV4(request, body, { region, service: 'cognito-idp' }, key, clock());
    const response = await fetchImpl(`https://${host}/`, { method: 'POST', headers, body, signal });
    const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return answer;
    // The type may carry a namespace: `…#UserNotFoundException`.
    const type = typeof answer.__type === 'string' ? answer.__type.split('#').pop()! : 'unknown';
    if (type === 'UserNotFoundException') return null;
    throw new CognitoError(type, response.status);
  };

  return async ({ username, sub }, signal) => {
    const user = await call('AdminGetUser', username, signal);
    if (user === null) return 'gone';
    const attributes = (user.UserAttributes ?? []) as { Name?: unknown; Value?: unknown }[];
    const now = attributes.find((attribute) => attribute.Name === 'sub')?.Value;
    // Every user has one: an answer without it is no answer, never "another sign-in".
    if (typeof now !== 'string') throw new CognitoError('UnreadableAnswer', 200);
    // A username can come back: a Google sign-in's is the same when its person signs up again,
    // with a new sub. That sign-in is never deleted.
    if (now !== sub) return 'not_theirs';
    // ponytail: check, then delete, since AdminDeleteUser takes a username and no sub: a sign-in
    // deleted and made again under this username between the two calls, milliseconds apart, would
    // go. Cognito offers no conditional delete to close it.
    return (await call('AdminDeleteUser', username, signal)) === null ? 'gone' : 'deleted';
  };
}
