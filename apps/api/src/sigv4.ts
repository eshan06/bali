import { type BinaryLike, createHash, createHmac } from 'node:crypto';

/*
 * AWS Signature Version 4 by Node's own crypto, no SDK (DECISIONS, 2026-10-09 and 2026-10-10): a
 * request signed in its headers (Cognito's admin calls, the deck bucket's read and delete), or in
 * its URL, a presigned one (the deck bucket's PUT and GET).
 */

const hmac = (key: BinaryLike, data: string) => createHmac('sha256', key).update(data).digest();
export const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');

export interface AwsRequest {
  method: string;
  host: string;
  /** As sent, each segment already `awsUriEncode`d. */
  path: string;
  /** Lower-case names, each value as sent. `host` is signed too, never listed here. */
  headers: Record<string, string>;
}
export interface AwsScope {
  region: string;
  service: string;
}
export interface AwsKey {
  accessKeyId: string;
  secretAccessKey: string;
}

/** AWS's URI encoding: every byte but A–Z, a–z, 0–9 and `-_.~` as upper-case `%XX`. */
export const awsUriEncode = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const amzDateOf = (now: Date) => now.toISOString().replace(/[-:]|\.\d{3}/g, '');
const credentialOf = (amzDate: string, scope: AwsScope) =>
  `${amzDate.slice(0, 8)}/${scope.region}/${scope.service}/aws4_request`;
const signedNamesOf = (request: AwsRequest) => [...Object.keys(request.headers), 'host'].sort();

/** The signature over a request's canonical form, its query already canonical. */
function signatureOf(
  request: AwsRequest,
  query: string,
  payloadHash: string,
  amzDate: string,
  scope: AwsScope,
  key: AwsKey,
): string {
  const headers: Record<string, string> = { ...request.headers, host: request.host };
  const names = signedNamesOf(request);
  const canonical = [
    request.method,
    request.path,
    query,
    ...names.map((name) => `${name}:${headers[name]}`),
    '',
    names.join(';'),
    payloadHash,
  ];
  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialOf(amzDate, scope),
    sha256(canonical.join('\n')),
  ];
  const signingKey = [
    amzDate.slice(0, 8),
    scope.region,
    scope.service,
    'aws4_request',
  ].reduce<BinaryLike>(hmac, `AWS4${key.secretAccessKey}`);
  return createHmac('sha256', signingKey).update(toSign.join('\n')).digest('hex');
}

/**
 * Signed in its headers, for a request with no query string: the headers to send, its own plus
 * `x-amz-date` and `authorization`. `host` is signed, not returned: fetch sets it.
 */
export function signV4(
  request: AwsRequest,
  payload: string,
  scope: AwsScope,
  key: AwsKey,
  now: Date,
): Record<string, string> {
  const amzDate = amzDateOf(now);
  const dated = { ...request, headers: { ...request.headers, 'x-amz-date': amzDate } };
  const signature = signatureOf(dated, '', sha256(payload), amzDate, scope, key);
  return {
    ...dated.headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${credentialOf(amzDate, scope)}, SignedHeaders=${signedNamesOf(dated).join(';')}, Signature=${signature}`,
  };
}

/**
 * Signed in its URL, a presigned URL good for `expiresIn` seconds from `now`: the payload unsigned
 * (`UNSIGNED-PAYLOAD`), each of `headers` signed, so a client must send it as signed. `own` is the
 * request's own query (S3's `response-cache-control`, say), signed with it.
 */
export function presignV4(
  request: AwsRequest,
  scope: AwsScope,
  key: AwsKey,
  now: Date,
  expiresIn: number,
  own: Record<string, string> = {},
): string {
  const amzDate = amzDateOf(now);
  const params = {
    ...own,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${key.accessKeyId}/${credentialOf(amzDate, scope)}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': signedNamesOf(request).join(';'),
  };
  // Sorted by name, byte by byte: upper case before lower.
  const search = Object.entries(params)
    .map(([name, value]) => [awsUriEncode(name), awsUriEncode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const signature = signatureOf(request, search, 'UNSIGNED-PAYLOAD', amzDate, scope, key);
  return `https://${request.host}${request.path}?${search}&X-Amz-Signature=${signature}`;
}
