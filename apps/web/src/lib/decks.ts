import {
  type CreateDeckResponse,
  type Deck,
  DECK_MAX_BYTES,
  DECK_TITLE_MAX_LENGTH,
  type DeckResponse,
  type DecksResponse,
  type MeClass,
} from '@bali/shared';

import { type ApiClient, ApiError } from './api-client';
import { newEventId } from './event-id';
import { type Failure, failureOf } from './live-question';
import { captureApiFailure } from './monitoring';
import { INVISIBLE, UNPRINTABLE } from './saved-questions';

/*
 * Your slides, the page's logic (Phase 7, M5; ARCHITECTURE, "Live lesson", decisions 4, 6 and 8),
 * tested and holding no words: the page says each answer as the approved canvas does. A PDF goes
 * from the browser straight to the bucket by the create's presigned PUT, never through the API.
 */

const PATH = '/v1/decks';

/** The teacher's decks (`GET /v1/decks`), newest first and none removed, or why not. */
export async function readDecks(
  api: Pick<ApiClient, 'get'>,
): Promise<{ kind: 'read'; decks: Deck[] } | Failure> {
  try {
    return { kind: 'read', decks: (await api.get<DecksResponse>(PATH)).decks };
  } catch (e) {
    return failureOf(e);
  }
}

const UNSHOWABLE = new RegExp(UNPRINTABLE.source, 'gu');

/**
 * A deck's title, from its file's name as the canvas shows one ("Unit 3 review" for "Unit 3
 * review.pdf"): the name without its `.pdf`, held to the create's checks (`Text`, as a question's
 * words are): what can't be shown taken out, trimmed, at most `DECK_TITLE_MAX_LENGTH` code points. A
 * name with nothing left but its `.pdf` keeps it.
 */
export function titleOf(name: string): string {
  const clean = (s: string) =>
    [...s.replace(UNSHOWABLE, '').trim()].slice(0, DECK_TITLE_MAX_LENGTH).join('').trim();
  const bare = clean(name.replace(/\.pdf$/i, ''));
  return INVISIBLE.test(bare) ? clean(name) : bare;
}

/**
 * A picked file, judged before anything is sent: over 25 MB (the create would refuse it before any
 * upload URL is minted), not a PDF by its first bytes (the check's own `%PDF-`, M2b1), or a deck
 * to upload, with its title. A file this can't read is let through: its upload reads it whole for
 * its SHA-256, and says it stopped.
 */
export type Picked = { kind: 'too_large' } | { kind: 'not_pdf' } | { kind: 'deck'; title: string };

export async function judgePick(file: File): Promise<Picked> {
  if (file.size > DECK_MAX_BYTES) return { kind: 'too_large' };
  const head = await file
    .slice(0, 5)
    .text()
    .catch(() => null);
  if (head !== null && head !== '%PDF-') return { kind: 'not_pdf' };
  return { kind: 'deck', title: titleOf(file.name) };
}

/**
 * How long an upload may run (#326): the sweep deletes a removed deck's object 30 minutes after its
 * last upload URL was minted, the URL's 5 and 25 for an upload under way (M2b2), so an upload still
 * running at 25 is stopped and never lands once its object is gone. Counted from before the create
 * is sent, so never past the server's own mint.
 */
export const UPLOAD_LIMIT_MS = 25 * 60_000;

/** How an upload's PUT ended: in the bucket, cancelled, stopped at its limit, or failed. */
export type PutEnd = 'uploaded' | 'cancelled' | 'too_slow' | { failed: number | undefined };

/** The browser's XMLHttpRequest, or a test's stand-in. */
export type XhrClass = new () => XMLHttpRequest;

export interface PutOptions {
  /** When, on `now`'s clock, the upload must have ended (`UPLOAD_LIMIT_MS`). */
  deadline: number;
  now: () => number;
  /** How much is sent, a fraction. */
  onProgress: (fraction: number) => void;
  /** Cancel. */
  signal: AbortSignal;
  Xhr?: XhrClass;
}

