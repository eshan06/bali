'use client';

import { type Deck, DECK_MAX_BYTES, type DeckRejection, type MeClass } from '@bali/shared';
import { FileText, Upload } from 'lucide-react';
import type { ReactNode } from 'react';

import { TOO_MANY_TRIES } from '@/lib/errors';
import type { Failure } from '@/lib/live-question';

import { Button } from './button';

/*
 * Your slides (M5b; the Slides board, LessonStates' lines for it, and SlidesStates' states in
 * between), drawn from what the page holds: every press is the page's (`app/slides/page.tsx`).
 */

/** The list as last read: on its way, failed, or the decks, as the API orders them. */
export type Decks = 'loading' | 'failed' | Deck[];

/** Why an upload stopped: still going at 25 minutes (#326), or a failure. */
export type Stop = { kind: 'too_slow' } | Failure;

/** An upload in this page, as its row shows it. */
export interface Sending {
  key: string;
  title: string;
  /** Its deck, once the create has answered: the list shows it as this upload, once. */
  deckId: string | null;
  state:
    { step: 'uploading'; percent: number } | { step: 'checking' } | { step: 'stopped'; why: Stop };
  /** Its Cancel is on its way: the row's buttons hold. */
  cancelling: boolean;
}

/** A deck made in this page, by the key of the upload that made it. */
export interface Made {
  key: string;
  deck: Deck;
}

/** A deck's Remove, pressed: its confirm, on its way (`busy`), or its last try's failure. */
export interface Removal {
  busy: boolean;
  failure: Failure | null;
}

/** A row of the list, by a key that stays the same as an upload turns into its deck. */
export type Row = { key: string; sending: Sending } | { key: string; deck: Deck };

/** A picked file refused before anything was sent, said under the page's head. */
export type Refusal =
  { kind: 'too_large'; name: string; bytes: number } | { kind: 'not_pdf'; name: string };

export interface SlidesActions {
  /** Upload a PDF: the file picker. */
  pick: () => void;
  /** The list's Try again. */
  read: () => void;
  cancel: (key: string) => void;
  retry: (key: string) => void;
  /** A deck's Remove, which asks first. */
  ask: (deckId: string) => void;
  remove: (deckId: string) => void;
  keep: (deckId: string) => void;
}

/** The page's title: where focus goes when nothing nearer is left. */
export const TITLE = 'slides-title';

/** The ids a row's parts take, by its key. */
export const idOf = (key: string) => `deck-${key}`;

/**
 * The list's rows: this page's uploads first, newest first, then the decks made here, newest
 * first, then the decks as the API lists them, each once, and none an upload here is still
 * sending. A deck made here keeps its upload's key, so its row stays the same element.
 */
export function rowsOf(decks: Decks, made: Made[], sending: Sending[]): Row[] {
  const seen = new Set(sending.flatMap((s) => (s.deckId ? [s.deckId] : [])));
  const rows: Row[] = sending.map((s) => ({ key: s.key, sending: s }));
  const listed = Array.isArray(decks) ? decks.map((deck) => ({ key: deck.id, deck })) : [];
  for (const row of [...made, ...listed]) {
    if (seen.has(row.deck.id)) continue;
    seen.add(row.deck.id);
    rows.push(row);
  }
  return rows;
}

/**
 * Where focus goes once the row `key` goes: the next row's button, else the one before's (the
 * page's to fall back from, to its title).
 */
export function focusAfter(rows: Row[], key: string): string[] {
  const at = rows.findIndex((r) => r.key === key);
  if (at === -1) return [];
  return [rows[at + 1], rows[at - 1]].flatMap((r) => (r ? [`${idOf(r.key)}-act`] : []));
}

const MB = 1024 * 1024;
/** Between a size and its unit, so the two never wrap apart. */
const NBSP = String.fromCharCode(0xa0);

