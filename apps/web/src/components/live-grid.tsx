'use client';

import {
  EVENT_RESUME_OVERLAP,
  type FeedEvent,
  type SessionSnapshot,
  STREAM_HEARTBEAT_MS,
} from '@bali/shared';
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Flag,
  LockOpen,
  type LucideIcon,
  ShieldOff,
  WifiOff,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';

import { NAME_BUTTON, QUIET } from '@/components/button';
import { SessionList } from '@/components/session-list';
import { StudentPanel } from '@/components/student-panel';
import { TryAgain } from '@/components/try-again';
import { NO_POPUPS, popupsAfter, unlockNews, UnlockPopups } from '@/components/unlock-popups';
import { getAccessToken } from '@/lib/auth';
import { config } from '@/lib/config';
import { errText } from '@/lib/errors';
import {
  applyEvent,
  endsSession,
  fromSnapshot,
  gridDisplay,
  type GridDisplay,
  landsLive,
  mergeSnapshot,
  silentNote,
  snapshotIsFresh,
  softpulses,
  type Staleness,
  staleness,
  staleWords,
  type Student,
  type Students,
} from '@/lib/grid-state';
import { type LogRead, useSessionLog, withStreamed } from '@/lib/session-log';
import { createSseClient, type SseClient, type SseStatus } from '@/lib/sse-client';
import { useApi, useSignOut } from '@/lib/use-api';

/** A state's edge: none to see on a tint; Silent's and Unknown's dashed (Q3 A, 1.5 px). */
const SOLID = 'border-transparent';
const DASHED = 'border-dashed border-border-strong';
const EMERGENCY = `${SOLID} bg-state-emergency-bg text-state-emergency-fg`;
const REVOKED = `${SOLID} bg-state-revoked-bg text-state-revoked-fg`;

/**
 * Each state's look (DESIGN.md §2): its tint, its icon and its words, never colour alone. A tile
 * (PV8) and the class page's count of it (PV7) both draw from it, so the two always agree. The two
 * Left states take their state's colour, the flag first and the state's icon after it (Q2 A; a
 * student who left while unlocked counts under Left with an orange tile, the owner, 2026-10-14);
 * Silent is the ended pair with a dashed edge, Unknown dashed with no fill (Q3 A).
 */
export const CHIP: Record<GridDisplay, { label: string; icons: LucideIcon[]; tone: string }> = {
  focused: {
    label: 'Focused',
    icons: [CircleCheck],
    tone: `${SOLID} bg-state-focused-bg text-state-focused-fg`,
  },
  unlocked: { label: 'Unlocked', icons: [LockOpen], tone: EMERGENCY },
  protection_off: { label: 'Protection off', icons: [ShieldOff], tone: REVOKED },
  silent: {
    label: 'Silent',
    icons: [WifiOff],
    tone: `${DASHED} bg-state-ended-bg text-state-ended-fg`,
  },
  ended: { label: 'Left', icons: [Flag], tone: `${SOLID} bg-state-ended-bg text-state-ended-fg` },
  // Left the session AND unshielded, the ISSUES #2 case: it must never read as the quiet "Left".
  left_unprotected: { label: 'Left · unlocked', icons: [Flag, LockOpen], tone: EMERGENCY },
  // The same, for a phone whose Screen Time permission was off: never an unlock.
  left_protection_off: { label: 'Left · protection off', icons: [Flag, ShieldOff], tone: REVOKED },
  absent: {
    label: 'Not here',
    icons: [Circle],
    tone: `${SOLID} bg-state-notjoined-bg text-state-notjoined-fg`,
  },
  unknown: {
    label: 'Unknown · refresh',
    icons: [CircleHelp],
    tone: `${DASHED} bg-state-nodevice-bg text-text-primary`,
  },
};

/** The six states the class page counts over the grid (ClassLive), in its order. */
export const COUNTED = [
  'focused',
  'unlocked',
  'protection_off',
  'silent',
  'absent',
  'ended',
] as const;
export type Counted = (typeof COUNTED)[number];

/**
 * Where each student counts: in their tile's state, both Left tiles under Left, as ClassLive
 * counts "Left · unlocked"; Unknown under none, since this tab can't say what it is.
 */
const COUNTED_AS: Record<GridDisplay, Counted | null> = {
  focused: 'focused',
  unlocked: 'unlocked',
  protection_off: 'protection_off',
  silent: 'silent',
  absent: 'absent',
  ended: 'ended',
  left_unprotected: 'ended',
  left_protection_off: 'ended',
  unknown: null,
};

/** The grid right now, counted (ClassLive): "Live · 25 of 28 joined" and the six counts. */
export interface StateCounts {
  /** Each student the grid shows, once. */
  total: number;
  /** Those who tapped in this session: all but Not here. */
  joined: number;
  counts: Record<Counted, number>;
}

/** The grid's tiles, counted by their states (`gridDisplay`'s). */
export function stateCounts(displays: readonly GridDisplay[]): StateCounts {
  const counts = Object.fromEntries(COUNTED.map((state) => [state, 0])) as Record<Counted, number>;
  for (const display of displays) {
    const state = COUNTED_AS[display];
    if (state !== null) counts[state] += 1;
  }
  return { total: displays.length, joined: displays.length - counts.absent, counts };
}

