import { createHmac, randomBytes } from 'node:crypto';

import type { Env } from './env.js';
import { awsUriEncode, presignV4, sha256, signV4 } from './sigv4.js';

/*
 * Where decks' PDFs are kept (Phase 7, M1; ARCHITECTURE, hosting decision 6 and Live lesson
 * decision 8): a private S3 bucket per environment, reached by presigned URLs, signed by Node's
 * own crypto (`sigv4.ts`); or, for CI and the demo, an in-memory stand-in whose URLs its own
 * `fetch` answers. A key is the API's own (M2's `storage_key`), never a client's.
 */

declare module 'fastify' {
  interface FastifyInstance {
    /** Decks' storage, or undefined while it is off (`buildApp`): M2's routes take it. */
    deckStorage: DeckStorage | undefined;
  }
}

export interface DeckStorage {
  /** A presigned PUT of a PDF of exactly `bytes` bytes (decision 6, `POST /v1/decks`). */
  uploadUrl(key: string, bytes: number): string;
  /** A presigned GET, its answer marked `Cache-Control: no-store` (decision 13). */
  downloadUrl(key: string): string;
  /** The object's bytes; `missing`; or `too_large`, read no further than `maxBytes` (M2). */
  read(key: string, maxBytes: number): Promise<Uint8Array | 'missing' | 'too_large'>;
  /** Deletes the object; one already gone is fine (M4). */
  delete(key: string): Promise<void>;
}

export const DECK_CONTENT_TYPE = 'application/pdf';
/** How long either URL works: the PUT's 5 minutes (decision 6), the GET's few. */
export const URL_LIFETIME_S = 5 * 60;
/** How long the API's own read or delete may take before it is abandoned. */
export const STORAGE_TIMEOUT_MS = 30_000;

/** S3's refusal: its error code and HTTP status, never its words. */
export class StorageError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`S3 refused: ${code} (${status})`);
    this.name = 'StorageError';
  }
}

const refusal = async (response: Response) => {
  const answer = await response.text().catch(() => '');
  return new StorageError(/<Code>([^<]+)<\/Code>/.exec(answer)?.[1] ?? 'unknown', response.status);
};

/** The bucket DECK_BUCKET names; undefined, storage off, while it is unset. */
export function s3DeckStorage(
  env: Env,
  fetchImpl: typeof fetch = fetch,
  clock: () => Date = () => new Date(),
): DeckStorage | undefined {
  const { DECK_BUCKET: bucket, DECK_BUCKET_REGION: region } = env;
  const key = {
    accessKeyId: env.DECK_BUCKET_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.DECK_BUCKET_SECRET_ACCESS_KEY ?? '',
  };
  if (!bucket || !region || !key.accessKeyId || !key.secretAccessKey) return undefined;
  // Virtual-hosted, so env.ts refuses a bucket name with a dot: its certificate wouldn't match.
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const scope = { region, service: 's3' };
  const pathOf = (objectKey: string) => `/${objectKey.split('/').map(awsUriEncode).join('/')}`;

  /** A URL that does one thing for 5 minutes, signed with `headers` and the query `own`. */
  const presign = (
    method: string,
    objectKey: string,
    headers: Record<string, string>,
    own?: Record<string, string>,
  ) => {
    const request = { method, host, path: pathOf(objectKey), headers };
    return presignV4(request, scope, key, clock(), URL_LIFETIME_S, own);
  };
  /** The API's own call, signed in its headers; S3 wants the empty payload's hash named. */
  const call = (method: 'GET' | 'DELETE', objectKey: string, own: Record<string, string> = {}) => {
    const path = pathOf(objectKey);
    const request = { method, host, path, headers: { ...own, 'x-amz-content-sha256': sha256('') } };
    const headers = signV4(request, '', scope, key, clock());
    const signal = AbortSignal.timeout(STORAGE_TIMEOUT_MS);
    return fetchImpl(`https://${host}${path}`, { method, headers, signal });
  };

  return {
    // Its length and type signed: S3 refuses a PUT that sends other ones.
    uploadUrl: (objectKey, bytes) =>
      presign('PUT', objectKey, {
        'content-length': String(bytes),
        'content-type': DECK_CONTENT_TYPE,
      }),
    downloadUrl: (objectKey) =>
      presign('GET', objectKey, {}, { 'response-cache-control': 'no-store' }),
    async read(objectKey, maxBytes) {
      // One byte past the cap and no more: S3 sends only the range asked for, so an object of any
      // size costs at most the cap to read.
      const response = await call('GET', objectKey, { range: `bytes=0-${maxBytes}` });
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return bytes.byteLength > maxBytes ? 'too_large' : bytes;
      }
      const error = await refusal(response);
      // An empty object has no byte 0 to send.
      if (error.code === 'InvalidRange') return new Uint8Array();
      // Without s3:ListBucket, which this key never holds (decision 8), S3 answers a missing
      // object 403 AccessDenied, not 404 NoSuchKey. A key that may not read the bucket at all
      // fails the runbook's check (runbook 10) before any deck is uploaded.
      if (error.code === 'NoSuchKey' || error.code === 'AccessDenied') return 'missing';
      throw error;
    },
    async delete(objectKey) {
      // 204, for an object that was never there too.
      const response = await call('DELETE', objectKey);
      if (!response.ok) throw await refusal(response);
    },
  };
}

