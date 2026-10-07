import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * The invite-code screen says each answer where `placeAnswer` puts it (lib/invite.ts, tested
 * there): a refusal of the code through the Field's `refusal`, under the input (field.test.ts),
 * any other answer in the line above the button. Read from the source, as the help page's test
 * reads its own, so no answer can be dropped on its way to the screen.
 */
const source = readFileSync(fileURLToPath(new URL('./invite-code.tsx', import.meta.url)), 'utf8');

describe('the invite-code screen', () => {
  it('says every answer placeAnswer places: under the field, or above the button', () => {
    expect(source).toContain('const { underField, aboveButton } = placeAnswer(said);');
    const field = /<Field\b[\s\S]*?\/>/.exec(source)?.[0] ?? '';
    expect(field).toContain('refusal={underField ?? undefined}');
    const above = source.indexOf('{aboveButton.message}');
    expect(above).toBeGreaterThan(source.indexOf('<Field'));
    expect(above).toBeLessThan(source.indexOf('<Button'));
  });

  it('offers Try again only for an answer that never came, never after a refusal (PB5’s review)', () => {
    // A refusal, a deleted account's included, changed nothing a resend could: Redeem code stays.
    expect(source).toMatch(/: said\?\.kind === 'failed'\s*\? 'Try again'\s*: 'Redeem code'\}/);
  });

  it('takes focus back to the field by the same rule, never a copy of it (PB2’s review)', () => {
    expect(source).toContain('if (placeAnswer(answer).underField) field.current?.focus();');
    expect(source).not.toContain('CODE_REFUSALS');
  });
});