/**
 * The room's columns (LO5; ClassLive's `.room`): as many tiles as fit, each at least 178 px, 8 px
 * apart, never wider than the room (`min`); on a phone, under 760 px, two (PhoneLive). In Present
 * (LO9; Present, PresentStates), fewer a row as it narrows, never smaller type: each at least 200 px
 * and 16 % of the room, so six at most, as the board draws 1,440 px (four on a 1,024 px projector,
 * five on a 1,280 px laptop); two on a phone.
 */
export const ROOM =
  'grid-cols-[repeat(auto-fill,minmax(min(178px,100%),1fr))] gap-2 max-[760px]:grid-cols-2';
export const PRESENT_ROOM =
  'grid-cols-[repeat(auto-fill,minmax(max(200px,16%),1fr))] gap-2 max-[760px]:grid-cols-2';

/** A state's chip (v2.css's `.chip-mini`): a pill 3 × 10 px in, its words 13/18, its edge 1.5 px. */
export const CHIP_PILL =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-0.75 text-caption font-medium whitespace-nowrap tabular-nums';

/** A state's chip in the lock-only look (lock.css's `.chip`; LO2): 4 × 12 px in, its icon 14 px. */
export const CHIP_LOCK =
  'inline-flex shrink-0 items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-caption font-medium whitespace-nowrap tabular-nums';

/**
 * A state as the lock-only look's chip (Check on, on Home and the class page): its tint, its icon
 * and its words, never colour alone; `words` its label unless given ("Silent · 5 min").
 */
export function LockChip({ display, words }: { display: GridDisplay; words?: string }) {
  const { label, icons, tone } = CHIP[display];
  const Icon = icons[icons.length - 1] ?? Circle;
  return (
    <span className={`${CHIP_LOCK} ${tone}`}>
      <Icon size={14} aria-hidden="true" className="shrink-0" />
      {(words ?? label).replaceAll(' · ', DOT)}
    </span>
  );
}

/** A dot between two parts of a line, after a no-break space, so a line never starts with one. */
export const DOT = '\u00a0· ';

/**
 * A tile in the room, the lock-only look (LO5; ClassLive's `.tile`): its state's tint, its edge
 * 1.5 px, 10 px corners, at least 60 px tall, 8 × 12 px in, its parts 12 px apart; pressed, it
 * scales to 0.98. In Present one size up (LO9; Present's `.room.is-proj .tile`): at least 84 px
 * tall, 12 px in.
 */
const ROOM_TILE =
  'relative flex w-full items-center gap-3 rounded-sm border-[1.5px] text-left tabular-nums';
const TILE_SIZE = { room: 'min-h-15 px-3 py-2', present: 'min-h-21 p-3' };

/**
 * One student's tile. In the room on the class page (LO5; ClassLive, LiveStates' rare tiles,
 * PhoneLive): the state's icon (a Left state's flag, as the rare tiles draw it), then the name over
 * the state's words (Silent's with its minutes), each cut short with an ellipsis rather than
 * wrapped, so every tile is one size, the whole name on hover. The state and the name only: an
 * unlock's reason, "last seen" and Clock off are in the student's panel (the owner, 2026-11-16). On
 * the live page a button that opens the panel and closes it; hovered, its edge shows, and while its
 * panel is open its edge is the primary ink, solid (LO6; ClassStudent's `aria-current`). In Present
 * (LO9; Present, PresentStates' rare tiles) the same tile one size up, its icon 22 px, its name
 * 18/23 and its state 15/20, never a button: nothing in it is the class's to open. `pulse` is
 * `bali-softpulse` (DESIGN.md §7) on the whole tile, and `onPulseEnd` hears it finish.
 */
export function Tile({
  student: s,
  now,
  present,
  pulse,
  onPulseEnd,
  select,
}: {
  student: Student;
  now: Date;
  present: boolean;
  pulse: boolean;
  onPulseEnd?: () => void;
  /** On the live page (PV11b), a button that opens the student's panel and closes it. */
  select?: { id: string; panel: string; selected: boolean; onSelect: () => void };
}) {
  const display = gridDisplay(s, now);
  const { icons, tone } = CHIP[display];
  const name = s.displayName ?? s.studentId.slice(0, 8);
  const words = stateWords(s, display, now).replaceAll(' · ', DOT);
  // The pulse on a layer the tile's own size, keyed by its unlock, so each new one pulses from the
  // start while the tile, a button that may hold focus, stays; once it has pulsed it leaves the
  // set, so a tile that turns red and back stays still.
  const glow = (corners: string) =>
    pulse ? (
      <span
        key={s.unlock?.eventId}
        aria-hidden="true"
        onAnimationEnd={onPulseEnd}
        className={`pointer-events-none absolute -inset-[1.5px] animate-softpulse ${corners}`}
      />
    ) : null;

  const Icon = icons[0] ?? Circle;
  // On the live page a button, which opens the panel; else the tile alone.
  const Box = select ? 'button' : 'div';
  const dashed = display === 'silent' || display === 'unknown';
  return (
    <li className="flex min-w-0">
      <Box
        {...(select && {
          type: 'button',
          id: select.id,
          'aria-expanded': select.selected,
          'aria-controls': select.selected ? select.panel : undefined,
          onClick: select.onSelect,
        })}
        className={`${ROOM_TILE} ${TILE_SIZE[present ? 'present' : 'room']} ${tone}${select ? ` press cursor-pointer [--press-scale:0.98] ${dashed ? 'hover:border-border-input' : 'hover:border-border-strong'} aria-expanded:border-solid aria-expanded:border-text-primary` : ''}`}
      >
        {glow('rounded-sm')}
        <Icon size={present ? 22 : 18} aria-hidden="true" className="shrink-0" />
        <span className="flex min-w-0 flex-col">
          <span
            title={name}
            className={`truncate text-text-primary ${present ? 'text-present-room-name' : 'text-room-name max-[760px]:text-room-name-phone'}`}
          >
            {name}
          </span>
          <span className={`truncate ${present ? 'text-present-room-state' : 'text-tile-line'}`}>
            {words}
          </span>
        </span>
      </Box>
    </li>
  );
}

