import { z } from 'zod';

/*
 * Request-shape pieces shared by more than one route, so the same rule can't be
 * spelled four slightly different ways and drift.
 */

/**
 * A device timestamp: ISO 8601, naming a real instant.
 *
 * `offset: true` matters. ISO 8601 writes the same moment two ways — `…Z` and
 * `…+02:00` — and zod's default `datetime()` accepts only the first. A phone
 * that formats its own UTC offset (what Foundation's `ISO8601DateFormatter`
 * does once a time zone is set on it) would be rejected, and on the unlock path
 * that rejection is not cosmetic: `unlockDisposition` maps a non-401 4xx to
 * `retry_and_surface`, so the outbox keeps the record and retries the identical
 * body forever. Every retry 400s, the unlock is never recorded server-side, and
 * ISSUES #2's lost record comes back through a validation schema
 * (ARCHITECTURE.md: "For unlock records, no response ever means discard").
 *
 * What stays refused is a timestamp with no zone at all (`2026-09-20T09:15:00`),
 * which names no instant: read as UTC or as the server's zone it is a different
 * moment, and rule 1's clamp would order the event against a window it was
 * never measured against. Accepting offsets is not the same as guessing one.
 *
 * Downstream needs no change: `new Date(…)` resolves either form to the same
 * instant, and `clampToWindow` compares instants.
 */
export const DeviceTime = z.string().datetime({ offset: true });

/**
 * A join code as a student typed it — for the join and its preview both, so
 * the two can never name different classes (A6). Codes are minted upper-case
 * from an alphabet with no look-alikes (`generateJoinCode`), so case and
 * surrounding whitespace are noise: `kwx49q ` is `KWX49Q`.
 *
 * The length check runs on the code as sent, before it is trimmed: the join's
 * check since Phase 2, kept as it was, so normalising only ever turns a 404
 * into a join. A blank code is still the join's 404; only an empty one is a 400.
 */
export const JoinCode = z.string().min(1).trim().toUpperCase();
