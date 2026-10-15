import {
  EVENT_RESUME_OVERLAP,
  type FeedEvent,
  isUnlockReason,
  type UnlockReason,
} from '@bali/shared';

import type { ApiClient } from './api-client';
import { errText } from './errors';
import { gridDisplay, type GridDisplay, type Student } from './grid-state';
import { type Moment, momentOf, payloadOf, readEvents } from './recap';

/*
 * The student panel's logic (PV11a; the canvas's ClassStudent and PanelStates), kept out of the
 * component so it can be tested directly, as the grid's is: one student in one session, their state
 * and last check-in as their tile has them, and from the session's events when they tapped in and
 * each moment. Data only: the panel (PV11b) says it.
 */

/** One student's events in one session, each once by its event id, in the engine's order (`seq`). */
export interface StudentEvents {
  sessionId: string;
  studentId: string;
  events: FeedEvent[];
  /** The last `seq` the session's feed was read to: a read again resumes the overlap before it. */
  cursor: number;
}

/** Nothing read yet: a read from it reads the session's feed from its start. */
export function noEvents(sessionId: string, studentId: string): StudentEvents {
  return { sessionId, studentId, events: [], cursor: 0 };
}

/**
 * Events folded in, as the live page folds the stream's (ARCHITECTURE, Live updates): this session's
 * and this student's alone, each once by its event id, so one both a read and the stream bring (the
 * overlap) counts once, and one that committed late under a lower `seq` takes its place. Nothing new
 * gives back `known` itself. The cursor stays the read's.
 */
export function withEvents(
  known: StudentEvents,
  sessionId: string,
  incoming: readonly FeedEvent[],
): StudentEvents {
  if (sessionId !== known.sessionId) return known;
  const byId = new Map(known.events.map((e) => [e.eventId, e]));
  for (const e of incoming) {
    if (e.userId === known.studentId && !byId.has(e.eventId)) byId.set(e.eventId, e);
  }
  if (byId.size === known.events.length) return known;
  return { ...known, events: [...byId.values()].sort((a, b) => a.seq - b.seq) };
}

/** The panel's read: under way, read, or failed, with what to say beside its Try again (rule 5). */
export type StudentRead =
  | { kind: 'loading' }
  | { kind: 'ready'; events: StudentEvents }
  | { kind: 'error'; message: string };

/**
 * Read a student's events into `known`: every page of the session's feed from its start, or, read
 * before, from `EVENT_RESUME_OVERLAP` before its cursor, as a live screen resumes, so an event that
 * committed late under a lower `seq` is still found. A failure is a result, never thrown, said in
 * `errText`'s words; part of the feed is never given as the whole, and Try again reads again. What
 * the stream brought while the read was out is folded into its answer, never dropped:
 * `withEvents(answer.events, sessionId, held.events)`.
 */
export async function readStudentEvents(
  api: Pick<ApiClient, 'get'>,
  known: StudentEvents,
): Promise<Exclude<StudentRead, { kind: 'loading' }>> {
  try {
    const from = Math.max(0, known.cursor - EVENT_RESUME_OVERLAP);
    const read = await readEvents(api, known.sessionId, from);
    const cursor = read.reduce((last, e) => Math.max(last, e.seq), known.cursor);
    return { kind: 'ready', events: { ...withEvents(known, known.sessionId, read), cursor } };
  } catch (e) {
    return { kind: 'error', message: errText(e) };
  }
}

/** One of the student's moments here: what happened, as the recap marks it, and when. */
export interface PanelMoment {
  /** Its event id. */
  key: string;
  moment: Moment;
  /** When, by the server's record (rule 1: the phone's claim held to the session's window). */
  at: Date;
  /**
   * An unlock's reason now: its latest change's (A20), else the one it was sent with; null when
   * none, or one this tab doesn't know, as the tile reads it, and on any other moment.
   */
  reason: UnlockReason | null;
}

export interface StudentPanel {
  /** Their tile's own state (`gridDisplay`, on the shared state function): never another (rule 2). */
  display: GridDisplay;
  /** Their first tap-in here that the engine applied, by its record; null before one. */
  tappedInAt: Date | null;
  /** Their moments here, oldest first, at one instant in the engine's order: the recap's own. */
  moments: PanelMoment[];
  /**
   * When the server last heard from their phone: what their tile's minutes count from
   * (`minutesSinceContact`), never later than now, as those minutes are never fewer than none (a
   * phone's clock set ahead, S9, puts a streamed record's time there until the refresh); null until
   * they tapped in here.
   */
  lastCheckIn: Date | null;
}

/**
 * One student's panel: their state and last check-in from the grid (`student`, their tile's), and
 * from their events here (any others in `events` are left out) when they tapped in and each moment.
 */
export function studentPanel(
  student: Student,
  events: readonly FeedEvent[],
  now: Date,
): StudentPanel {
  // Each once by its event id, as a replay in the overlap is, in the engine's order.
  const theirs = [
    ...new Map(
      events.filter((e) => e.userId === student.studentId).map((e) => [e.eventId, e]),
    ).values(),
  ].sort((a, b) => a.seq - b.seq);
  // Each unlock's latest change, in the engine's order (A20).
  const changed = new Map<unknown, unknown>();
  for (const e of theirs) {
    if (e.type !== 'unlock_reason_changed') continue;
    const { unlock_event_id: of, reason } = payloadOf(e.payload);
    changed.set(of, reason);
  }
  const moments: PanelMoment[] = [];
  for (const e of theirs) {
    const moment = momentOf(e);
    if (moment === null) continue;
    const reason = changed.has(e.eventId) ? changed.get(e.eventId) : payloadOf(e.payload).reason;
    moments.push({
      key: e.eventId,
      moment,
      at: new Date(e.occurredAt),
      reason: moment === 'unlock' && isUnlockReason(reason) ? reason : null,
    });
  }
  // Oldest first, as the recap places them; the sort keeps the engine's order at one instant.
  moments.sort((a, b) => a.at.getTime() - b.at.getTime());
  const contact = student.joinedAt === null ? null : (student.lastSeenAt ?? student.joinedAt);
  return {
    display: gridDisplay(student, now),
    tappedInAt: moments.find((m) => m.moment === 'in')?.at ?? null,
    moments,
    lastCheckIn: contact && new Date(Math.min(contact.getTime(), now.getTime())),
  };
}