/**
 * The PDF to the bucket by its presigned PUT, as it was signed: `Content-Type: application/pdf`
 * and the file's exact length, which the browser sets from the body. By XMLHttpRequest, whose
 * upload reports its progress (`fetch` reports none). Stopped by `signal`, and at `deadline` by the
 * browser itself (XHR's own timeout, which no throttling of a background tab's timers delays). A
 * failure is reported as an API call's is, by the key's template: the URL carries its signature,
 * so it never leaves.
 */
export function putPdf(url: string, body: Blob, opts: PutOptions): Promise<PutEnd> {
  const { deadline, now, onProgress, signal, Xhr = XMLHttpRequest } = opts;
  const left = deadline - now();
  if (signal.aborted) return Promise.resolve('cancelled');
  if (left <= 0) return Promise.resolve('too_slow');
  return new Promise((resolve) => {
    const xhr = new Xhr();
    const cancel = () => xhr.abort();
    const end = (how: PutEnd) => {
      signal.removeEventListener('abort', cancel);
      resolve(how);
    };
    const failed = (status: number | undefined) => {
      captureApiFailure('PUT', `/bucket${new URL(url).pathname}`, status ?? 'network');
      end({ failed: status });
    };
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/pdf');
    xhr.timeout = left;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? end('uploaded') : failed(xhr.status);
    xhr.onerror = () => failed(undefined);
    xhr.onabort = () => end('cancelled');
    xhr.ontimeout = () => end('too_slow');
    signal.addEventListener('abort', cancel);
    xhr.send(body);
  });
}

/** One upload in this page: its file and title, its two writes' ids, and how far it got. */
export interface Upload {
  file: Blob;
  title: string;
  /** The create's `eventId`: Try again sends it again, and its replay mints a fresh URL (M2b2). */
  createId: string;
  /** The check's `eventId`: sent again after an answer that never came, it answers the verdict. */
  completeId: string;
  /** Its SHA-256, once read. */
  sha256: string | null;
  /** Its deck as the create answered it, pending: what a Cancel removes. */
  deck: Deck | null;
  /** Its PDF is in the bucket: Try again only asks for the check. */
  uploaded: boolean;
}

export const newUpload = (file: Blob, title: string, mint = newEventId): Upload => ({
  file,
  title,
  createId: mint(),
  completeId: mint(),
  sha256: null,
  deck: null,
  uploaded: false,
});

/** Where a running upload stands: how much is sent, or its check. */
export type UploadStep = { step: 'uploading'; fraction: number } | { step: 'checking' };

/**
 * How a run ended. `checked`: the server's verdict, the deck `ready` or `rejected` with why.
 * `gone`: its deck was removed meanwhile, in another tab. Else the upload as far as it got, for
 * Try again to go on from: `cancelled`, `too_slow` (stopped at `UPLOAD_LIMIT_MS`), or `stopped`
 * by a failure.
 */
export type UploadEnd =
  | { kind: 'checked'; deck: Deck }
  | { kind: 'gone' }
  | { kind: 'cancelled' | 'too_slow'; upload: Upload }
  | { kind: 'stopped'; failure: Failure; upload: Upload };

export interface RunOptions {
  /** Cancel, and the page closing. */
  signal: AbortSignal;
  onStep: (step: UploadStep) => void;
  /** A clock that only moves forward, for the upload's limit. */
  now?: () => number;
  /** The PUT, `putPdf`; a test's stand-in. */
  put?: (url: string, body: Blob, opts: PutOptions) => Promise<PutEnd>;
}