/**
 * A file's size as the boards write one: tenths under 10 MB ("4.2 MB"), never under 0.1, whole
 * from there ("31 MB"); and a file a hair over the 25 MB limit in tenths rounded up, so it never
 * reads as within it.
 */
export function megabytes(bytes: number): string {
  const mb = bytes / MB;
  const limit = DECK_MAX_BYTES / MB;
  const tenths = (n: number) => `${n.toFixed(1)}${NBSP}MB`;
  // Over the limit, but by less than rounds to a whole megabyte more: never at or under it.
  if (bytes > DECK_MAX_BYTES && Math.round(mb) <= limit) {
    return tenths(Math.max(limit + 0.1, Math.round(mb * 10) / 10));
  }
  return mb < 10 ? tenths(Math.max(0.1, Math.round(mb * 10) / 10)) : `${Math.round(mb)}${NBSP}MB`;
}

/** "Oct 6", kept on one line. */
const dayOf = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
    .format(new Date(iso))
    .replace(/\s/g, NBSP);

/** "12 pages", "1 page". */
const pagesOf = ({ pageCount }: Deck) => `${pageCount ?? 0} ${pageCount === 1 ? 'page' : 'pages'}`;

/** A ready deck's line, as the board writes it: "12 pages · 4.2 MB · Added Oct 6". */
export const readyLine = (deck: Deck): string =>
  `${pagesOf(deck)} · ${megabytes(deck.bytes)} · Added ${dayOf(deck.createdAt)}`;

/** A deck's line in the class page's side panel (LessonDecks): "12 pages · Added Oct 6". */
export const showLine = (deck: Deck): string => `${pagesOf(deck)} · Added ${dayOf(deck.createdAt)}`;

/** Your slides that didn't load: on their page, and in the class page's side panel. */
export const CANT_LOAD_SLIDES = "Bali couldn't load your slides.";

/** Why a deck was refused, in the boards' words (LessonStates' Refused; Slides' password line). */
const REJECTED: Record<DeckRejection, string> = {
  not_pdf: "This file isn't a PDF.",
  too_large: 'This PDF is over 25 MB.',
  mismatch: "The upload didn't arrive in one piece. Upload it again.",
  too_many_pages: 'This PDF has more than 200 pages.',
  encrypted: 'This PDF is password-protected. Remove the password, then upload it again.',
  too_slow: "Bali couldn't read this PDF in time. Save it again, then upload it.",
  unfinished: "The upload didn't finish. Upload it again.",
};

/**
 * A deck's line that isn't ready: why it was refused; a pending one this page isn't sending (its
 * tab closed while it ran, or Bali didn't hear its Cancel) as the sweep says it after 24 hours
 * (SlidesStates).
 */
export const notReadyLine = (deck: Deck): string =>
  REJECTED[deck.status === 'rejected' ? (deck.rejection ?? 'unfinished') : 'unfinished'] ??
  REJECTED.unfinished;

/** A refused pick, under the head (Slides' size line; LessonStates' isn't-a-PDF line). */
export function refusalLine(refusal: Refusal): string {
  return refusal.kind === 'too_large'
    ? `“${refusal.name}” is ${megabytes(refusal.bytes)}. Bali takes PDFs up to 25 MB.`
    : `“${refusal.name}” isn't a PDF. Save it as a PDF, then upload it.`;
}

/** A stopped upload, in its row (LessonStates' "The upload stopped"; SlidesStates' others). */
export function stoppedLine(why: Stop): string {
  if (why.kind === 'too_slow') {
    return 'The upload was still going after 25 minutes, so Bali stopped it. Try again on a faster connection.';
  }
  if (why.kind === 'failed' && why.status === 429) return TOO_MANY_TRIES;
  return 'The upload stopped. Check your connection and try again.';
}

/** A removal that didn't go through, in its confirm's place (SlidesStates). */
export function removeLine(title: string, failure: Failure): string {
  if (failure.kind === 'refused') return `Bali couldn't remove “${title}”.`;
  return failure.status === 429
    ? TOO_MANY_TRIES
    : `Bali couldn't remove “${title}”. Check your connection and try again.`;
}

