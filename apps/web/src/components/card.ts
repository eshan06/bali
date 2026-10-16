/*
 * A card (DESIGN.md §4, Card): `surface-card` straight on the page, with its own `border-default`
 * hairline and `shadow-1`. No grey tray behind a card or a group of them, and no other grey frame
 * in its place (the owner, 2026-10-06). A list's cards (Classes' cards, Home's rows, the tiles) are
 * drawn by each list's own step in v2's look.
 */

/** A card on its own (the recap, the block, the class page's), v2's: `radius-md` with 20 px. */
export const CARD_ALONE = 'rounded-md border border-border-default bg-surface-card p-5 shadow-1';

/**
 * An entry page's card (sign-in, its callback, the invite code), v2.css's `.stage-card`:
 * `radius-md` with 24 px, the column's width, its parts 18 px apart.
 */
export const CARD_ENTRY =
  'flex w-full flex-col gap-4.5 rounded-md border border-border-default bg-surface-card p-6 shadow-1';
