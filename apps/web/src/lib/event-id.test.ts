import { describe, expect, it } from 'vitest';

import { eventIdAfter, newEventId } from './event-id';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timeOf = (id: string) => parseInt(id.replace('-', '').slice(0, 12), 16);

describe('newEventId', () => {
  it('is a UUIDv7: the time in its first 48 bits, then version 7 and the RFC 9562 variant', () => {
    // 2026-10-04T12:30:00Z is 1791117000000 ms, 0x01a106e47d40.
    const at = Date.UTC(2026, 9, 4, 12, 30);
    const id = newEventId(at, new Uint8Array(16).fill(0xff));
    expect(id).toMatch(V7);
    expect(id).toBe('01a106e4-7d40-7fff-bfff-ffffffffffff');
    expect(newEventId(at, new Uint8Array(16))).toBe('01a106e4-7d40-7000-8000-000000000000');
    expect(parseInt(id.replace('-', '').slice(0, 12), 16)).toBe(at);
  });

  it('is fresh each time, and sorts by when it was minted', () => {
    const ids = Array.from({ length: 100 }, () => newEventId());
    for (const id of ids) expect(id).toMatch(V7);
    expect(new Set(ids).size).toBe(100);
    expect(newEventId(1_000) < newEventId(2_000)).toBe(true);
  });

  it('leaves the random bytes it was given as they were', () => {
    const bytes = new Uint8Array(16).fill(0xab);
    newEventId(0, bytes);
    expect([...bytes]).toEqual(new Array(16).fill(0xab));
  });
});

describe('eventIdAfter', () => {
  const at = Date.UTC(2026, 9, 12, 9, 41);
  // The answer held, minted at `at` with its random bits all ones: the last id of its millisecond.
  const held = newEventId(at, new Uint8Array(16).fill(0xff));

  it('sorts after the id held from a clock a minute behind it, a millisecond past it', () => {
    const id = eventIdAfter(held, at - 60_000);
    expect(id).toMatch(V7);
    expect(id > held).toBe(true);
    expect(timeOf(id)).toBe(at + 1);
    // From the same clock, each next one minted after the last sorts after it too.
    const next = eventIdAfter(id, at - 60_000);
    expect(next > id).toBe(true);
    expect(timeOf(next)).toBe(at + 2);
  });

  it('is of the clock’s own millisecond when that is later, or nothing is held', () => {
    expect(timeOf(eventIdAfter(held, at + 5_000))).toBe(at + 5_000);
    expect(timeOf(eventIdAfter(held, at))).toBe(at + 1);
    expect(timeOf(eventIdAfter(null, at))).toBe(at);
    expect(timeOf(eventIdAfter('not an id', at))).toBe(at);
  });
});
