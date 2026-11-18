'use client';

import { type FeedEvent, isUnlockReason, type UnlockReason } from '@bali/shared';
import { LockOpen, X } from 'lucide-react';

import { ICON_BUTTON } from '@/components/button';
import { land } from '@/components/try-again';
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

/**
 * The stack's layer (LO6; ClassLive's `.popups`, pinned since LO13), an item of the live page's
 * grid, which places it (`LiveGrid`) where no control of the header, the count or Check on is ever
 * under it (GA2; the audit's C01): at 1024 px and wider over the session list's column, from 12 px
 * over its top to the live part's foot, 28 px into the gap beside it and 12 px past its right,
 * inside the page's 40 px margin, 380 px in all; under 1024 px from 12 px over the room (8 px on a
 * phone) to the foot of the session list under it, out 12 px past the page's right but on a phone
 * (PhoneLive), so no pop-up is ever cut at the window's edge. Its size is the grid's alone
 * (`contain-size`), so a tall stack never moves the room or the list, and it takes nobody's clicks
 * but the pop-ups' own.
 */
const LAYER =
  'pointer-events-none -mt-3 -mr-3 self-stretch contain-size lg:-ml-7 max-[760px]:-mt-2 max-[760px]:mr-0';
/**
 * The stack (ClassLive's `.popups`, LiveListStates): at the layer's top right, 380 px wide at most
 * (on a phone the room's width), 10 px apart. Pinned (the owner's ruling, 2026-11-17: "Pin them"):
 * while one is open it stays in view at the window's top right, 18 px under the top bar (its 60 px
 * row and hairline, 56 px on a phone), however far down the page is scrolled, and never above the
 * layer's top. Over the bar and the student panel (z 3 and 5). A stack taller than the window's
 * room for it scrolls with the page.
 */
const STACK =
  'sticky top-[79px] z-20 ml-auto flex w-95 max-w-full flex-col gap-2.5 max-[760px]:top-[75px] max-[760px]:w-full';
/**
 * One pop-up (lock.css's `.popup`): white, a strong hairline, 12 px corners, `shadow-3`, 16 px in,
 * dropping in 6 px as it opens (`pop-in`); the lock in its tint's 36 px well, the words, then Close.
 */
const POPUP =
  'pointer-events-auto grid grid-cols-[36px_minmax(0,1fr)_32px] items-start gap-3 rounded-frame border border-border-strong bg-surface-card p-4 shadow-3 pop-in';

/**
 * The unlock pop-ups (PV10, ClassUnlock; the lock-only look since LO6, ClassLive, LiveStates' An
 * unlock lands, LiveListStates): each unlock the stream brings, newest on top, until it is closed,
 * pinned at the window's top right (LO13). The live grid holds them and places them (`place`, its
 * grid's cells for the layer), so they go with the session's live page, never in Present; each
 * unlock stays in the session list, then the recap. Its words are an alert,
 * so a screen reader says each as it opens
 * ("Ethan Park used Emergency Unlock. Nurse 9:31 AM") without moving focus; Close, named for
 * whose pop-up it closes ("Close Ethan Park's pop-up", the audit's C02), is described by them, and
 * closing one moves focus to the Close of the pop-up that takes its place, else the one above it,
 * and the last one's to its student's tile, else the class's name, never the page (GA4, the
 * conductor's call).
 * Open student (PV11b) opens the student's panel, described by the same words, once their tile is
 * on the grid.
 */
export function UnlockPopups({
  unlocks,
  students,
  tileOf,
  onClose,
  onOpen,
  place = '',
}: {
  unlocks: readonly Unlock[];
  /** The grid's students, so a pop-up names each as their tile does now. */
  students: Students;
  /** A student's tile's id, where focus goes as the last pop-up closes. */
  tileOf: (studentId: string) => string;
  onClose: (eventId: string) => void;
  /** Open student: the panel for whoever unlocked. */
  onOpen: (unlock: Unlock) => void;
  /** The layer's cells in the live page's grid (`LiveGrid`). */
  place?: string;
}) {
  if (unlocks.length === 0) return null;
  // As the tile names them: their display name, else the start of their id until the grid has it.
  const nameOf = (u: Unlock) => students[u.studentId]?.displayName ?? u.studentId.slice(0, 8);
  return (
    <div className={`${LAYER} ${place}`.trim()}>
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
                {/* The reason and the time, 12 px apart, no dot between (lock.css's `.pp-why`). */}
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-meta text-text-secondary">
                  <span>{reasonWords(u.reason)}</span>
                  <span>{bellTime(u.at)}</span>
                </p>
              </div>
              {/* lock.css's `.pp-open`: 13.5/19 semibold in the unlock's ink, 8 px under the words. */}
              {students[u.studentId] ? (
                <button
                  type="button"
                  aria-describedby={`unlock-${u.eventId}`}
                  onClick={() => onOpen(u)}
                  className="mt-2 cursor-pointer rounded-xs text-meta font-semibold text-state-emergency-fg underline-offset-3 hover:underline"
                >
                  Open student
                </button>
              ) : null}
            </div>
            <button
              type="button"
              aria-label={`Close ${nameOf(u)}'s pop-up`}
              aria-describedby={`unlock-${u.eventId}`}
              onClick={(e) => {
                const popup = e.currentTarget.parentElement;
                const next = popup?.nextElementSibling ?? popup?.previousElementSibling;
                const at = document.activeElement;
                if (at === e.currentTarget || at === document.body) {
                  const close = next?.querySelector<HTMLElement>(':scope > button');
                  if (close) close.focus();
                  else land(document, [tileOf(u.studentId)]);
                }
                onClose(u.eventId);
              }}
              className={ICON_BUTTON}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