/** A state's words: its label, Silent's with its minutes ("Silent · 5 min"). */
function stateWords(s: Student, display: GridDisplay, now: Date): string {
  const { label } = CHIP[display];
  return display === 'silent' ? `${label} · ${silentNote(s, now)}` : label;
}

/**
 * A student's state as a chip, their tile's state, icon and words in its tint, Silent's with its
 * minutes: the student panel's, in the lock-only look (LO6; ClassStudent's `.chip`).
 */
export function StateChip({ student: s, now }: { student: Student; now: Date }) {
  const display = gridDisplay(s, now);
  return <LockChip display={display} words={stateWords(s, display, now)} />;
}

/** How long the stream's first connect may take before the grid says so (the owner, 2026-10-14). */
export const FIRST_CONNECT_MS = 3000;

/**
 * The stream's state as the grid's health reads it (`staleness`), `connectingMs` after its first
 * connect began: that connect counts as open for its first `FIRST_CONNECT_MS`, since it has lost
 * nothing and the grid was just read, so no pill flashes for the 60–100 ms it takes as each page
 * loads (PV7's find); one that hangs past it, as a school's network can, is said as the pill, as a
 * lost stream is at once.
 */
export function healthOf(status: SseStatus, connectingMs: number): 'open' | 'reconnecting' {
  return status === 'reconnecting' || (status === 'connecting' && connectingMs >= FIRST_CONNECT_MS)
    ? 'reconnecting'
    : 'open';
}

/**
 * The grid's health in words (`staleWords`), inside a status (DR-05): a screen reader hears it as
 * it comes and as its reason changes, as a student hears "Can't reach Bali", but not its age at
 * each second's tick (`aria-live="off"`, as YourPhone's minutes). One span, so the pill's flex row
 * lays it out as one piece.
 */
export function StaleWords({ stale }: { stale: Staleness }) {
  const words = staleWords(stale);
  // The words' one figure is the grid's age, which ticks: from it on, unsaid as it changes.
  const age = words.search(/\d/);
  return (
    <span>
      {words.slice(0, age)}
      <span aria-live="off">{words.slice(age)}</span>
    </span>
  );
}

/**
 * The live feed lost or quiet, over the count (LO5; LiveStates' "The live feed drops", and
 * LiveTopStates' quiet feed), and over Present's band (LO9; PresentStates): a white pill, a strong
 * edge and `shadow-2`, its words today's (`staleWords`), after a stone dot that holds still, where
 * the board draws a spinner: nothing loops (DESIGN.md §7), as Home's (HomeMoments).
 */
export function FeedLine({ stale }: { stale: Staleness }) {
  return (
    <p
      role="status"
      className="inline-flex items-center gap-2 self-start rounded-full border border-border-strong bg-surface-card py-2 pr-4 pl-3 text-meta text-text-primary tabular-nums shadow-2"
    >
      <span aria-hidden="true" className="size-1.75 shrink-0 rounded-full bg-pip" />
      <StaleWords stale={stale} />
    </p>
  );
}

/**
 * A line that something didn't load or wasn't done, in the lock-only look (HomeStates' `.oops`;
 * LO4, the class page's own, moved here for its live part): after the alert's icon, between
 * hairlines unless `ruled` is off, where the live page's own rule is beside it already
 * (LiveTopStates); with Try again when `onRetry` sends it again, held while `held` says a read or a
 * send of it is on its way, focus then where `then` says.
 */
