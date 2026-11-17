import type { FeedEvent } from '@bali/shared';

import { gridDisplay, type GridDisplay, lastContact, type Student } from './grid-state';
import { type StudentMoment, studentMoments } from './recap';

/*
 * The student panel's logic (PV11a; ClassStudent), kept out of the component so it can be tested
 * directly, as the grid's is: one student in one session, their state and last check-in as their
 * tile has them, and from the session's log (`session-log.ts`, LO6) when they tapped in and each
 * moment. Data only: the panel says it.
 */

/** One of the student's moments here: the recap's own (`studentMoments`), what happened and when. */
export type PanelMoment = StudentMoment;

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
  const moments = studentMoments(events, student.studentId);
  const contact = student.joinedAt === null ? null : lastContact(student);
  return {
    display: gridDisplay(student, now),
    tappedInAt: moments.find((m) => m.moment === 'in')?.at ?? null,
    moments,
    lastCheckIn: contact && new Date(Math.min(contact.getTime(), now.getTime())),
  };
}
