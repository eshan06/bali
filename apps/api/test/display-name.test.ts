import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { INVISIBLE } from '../src/display-name.js';

/*
 * Android's phone holds this blank test (INVISIBLE) as tables in its Me.kt: the
 * JDK has neither Unicode's White_Space whole nor its Default_Ignorable_Code_Point,
 * and the app takes no ICU4J (docs/DECISIONS.md, 2026-11-05, Q6). The tables are
 * read from the Kotlin itself, so neither can drift from this regex unseen.
 */
const kotlin = readFileSync(
  new URL('../../../android/outbox/src/main/kotlin/com/bali/outbox/Me.kt', import.meta.url),
  'utf8',
);

/** Me.kt's table `name`: each range in its `listOf(…)`, written `0x…..0x…`. */
function table(name: string): { from: number; to: number }[] {
  const list = new RegExp(`private val ${name} =\\s*listOf\\(([^)]*)\\)`).exec(kotlin)?.[1];
  if (list === undefined) throw new Error(`Me.kt has no table ${name}`);
  return [...list.matchAll(/0x(?<from>[0-9A-F]+)\.\.0x(?<to>[0-9A-F]+)/g)].map((range) => ({
    from: Number.parseInt(range.groups?.from ?? '', 16),
    to: Number.parseInt(range.groups?.to ?? '', 16),
  }));
}

const hex = (codePoint: number) => `U+${codePoint.toString(16).toUpperCase()}`;
const blank = (codePoint: number) => INVISIBLE.test(String.fromCodePoint(codePoint));

// The two symbols drawn as blank space, which Me.kt's `blank` names outright.
const ranges = [
  ...table('whiteSpace'),
  ...table('ignorable'),
  { from: 0x2800, to: 0x2800 },
  { from: 0x1d159, to: 0x1d159 },
];

describe("The API's blank test, as Android's Me.kt holds it (Q6)", () => {
  it('reads both of the tables, each range in order', () => {
    expect([table('whiteSpace').length, table('ignorable').length]).toEqual([10, 17]);
    for (const { from, to } of ranges) expect(from, hex(from)).toBeLessThanOrEqual(to);
  });

  it.each(ranges.map(({ from, to }) => ({ from, to, range: `${hex(from)}..${hex(to)}` })))(
    'agrees on $range: every code point in it is blank',
    ({ from, to }) => {
      const drawn: string[] = [];
      for (let codePoint = from; codePoint <= to; codePoint++) {
        if (!blank(codePoint)) drawn.push(hex(codePoint));
      }
      expect(drawn).toEqual([]);
    },
  );

  it('agrees on every code point between them: none is blank', () => {
    const unseen: string[] = [];
    for (let codePoint = 0; codePoint <= 0x10ffff; codePoint++) {
      const listed = ranges.some(({ from, to }) => codePoint >= from && codePoint <= to);
      if (!listed && blank(codePoint)) unseen.push(hex(codePoint));
    }
    expect(unseen).toEqual([]);
  });
});