export function Oops({
  children,
  onRetry,
  held = false,
  then = [],
  ruled = true,
}: {
  children: ReactNode;
  onRetry?: () => unknown;
  held?: boolean;
  then?: readonly string[];
  ruled?: boolean;
}) {
  const line = (
    <p role="alert" className="flex min-w-0 items-center gap-2 text-body">
      <CircleAlert size={18} aria-hidden="true" className="shrink-0" />
      {children}
    </p>
  );
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-3${ruled ? ' border-y border-border-default py-4' : ''}`}
    >
      {onRetry ? (
        <TryAgain onRetry={onRetry} held={held} then={then}>
          {line}
        </TryAgain>
      ) : (
        line
      )}
    </div>
  );
}

/** Check on's rows in order: the unlocks first, then protection off, Silent, Not here, Left, Unknown. */
const CHECK_ORDER: readonly GridDisplay[] = [
  'unlocked',
  'left_unprotected',
  'protection_off',
  'left_protection_off',
  'silent',
  'absent',
  'ended',
  'unknown',
];

/** A row of Check on: a state in its tile's words ("Silent · 5 min"), and who is in it. */
export interface CheckRow {
  display: GridDisplay;
  words: string;
  students: Student[];
}

/**
 * Who to check on (ClassLive, LiveStates, LiveTopStates; Home's the same, HomeMoments): everyone the
 * grid shows who isn't focused, the count the board draws (28 − 24 = 4), a row per state in its
 * tile's words, Silent's with its minutes, so two silent for different times get a row each; in
 * `CHECK_ORDER`, each row's students in the grid's order.
 */
export function checkOn(students: readonly Student[], now: Date): CheckRow[] {
  const rows = new Map<string, CheckRow>();
  for (const s of students) {
    const display = gridDisplay(s, now);
    if (display === 'focused') continue;
    const words = stateWords(s, display, now);
    const row = rows.get(words) ?? { display, words, students: [] };
    row.students.push(s);
    rows.set(words, row);
  }
  return [...rows.values()].sort(
    (a, b) => CHECK_ORDER.indexOf(a.display) - CHECK_ORDER.indexOf(b.display),
  );
}

/**
 * Check on (LO5; ClassLive, LiveStates, LiveTopStates): "Check on 4" over its rows, each the state's
 * chip and who is in it, the state and the name only (the owner, 2026-11-16: the times and the
 * reason are in the student's panel). Each name opens that student's panel, as their tile does, and
 * so does Open at the end of a row of one, none on a phone (PhoneLive). An unlock the stream brings
 * glows its row's edge twice with its tile (`bali-softpulse`; LiveStates' An unlock lands), then it
 * holds still. While the live feed is down, the rows faded and the names plain, as they were at the
 * last update. Everyone focused says so in one line; a class with no students yet says that.
 */
function CheckOn({
  id,
  rows,
  total,
  stale,
  live,
  opened,
  panel,
  onOpen,
}: {
  id: string;
  rows: readonly CheckRow[];
  total: number;
  stale: boolean;
  /** The unlocks that landed live and still pulse (`softpulses`), by event id. */
  live: ReadonlySet<string>;
  /** The student whose panel is open, if any, and the panel's id. */
  opened: string | null;
  panel: string;
  /** Open (or close) a student's panel, from the button with the id given. */
  onOpen: (studentId: string, from: string) => void;
}) {
  const faded = stale ? 'opacity-60' : '';
  if (total === 0) return <p className="text-body text-text-secondary">No students yet.</p>;
  const count = rows.reduce((n, row) => n + row.students.length, 0);
  if (count === 0) {
    return (
      <p
        className={`flex items-center gap-3 border-y border-border-default py-4 text-body font-medium text-state-focused-fg ${faded}`}
      >
        <CircleCheck size={18} aria-hidden="true" className="shrink-0" />
        Everyone&apos;s focused.
      </p>
    );
  }
  /** A button that opens a student's panel, its own id, so focus comes back to it as it closes. */
  const opener = (s: Student, kind: 'name' | 'open') => {
    const own = `${id}-${kind}-${s.studentId}`;
    const open = opened === s.studentId;
    return {
      type: 'button' as const,
      id: own,
      'aria-expanded': open,
      'aria-controls': open ? panel : undefined,
      onClick: () => onOpen(s.studentId, own),
    };
  };
  return (
    <div>
      <h3 className="mb-2 text-data font-semibold">Check on {count}</h3>
      <ul className="border-t border-border-default">
        {rows.map((row) => {
          const [one] = row.students.length === 1 ? row.students : [];
          // Its pulsing unlocks, so each new one glows the row from the start, as its tile does.
          const glowing = row.students
            .filter((s) => softpulses(s, row.display, live))
            .map((s) => s.unlock?.eventId)
            .join(' ');
          return (
            // Keyed by its state, never its words: a Silent row's minutes turn over each minute,
            // and the row, a name in it focused, stays put. Silent alone has a row per minute,
            // each told apart by its first student.
            <li
              key={
                row.display === 'silent'
                  ? `silent-${row.students[0]?.studentId ?? ''}`
                  : row.display
              }
              className={`relative grid grid-cols-[minmax(150px,max-content)_minmax(0,1fr)_auto] items-center gap-4 border-b border-border-default py-3 max-[760px]:grid-cols-[minmax(140px,max-content)_minmax(0,1fr)] max-[760px]:gap-x-3 max-[760px]:gap-y-2 ${faded}`}
            >
              <span>
                <LockChip display={row.display} words={row.words} />
              </span>
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                {row.students.map((s) => {
                  const name = s.displayName ?? s.studentId.slice(0, 8);
                  return stale ? (
                    <span key={s.studentId} className="font-semibold wrap-anywhere">
                      {name}
                    </span>
                  ) : (
                    <button
                      key={s.studentId}
                      {...opener(s, 'name')}
                      className={`${NAME_BUTTON} wrap-anywhere`}
                    >
                      {name}
                    </button>
                  );
                })}
              </p>
              {one && !stale ? (
                <button
                  {...opener(one, 'open')}
                  aria-label={`Open ${one.displayName ?? one.studentId.slice(0, 8)}`}
                  className={`${QUIET} justify-self-end max-[760px]:hidden`}
                >
                  Open
                </button>
              ) : null}
              {/* The row's edge glowing, 10 px round, its hairline left straight under it. */}
              {glowing ? (
                <span
                  key={glowing}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 animate-softpulse rounded-sm"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The grid as it stands, for Home's live card to draw in its own words (`LiveGrid`'s `card`). */
export interface GridNow {
  /** Every student, once the snapshot is read; null until then. */
  students: Students | null;
  /** This tab's clock, read each second. */
  now: Date;
  /**
   * The snapshot didn't load, in `errText`'s words; `retry` reads it again, the failure kept while
   * `retrying`, until the answer.
   */
  error: string | null;
  retry: () => void;
  retrying: boolean;
  /** Why the grid may be out of date, and how old it is (`staleness`); null while it is current. */
  stale: Staleness | null;
}

export function LiveGrid({
  sessionId,
  onEnded,
  onSession,
  onCounts,
  present = false,
  clock = null,
  livePage = false,
  card,
  opening = null,
}: {
  sessionId: string;
  /** Called with `sessionId` once the server marks the session over: an end event, or a snapshot. */
  onEnded?: (sessionId: string) => void;
  /** Called with the session as each snapshot the grid keeps says it is: its start and bell (P10). */
  onSession?: (session: SessionSnapshot['session']) => void;
  /** Called with `sessionId` and the grid counted (`stateCounts`) whenever a count changes (PV7). */
  onCounts?: (sessionId: string, counts: StateCounts) => void;
  /**
   * The projector view (LO9; Present, PresentStates): the band, the time left (`clock`) beside the
   * count of who is focused, over a hairline, then everyone's tile one size up (`Tile`); the same
   * states and words, but never an unlock's reason, a last check-in or Clock off, no pop-up and no
   * panel: the class can see it. No lesson piece, whichever way the lessons switch is set.
   */
  present?: boolean;
  /** Present's time left (`PresentClock`), at the start of its band. */
  clock?: ReactNode;
  /**
   * The class page's own grid while a session runs. On the page (LO5, LO6; ClassLive, LiveStates,
   * LiveTopStates, LiveListStates, PhoneLive): the count of who is focused, Check on, then the room,
   * Everyone's tiles, and on the right the session list (`SessionList`), under the room on a phone;
   * the live feed lost or quiet said over the count (`FeedLine`), the count and Check on faded; a
   * grid that didn't load said in the count's place with Try again. In Present (LO9) the same lines
   * over its band and in its room's place, the count faded. Each unlock the stream brings opens a
   * pop-up (PV10; ClassUnlock), and each tile and each name in Check on opens the student's panel
   * (ClassStudent), as does a pop-up's Open student; neither in Present, where the panel closes.
   * The session's log is read for the list and the panel once the grid is (`useSessionLog`), here
   * alone, never for Home's card.
   */
  livePage?: boolean;
  /**
   * Home's live card (PV17b; Main): the grid handed to it as it stands (`GridNow`), drawn there in
   * place of all the grid draws, so Home counts the class from the class page's own snapshot,
   * stream and 15 s read.
   */
  card?: (grid: GridNow) => ReactNode;
  /**
   * A student to open first, named by Home's Check on (`?student=`, LO3): their panel opens once the
   * grid is read, if they are on it, on the live page and not in Present; asked once.
   */
  opening?: string | null;
}) {
  const api = useApi();
  const onUnauthorized = useSignOut();
  // The newest callbacks, read where a snapshot lands, so a new one never restarts the stream.
  const onEndedRef = useRef(onEnded);
  const onSessionRef = useRef(onSession);
  const onCountsRef = useRef(onCounts);
  useEffect(() => {
    onEndedRef.current = onEnded;
    onSessionRef.current = onSession;
    onCountsRef.current = onCounts;
  }, [onEnded, onSession, onCounts]);
  const [students, setStudents] = useState<Students | null>(null);
  // Over when it boots (R5's grid under the recap card): drawn once, holding none of the streams.
  const [over, setOver] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [status, setStatus] = useState<SseStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // a boot that failed, tried again (rule 5)
  // That boot on its way: its failure stays said, Try again held, until it answers (TryAgain).
  const [retrying, setRetrying] = useState(false);
  // Another session's grid starts unread, no failure of this one's said over it.
  const [booting, setBooting] = useState(sessionId);
  if (booting !== sessionId) {
    setBooting(sessionId);
    setError(null);
    setRetrying(false);
  }
  // The unlocks that landed while the grid was open, by event id: their chips pulse (§7).
  const [liveUnlocks, setLiveUnlocks] = useState<ReadonlySet<string>>(() => new Set());
  // And each opens a pop-up (PV10), kept while Present is on and shown after it, until it is closed
  // or the session's live page goes, its grid with it.
  const [popups, tell] = useReducer(popupsAfter, NO_POPUPS);
  // The student whose panel is open (PV11b), and how many times one has opened, so each open,
  // the same student's again from a pop-up included, takes focus into it; and the button in Check
  // on that opened it, if one did, where focus goes back as it closes (else their tile).
  const [panel, setPanel] = useState<{ studentId: string; opens: number; from?: string } | null>(
    null,
  );
  // Every event the stream has brought, folded into the session's log (LO6).
  const [streamed, setStreamed] = useState<readonly FeedEvent[]>([]);
  // The session's log, for the session list and the panel (LO6): read once the grid is, on the
  // class page alone, the stream's events folded in as they come.
  const { log: read, retry: readAgain } = useSessionLog(
    api,
    sessionId,
    livePage && students !== null,
  );
  const log = useMemo<LogRead>(
    () =>
      read.kind === 'ready' ? { kind: 'ready', events: withStreamed(read.events, streamed) } : read,
    [read, streamed],
  );
  const id = useId();
  const tileId = (studentId: string) => `${id}-tile-${studentId}`;
  const panelId = `${id}-panel`;
  // Any sign of life from the server: an event, a heartbeat comment, or a
  // snapshot refresh that came back. A heartbeat is freshness and not just
  // liveness — a quiet class emits no events, so nothing arriving is normal
  // and only nothing arriving FROM THE SERVER means the screen is guessing.
  // Two clocks — see `staleness`. The stream's own, and the grid's (which the
  // 15 s poll also feeds). One clock for both hid a dead stream behind a
  // working poll.
  const lastStreamActivity = useRef<number>(Date.now());
  const lastGridActivity = useRef<number>(Date.now());
  // When the stream's first connect began, for how long it has taken (`healthOf`).
  const connectStart = useRef<number>(Date.now());
  // The newest event seq the grid has applied, so a stale in-flight snapshot
  // can't roll it backwards over a streamed unlock.
  const appliedSeq = useRef<number>(0);

  // Boot from the snapshot, then stream.
  useEffect(() => {
    let sse: SseClient | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await api.get<SessionSnapshot>(`/v1/sessions/${sessionId}`);
        if (cancelled) return;
        setError(null);
        setRetrying(false);
        setStudents(fromSnapshot(snap));
        onSessionRef.current?.(snap.session);
        if (snap.ended) {
          setOver(true);
          onEndedRef.current?.(sessionId);
          return;
        }
        appliedSeq.current = snap.latestSeq;
        lastStreamActivity.current = Date.now();
        lastGridActivity.current = Date.now();
        connectStart.current = Date.now();
        sse = createSseClient({
          url: `${config.apiUrl}/v1/sessions/${sessionId}/stream`,
          getToken: getAccessToken,
          after: snap.latestSeq,
          settled: snap.settledSeq,
          overlap: EVENT_RESUME_OVERLAP,
          onEvent: (e) => {
            setStudents((prev) => (prev ? applyEvent(prev, e) : prev));
            setStreamed((prev) => [...prev, e]);
            const live = landsLive(e, snap.latestSeq);
            if (live) setLiveUnlocks((prev) => new Set(prev).add(e.eventId));
            const news = unlockNews(e, live);
            if (news) tell(news);
            if (e.seq > appliedSeq.current) appliedSeq.current = e.seq;
            lastStreamActivity.current = Date.now();
            lastGridActivity.current = Date.now();
            if (endsSession(e)) onEndedRef.current?.(sessionId);
          },
          onActivity: () => {
            lastStreamActivity.current = Date.now();
            lastGridActivity.current = Date.now();
          },
          onStatus: setStatus,
          onUnauthorized,
        });
      } catch (e) {
        if (cancelled) return;
        setError(errText(e));
        setRetrying(false);
      }
    })();
    return () => {
      cancelled = true;
      sse?.close();
    };
  }, [api, sessionId, onUnauthorized, attempt]);

  // Focus into the panel as it opens, at the student's name (`PanelView`).
  useEffect(() => {
    if (panel !== null) document.getElementById(`${panelId}-name`)?.focus();
  }, [panel, panelId]);
  // Present closes the panel: its moments carry each unlock's reason, never for the projector.
  useEffect(() => {
    if (present) setPanel(null);
  }, [present]);
  // The student Home's Check on named (`opening`), their panel opened once the grid is read, if
  // they are on it (an own key: the address is anyone's to type), on the live page and not in
  // Present; asked once, whatever the answer.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || opening === null || students === null) return;
    opened.current = true;
    if (livePage && !present && Object.hasOwn(students, opening)) {
      setPanel({ studentId: opening, opens: 1 });
    }
  }, [opening, students, livePage, present]);

  // Local clock so the silent badge appears with zero event traffic.
  useEffect(() => {
    if (over) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [over]);

  // The grid counted, told only when a count moves: a student tapping in, unlocking or going
  // silent on this clock, not every second's tick. Never while the grid says it didn't load (the
  // 15 s refresh can still fill it then), so no count stands beside that line.
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (!students || error) return;
    const counts = stateCounts(Object.values(students).map((s) => gridDisplay(s, now)));
    const key = JSON.stringify(counts);
    if (key === told.current) return;
    told.current = key;
    onCountsRef.current?.(sessionId, counts);
  }, [students, now, sessionId, error]);

  // Slow snapshot refresh keeps derived silence honest for quietly-present
  // students: heartbeats update last_seen_at server-side but emit no event
  // (decision 7), so they never reach the grid through the stream alone. It is
  // dropped when the stream has already applied something newer — a snapshot
  // read before an unlock but resolving after it would put the chip back to
  // green for an unshielded phone.
  useEffect(() => {
    if (over) return;
    const t = setInterval(() => {
      void api.get<SessionSnapshot>(`/v1/sessions/${sessionId}`).then(
        (snap) => {
          // The refresh came back, so the GRID is current whether or not it
          // changed anything — "last updated" must not keep counting up past a
          // reload that worked. Deliberately not the stream's clock: this poll
          // runs every 15 s against a 60 s threshold, so feeding it there
          // resets the counter four times per threshold and a stream that has
          // silently died never gets reported at all.
          lastGridActivity.current = Date.now();
          // Over is over, however old the read: a stream that missed the end still ends here.
          if (snap.ended) onEndedRef.current?.(sessionId);
          if (!snapshotIsFresh(snap.latestSeq, appliedSeq.current)) return;
          appliedSeq.current = snap.latestSeq;
          setStudents((cur) => (cur ? mergeSnapshot(cur, snap) : fromSnapshot(snap)));
          onSessionRef.current?.(snap.session);
        },
        () => {
          /* keep the last-known grid; the banner already shows staleness */
        },
      );
    }, 15_000);
    return () => clearInterval(t);
  }, [api, sessionId, over]);

  // How fresh the grid is, once it is read (`staleness`).
  const stale =
    students === null
      ? null
      : staleness({
          status: healthOf(status, now.getTime() - connectStart.current),
          lastStreamActivityAt: lastStreamActivity.current,
          lastGridActivityAt: lastGridActivity.current,
          now: now.getTime(),
          heartbeatMs: STREAM_HEARTBEAT_MS,
        });
  // A boot that failed, read again, its failure said until the answer.
  const retry = () => {
    setRetrying(true);
    setAttempt((n) => n + 1);
  };
  // Home's live card draws the grid as it stands, every line in its own words (PV17b).
  if (card) return card({ students, now, error, retry, retrying, stale: over ? null : stale });

  // The class page's own room, in the lock-only look (LO5); Present's band and room after it (LO9).
  const room = !present;
  // A session that didn't load, or isn't read yet: said in the count's place (ClassRetryStates,
  // LiveTopStates), or in Present in the room's, under its band's time (PresentStates); read, focus
  // on the class's name, the page's heading.
  const waiting = error ? (
    <Oops onRetry={retry} held={retrying} ruled={false}>
      Couldn&apos;t load this session. {error}
    </Oops>
  ) : students ? null : (
    <p role="status" className="text-body text-text-secondary">
      Loading this session…
    </p>
  );
  if (room && waiting) return waiting;
  const lost = waiting === null && stale && !over ? stale : null;
  const rows = students ? Object.values(students) : [];
  const open = (studentId: string, from?: string) => {
    setPanel((cur) => ({ studentId, opens: (cur?.opens ?? 0) + 1, from }));
  };
  // Its tiles are buttons, and its panel shows, on the live page alone, and never in Present.
  const selects = livePage && !present;
  const shown = selects && panel !== null ? students?.[panel.studentId] : undefined;
  // Under 1024 px the room's part is one column: the count with Check on, the room and the session
  // list, each a row of the grid (the left column's `contents`), so the pop-ups' layer can run from
  // the room's top to the list's foot; at 1024 px and wider the list's column, from its top. So the
  // header, the count and Check on are never under a pop-up (GA2; the audit's C01). Each is placed
  // by its row and its column both, as a grid lays two items in one cell only then.
  const roomShown = rows.length > 0;
  const listRow = `max-lg:col-start-1 ${roomShown ? 'max-lg:row-start-3' : 'max-lg:row-start-2'}`;
  // The unlock pop-ups (ClassUnlock, ClassUnlocks), never on the projector, pinned at the window's
  // top right as the page scrolls (the owner's "Pin them", 2026-11-17). Open student closes its
  // pop-up, as ClassStudent draws none.
  const unlocks =
    selects && students ? (
      <UnlockPopups
        unlocks={popups.open}
        students={students}
        tileOf={tileId}
        onClose={(eventId) => tell({ kind: 'close', eventId })}
        onOpen={(u) => {
          tell({ kind: 'close', eventId: u.eventId });
          open(u.studentId);
        }}
        place={`lg:col-start-2 lg:row-start-1 max-lg:col-start-1 ${roomShown ? 'max-lg:row-[2/span_2]' : 'max-lg:row-start-2'}`}
      />
    ) : null;
  const tilesOf = rows.map((s) => {
    const unlock = s.unlock?.eventId;
    return (
      <Tile
        key={s.studentId}
        student={s}
        now={now}
        present={present}
        pulse={softpulses(s, gridDisplay(s, now), liveUnlocks)}
        onPulseEnd={() =>
          setLiveUnlocks((prev) => {
            const next = new Set(prev);
            if (unlock !== undefined) next.delete(unlock);
            return next;
          })
        }
        select={
          selects
            ? {
                id: tileId(s.studentId),
                panel: panelId,
                selected: panel?.studentId === s.studentId,
                // A second press closes it again, focus staying on the tile.
                onSelect: () =>
                  panel?.studentId === s.studentId ? setPanel(null) : open(s.studentId),
              }
            : undefined
        }
      />
    );
  });
  // The student's panel (ClassStudent), from the session's log, sliding in afresh for each student;
  // Close or Escape gives focus back to the button in Check on that opened it, else to their tile.
  const studentPanel = shown ? (
    <StudentPanel
      key={shown.studentId}
      id={panelId}
      student={shown}
      chip={<StateChip student={shown} now={now} />}
      log={log}
      now={now}
      onClose={() => {
        const from = panel?.from ? document.getElementById(panel.from) : null;
        (from ?? document.getElementById(tileId(shown.studentId)))?.focus();
        setPanel(null);
      }}
      onRetry={readAgain}
    />
  ) : null;

  const counted = stateCounts(rows.map((s) => gridDisplay(s, now)));
  if (room && students) {
    // ClassLive: the count of who is focused, then who to check on, then the whole room, 40 px
    // apart; the live feed lost or quiet said over the count, the count and Check on as they were
    // at the last update, faded (LiveStates, LiveTopStates). Nobody in the class yet: no room. On
    // the right, 340 px and 48 px off, the session list; under 1024 px, where beside it the room
    // would narrow to a tile or two a row, after the room, 40 px under it, and on a phone, under
    // 760 px, 32 (LiveListStates' tablet, PhoneLive); the pop-ups' layer over the list's cells.
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-12 max-lg:grid-cols-1 max-[760px]:gap-8 min-[760px]:max-lg:gap-10">
        <div className="flex min-w-0 flex-col gap-10 max-lg:contents">
          <section
            aria-labelledby={`${id}-count`}
            className={`flex min-w-0 flex-col gap-6 max-lg:col-start-1 max-lg:row-start-1${roomShown ? ' max-[760px]:mb-2' : ''}`}
          >
            {lost ? <FeedLine stale={lost} /> : null}
            <h2
              id={`${id}-count`}
              className={`flex flex-wrap items-baseline gap-x-3 ${lost ? 'opacity-60' : ''}`}
            >
              <span className="text-count tabular-nums max-[760px]:text-count-phone">
                {counted.counts.focused}
              </span>{' '}
              <span className="text-count-of text-text-secondary max-[760px]:text-count-of-phone">
                of {counted.total} focused
              </span>
            </h2>
            <CheckOn
              id={id}
              rows={checkOn(rows, now)}
              total={counted.total}
              stale={lost !== null}
              live={liveUnlocks}
              opened={panel?.studentId ?? null}
              panel={panelId}
              onOpen={(studentId, from) =>
                panel?.studentId === studentId ? setPanel(null) : open(studentId, from)
              }
            />
          </section>
          {roomShown ? (
            <section
              aria-labelledby={`${id}-room`}
              className="flex min-w-0 flex-col gap-4 max-lg:col-start-1 max-lg:row-start-2"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                <h2 id={`${id}-room`} className="text-section-title">
                  Everyone
                </h2>
                <span className="text-data font-normal text-text-tertiary">{rows.length}</span>
              </div>
              <ul aria-label="Everyone in the class" className={`grid ${ROOM}`}>
                {tilesOf}
              </ul>
            </section>
          ) : null}
        </div>
        <div className={`min-w-0 lg:col-start-2 lg:row-start-1 ${listRow}`}>
          <SessionList id={id} log={log} students={students} onRetry={readAgain} />
        </div>
        {unlocks}
        {studentPanel}
      </div>
    );
  }

  // Present (LO9; Present, PresentStates): the live feed lost or quiet said over the band, the count
  // faded with it; the band, the time left beside the count of who is focused, over a hairline;
  // then everyone's tile one size up. Until the session is read, or if it didn't load, the band's
  // time alone and that line in the room's place; nobody in the class yet, said there.
  return (
    <>
      {lost ? <FeedLine stale={lost} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-6 border-b border-border-strong pb-6">
        {clock}
        {waiting ? null : (
          <h2 className={`flex flex-wrap items-baseline gap-x-4 ${lost ? 'opacity-60' : ''}`}>
            <span className="text-present-count tabular-nums">{counted.counts.focused}</span>{' '}
            <span className="text-present-count-of text-text-secondary">
              of {counted.total} focused
            </span>
          </h2>
        )}
      </div>
      {waiting ??
        (rows.length === 0 ? (
          <p className="text-body text-text-secondary">No students yet.</p>
        ) : (
          <ul aria-label="Everyone in the class" className={`grid ${PRESENT_ROOM}`}>
            {tilesOf}
          </ul>
        ))}
    </>
  );
}