export interface MemoryDeckStorage extends DeckStorage {
  /** Answers this storage's own URLs as S3 answers presigned ones: tests and the demo use it. */
  fetch: typeof fetch;
}

/** A host that resolves nowhere (RFC 2606), so no real request can reach a stand-in's URL. */
const MEMORY_ORIGIN = 'https://deck-storage.invalid';

/** The in-memory stand-in CI and the demo use: no AWS, the same refusals as S3's. */
export function memoryDeckStorage(clock: () => Date = () => new Date()): MemoryDeckStorage {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const secret = randomBytes(32);
  // What S3's signature covers: the method, the key, the expiry and, for a PUT, its type and length.
  const sign = (...signed: string[]) =>
    createHmac('sha256', secret).update(signed.join('\n')).digest('hex');
  const url = (key: string, method: string, ...sent: string[]) => {
    const expires = String(clock().getTime() + URL_LIFETIME_S * 1000);
    const signature = sign(method, key, expires, ...sent);
    return `${MEMORY_ORIGIN}/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}`;
  };
  const refuse = (code: string) =>
    new Response(`<Error><Code>${code}</Code></Error>`, { status: 403 });

  return {
    uploadUrl: (key, bytes) => url(key, 'PUT', DECK_CONTENT_TYPE, String(bytes)),
    downloadUrl: (key) => url(key, 'GET'),
    read: (key, maxBytes) => {
      const object = objects.get(key);
      if (!object) return Promise.resolve('missing');
      return Promise.resolve(object.byteLength > maxBytes ? 'too_large' : object.slice());
    },
    delete: (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
    async fetch(input, init) {
      const request = new Request(input, init);
      const target = new URL(request.url);
      const key = decodeURIComponent(target.pathname.slice(1));
      const expires = target.searchParams.get('expires') ?? '';
      const body = new Uint8Array(await request.arrayBuffer());
      const sent =
        request.method === 'PUT'
          ? [request.headers.get('content-type') ?? '', String(body.byteLength)]
          : [];
      const signature = sign(request.method, key, expires, ...sent);
      if (target.origin !== MEMORY_ORIGIN || target.searchParams.get('signature') !== signature) {
        return refuse('SignatureDoesNotMatch');
      }
      if (clock().getTime() > Number(expires)) return refuse('AccessDenied');
      if (request.method === 'PUT') {
        objects.set(key, body);
        return new Response(null, { status: 200 });
      }
      const object = objects.get(key);
      // As S3 answers a key with no s3:ListBucket (decision 8).
      if (!object) return refuse('AccessDenied');
      const headers = { 'content-type': DECK_CONTENT_TYPE, 'cache-control': 'no-store' };
      return new Response(object.slice(), { headers });
    },
  };
}
