/*
 * A card (DESIGN.md §4, Card): `surface-card` straight on the page, with its own `border-default`
 * hairline and `shadow-1`, the hairline alone in dark, where `shadow-1` is none. No grey tray
 * behind a card or a group of them, and no other grey frame in its place (the owner, 2026-10-06).
 * In a list, `radius-md` with `space-4` padding, the cards `space-2` apart (`grid gap-2`).
 */
export const CARD = 'rounded-md border border-border-default bg-surface-card p-4 shadow-1';

/** A card standing alone (sign-in, the invite code, the recap): `radius-lg` with `space-6`. */
export const CARD_ALONE = 'rounded-lg border border-border-default bg-surface-card p-6 shadow-1';