/** A file's SHA-256, lowercase hex, as the create declares it. */
async function sha256Of(file: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * An upload, run on from where `start` got to: the file read for its SHA-256, the pending deck and
 * its URL (`POST /v1/decks`, under the upload's own `eventId`, so a second run is the replay and
 * gets a fresh URL), the PDF sent to the bucket within `UPLOAD_LIMIT_MS` of that create, then the
 * check (`POST /v1/decks/{id}/complete`).
 */
export async function runUpload(
  api: Pick<ApiClient, 'post'>,
  start: Upload,
  opts: RunOptions,
): Promise<UploadEnd> {
  const { signal, onStep, now = () => performance.now(), put = putPdf } = opts;
  let upload = start;
  let deck = upload.deck;
  const stopped = (failure: Failure): UploadEnd => ({ kind: 'stopped', failure, upload });
  if (!upload.uploaded || deck === null) {
    onStep({ step: 'uploading', fraction: 0 });
    try {
      upload = { ...upload, sha256: upload.sha256 ?? (await sha256Of(upload.file)) };
    } catch (e) {
      return stopped(failureOf(e));
    }
    if (signal.aborted) return { kind: 'cancelled', upload };
    const sent = now();
    let made: CreateDeckResponse;
    try {
      made = await api.post<CreateDeckResponse>(PATH, {
        eventId: upload.createId,
        title: upload.title,
        bytes: upload.file.size,
        sha256: upload.sha256,
      });
    } catch (e) {
      return stopped(failureOf(e));
    }
    deck = made.deck;
    upload = { ...upload, deck };
    const sentAll = await put(made.uploadUrl, upload.file, {
      deadline: sent + UPLOAD_LIMIT_MS,
      now,
      signal,
      onProgress: (fraction) => onStep({ step: 'uploading', fraction }),
    });
    if (sentAll === 'cancelled' || sentAll === 'too_slow') return { kind: sentAll, upload };
    if (sentAll !== 'uploaded') {
      return stopped({ kind: 'failed', status: sentAll.failed, retryAfter: undefined });
    }
    upload = { ...upload, uploaded: true };
  }
  onStep({ step: 'checking' });
  try {
    const checked = await api.post<DeckResponse>(`${PATH}/${deck.id}/complete`, {
      eventId: upload.completeId,
    });
    return { kind: 'checked', deck: checked.deck };
  } catch (e) {
    if (e instanceof ApiError && e.reason === 'deck_not_found') return { kind: 'gone' };
    return stopped(failureOf(e));
  }
}

/**
 * The classes a `409 deck_in_use` names (M5a's `DeckInUseDetails`), in the order `/v1/me` lists
 * them; null when its `details` name none, or have another shape, as a server before M5a sent.
 */
export function inUseClasses(details: unknown): MeClass[] | null {
  const classes = (details as { classes?: unknown } | null | undefined)?.classes;
  if (!Array.isArray(classes) || classes.length === 0) return null;
  const named = classes.filter(
    (c): c is MeClass =>
      typeof (c as MeClass | null)?.id === 'string' &&
      typeof (c as MeClass | null)?.name === 'string',
  );
  return named.length === classes.length ? named.map(({ id, name }) => ({ id, name })) : null;
}

/** One removal: the deck, and the `eventId` it is sent under. */
export interface RemoveAttempt {
  deckId: string;
  eventId: string;
}

/** The unanswered removal of `deckId` again, under its id; else a fresh one (a removal is unordered). */
export const removeAttemptFor = (
  unanswered: RemoveAttempt | undefined,
  deckId: string,
  mint = newEventId,
): RemoveAttempt => (unanswered?.deckId === deckId ? unanswered : { deckId, eventId: mint() });

/**
 * A removal's answer: `removed`, a deck already gone (removed in another tab) included; `in_use`
 * while a running session shows it, naming each class; or why not. A refusal `in_use` naming no
 * class it can read is a failure: refused.
 */
export type RemoveAnswer = { kind: 'removed' } | { kind: 'in_use'; classes: MeClass[] } | Failure;

/** Remove it (`DELETE /v1/decks/{id}`): a Remove's, and a Cancel's of the pending deck it made. */
export async function removeDeck(
  api: Pick<ApiClient, 'del'>,
  attempt: RemoveAttempt,
): Promise<RemoveAnswer> {
  try {
    await api.del<DeckResponse>(`${PATH}/${attempt.deckId}`, { eventId: attempt.eventId });
    return { kind: 'removed' };
  } catch (e) {
    if (e instanceof ApiError && e.reason === 'deck_not_found') return { kind: 'removed' };
    const classes = e instanceof ApiError && e.reason === 'deck_in_use' && inUseClasses(e.details);
    return classes ? { kind: 'in_use', classes } : failureOf(e);
  }
}
