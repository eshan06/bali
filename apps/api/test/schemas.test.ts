import { describe, expect, it } from 'vitest';

import { DeviceTime } from '../src/routes/schemas.js';

/*
 * The DeviceTime rule itself, pinned in milliseconds rather than through five
 * HTTP round trips. timestamps.test.ts proves the rule reaches every route and
 * that the instant survives the trip; this file is where the accept/reject
 * table lives, so widening it again is a one-line diff with an obvious blast
 * radius.
 */

const accepted = [
  ['UTC, the form every current client sends', '2026-09-20T12:00:00Z'],
  ['UTC with milliseconds (Date.toISOString)', '2026-09-20T12:00:00.000Z'],
  ['a positive offset', '2026-09-20T14:00:00+02:00'],
  ['a negative offset — the likeliest real deployment', '2026-09-20T05:00:00-07:00'],
  ['a half-hour offset', '2026-09-20T17:30:00+05:30'],
  ['zero written as an offset', '2026-09-20T12:00:00+00:00'],
  ['fractional seconds with an offset', '2026-09-20T14:00:00.123+02:00'],
] as const;

const rejected = [
  // Names no instant: read as UTC or as the server's zone it is a different
  // moment, and rule 1's clamp would order it against a window it was never
  // measured against.
  ['no zone at all', '2026-09-20T09:15:00'],
  ['a date with no time', '2026-09-20'],
  ['ISO basic format — the extended form is the contract', '2026-09-20T14:00:00+0200'],
  ['an hour-only offset', '2026-09-20T14:00:00+02'],
  ['an out-of-range offset', '2026-09-20T14:00:00+25:00'],
  ['a lowercase zone marker', '2026-09-20T12:00:00z'],
  ['a space instead of T', '2026-09-20 12:00:00Z'],
  ['a day that does not exist', '2026-02-30T12:00:00Z'],
  ['prose', 'yesterday'],
  ['nothing', ''],
] as const;

describe('DeviceTime', () => {
  it.each(accepted)('accepts %s', (_why, value) => {
    expect(DeviceTime.safeParse(value).success).toBe(true);
  });

  it.each(rejected)('rejects %s', (_why, value) => {
    expect(DeviceTime.safeParse(value).success).toBe(false);
  });

  it('accepts nothing that Date reads as an invalid instant', () => {
    // Load-bearing, not hygiene: the engine documents an unparseable deviceTime
    // reaching the NOT NULL occurred_at column as a real hazard, and this
    // schema's 400 is the only thing standing in front of it
    // (packages/db/src/transitions.ts, unlock's caller preconditions). This
    // checks the table above, not every accepted string — zod's own grammar
    // bounds the offset to ±23:59 and validates the calendar day, so the
    // property holds by construction rather than by this assertion.
    for (const [, value] of accepted) {
      expect(Number.isNaN(new Date(value).getTime())).toBe(false);
    }
  });

  it('reads an offset as the instant it names, not the digits it shows', () => {
    const z = new Date('2026-09-20T12:00:00Z').getTime();
    expect(new Date('2026-09-20T14:00:00+02:00').getTime()).toBe(z);
    expect(new Date('2026-09-20T05:00:00-07:00').getTime()).toBe(z);
  });
});
