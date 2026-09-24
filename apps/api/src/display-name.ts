import { DISPLAY_NAME_MAX_LENGTH } from '@bali/shared';
import { z } from 'zod';

/*
 * What a display name may hold, for both ways one arrives: a sign-in token's
 * claim, cleaned when `/v1/me` fills a missing name (`displayNameFromClaims`),
 * and the name a student sets (`PATCH /v1/me`, A8), refused when it breaks a
 * rule — a student typing a name must see exactly what is stored. Either way
 * it lands in a teacher's grid and in logs, where a bidi override or an ANSI
 * escape would be someone else's cursor.
 */

/**
 * What a name never carries: control and format characters, lone surrogate
 * halves, and line and paragraph separators.
 *
 * Zero-width joiner and non-joiner are kept: they are `\p{Cf}` too, but they
 * carry meaning in Persian, Arabic and Indic names and inside emoji sequences.
 * Line and paragraph separators (U+2028, U+2029) go: a log viewer can break a
 * line on them. A lone surrogate half passes TypeScript happily and then
 * reaches Postgres, which stores it as U+FFFD for good; a proper pair is one
 * code point, and is kept.
 *
 * Global, for `replace`; test with `search`, which ignores `lastIndex`.
 */
export const UNPRINTABLE = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]|(?![\u200c\u200d])\p{Cf}/gu;

/**
 * Nothing a reader would see: whitespace, default-ignorable characters (the
 * joiners, Hangul fillers, variation selectors), and two symbols drawn as blank
 * space, the blank braille cell and the musical null notehead. A name made only
 * of these is no name: stored, it would blank the student's cell in the grid.
 * Invisible letters INSIDE a visible name are kept.
 */
export const INVISIBLE = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\u2800\u{1D159}]*$/u;

/**
 * The name a student sets (A8): trimmed, each run of spaces made one — what is
 * stored, and what the answer returns — and refused when it is blank or
 * invisible, longer than `DISPLAY_NAME_MAX_LENGTH` code points, or carries
 * anything UNPRINTABLE. That last is checked on the name as sent, so a newline
 * or a tab is refused rather than quietly made a space.
 */
export const DisplayName = z
  .string()
  .refine((name) => name.search(UNPRINTABLE) === -1, 'has a character that cannot be shown')
  .transform((name) => name.trim().replace(/\s+/gu, ' '))
  .refine((name) => !INVISIBLE.test(name), 'is blank')
  .refine(
    (name) => [...name].length <= DISPLAY_NAME_MAX_LENGTH,
    `is longer than ${DISPLAY_NAME_MAX_LENGTH} characters`,
  );
