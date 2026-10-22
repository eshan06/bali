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
    expect(above).toBeLessThan(source.indexOf('<TryAgain'));
  });

  it('offers Try again only for an answer that never came, never after a refusal (PB5’s review)', () => {
    // A refusal, a deleted account's included, changed nothing a resend could: Redeem code stays.
    // One button throughout, `TryAgain`'s (try-again.test.ts), so focus stays on it whatever it
    // comes to say: Redeeming… while it sends, Try again, or Go to your classes.
    expect(source).toMatch(
      /send=\{\{\s*words: teaches \? 'Go to your classes' : 'Redeem code',\s*sending: 'Redeeming…',\s*failed: said\?\.kind === 'failed',\s*\}\}/,
    );
    expect(source).toMatch(/onRetry=\{teaches \? onTeacher : redeem\}\s*held=\{busy\}/);
  });

  it('redeems on its button’s press, Enter in the field pressing it, once a send at a time', () => {
    // Its form's submit sends nothing: the button's press does, as Register block's does, or, once
    // the account teaches, Enter goes on as the button would.
    expect(source).toMatch(
      /onSubmit=\{\(e\) => \{\s*e\.preventDefault\(\);\s*if \(teaches && !sending\.current\) onTeacher\(\);\s*\}\}/,
    );
    expect(source).toMatch(/type=\{teaches \? 'button' : 'submit'\}/);
    expect(source).toMatch(/async function redeem\(\) \{\s*if \(sending\.current\) return;/);
  });

  it('takes focus back to the field by the same rule, never a copy of it (PB2’s review)', () => {
    expect(source).toContain('if (placeAnswer(answer).underField) field.current?.focus();');
    expect(source).not.toContain('CODE_REFUSALS');
  });
});
