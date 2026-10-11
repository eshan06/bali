import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { DECK_CONTENT_TYPE, type DeckStorage, s3DeckStorage } from '../src/deck-storage.js';

/*
 * The deck bucket's check (docs/RUNBOOKS.md, runbook 10; PLAN's M0), run where the API runs and
 * with its variables: `railway ssh --service bali -- npm run --silent deck-bucket:check`. As a
 * browser would, it uploads a small file by a presigned PUT and takes it back by a presigned GET;
 * it checks the bucket refuses another length or type, and lets each of CORS_ORIGINS upload and
 * download and no other origin; then the API reads the file and deletes it. A line per check, then
 * PASS or FAIL.
 */

/** An origin the bucket's CORS must refuse. */
const STRANGER = 'https://example.com';

/** Every check, a line each; true when all passed. */
export async function checkDeckBucket(
  storage: DeckStorage,
  origins: readonly string[],
  print: (line: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const key = `check/${randomUUID()}.pdf`;
  const file = new TextEncoder().encode('%PDF-1.4\n% Bali: the deck bucket check\n');
  let failed = 0;
  const check = (ok: boolean, what: string) => {
    print(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
    if (!ok) failed += 1;
  };
  const upload = storage.uploadUrl(key, file.byteLength);
  const put = async (body: Uint8Array, type = DECK_CONTENT_TYPE) =>
    (await fetchImpl(upload, { method: 'PUT', headers: { 'content-type': type }, body })).status;
  /** The origin a preflight from `origin` is allowed, or null when it is refused. */
  const cors = async (url: string, origin: string, method: string) => {
    const headers = {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'content-type',
    };
    const answer = await fetchImpl(url, { method: 'OPTIONS', headers });
    return answer.ok ? answer.headers.get('access-control-allow-origin') : null;
  };

  try {
    check((await put(file)) === 200, 'a presigned PUT uploads a PDF');
    check(
      (await put(new Uint8Array(file.byteLength + 1))) === 403,
      'one of another length is refused',
    );
    check((await put(file, 'text/plain')) === 403, 'one of another type is refused');
    const download = storage.downloadUrl(key);
    const got = await fetchImpl(download);
    const same = Buffer.from(await got.arrayBuffer()).equals(file);
    check(got.status === 200 && same, 'a presigned GET gives it back');
    check(
      got.headers.get('cache-control') === 'no-store',
      'its answer says Cache-Control: no-store',
    );
    check(origins.length > 0, 'CORS_ORIGINS names the portal’s origins');
    for (const origin of origins) {
      check((await cors(upload, origin, 'PUT')) === origin, `${origin} may upload (CORS)`);
      check((await cors(download, origin, 'GET')) === origin, `${origin} may download (CORS)`);
    }
    check((await cors(upload, STRANGER, 'PUT')) === null, `${STRANGER}, any other origin, may not`);
    const read = await storage.read(key, file.byteLength);
    check(read instanceof Uint8Array && Buffer.from(read).equals(file), 'the API reads it');
    await storage.delete(key);
    check((await storage.read(key, file.byteLength)) === 'missing', 'the API deletes it');
  } finally {
    await storage.delete(key).catch(() => undefined);
  }
  print(failed === 0 ? 'PASS: the deck bucket works.' : `FAIL: ${failed} of the checks above.`);
  return failed === 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    // Here, not above: env.ts reads the variables as it loads, and refuses them as the boot does.
    const { env } = await import('../src/env.js');
    const storage = s3DeckStorage(env);
    if (!storage) throw new Error('deck storage is off: the four DECK_BUCKET variables are unset');
    const origins =
      env.CORS_ORIGINS?.split(',')
        .map((o) => o.trim())
        .filter(Boolean) ?? [];
    process.exitCode = (await checkDeckBucket(storage, origins, console.log)) ? 0 : 1;
  } catch (err) {
    // env.ts's refusals and a StorageError name the variable, or S3's code, never a secret.
    console.log(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
