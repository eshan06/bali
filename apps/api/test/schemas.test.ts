import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '@bali/db';
import { describe, expect, it } from 'vitest';

import { DeviceTime, JoinCode, Order } from '../src/routes/schemas.js';

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
  // The upper bound the NaN argument below leans on. Pinned so a zod bump
  // cannot widen it unnoticed.
  ['the widest offset the grammar allows', '2026-09-20T12:00:00+23:59'],
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
  ['one minute past the widest allowed offset', '2026-09-20T12:00:00+24:00'],
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

describe('JoinCode', () => {
  const code = JOIN_CODE_ALPHABET.slice(0, JOIN_CODE_LENGTH);

  it('reads a code as typed — any case, any surrounding whitespace — as the code', () => {
    for (const typed of [code, code.toLowerCase(), `  ${code.toLowerCase()}\n`, `\t${code} `]) {
      expect(JoinCode.parse(typed)).toBe(code);
    }
  });

  it('leaves every minted code as it is, so a stored code is always found', () => {
    // The routes upper-case what they are sent and match it exactly, and no
    // CHECK constraint holds the stored codes to that: `generateJoinCode` is
    // their only writer, so its alphabet is what keeps them findable. A
    // lower-case symbol added to it would mint codes nobody could join.
    for (const symbol of JOIN_CODE_ALPHABET) {
      const minted = symbol.repeat(JOIN_CODE_LENGTH);
      expect(JoinCode.parse(minted)).toBe(minted);
      expect(JoinCode.parse(minted.toLowerCase())).toBe(minted);
    }
  });

  it('refuses an empty code, and one longer than a code once trimmed', () => {
    expect(JoinCode.safeParse('').success).toBe(false);
    expect(JoinCode.safeParse(`${code}X`).success).toBe(false);
    expect(JoinCode.safeParse('x'.repeat(10_000)).success).toBe(false);
    // Blank is not empty: it trims to nothing and is the join's 404, as ever.
    expect(JoinCode.parse('   ')).toBe('');
  });
});

describe('Order (A12)', () => {
  const install = '0192a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b';

  it('passes an order the engine can compare, and none as none', () => {
    expect(Order.parse({ install, seq: 1 })).toEqual({ install, seq: 1 });
    expect(Order.parse({ install, seq: Number.MAX_SAFE_INTEGER })).toEqual({
      install,
      seq: Number.MAX_SAFE_INTEGER,
    });
    expect(Order.parse(undefined)).toBeUndefined();
    expect(Order.parse(null)).toBeNull();
  });

  it.each([
    ['a string', 'order'],
    ['a number', 7],
    ['a list', [install, 1]],
    ['no install', { seq: 1 }],
    ['no seq', { install }],
    ['an install that is no UUID', { install: 'phone-1', seq: 1 }],
    ['a zero seq', { install, seq: 0 }],
    ['a negative seq', { install, seq: -1 }],
    ['a fractional seq', { install, seq: 2.5 }],
    ['a seq past the safe integers', { install, seq: 2 ** 53 }],
    ['a seq as a string', { install, seq: '1' }],
  ])('takes %s as none, never refusing the record it rides on', (_why, value) => {
    expect(Order.safeParse(value)).toEqual({ success: true, data: null });
  });
});
