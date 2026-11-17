import { describe, expect, it } from 'vitest';

import { bareTime, type Moment } from '../lib/recap';
import { axisEndOf, stretchesOf, trackWords } from './timeline';

/*
 * The recap's tracks (LO7; ClassEnded): a student's session as stretches, from the recap's own
 * moments by the grid's own rules, and the words a screen reader hears for them. The rows they draw
 * are driven in recap-card.test.tsx.
 */
const AT = (minute: number) => Date.UTC(2026, 9, 12, 14, minute);
const START = AT(5);
const END = AT(55);
/** Moments at these minutes. */
const moments = (...list: [Moment, number][]) =>
  list.map(([moment, minute], i) => ({ key: `m${i}`, moment, at: new Date(AT(minute)) }));
/** Each stretch as "state from-to", in minutes. */
const said = (list: { state: string; from: number; to: number }[]) =>
  list.map((s) => `${s.state} ${(s.from - AT(0)) / 60_000}-${(s.to - AT(0)) / 60_000}`);
const bare = (minute: number) => bareTime(AT(minute));

describe('a student’s stretches (stretchesOf)', () => {
  it('is Not here until their tap-in, then focused, unlocked and back as their moments turn them', () => {
    const track = stretchesOf(moments(['in', 6], ['unlock', 18], ['focus', 24]), START, END);
    expect(said(track)).toEqual(['notin 5-6', 'focused 6-18', 'unlocked 18-24', 'focused 24-55']);
  });

  it('returns Screen Time back on to unlocked while an unlock is open, else to focused (the grid’s rule)', () => {
    const open = stretchesOf(
      moments(['in', 5], ['unlock', 10], ['off', 12], ['on', 14]),
      START,
      END,
    );
    expect(said(open).slice(-2)).toEqual(['off 12-14', 'unlocked 14-55']);
    const closed = stretchesOf(
      moments(['in', 5], ['unlock', 10], ['focus', 11], ['off', 12], ['on', 14]),
      START,
      END,
    );
    expect(said(closed).slice(-2)).toEqual(['off 12-14', 'focused 14-55']);
    // A tap of the block closes an unlock as Back in focus does.
    const tapped = stretchesOf(
      moments(['in', 5], ['unlock', 10], ['in', 11], ['off', 12], ['on', 14]),
      START,
      END,
    );
    expect(said(tapped).at(-1)).toBe('focused 14-55');
  });

  it('keeps protection off through an unlock that arrives then, never softening it (the grid’s applyUnlock), unlocked once Screen Time is back on', () => {
    const track = stretchesOf(
      moments(['in', 6], ['off', 15], ['unlock', 20], ['on', 30]),
      START,
      END,
    );
    expect(said(track)).toEqual(['notin 5-6', 'focused 6-15', 'off 15-30', 'unlocked 30-55']);
    expect(said(stretchesOf(moments(['in', 6], ['off', 15], ['unlock', 20]), START, END))).toEqual([
      'notin 5-6',
      'focused 6-15',
      'off 15-55',
    ]);
  });

  it('turns nothing on an unlock the engine noted superseded, which the grid never applies (applyUnlock)', () => {
    // A phone's clock behind the start: its tap-in, its refocus and its late unlock all held to
    // the start, the unlock last in the engine's order.
    const late = [
      { key: 'in', moment: 'in' as const, at: new Date(START) },
      { key: 'back', moment: 'focus' as const, at: new Date(START) },
      { key: 'late', moment: 'unlock' as const, at: new Date(START) },
      { key: 'off', moment: 'off' as const, at: new Date(AT(20)) },
      { key: 'on', moment: 'on' as const, at: new Date(AT(25)) },
    ];
    expect(said(stretchesOf(late, START, END, new Set(['late'])))).toEqual([
      'focused 5-20',
      'off 20-25',
      'focused 25-55',
    ]);
  });

  it('keeps a silence until they check in again, or any moment their phone sent', () => {
    expect(said(stretchesOf(moments(['in', 5], ['silent', 20], ['back', 30]), START, END))).toEqual(
      ['focused 5-20', 'silent 20-30', 'focused 30-55'],
    );
    expect(
      said(stretchesOf(moments(['in', 5], ['silent', 20], ['unlock', 25]), START, END)),
    ).toEqual(['focused 5-20', 'silent 20-25', 'unlocked 25-55']);
    // To the bell, unheard.
    expect(said(stretchesOf(moments(['in', 5], ['silent', 50]), START, END)).at(-1)).toBe(
      'silent 50-55',
    );
  });

  it('is Not here after they leave, until a tap-in brings them back; a moment while away turns nothing', () => {
    const track = stretchesOf(
      moments(['in', 5], ['left', 20], ['unlock', 22], ['in', 30]),
      START,
      END,
    );
    expect(said(track)).toEqual(['focused 5-20', 'notin 20-30', 'focused 30-55']);
  });

  it('draws nothing past the bell, nor for a moment before the tap-in, and joins stretches of one state', () => {
    const track = stretchesOf(
      moments(['unlock', 4], ['in', 8], ['in', 12], ['on', 15], ['unlock', 56]),
      START,
      END,
    );
    expect(said(track)).toEqual(['notin 5-8', 'focused 8-55']);
  });
});

describe('a track in words (trackWords)', () => {
  const words = (...list: [Moment, number][]) =>
    trackWords(stretchesOf(moments(...list), START, END), END);

  it('says each stretch as ClassEnded words its tracks', () => {
    expect(words(['in', 6], ['unlock', 18], ['focus', 24])).toBe(
      `Focused from ${bare(6)}, unlocked ${bare(18)} to ${bare(24)}, then focused to the bell`,
    );
    expect(words(['in', 6], ['unlock', 31])).toBe(
      `Focused from ${bare(6)}, unlocked from ${bare(31)} to the bell`,
    );
    expect(words(['in', 5], ['silent', 27], ['back', 41])).toBe(
      `Focused from ${bare(5)}, silent ${bare(27)} to ${bare(41)}, then focused to the bell`,
    );
  });

  it('says one stretch alone to its end, a leave’s time where it ended before the bell', () => {
    expect(words(['in', 5])).toBe(`Focused from ${bare(5)} to the bell`);
    expect(words(['in', 5], ['left', 27])).toBe(`Focused from ${bare(5)} to ${bare(27)}`);
    expect(words(['in', 5], ['unlock', 10], ['left', 27])).toBe(
      `Focused from ${bare(5)}, unlocked from ${bare(10)} to ${bare(27)}`,
    );
  });

  it('says a time away as Not here, as the Key does', () => {
    expect(words(['in', 5], ['left', 20], ['in', 30])).toBe(
      `Focused from ${bare(5)}, not here ${bare(20)} to ${bare(30)}, then focused to the bell`,
    );
  });

  it('says Not here for a track with no stretch here', () => {
    expect(words(['unlock', 9])).toBe('Not here');
  });
});

describe('the axis’s end (axisEndOf)', () => {
  it('is the session’s end, or a later moment drawn on it, as recapGroups stretches its ticks', () => {
    const student = (minute: number) => ({ moments: [{ at: new Date(AT(minute)) }] });
    const groups = (minutes: number[]) =>
      ({ partTime: minutes.map(student), notJoined: [] }) as unknown as Parameters<
        typeof axisEndOf
      >[0];
    expect(axisEndOf(groups([20, 40]), END)).toBe(END);
    expect(axisEndOf(groups([20, 58]), END)).toBe(AT(58));
  });
});
