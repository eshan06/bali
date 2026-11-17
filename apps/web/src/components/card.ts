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

/*
 * The lock-only look's surfaces (DESIGN.md §1, The lock-only look; LO2): no card on a card, so a
 * page's parts rest on the page between hairlines, and only these stand apart from it.
 */

/** A plain well (`.ready`, `.last`, `.first`): stone at 16 px corners, never the live green; each board's own padding. */
export const WELL = 'rounded-live bg-surface-sunken';

/** A class live (`.live`, Home's): green-50 in its green-200 edge, at 16 px corners. */
export const LIVE_WELL = 'rounded-live border border-live-edge bg-live-fill';

/** A code read symbol by symbol, in its well (`.code-well`): 34/44 mono, 8 × 16 px in, 12 px corners. */
export const CODE_WELL =
  'inline-flex items-center rounded-frame bg-surface-sunken px-4 py-2 font-mono text-code-well text-text-primary';

/**
 * A dialog (`.dialog`): white, 440 px, 24 px in, its parts 16 px apart, 16 px corners with its
 * hairline and `shadow-3`, 120 px from the top over the warm backdrop, as v2's; a native modal,
 * shown only while open. Its title `text-panel-title`.
 */
export const DIALOG_LOCK =
  'm-auto mt-30 w-110 max-w-[calc(100%-32px)] flex-col gap-4 overscroll-contain rounded-live border border-border-default bg-surface-card p-6 text-text-primary shadow-3 backdrop:bg-scrim open:flex';

/**
 * A ledger (`.ledger`; Your classes, Reports' sessions): a table of hairlines, no box, its cells
 * 14/20, scrolling sideways in a box of its own where a page draws it so. Its head's cells
 * (`LEDGER_HEAD`), its body's (`LEDGER_CELL`), a figure's right-aligned by the page; a row's name, a
 * link to its page (`LEDGER_NAME`); the line under a cell's words (`LEDGER_SUB`); and a class live
 * among them (`LEDGER_LIVE`, on its row): green-50, its first cell edged in the live green.
 */
export const LEDGER = 'w-full border-collapse text-data font-normal';
export const LEDGER_HEAD =
  'border-b border-border-strong py-2 pr-4 text-left text-caption font-medium whitespace-nowrap text-text-tertiary last:pr-0';
export const LEDGER_CELL = 'border-b border-border-default py-3 pr-4 align-middle last:pr-0';
export const LEDGER_NAME =
  'rounded-xs font-semibold text-text-primary underline-offset-3 hover:underline';
export const LEDGER_SUB = 'block text-countdown-sub text-text-tertiary';
export const LEDGER_LIVE =
  '[&>td]:bg-live-fill [&>td:first-child]:pl-3 [&>td:first-child]:shadow-[inset_2px_0_0_var(--bali-green-200)]';
