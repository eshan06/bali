'use client';

import { type FeedEvent, isUnlockReason, type UnlockReason } from '@bali/shared';
import { LockOpen, X } from 'lucide-react';

import type { Students } from '@/lib/grid-state';
import { bellTime } from '@/lib/session-controls';

/** An unlock the live grid's stream brought while the class page was open (PV10; ClassUnlock). */
export interface Unlock {
  /** The unlock's own event id: one pop-up per unlock. */
  eventId: string;
  /** Who unlocked, named as their tile names them, as it names them now (`UnlockPopups`). */
  studentId: string;
  /** The reason they gave, the latest one (A20). */
  reason: UnlockReason | null;
  /** When the server recorded it. */
  at: string;
}

/** What the stream tells the pop-ups: an unlock that landed live, or a new reason for one. */
export type UnlockNews =
  | { kind: 'unlock'; unlock: Unlock }
  | { kind: 'reason'; eventId: string; reason: UnlockReason | null };
export type PopupAction = UnlockNews | { kind: 'close'; eventId: string };

/** The pop-ups open, newest first, and every unlock one has opened for. */
export interface Popups {
  open: readonly Unlock[];
  seen: ReadonlySet<string>;
}
export const NO_POPUPS: Popups = { open: [], seen: new Set() };

/**
 * The pop-ups after one piece of news or a Close (ClassUnlocks: newest on top, each until it is
 * closed). An unlock opens one once: shown before, open or closed, it never opens again, whatever
 * the stream replays. A new reason changes the pop-up of the unlock it names and opens none.
 */
export function popupsAfter(state: Popups, action: PopupAction): Popups {
  switch (action.kind) {
    case 'unlock': {
      const { unlock } = action;
      if (state.seen.has(unlock.eventId)) return state;
      return { open: [unlock, ...state.open], seen: new Set(state.seen).add(unlock.eventId) };
    }
    case 'reason':
      return {
        ...state,
        open: state.open.map((u) =>
          u.eventId === action.eventId ? { ...u, reason: action.reason } : u,
        ),
      };
    case 'close':
      return { ...state, open: state.open.filter((u) => u.eventId !== action.eventId) };
  }
}

/**
 * What one streamed event tells the pop-ups, if anything: an unlock that landed live (`live`, the
 * grid's `landsLive`, as its tile's pulse); or a new reason for an unlock (A20), whichever unlock it
 * names.
 */
export function unlockNews(e: FeedEvent, live: boolean): UnlockNews | null {
  const { reason: given, unlock_event_id: of } = (e.payload ?? {}) as {
    reason?: unknown;
    unlock_event_id?: unknown;
  };
  const reason = isUnlockReason(given) ? given : null;
  if (e.type === 'unlock' && live) {
    const unlock = { eventId: e.eventId, studentId: e.userId ?? '', reason, at: e.occurredAt };
    return { kind: 'unlock', unlock };
  }
  if (e.type === 'unlock_reason_changed' && typeof of === 'string') {
    return { kind: 'reason', eventId: of, reason };
  }
  return null;
}

/** The reason as the student's tile says it (`unlockNote`); none, as the recap says it. */
const REASON: Record<UnlockReason, string> = {
  bathroom: 'Bathroom',
  nurse: 'Nurse',
  other: 'Other reason',
};
/** An unlock's reason in words, the pop-up's and the student panel's (PV11b). */
export const reasonWords = (reason: UnlockReason | null) =>
  reason === null ? 'No reason given' : REASON[reason];
/** A dot between two parts of a line, after a no-break space, as the tiles' (`live-grid.tsx`). */
const DOT = '\u00a0· ';

/**
 * The stack's layer, over the page's whole frame (the shell's 30/36 px in, 22/16 on a phone), placed
 * against the class page's `<main>`: it takes no room and nobody's clicks but the pop-ups' own, over
 * the reconnect pill's layer (z-10) should the two meet on a phone.
 */
const LAYER =
  'pointer-events-none absolute -inset-x-9 -top-7.5 bottom-0 z-20 max-sm:-inset-x-4 max-sm:-top-5.5';
