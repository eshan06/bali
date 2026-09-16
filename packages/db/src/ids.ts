import { v7 as uuidv7 } from 'uuid';

/**
 * Mints a row ID (data-model decision 2: every ID is a UUIDv7 — offline-mintable,
 * unguessable, and time-prefixed so index pages stay warm). Phones mint their own
 * with their platform's UUIDv7; this is the server-side equivalent.
 */
export function newUuidV7(): string {
  return uuidv7();
}
