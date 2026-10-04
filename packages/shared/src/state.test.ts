import { describe, expect, it } from 'vitest';

import {
  clampToWindow,
  CLOCK_AHEAD_THRESHOLD_MS,
  clockAheadSeconds,
  deriveDisplayState,
  hasClockNote,
  SILENCE_THRESHOLD_MS,
  type ParticipationSnapshot,
} from './state.js';

const base: ParticipationSnapshot = {
  state: 'focused',
  joinedAt: new Date('2026-01-01T09:00:00Z'),
  lastSeenAt: new Date('2026-01-01T09:00:00Z'),
  endedAt: null,
};
const now = new Date('2026-01-01T09:00:30Z'); // 30s after last contact

describe('deriveDisplayState', () => {
  it('shows the stored state while contact is fresh', () => {
    expect(deriveDisplayState(base, now)).toBe('focused');
    expect(deriveDisplayState({ ...base, state: 'unlocked' }, now)).toBe('unlocked');
    expect(deriveDisplayState({ ...base, state: 'protection_off' }, now)).toBe('protection_off');
  });

  it('an ended participation reads as ended regardless of anything else', () => {
    expect(
      deriveDisplayState(
        { ...base, state: 'focused', endedAt: new Date('2026-01-01T09:25:00Z') },
        now,
      ),
    ).toBe('ended');
  });

  it('a focused phone past the silence threshold reads as silent', () => {
    const late = new Date(base.lastSeenAt!.getTime() + SILENCE_THRESHOLD_MS + 1);
    expect(deriveDisplayState(base, late)).toBe('silent');
  });

  it('silence overrides only focused — unlocked and protection_off stand', () => {
    const late = new Date(base.lastSeenAt!.getTime() + SILENCE_THRESHOLD_MS + 1);
    expect(deriveDisplayState({ ...base, state: 'unlocked' }, late)).toBe('unlocked');
    expect(deriveDisplayState({ ...base, state: 'protection_off' }, late)).toBe('protection_off');
  });

  it('a freshly joined student with no check-in yet uses joinedAt, not silent', () => {
    const p: ParticipationSnapshot = { ...base, lastSeenAt: null };
    expect(deriveDisplayState(p, now)).toBe('focused');
    const late = new Date(p.joinedAt.getTime() + SILENCE_THRESHOLD_MS + 1);
    expect(deriveDisplayState(p, late)).toBe('silent');
  });

  it('the threshold boundary is exclusive — exactly at the threshold is not yet silent', () => {
    const exactly = new Date(base.lastSeenAt!.getTime() + SILENCE_THRESHOLD_MS);
    expect(deriveDisplayState(base, exactly)).toBe('focused');
  });
});

describe('clampToWindow', () => {
  const start = new Date('2026-01-01T09:00:00Z');
  const end = new Date('2026-01-01T09:25:00Z');

  it('leaves a time inside the window untouched', () => {
    const t = new Date('2026-01-01T09:10:00Z');
    expect(clampToWindow(t, start, end).toISOString()).toBe(t.toISOString());
  });

  it('pulls a backdated time up to the start (rule 1: no backdating out of a report)', () => {
    expect(clampToWindow(new Date('2026-01-01T08:00:00Z'), start, end).toISOString()).toBe(
      start.toISOString(),
    );
  });

  it('pulls a future time down to the end (no pushing past the bell)', () => {
    expect(clampToWindow(new Date('2026-01-01T10:00:00Z'), start, end).toISOString()).toBe(
      end.toISOString(),
    );
  });
});

describe('clockAheadSeconds (S9)', () => {
  const heard = new Date('2026-01-01T09:00:00Z');
  const at = (ms: number) => new Date(heard.getTime() + ms);

  it('notes a claim ahead of the server past the threshold, in whole seconds', () => {
    expect(clockAheadSeconds(at(CLOCK_AHEAD_THRESHOLD_MS + 1_000), heard)).toBe(121);
    expect(clockAheadSeconds(at(60 * 60_000), heard)).toBe(3600);
  });

  it('says nothing at or under the threshold, nor for a claim behind (offline catch-up)', () => {
    expect(clockAheadSeconds(at(CLOCK_AHEAD_THRESHOLD_MS), heard)).toBeNull();
    expect(clockAheadSeconds(at(5_000), heard)).toBeNull();
    expect(clockAheadSeconds(at(-60 * 60_000), heard)).toBeNull();
  });

  it('reads the note back only as a number', () => {
    expect(hasClockNote({ clock_ahead_s: 300 })).toBe(true);
    expect(hasClockNote({ clock_ahead_s: '300' })).toBe(false);
    expect(hasClockNote(null)).toBe(false);
    expect(hasClockNote({ recorded_as: 'superseded' })).toBe(false);
  });
});