/**
 * The stack as ClassUnlocks draws it: 96 px from the frame's top and 18 px from its right, 380 px
 * wide at most, 10 px apart. It stays in view as the page scrolls, 18 px from the top (v2.css's
 * `.toast`), so a new unlock isn't left above a grid scrolled to its last row; at rest the two are
 * one. A stack taller than the page under it scrolls with the page.
 */
const STACK =
  'sticky top-4.5 mt-24 mr-4.5 ml-auto flex w-95 max-w-[calc(100%-36px)] flex-col gap-2.5';
/**
 * One pop-up (v2.css's `.toast`): white, a hairline and a 3 px orange-400 top edge, 14 px corners,
 * `shadow-3`, 14/10/14/16 px in; the lock in its tint's 36 px well, the words, then Close.
 */
const POPUP =
  'pointer-events-auto grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-t-3 border-border-default border-t-unlock-edge bg-surface-card pt-3.5 pr-2.5 pb-3.5 pl-4 shadow-3';

/**
 * The unlock pop-ups (PV10; ClassUnlock, ClassUnlocks): each unlock the stream brings, newest on
 * top, until it is closed. The live grid holds them, so they go with the session's live page, as
 * ClassUnlock draws them on it alone; each unlock then shows on its tile under How it ended and in
 * the recap. Its words are an alert, so a screen reader says each as it opens
 * ("Ethan Park used Emergency Unlock. Nurse · 9:31 AM") without moving focus; Close is described by
 * them, and closing one moves focus to the Close of the pop-up that takes its place, else the one
 * above it.
 * Open student (PV11b) opens the student's panel, described by the same words, once their tile is
 * on the grid.
 */
export function UnlockPopups({
  unlocks,
  students,
  onClose,
  onOpen,
}: {
  unlocks: readonly Unlock[];
  /** The grid's students, so a pop-up names each as their tile does now. */
  students: Students;
  onClose: (eventId: string) => void;
  /** Open student: the panel for whoever unlocked. */
  onOpen: (unlock: Unlock) => void;
}) {
  if (unlocks.length === 0) return null;
  // As the tile names them: their display name, else the start of their id until the grid has it.
  const nameOf = (u: Unlock) => students[u.studentId]?.displayName ?? u.studentId.slice(0, 8);
  return (
    <div className={LAYER}>
      <div className={STACK}>
        {unlocks.map((u) => (
          <div key={u.eventId} className={POPUP}>
            <span className="grid size-9 place-items-center rounded-sm bg-state-emergency-bg text-state-emergency-fg">
              <LockOpen size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div role="alert">
                {/* 15/20 semibold, the size of a tile's name. */}
                <p id={`unlock-${u.eventId}`} className="text-tile-name wrap-break-word">
                  {nameOf(u)} used Emergency Unlock
                </p>
                <p className="mt-0.5 text-caption text-text-secondary">
                  {reasonWords(u.reason)}
                  {DOT}
                  {bellTime(u.at)}
                </p>
              </div>
              {/* v2.css's `.t-act`: 13/18 semibold in orange-700, 8 px under the words. */}
              {students[u.studentId] ? (
                <button
                  type="button"
                  aria-describedby={`unlock-${u.eventId}`}
                  onClick={() => onOpen(u)}
                  className="mt-2 cursor-pointer rounded-xs text-caption font-semibold text-unlock-link underline-offset-2 hover:underline"
                >
                  Open student
                </button>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Close"
              aria-describedby={`unlock-${u.eventId}`}
              onClick={(e) => {
                const popup = e.currentTarget.parentElement;
                const next = popup?.nextElementSibling ?? popup?.previousElementSibling;
                if (document.activeElement === e.currentTarget) {
                  next?.querySelector<HTMLElement>('button[aria-label="Close"]')?.focus();
                }
                onClose(u.eventId);
              }}
              className="-mt-1.5 grid size-8 cursor-pointer place-items-center rounded-item text-text-tertiary hover:bg-surface-sunken hover:text-text-primary"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
