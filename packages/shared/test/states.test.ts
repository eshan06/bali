import { describe, expect, it } from 'vitest';
import {
  deriveParticipantState,
  formatCountdown,
  staleBadgeText,
  type DeriveInput,
} from '../src/states';

const NOW = new Date('2026-06-10T10:22:00Z');
const liveSession = { endsAt: new Date('2026-06-10T10:45:00Z'), endedAt: null };

function input(partial: Partial<DeriveInput>): DeriveInput {
  return {
    storedState: null,
    noDevice: false,
    passEndsAt: null,
    lastSeenAt: null,
    session: liveSession,
    now: NOW,
    ...partial,
  };
}

describe('deriveParticipantState — precedence is law', () => {
  it('member with no participation row is not_joined', () => {
    expect(deriveParticipantState(input({})).state).toBe('not_joined');
  });

  it('focused with fresh heartbeat', () => {
    const d = deriveParticipantState(
      input({ storedState: 'focused', lastSeenAt: new Date('2026-06-10T10:21:40Z') }),
    );
    expect(d.state).toBe('focused');
    expect(d.isStale).toBe(false);
    expect(d.staleSeconds).toBe(20);
  });

  it('staleness badge appears at 2 minutes and decorates, never replaces, the state', () => {
    const d = deriveParticipantState(
      input({ storedState: 'focused', lastSeenAt: new Date('2026-06-10T10:18:00Z') }),
    );
    expect(d.state).toBe('focused');
    expect(d.isStale).toBe(true);
    expect(staleBadgeText(d.staleSeconds!)).toBe('4m');
  });

  it('active pass wins over focused and carries the countdown', () => {
    const d = deriveParticipantState(
      input({
        storedState: 'pass',
        passEndsAt: new Date('2026-06-10T10:26:32Z'),
      }),
    );
    expect(d.state).toBe('pass');
    expect(formatCountdown(d.passRemainingSeconds!)).toBe('4:32');
  });

  it('expired pass (sweeper lag) renders focused — shields are returning', () => {
    const d = deriveParticipantState(
      input({ storedState: 'pass', passEndsAt: new Date('2026-06-10T10:20:00Z') }),
    );
    expect(d.state).toBe('focused');
    expect(d.passRemainingSeconds).toBeNull();
  });

  it('emergency_unlocked wins over an active pass', () => {
    const d = deriveParticipantState(
      input({
        storedState: 'emergency_unlocked',
        passEndsAt: new Date('2026-06-10T10:26:32Z'),
      }),
    );
    expect(d.state).toBe('emergency_unlocked');
  });

  it('revoked wins over emergency and pass', () => {
    const d = deriveParticipantState(
      input({ storedState: 'revoked', passEndsAt: new Date('2026-06-10T10:26:32Z') }),
    );
    expect(d.state).toBe('revoked');
  });

  it('no_device replaces the display regardless of stored state', () => {
    const d = deriveParticipantState(input({ storedState: 'focused', noDevice: true }));
    expect(d.state).toBe('no_device');
    expect(d.staleSeconds).toBeNull();
  });

  it('session past endsAt renders ended even before the sweeper runs', () => {
    const d = deriveParticipantState(
      input({
        storedState: 'focused',
        session: { endsAt: new Date('2026-06-10T10:20:00Z'), endedAt: null },
      }),
    );
    expect(d.state).toBe('ended');
  });

  it('ended session never shows staleness badges', () => {
    const d = deriveParticipantState(
      input({
        storedState: 'focused',
        lastSeenAt: new Date('2026-06-10T09:00:00Z'),
        session: { endsAt: new Date('2026-06-10T10:45:00Z'), endedAt: new Date('2026-06-10T10:21:00Z') },
      }),
    );
    expect(d.state).toBe('ended');
    expect(d.isStale).toBe(false);
  });

  it('not_joined never shows a staleness badge', () => {
    const d = deriveParticipantState(input({ lastSeenAt: new Date('2026-06-10T09:00:00Z') }));
    expect(d.state).toBe('not_joined');
    expect(d.staleSeconds).toBeNull();
    expect(d.isStale).toBe(false);
  });

  it('badge text uses seconds under a minute ("20s" variant from the mocks)', () => {
    expect(staleBadgeText(20)).toBe('20s');
  });
});