/** The refusal of a deck in use, naming each class (Slides; SlidesStates' two or more). */
export function inUseLine(classes: MeClass[]): string {
  const names = new Intl.ListFormat('en', { type: 'conjunction' }).format(
    classes.map((c) => c.name),
  );
  return `It's showing in ${names} right now. Stop showing it there first.`;
}

/*
 * v2.css's `.deck-row`: the file's tile, its name and line, its buttons, and anything said across
 * the row's foot; a card's hairline and corners, and no shadow, as the board draws it.
 */
const ROW =
  'grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-md border border-border-default bg-surface-card px-4 py-3.5 text-body';
const SAID = 'flex flex-wrap items-center gap-x-4 gap-y-3';
const ACROSS = `col-[2/-1] ${SAID}`;
const BUTTONS = 'flex flex-wrap items-center gap-2.5';
const CAPTION = 'text-caption text-text-tertiary';

/**
 * Your slides (the Slides board): its head with Upload a PDF, a refused pick under it, then the
 * list: loading, failed with Try again, none yet, or each row.
 */
export function SlidesView({
  decks,
  rows,
  refusal,
  removals,
  inUse,
  on,
  children,
}: {
  decks: Decks;
  rows: Row[];
  refusal: Refusal | null;
  removals: Record<string, Removal>;
  inUse: Record<string, MeClass[]>;
  on: SlidesActions;
  /** The page's file picker, beside its button. */
  children?: ReactNode;
}) {
  return (
    <main className="flex flex-col gap-5.5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div>
          <h1 id={TITLE} tabIndex={-1} className="text-page-title">
            Your slides
          </h1>
          <p className="mt-0.5 text-meta text-text-secondary">
            PDFs up to 25 MB and 200 pages. Students see a slide only while you show it in class.
          </p>
        </div>
        <Button onClick={on.pick}>
          <Upload size={16} aria-hidden="true" />
          Upload a PDF
        </Button>
        {children}
      </div>
      {refusal ? (
        // A new element for each refusal, so a screen reader says each one.
        <p key={refusalLine(refusal)} role="alert" className="text-body">
          {refusalLine(refusal)}
        </p>
      ) : null}
      {decks === 'loading' ? (
        <p role="status" className="text-body text-text-secondary">
          Loading…
        </p>
      ) : decks === 'failed' ? (
        <div className={SAID}>
          <p role="alert" className="text-body">
            {CANT_LOAD_SLIDES}
          </p>
          <Button variant="secondary" size="sm" onClick={on.read}>
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-body text-text-secondary">
          No slides yet. Upload a PDF to show it in class.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="flex max-w-215 flex-col gap-2.5">
          {rows.map((row) => (
            <DeckRow
              key={row.key}
              row={row}
              removal={'deck' in row ? removals[row.deck.id] : undefined}
              inUse={'deck' in row ? inUse[row.deck.id] : undefined}
              on={on}
            />
          ))}
        </ul>
      ) : null}
    </main>
  );
}

/**
 * One row (`.deck-row`): an upload with its percentage and Cancel, its check, or where it stopped
 * with Try again; or a deck, ready with its pages, size and day, or refused with why, Remove beside
 * it, which asks across the row's foot, or says it is in use. Its line is said as it changes (the
 * percentage aside, which the bar gives), so the check and its verdict reach a screen reader.
 */
