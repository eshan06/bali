import { describe, expect, it } from 'vitest';

import { lastSessionDay, sessionDay, sessionRan } from './classes';

/*
 * The days and times Home says (LO3; Main, HomeIdle): a class's last session in Your classes, and
 * when the last session ran in its well. Your classes, the first class and Your block are driven in
 * `home.test.tsx` and `blocks.test.tsx`.
 */

const UTC = { locale: 'en-US', timeZone: 'UTC' };
/** Monday, October 12, 2026, 2:30 PM UTC. */
const NOW = new Date('2026-10-12T14:30:00.000Z');

describe('a session’s day (Main, HomeIdle; ClassesStates)', () => {
  it('is Today, a day of the last six, else its date, with its year once that isn’t this one', () => {
    const day = (iso: string) => sessionDay(iso, NOW, UTC);
    expect(day('2026-10-12T08:00:00.000Z')).toBe('Today');
    expect(day('2026-10-11T22:00:00.000Z')).toBe('Sunday');
    expect(day('2026-10-09T13:00:00.000Z')).toBe('Friday');
    expect(day('2026-10-06T09:00:00.000Z')).toBe('Tuesday');
    // A week ago or more: its date, a weekday no longer telling which week.
    expect(day('2026-10-05T09:00:00.000Z')).toBe('Oct 5');
    expect(day('2026-10-02T09:00:00.000Z')).toBe('Oct 2');
    expect(day('2025-12-18T09:00:00.000Z')).toBe('Dec 18, 2025');
  });

  it('says a class’s last session in Your classes: today with its time, else its day alone', () => {
    expect(lastSessionDay('2026-10-12T08:00:00.000Z', NOW, UTC)).toBe('Today, 8:00 AM');
    expect(lastSessionDay('2026-10-09T13:00:00.000Z', NOW, UTC)).toBe('Friday');
    expect(lastSessionDay('2026-10-02T09:00:00.000Z', NOW, UTC)).toBe('Oct 2');
  });

  it('says when the last session ran, its start’s AM or PM left off when its end has the same', () => {
    const ran = (startedAt: string, endedAt: string) =>
      sessionRan({ startedAt, endedAt }, NOW, UTC);
    expect(ran('2026-10-12T08:00:00.000Z', '2026-10-12T08:50:00.000Z')).toBe(
      'Today, 8:00 to 8:50 AM',
    );
    expect(ran('2026-10-09T11:30:00.000Z', '2026-10-09T12:20:00.000Z')).toBe(
      'Friday, 11:30 AM to 12:20 PM',
    );
    expect(ran('2026-10-02T13:05:00.000Z', '2026-10-02T13:55:00.000Z')).toBe(
      'Oct 2, 1:05 to 1:55 PM',
    );
  });
});
