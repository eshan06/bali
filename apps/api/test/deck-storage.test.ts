import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { checkDeckBucket } from '../scripts/deck-bucket-check.js';
import { buildApp } from '../src/app.js';
import {
  type MemoryDeckStorage,
  memoryDeckStorage,
  s3DeckStorage,
  URL_LIFETIME_S,
} from '../src/deck-storage.js';
import type { Env } from '../src/env.js';
import { makeTestDb } from './helpers/db.js';
import { testEnv } from './helpers/env.js';

/*
 * Decks' storage (Phase 7, M1): the S3 adapter's requests, signed as the AWS SDK's own signer
 * signs them, against a fake S3; the in-memory stand-in CI and the demo use, answering its URLs as
 * S3 does; the runbook's check, run against the stand-in; and the boot's one line.
 */

const KEY = 'decks/0192d3e4-5b6a-7c8d-9e0f-a1b2c3d4e5f6';
const NOW = new Date('2026-10-10T12:34:56.789Z');
const BUCKET = {
  DECK_BUCKET: 'bali-decks-dev',
  DECK_BUCKET_REGION: 'us-east-1',
  // AWS's documented sample key.
  DECK_BUCKET_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  DECK_BUCKET_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const OBJECT = `https://bali-decks-dev.s3.us-east-1.amazonaws.com/${KEY}`;
const SIGNED =
  'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20261010%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261010T123456Z&X-Amz-Expires=300';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

interface Sent {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

/** The adapter on the bucket above, against a fake S3 answering every call with `answer`. */
function s3(answer: () => Response) {
  const sent: Sent[] = [];
  const fetchImpl = ((url: string, init: Sent['init']) => {
    sent.push({ url, init });
    return Promise.resolve(answer());
  }) as unknown as typeof fetch;
  return { storage: s3DeckStorage({ ...testEnv, ...BUCKET }, fetchImpl, () => NOW)!, sent };
}
/** S3's refusal, its words and the key included, as S3 writes one. */
const refusal = (code: string, status: number) => () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>The words S3 says</Message><Key>${KEY}</Key></Error>`,
    { status },
  );

describe('the S3 adapter', () => {
  // The signatures @smithy/signature-v4 gave these very requests when this was written.
  it('presigns the PUT, 5 minutes, for a PDF of that length, as the AWS SDK’s signer does', () => {
    expect(s3(refusal('unused', 500)).storage.uploadUrl(KEY, 123_456)).toBe(
      `${OBJECT}?${SIGNED}&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost&X-Amz-Signature=5d0a3767f59e637765347a89d6ae0df96611300e464f33bb4d34980324375c78`,
    );
    expect(URL_LIFETIME_S).toBe(300);
  });

  it('presigns the GET, 5 minutes, its answer marked no-store, as the AWS SDK’s signer does', () => {
    expect(s3(refusal('unused', 500)).storage.downloadUrl(KEY)).toBe(
      `${OBJECT}?${SIGNED}&X-Amz-SignedHeaders=host&response-cache-control=no-store&X-Amz-Signature=9edfce4a1ce54719accc2cadc64899a018d2d67fdb92e39410537ddad3fa1e66`,
    );
  });

  it('reads an object from the bucket’s own host, its signing the AWS SDK’s signer’s', async () => {
    const { storage, sent } = s3(() => new Response('%PDF-1.7 a deck', { status: 206 }));
    const read = await storage.read(KEY, 25 * 1024 * 1024);
    expect(Buffer.from(read as Uint8Array).toString()).toBe('%PDF-1.7 a deck');
    expect(sent.map(({ url, init }) => [init.method, url])).toEqual([['GET', OBJECT]]);
    expect(sent[0]!.init.headers).toEqual({
      range: 'bytes=0-26214400',
      'x-amz-content-sha256': EMPTY_SHA256,
      'x-amz-date': '20261010T123456Z',
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261010/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=08029eca5664a88f3a365be1e0fb6069c989b3131e59b8a2c7473b48e1b91e6d',
    });
    expect(sent[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks for one byte past the cap and no more: an object that fills it is too_large', async () => {
    const { storage, sent } = s3(() => new Response(new Uint8Array(4_096), { status: 206 }));
    expect(await storage.read(KEY, 4_096)).toHaveLength(4_096);
    expect(await storage.read(KEY, 4_095)).toBe('too_large');
    expect(sent.map(({ init }) => init.headers.range)).toEqual(['bytes=0-4096', 'bytes=0-4095']);
    // An empty object has no byte 0: S3 refuses the range, and the read is empty.
    expect(await s3(refusal('InvalidRange', 416)).storage.read(KEY, 4_096)).toEqual(
      new Uint8Array(),
    );
  });

  it('reads a missing object as missing: 404, or the 403 S3 gives a key without s3:ListBucket', async () => {
    expect(await s3(refusal('NoSuchKey', 404)).storage.read(KEY, 1_000)).toBe('missing');
    expect(await s3(refusal('AccessDenied', 403)).storage.read(KEY, 1_000)).toBe('missing');
  });

  it('throws any other refusal as its code and status, never S3’s words or the key', async () => {
    const err = await s3(refusal('SignatureDoesNotMatch', 403))
      .storage.read(KEY, 1_000)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'StorageError', code: 'SignatureDoesNotMatch', status: 403 });
    expect((err as Error).message).not.toContain('The words S3 says');
    expect((err as Error).message).not.toContain(KEY);
    // An answer that is not S3's XML (a proxy's page, say) is a refusal too.
    const page = () => new Response('<html>busy</html>', { status: 503 });
    await expect(s3(page).storage.read(KEY, 1_000)).rejects.toMatchObject({
      code: 'unknown',
      status: 503,
    });
  });

  it('deletes, signed as the AWS SDK’s signer signs it, S3’s 204 for one never there too', async () => {
    const { storage, sent } = s3(() => new Response(null, { status: 204 }));
    await storage.delete(KEY);
    expect(sent.map(({ url, init }) => [init.method, url])).toEqual([['DELETE', OBJECT]]);
    expect(sent[0]!.init.headers).toEqual({
      'x-amz-content-sha256': EMPTY_SHA256,
      'x-amz-date': '20261010T123456Z',
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20261010/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=2d833ab888a1a5f223337cd9b204824169ac7e74d68f13865652d6fbafea61fe',
    });
    await expect(s3(refusal('AccessDenied', 403)).storage.delete(KEY)).rejects.toMatchObject({
      code: 'AccessDenied',
      status: 403,
    });
  });

  it('is undefined — storage off — while any of the four is unset', () => {
    for (const name of Object.keys(BUCKET)) {
      expect(s3DeckStorage({ ...testEnv, ...BUCKET, [name]: undefined }), name).toBeUndefined();
    }
  });
});

describe('the in-memory stand-in', () => {
  const file = new TextEncoder().encode('%PDF-1.4 a deck');
  const put = (storage: MemoryDeckStorage, url: string, body = file, type = 'application/pdf') =>
    storage.fetch(url, { method: 'PUT', headers: { 'content-type': type }, body });

  it('takes a PUT by its URL, and gives the file back read or downloaded, marked no-store', async () => {
    const storage = memoryDeckStorage();
    const upload = storage.uploadUrl(KEY, file.byteLength);
    expect(new URL(upload).hostname).toBe('deck-storage.invalid');
    expect((await put(storage, upload)).status).toBe(200);

    const read = (await storage.read(KEY, file.byteLength)) as Uint8Array;
    expect(read).toEqual(file);
    read[0] = 0; // a copy: the stored file is unchanged
    const got = await storage.fetch(storage.downloadUrl(KEY));
    expect(got.status).toBe(200);
    expect(got.headers.get('cache-control')).toBe('no-store');
    expect(got.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(file);
  });

  it('refuses, as S3 does, another length or type, and a URL for another method or key', async () => {
    const storage = memoryDeckStorage();
    const upload = storage.uploadUrl(KEY, file.byteLength);
    const elsewhere = upload.replace(encodeURIComponent(KEY), encodeURIComponent('decks/other'));
    const answers = [
      await put(storage, upload, new Uint8Array(file.byteLength + 1)),
      await put(storage, upload, file, 'text/plain'),
      await storage.fetch(upload),
      await put(storage, elsewhere),
      await put(storage, storage.downloadUrl(KEY)),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(403);
      expect(await answer.text()).toContain('<Code>SignatureDoesNotMatch</Code>');
    }
    expect(await storage.read(KEY, 1_000)).toBe('missing');
  });

  it('refuses a URL past its 5 minutes', async () => {
    let now = NOW;
    const storage = memoryDeckStorage(() => now);
    const upload = storage.uploadUrl(KEY, file.byteLength);
    now = new Date(NOW.getTime() + URL_LIFETIME_S * 1_000);
    expect((await put(storage, upload)).status).toBe(200);
    const download = storage.downloadUrl(KEY);

    now = new Date(now.getTime() + URL_LIFETIME_S * 1_000 + 1);
    for (const answer of [await storage.fetch(download), await put(storage, upload)]) {
      expect(answer.status).toBe(403);
      expect(await answer.text()).toContain('<Code>AccessDenied</Code>');
    }
  });

  it('reads none as missing and a larger one as too_large, and deletes, as often as asked', async () => {
    const storage = memoryDeckStorage();
    expect(await storage.read(KEY, 1_000)).toBe('missing');
    await put(storage, storage.uploadUrl(KEY, file.byteLength));
    expect(await storage.read(KEY, file.byteLength - 1)).toBe('too_large');
    await storage.delete(KEY);
    await storage.delete(KEY);
    expect(await storage.read(KEY, 1_000)).toBe('missing');
    expect((await storage.fetch(storage.downloadUrl(KEY))).status).toBe(403);
  });
});

describe('the runbook’s check (runbook 10)', () => {
  const PORTAL = ['https://bali-portal.vercel.app', 'http://localhost:3000'];

  /** The stand-in, its preflights answered as a bucket whose CORS allows `allowed` answers them. */
  function bucket(allowed: readonly string[]) {
    const storage = memoryDeckStorage();
    const fetchImpl = ((input: string, init?: RequestInit) => {
      if (init?.method !== 'OPTIONS') return storage.fetch(input, init);
      const origin = new Headers(init.headers).get('origin') ?? '';
      const allows = allowed.includes(origin) || allowed.includes('*');
      return Promise.resolve(
        allows
          ? new Response(null, {
              headers: { 'access-control-allow-origin': allowed.includes('*') ? '*' : origin },
            })
          : new Response('<Error><Code>AccessForbidden</Code></Error>', { status: 403 }),
      );
    }) as typeof fetch;
    return { storage, fetchImpl };
  }

  async function run(allowed: readonly string[], origins = PORTAL) {
    const { storage, fetchImpl } = bucket(allowed);
    const lines: string[] = [];
    const passed = await checkDeckBucket(storage, origins, (line) => lines.push(line), fetchImpl);
    return { passed, lines };
  }

  it('passes a bucket that works, its CORS the portal’s origins only', async () => {
    const { passed, lines } = await run(PORTAL);
    expect(passed).toBe(true);
    expect(lines.at(-1)).toBe('PASS: the deck bucket works.');
    expect(lines.slice(0, -1).every((line) => line.startsWith('ok  '))).toBe(true);
    expect(lines).toHaveLength(14);
  });

  it('fails, naming each check, a CORS that misses an origin or allows any', async () => {
    const missing = await run([PORTAL[0]!]);
    expect(missing.passed).toBe(false);
    expect(missing.lines.filter((line) => line.startsWith('FAIL '))).toEqual([
      'FAIL  http://localhost:3000 may upload (CORS)',
      'FAIL  http://localhost:3000 may download (CORS)',
    ]);
    expect(missing.lines.at(-1)).toBe('FAIL: 2 of the checks above.');

    const any = await run(['*']);
    expect(any.passed).toBe(false);
    expect(any.lines.filter((line) => line.startsWith('FAIL '))).toHaveLength(5);

    const none = await run(PORTAL, []);
    expect(none.lines).toContain('FAIL  CORS_ORIGINS names the portal’s origins');
  });
});

describe('the boot', () => {
  it('says once whether deck storage is on, and keeps what it runs with on the app', async () => {
    const { db, close } = await makeTestDb();
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const info: Env = { ...testEnv, LOG_LEVEL: 'info' };
    const said = (words: string) => lines.filter((line) => line.includes(words));
    try {
      const off = buildApp(info, { db, logStream });
      expect(off.deckStorage).toBeUndefined();
      expect(
        said(
          '"deck storage is off: DECK_BUCKET, DECK_BUCKET_REGION, DECK_BUCKET_ACCESS_KEY_ID and DECK_BUCKET_SECRET_ACCESS_KEY are unset"',
        ),
      ).toHaveLength(1);

      const injected = memoryDeckStorage();
      const fake = buildApp(info, { db, logStream, deckStorage: injected });
      expect(fake.deckStorage).toBe(injected);
      const keyed = buildApp({ ...info, ...BUCKET }, { db, logStream });
      expect(keyed.deckStorage?.downloadUrl(KEY).startsWith(`${OBJECT}?`)).toBe(true);
      expect(said('"deck storage is on"')).toHaveLength(2);
      await Promise.all([off.close(), fake.close(), keyed.close()]);
    } finally {
      await close();
    }
  });
});