export function DeckRow({
  row,
  removal,
  inUse,
  on,
}: {
  row: Row;
  removal: Removal | undefined;
  inUse: MeClass[] | undefined;
  on: SlidesActions;
}) {
  const id = idOf(row.key);
  const name = `${id}-name`;
  let line: ReactNode = null;
  let bar: number | null = null;
  let buttons: ReactNode = null;
  let foot: ReactNode = null;
  if ('sending' in row) {
    const { state, cancelling } = row.sending;
    const { key } = row;
    if (state.step === 'uploading') {
      line = (
        <>
          Uploading<span aria-hidden="true"> · {state.percent}%</span>
        </>
      );
      bar = state.percent;
    }
    if (state.step === 'checking') line = 'Checking the file…';
    if (state.step !== 'checking') {
      buttons = (
        // Held, not disabled, while its Cancel is sent (SlidesStates): focus stays where it is.
        <Button
          id={`${id}-act`}
          variant="secondary"
          size="sm"
          aria-describedby={name}
          aria-disabled={cancelling}
          onClick={() => {
            if (!cancelling) on.cancel(key);
          }}
        >
          Cancel
        </Button>
      );
    }
    if (state.step === 'stopped') {
      foot = (
        <div className={ACROSS}>
          {/* A new element for each stop, so a screen reader says each one. */}
          <p key={stoppedLine(state.why)} role="alert">
            {stoppedLine(state.why)}
          </p>
          <Button
            variant="secondary"
            size="sm"
            aria-describedby={name}
            aria-disabled={cancelling}
            onClick={() => {
              if (!cancelling) on.retry(key);
            }}
          >
            Try again
          </Button>
        </div>
      );
    }
  } else {
    const { deck } = row;
    line = deck.status === 'ready' ? readyLine(deck) : notReadyLine(deck);
    if (removal) {
      foot = (
        <div role="group" aria-labelledby={`${id}-rm`} className={ACROSS}>
          {/* A new element for a failure, so a screen reader says each one as it comes. */}
          <p
            key={removal.failure ? removeLine(deck.title, removal.failure) : 'asked'}
            id={`${id}-rm`}
            role={removal.failure ? 'alert' : undefined}
          >
            {removal.failure
              ? removeLine(deck.title, removal.failure)
              : `Remove “${deck.title}”? Students won't see it again, and you can't undo this.`}
          </p>
          <div className={BUTTONS}>
            {/* Held, not disabled, while it is sent: focus stays where it is. */}
            <Button
              variant="secondary"
              size="sm"
              aria-disabled={removal.busy}
              onClick={() => {
                if (!removal.busy) on.remove(deck.id);
              }}
            >
              Remove
            </Button>
            <Button
              id={`${id}-keep`}
              variant="secondary"
              size="sm"
              aria-disabled={removal.busy}
              onClick={() => {
                if (!removal.busy) on.keep(deck.id);
              }}
            >
              Keep
            </Button>
          </div>
        </div>
      );
    } else {
      buttons = (
        <Button
          id={`${id}-act`}
          variant="secondary"
          size="sm"
          aria-describedby={name}
          onClick={() => on.ask(deck.id)}
        >
          Remove
        </Button>
      );
      if (inUse) {
        foot = (
          <p key={inUseLine(inUse)} role="alert" className="col-[2/-1]">
            {inUseLine(inUse)}
          </p>
        );
      }
    }
  }
  const title = 'sending' in row ? row.sending.title : row.deck.title;
  return (
    <li className={ROW}>
      <span className="grid size-10 place-items-center rounded-sm bg-surface-sunken text-text-secondary">
        <FileText size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p id={name} className="font-semibold wrap-anywhere">
          {title}
        </p>
        {line === null ? null : (
          <p aria-live="polite" className={CAPTION}>
            {line}
          </p>
        )}
        {bar === null ? null : (
          <div
            role="progressbar"
            aria-labelledby={name}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={bar}
            className="mt-1.5 h-1 w-60 max-w-full overflow-hidden rounded-full bg-surface-sunken"
          >
            <span
              className="block h-full rounded-full bg-surface-brand"
              style={{ width: `${bar}%` }}
            />
          </div>
        )}
      </div>
      <div className={BUTTONS}>{buttons}</div>
      {foot}
    </li>
  );
}
