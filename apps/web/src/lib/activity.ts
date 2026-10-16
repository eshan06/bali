import { ACTIVITY_EVENT_TYPES, type ActivityEvent, type ActivityResponse } from '@bali/shared';

import { type ApiClient, POLL_TIMEOUT_MS } from './api-client';
import { errText } from './errors';
import type { PageVisibility } from './live-question';
import { rereadEvery } from './student-web';

/*
 * Home's Recent activity (PV17c; Main), kept out of the component so it can be tested directly:
 * its read, and its read again while Home is in view.
 */

/**
 * How long Home waits after Recent activity's last answer to read it again while it is in view: the
 * class page's grid reads its session as often (15 s), so the list keeps to the live card beside it.
 */
export const ACTIVITY_EVERY_MS = 15_000;

/** Recent activity as Home has it: being read, read, or why it couldn't be. */
export type ActivityRead =
  | { kind: 'loading' }
  | { kind: 'ready'; events: ActivityEvent[] }
  | { kind: 'error'; message: string };

const KINDS: readonly string[] = ACTIVITY_EVENT_TYPES;

/**
 * Read Recent activity (`GET /v1/me/activity`, PV3): today's unlocks, protection offs and starts
 * across the teacher's classes, newest first, four at most. A kind this build doesn't know is
 * skipped, as the vocabulary's rule says, and so is an unlock or protection off naming no student,
 * which the API never sends. A poll's limit, so a read the network swallows fails in 10 s (#334).
 * Never thrown: a failure is said with Try again.
 */
export async function readActivity(
  api: Pick<ApiClient, 'get'>,
): Promise<Exclude<ActivityRead, { kind: 'loading' }>> {
  try {
    const { events } = await api.get<ActivityResponse>('/v1/me/activity', POLL_TIMEOUT_MS);
    return {
      kind: 'ready',
      events: events.filter(
        (e) => KINDS.includes(e.type) && (e.type === 'session_started' || e.student !== null),
      ),
    };
  } catch (e) {
    return { kind: 'error', message: errText(e) };
  }
}

/**
 * Read Recent activity now and at once as the page comes back into view, and between those every
 * `ACTIVITY_EVERY_MS` while it is in view (`rereadEvery`: its first read that long after the poll
 * starts, each next that long after the one before answered, one at a time, none while hidden),
 * telling `show` each answer. Only the newest read's answer is told, so one that lands late never
 * puts an older list back. Stopped as Home stops showing it.
 */
export function pollActivity(
  api: Pick<ApiClient, 'get'>,
  show: (read: Exclude<ActivityRead, { kind: 'loading' }>) => void,
  doc: PageVisibility = document,
): { stop(): void } {
  let stopped = false;
  let newest = 0;
  const read = async () => {
    const mine = (newest += 1);
    const answer = await readActivity(api);
    if (!stopped && mine === newest) show(answer);
  };
  const back = () => {
    if (doc.visibilityState === 'visible') void read();
  };

  void read();
  const again = rereadEvery(read, doc, ACTIVITY_EVERY_MS);
  doc.addEventListener('visibilitychange', back);
  return {
    stop() {
      stopped = true;
      again.stop();
      doc.removeEventListener('visibilitychange', back);
    },
  };
}
