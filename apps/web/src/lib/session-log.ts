import type { FeedEvent } from '@bali/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from './api-client';
import { errText } from './errors';
import { applyEvent, type Students } from './grid-state';
import { readEvents } from './recap';

/*
 * The session's own log on the class page (LO6; ClassLive's session list, ClassStudent's panel,
 * LiveListStates): every event of the session, read once its grid is and kept up to date by the
 * grid's stream, so the session list and each student's panel say the same from one read. Logic
 * only: the list (`session-list.tsx`) and the panel (`student-panel.tsx`) say it.
 */

/** The log: on its way, read, or failed, with what to say beside its Try again (rule 5). */
export type LogRead =
  | { kind: 'loading' }
  | { kind: 'ready'; events: readonly FeedEvent[] }
  | { kind: 'error'; message: string };

/**
 * A session's whole log, every page of its feed from the start (`readEvents`). A failure is a
 * result, never thrown, in `errText`'s words: part of the log is never given as the whole.
 */
export async function readLog(
  api: Pick<ApiClient, 'get'>,
  sessionId: string,
): Promise<Exclude<LogRead, { kind: 'loading' }>> {
  try {
    return { kind: 'ready', events: await readEvents(api, sessionId) };
  } catch (e) {
    return { kind: 'error', message: errText(e) };
  }
}

/**
 * The log with what the stream brought folded in, as the live page folds the stream's
 * (ARCHITECTURE, Live updates): each event once by its id, so one both the read and the stream
 * bring (the overlap) counts once, in the engine's order (`seq`), so one that committed late under
 * a lower seq takes its place. Nothing new gives back `read` itself.
 */
export function withStreamed(
  read: readonly FeedEvent[],
  streamed: readonly FeedEvent[],
): readonly FeedEvent[] {
  const byId = new Map(read.map((e) => [e.eventId, e]));
  for (const e of streamed) if (!byId.has(e.eventId)) byId.set(e.eventId, e);
  if (byId.size === read.length) return read;
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** What a line of the session list says happened (ClassLive). */
export type LineKind = 'started' | 'unlock' | 'silent' | 'focus' | 'off';

/** One line of the session list. */
export interface LogLine {
  /** Its event's id. */
  key: string;
  kind: LineKind;
  /** Who it is about; none for the session's start. */
  studentId: string | null;
  /** When, on the server's record (rule 1: the phone's claim held to the session's window). */
  at: Date;
}

/** A student's states their next focused is a return from. */
const AWAY: readonly unknown[] = ['unlocked', 'protection_off'];

/**
 * The session list's lines (ClassLive; LiveListStates), newest first, a moment at one instant the
 * engine's later first: the session's start, every Emergency Unlock and every protection off (each
 * whatever it changed, as the report lists them), a phone going silent, and a student back in focus
 * after an unlock or protection off, by Back to focus, Screen Time back on or a tap of the block.
 * Back in focus is read by the grid's own state function (`applyEvent`, rule 2), each event applied
 * in the engine's order, so a late return the engine recorded but never applied is none. Nothing
 * else of a student's (a tap-in, a check-in again, Screen Time back on while still unlocked, a
 * leave) is a line: no board shows one there.
 */
export function logLines(events: readonly FeedEvent[]): LogLine[] {
  const lines: LogLine[] = [];
  let students: Students = {};
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const id = e.userId;
    const before = id === null ? null : (students[id]?.state ?? null);
    students = applyEvent(students, e);
    const back = id !== null && AWAY.includes(before) && students[id]?.state === 'focused';
    const kind: LineKind | null =
      e.type === 'session_started'
        ? 'started'
        : e.type === 'unlock'
          ? 'unlock'
          : e.type === 'protection_off'
            ? 'off'
            : e.type === 'went_silent'
              ? 'silent'
              : back
                ? 'focus'
                : null;
    if (kind !== null)
      lines.push({ key: e.eventId, kind, studentId: id, at: new Date(e.occurredAt) });
  }
  // Newest first; the sort keeps the engine's later first at one instant.
  return lines.reverse().sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * The session's log on the class page: read once `reading` turns on (its grid read, so the log holds
 * every event up to the grid's and the stream brings the rest), and again by `retry` after a
 * failure, the failure said until Bali answers (`TryAgain` holds on the promise). Only the newest
 * read's answer is kept.
 */
export function useSessionLog(
  api: Pick<ApiClient, 'get'>,
  sessionId: string,
  reading: boolean,
): { log: LogRead; retry: () => Promise<void> } {
  const [log, setLog] = useState<LogRead>({ kind: 'loading' });
  const turn = useRef(0);
  const retry = useCallback(async () => {
    const mine = ++turn.current;
    const answer = await readLog(api, sessionId);
    if (turn.current === mine) setLog(answer);
  }, [api, sessionId]);
  useEffect(() => {
    if (!reading) return;
    void retry();
    return () => {
      turn.current += 1;
    };
  }, [reading, retry]);
  return { log, retry };
}
