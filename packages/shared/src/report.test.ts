import { describe, expect, it } from 'vitest';

import type { EventType } from './index.js';
import { sessionReport, type ReportEvent, type ReportWindow } from './report.js';

/*
 * One test per counting rule of PLAN.md's reports row, on events built by
 * hand. packages/db/test/report.test.ts drives the real engine through the
 * same rules and reads back what it stores.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 9, 0) + minute * 60_000);
/** A 09:00–09:25 lesson that ran to its bell, read at 09:30. */
const lesson: ReportWindow = { startedAt: at(0), endsAt: at(25), endedAt: at(25) };
const later = at(30);
const late = { recorded_as: 'superseded' };

/** Events in the order the engine recorded them: each one's `seq` is its place here. */
function recorded(...rows: [EventType, string | null, number, unknown?][]): ReportEvent[] {
  return rows.map(([type, userId, minute, payload], i) => ({
    eventId: `event-${i + 1}`,
    seq: i + 1,
    type,
    userId,
    occurredAt: at(minute),
    payload: payload ?? null,
  }));
}

describe('sessionReport', () => {
  it('counts each joined student’s focus to the end, and averages it over who joined', () => {
    const report = sessionReport(
      lesson,
      recorded(
        ['session_started', null, 0],
        ['tap_in', 'ana', 1],
        ['tap_in', 'ben', 5],
        ['session_expired', null, 25],
      ),
      later,
    );
    expect(report).toEqual({
      joined: ['ana', 'ben'],
      focusMinutes: 44,
      averageFocusMinutes: 22,
      silentMinutes: 0,
      unlocks: [],
      protectionOffs: [],
    });
  });

  it('with no one joined, the average is none, never zero', () => {
    const report = sessionReport(lesson, recorded(['session_started', null, 0]), later);
    expect(report).toMatchObject({ joined: [], focusMinutes: 0, averageFocusMinutes: null });
  });

  it('never counts past ended_at: an unlock or protection off noted after_session_end adds nothing', () => {
    // Ended early, at 09:10. Both reached the server after the end; their
    // claims, clamped to the scheduled window, fall past the real end.
    const early = { ...lesson, endedAt: at(10) };
    const report = sessionReport(
      early,
      recorded(
        ['tap_in', 'ana', 1],
        ['session_ended', null, 10],
        ['unlock', 'ana', 20, { recorded_as: 'after_session_end', reason: 'nurse' }],
        ['protection_off', 'ana', 22, { recorded_as: 'after_session_end' }],
      ),
      later,
    );
    expect(report.focusMinutes).toBe(9);
    expect(report.unlocks).toEqual([
      {
        eventId: 'event-3',
        studentId: 'ana',
        occurredAt: at(20),
        reason: 'nurse',
        recordedAs: 'after_session_end',
      },
    ]);
    expect(report.protectionOffs).toEqual([
      { eventId: 'event-4', studentId: 'ana', occurredAt: at(22), recordedAs: 'after_session_end' },
    ]);
  });

  it('never counts past the bell: one the sweep has not ended counts to its bell, one running to now', () => {
    const unswept = { ...lesson, endedAt: null };
    const events = recorded(['tap_in', 'ana', 1]);
    expect(sessionReport(unswept, events, at(40)).focusMinutes).toBe(24);
    expect(sessionReport(unswept, events, at(10)).focusMinutes).toBe(9);
  });

  it('an unlock noted superseded never ends focus, after the end included', () => {
    // Stuck on the phone while its re-tap (09:08) went ahead, it landed after
    // the end: late, recorded, and the student was focused all along.
    const early = { ...lesson, endedAt: at(20) };
    const report = sessionReport(
      early,
      recorded(
        ['tap_in', 'ana', 1],
        ['tap_in', 'ana', 8],
        ['session_ended', null, 20],
        ['unlock', 'ana', 5, { recorded_as: 'superseded', reason: 'bathroom' }],
      ),
      later,
    );
    expect(report.focusMinutes).toBe(19);
    expect(report.unlocks).toMatchObject([{ occurredAt: at(5), recordedAs: 'superseded' }]);
  });

  it('a return noted superseded never starts focus, and a tap noted so never joins (A13, A14)', () => {
    // Ana's refocus was made before her 09:06 unlock and landed after it; Ben's
    // only tap was older than one of his into another class.
    const report = sessionReport(
      lesson,
      recorded(
        ['tap_in', 'ana', 1],
        ['unlock', 'ana', 6],
        ['refocus', 'ana', 4, late],
        ['tap_in', 'ben', 2, late],
      ),
      later,
    );
    expect(report).toMatchObject({ joined: ['ana'], focusMinutes: 5, averageFocusMinutes: 5 });
  });

  it('orders a student’s own unlock and return as the engine did, never by the times alone (A12)', () => {
    // Unlocked at 09:05 and back at 09:08; then the clock went back five
    // minutes and the real unlock after the return claims 09:03. The engine
    // applied it — by the phone's order it came last — so she stays unlocked.
    // By the times she would be focused from 09:08 to the bell: 19 minutes.
    const events = recorded(
      ['tap_in', 'ana', 1],
      ['unlock', 'ana', 5],
      ['refocus', 'ana', 8],
      ['unlock', 'ana', 3],
    );
    const report = sessionReport(lesson, [...events].reverse(), later);
    expect(report.focusMinutes).toBe(4);
  });

  it('a time before the record ahead of it counts from that record: a clock turned back adds nothing', () => {
    const report = sessionReport(
      lesson,
      recorded(['tap_in', 'ana', 20], ['unlock', 'ana', 2], ['refocus', 'ana', 3]),
      later,
    );
    expect(report.focusMinutes).toBe(5);
  });

  it('left_for_other_session ends focus and is never an unlock (decision 4)', () => {
    const report = sessionReport(
      lesson,
      recorded(['tap_in', 'ana', 1], ['left_for_other_session', 'ana', 10]),
      later,
    );
    expect(report).toMatchObject({ joined: ['ana'], focusMinutes: 9, unlocks: [] });
  });

  it('a removal or a leave ends focus; a tap after it starts a new stint, one join', () => {
    const report = sessionReport(
      lesson,
      recorded(
        ['tap_in', 'ana', 1],
        ['enrollment_removed', 'ana', 5],
        ['unlock', 'ana', 7, { recorded_as: 'no_live_participation' }],
        ['tap_in', 'ana', 10],
        ['enrollment_left', 'ana', 20],
      ),
      later,
    );
    expect(report).toMatchObject({ joined: ['ana'], focusMinutes: 14 });
    expect(report.unlocks).toMatchObject([{ recordedAs: 'no_live_participation' }]);
  });

  it('armed_tap_skipped is never a join', () => {
    const report = sessionReport(
      lesson,
      recorded(['armed_tap_skipped', 'ana', 0, { armed_tap_event_id: 'spent' }]),
      later,
    );
    expect(report).toMatchObject({ joined: [], focusMinutes: 0, averageFocusMinutes: null });
  });

  it('an unlock kept with no class is in none, and the one filed under its tap counts once', () => {
    const kept = (recordedAs: string) => ({ recorded_as: recordedAs, reason: 'nurse' });
    const report = sessionReport(
      lesson,
      recorded(
        ['unlock', 'ana', 1, kept('tap_armed')],
        ['unlock', 'ana', 1, kept('unknown_session')],
        ['unlock', 'ana', 1, kept('not_enrolled')],
        ['unlock', 'ana', 2, kept('unknown_tap')],
        ['tap_in', 'ana', 1],
        // Its tap landed and filed it: an unlock of its own, naming the kept one.
        [
          'unlock',
          'ana',
          2,
          { tap_event_id: 'tap', unattached_event_id: 'event-4', reason: 'nurse' },
        ],
      ),
      later,
    );
    expect(report.unlocks).toEqual([
      {
        eventId: 'event-6',
        studentId: 'ana',
        occurredAt: at(2),
        reason: 'nurse',
        recordedAs: null,
      },
    ]);
    expect(report.focusMinutes).toBe(1);
  });

  it('protection off ends focus as an unlock does; Screen Time back on returns to the state before it', () => {
    const report = sessionReport(
      lesson,
      recorded(
        ['tap_in', 'ana', 1],
        ['protection_off', 'ana', 5],
        ['protection_on', 'ana', 9],
        // Unlocked before it went off: back on, she is still unlocked.
        ['tap_in', 'ben', 1],
        ['unlock', 'ben', 3],
        ['protection_off', 'ben', 5],
        ['protection_on', 'ben', 9],
        // An unlock made while it was off changed nothing then, and stands after.
        ['tap_in', 'cy', 1],
        ['protection_off', 'cy', 5],
        ['unlock', 'cy', 7, { recorded_as: 'protection_off' }],
        ['protection_on', 'cy', 9],
        // Back on, made before a protection off of the phone's own: late.
        ['tap_in', 'di', 1],
        ['protection_off', 'di', 5],
        ['protection_on', 'di', 9, late],
        // A late unlock is no turn: back on returns to the re-tap that went ahead of it.
        ['tap_in', 'ed', 1],
        ['tap_in', 'ed', 4],
        ['unlock', 'ed', 2, late],
        ['protection_off', 'ed', 5],
        ['protection_on', 'ed', 9],
      ),
      later,
    );
    // Ana 4 + 16, Ben 2, Cy 4, Di 4, Ed 4 + 16.
    expect(report.focusMinutes).toBe(50);
    expect(report.protectionOffs.map((off) => [off.studentId, off.recordedAs])).toEqual([
      ['ana', null],
      ['ben', null],
      ['cy', null],
      ['di', null],
      ['ed', null],
    ]);
    expect(report.unlocks).toMatchObject([
      { studentId: 'ed', recordedAs: 'superseded' },
      { studentId: 'ben', recordedAs: null },
      { studentId: 'cy', recordedAs: 'protection_off' },
    ]);
  });

  it('silence is never focus: counted apart, from went_silent until contact or the end', () => {
    const report = sessionReport(
      lesson,
      recorded(
        ['tap_in', 'ana', 1],
        ['went_silent', 'ana', 5],
        ['came_back', 'ana', 8],
        ['tap_in', 'ben', 1],
        ['went_silent', 'ben', 20],
      ),
      later,
    );
    // Ana 4 + 17 and 3 silent; Ben 19 and 5 silent.
    expect(report).toMatchObject({ focusMinutes: 40, silentMinutes: 8 });
  });

  it('an unlock shows its reason now: its latest change’s (A20)', () => {
    const report = sessionReport(
      lesson,
      recorded(
        ['tap_in', 'ana', 1],
        ['unlock', 'ana', 3, { reason: 'bathroom' }],
        ['unlock_reason_changed', 'ana', 4, { unlock_event_id: 'event-2', reason: 'nurse' }],
        ['unlock_reason_changed', 'ana', 5, { unlock_event_id: 'event-2', reason: 'other' }],
        ['tap_in', 'ben', 1],
        ['unlock', 'ben', 6],
      ),
      later,
    );
    expect(report.unlocks.map((u) => [u.studentId, u.reason])).toEqual([
      ['ana', 'other'],
      ['ben', null],
    ]);
  });

  it('a note this build does not know moves no one, and is listed as none (#191’s review)', () => {
    // A newer build's note, read here mid-deploy: a note always means the
    // engine did not apply the record, so Ana stays focused to the bell and
    // Ben never joins.
    const newer = { recorded_as: 'a_newer_note' };
    const report = sessionReport(
      lesson,
      recorded(
        ['tap_in', 'ana', 1],
        ['unlock', 'ana', 5, { ...newer, reason: 'nurse' }],
        ['protection_off', 'ana', 10, newer],
        ['tap_in', 'ben', 2, newer],
      ),
      later,
    );
    expect(report).toMatchObject({ joined: ['ana'], focusMinutes: 24, averageFocusMinutes: 24 });
    expect(report.unlocks).toEqual([
      {
        eventId: 'event-2',
        studentId: 'ana',
        occurredAt: at(5),
        reason: 'nurse',
        recordedAs: null,
      },
    ]);
    expect(report.protectionOffs).toEqual([
      { eventId: 'event-3', studentId: 'ana', occurredAt: at(10), recordedAs: null },
    ]);
  });

  it('lists every unlock in the class with its note, oldest first', () => {
    const report = sessionReport(
      lesson,
      recorded(
        ['tap_in', 'ana', 1],
        ['unlock', 'ana', 9],
        ['unlock', 'ben', 4, { recorded_as: 'no_live_participation' }],
        ['tap_in', 'ana', 12],
        ['unlock', 'ana', 10, late],
      ),
      later,
    );
    expect(report.unlocks.map((u) => [u.studentId, u.occurredAt, u.recordedAs])).toEqual([
      ['ben', at(4), 'no_live_participation'],
      ['ana', at(9), null],
      ['ana', at(10), 'superseded'],
    ]);
  });
});
