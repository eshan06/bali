/**
 * A fresh UUIDv7 for a write's `eventId` (rule 4; data-model decision 2): the
 * Unix time in milliseconds in its first 48 bits, then the version, 7, and
 * RFC 9562's variant, the rest random from the browser's Web Crypto. The
 * portal's own, so it adds no dependency; the server and the phones mint theirs
 * with their platform's. A retry of one write sends the same id, so the server
 * applies it once.
 */
export function newEventId(
  now: number = Date.now(),
  bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
): string {
  const b = bytes.slice(0, 16);
  for (let i = 0; i < 6; i += 1) b[i] = Math.floor(now / 2 ** (8 * (5 - i))) % 256;
  b[6] = 0x70 | (b[6] & 0x0f);
  b[8] = 0x80 | (b[8] & 0x3f);
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A fresh UUIDv7 that sorts after `held`, however far behind this computer's clock stands: of
 * `now`'s millisecond, or of the one past the millisecond `held` begins with, whichever is later.
 * A write that replaces another only when its id sorts after (Live lesson, decision 4: an answer)
 * mints its next this way, as the phone's `EventID.mint(at:after:)` does.
 */
export function eventIdAfter(held: string | null, now: number = Date.now()): string {
  const time = held === null ? NaN : parseInt(held.replace(/-/g, '').slice(0, 12), 16);
  return newEventId(Number.isFinite(time) ? Math.max(now, time + 1) : now);
}
