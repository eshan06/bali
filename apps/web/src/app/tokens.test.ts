import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * The portal's tokens are the design system's own file, ios/Bali/UI/bali-tokens.json, as
 * AppTests.tokens pins Theme.swift to it: every `--bali-*` variable globals.css sets, light and
 * dark, each radius, the spacing unit and each type style in its @theme, and the families in
 * fonts.ts, so the two cannot drift apart unnoticed. A value the tokens lack has no place here.
 */
interface Token {
  name: string;
  value: string | { light: string; dark: string };
}
interface Style {
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
}
interface Tokens {
  color: { tokens: Token[] };
  type: { families: Record<'sans' | 'num' | 'mono', string>; groups: { styles: Style[] }[] };
  spacing: { tokens: Token[] };
  radius: { tokens: Token[] };
  shadow: { tokens: Token[] };
}

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const css = read('./globals.css');
const fonts = read('./fonts.ts');
const tokens = JSON.parse(read('../../../../ios/Bali/UI/bali-tokens.json')) as Tokens;

/** The declarations of one CSS block, name to value, as `0 1px rgba(1,2,3,0.5)` whatever the spacing. */
function declarations(block: string | undefined): Map<string, string> {
  if (block === undefined) throw new Error('block not found in globals.css');
  const entries = [...block.matchAll(/(--[\w*-]+):\s*([^;]+);/g)].map((m) => [
    m[1] ?? '',
    (m[2] ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/,\s/g, ',').trim(),
  ]);
  return new Map(entries as [string, string][]);
}
const roots = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
const light = declarations(roots[0]);
const dark = declarations(roots[1]);
const theme = declarations(/@theme\s*\{([^}]*)\}/.exec(css)?.[1]);
const inline = declarations(/@theme inline\s*\{([^}]*)\}/.exec(css)?.[1]);

const byName = (list: Token[]) => new Map(list.map((t) => [t.name, t]));
const colours = byName(tokens.color.tokens);
const shadows = byName(tokens.shadow.tokens);
/** A token's value on one side, as the CSS writes it: a `{token}` reference is `var(--bali-token)`. */
function side(token: Token, mode: 'light' | 'dark'): string {
  const raw = typeof token.value === 'string' ? token.value : token.value[mode];
  return raw
    .replace(/\{([\w-]+)\}/g, 'var(--bali-$1)')
    .toLowerCase()
    .replace(/,\s/g, ',');
}
const semantic = (list: Token[]) => list.filter((t) => typeof t.value !== 'string');
/** `#rrggbb` as its three bytes. */
const bytes = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('the portal’s tokens are bali-tokens.json’s', () => {
  it('every --bali- variable on :root is a token’s light value', () => {
    expect(light.size).toBeGreaterThan(60);
    for (const [name, value] of light) {
      if (name === '--bali-softpulse-glow') continue;
      const token = colours.get(name.slice('--bali-'.length)) ?? shadows.get(name.slice(7));
      expect(token, name).toBeDefined();
      expect(value, name).toBe(side(token as Token, 'light'));
    }
  });

  it('every semantic colour and shadow token is on :root; focus-ring is the outline rule', () => {
    for (const token of semantic(tokens.color.tokens)) {
      expect(light.has(`--bali-${token.name}`), token.name).toBe(true);
    }
    for (const token of semantic(tokens.shadow.tokens)) {
      if (token.name === 'focus-ring') continue;
      expect(light.has(`--bali-${token.name}`), token.name).toBe(true);
    }
  });

  it('the dark block holds each token’s dark value, every one whose dark differs included', () => {
    for (const [name, value] of dark) {
      if (name === '--bali-softpulse-glow') continue;
      const token = colours.get(name.slice(7)) ?? shadows.get(name.slice(7));
      expect(token, name).toBeDefined();
      expect(value, name).toBe(side(token as Token, 'dark'));
    }
    for (const token of [...semantic(tokens.color.tokens), ...semantic(tokens.shadow.tokens)]) {
      if (token.name === 'focus-ring' || side(token, 'dark') === side(token, 'light')) continue;
      expect(dark.has(`--bali-${token.name}`), token.name).toBe(true);
    }
  });

  it('the focus ring is the token’s colour, gap and width, as an outline on every control', () => {
    const ring = shadows.get('focus-ring') as Token;
    // "0 0 0 2px <page>, 0 0 0 4px <ring>": a 2 px gap, then a ring out to 4 px.
    const [gap, edge] = [...side(ring, 'light').matchAll(/0 0 0 (\d+)px/g)].map((m) =>
      Number(m[1]),
    );
    expect(css).toMatch(
      new RegExp(
        `:focus-visible\\s*\\{\\s*outline: ${Number(edge) - Number(gap)}px solid var\\(--bali-focus-ring-color\\);\\s*outline-offset: ${gap}px;`,
      ),
    );
    // The ring's colour is focus-ring-color's: green-600 in light, green-300 in dark.
    const colour = colours.get('focus-ring-color') as Token;
    for (const mode of ['light', 'dark'] as const) {
      const primitive = /\{([\w-]+)\}/.exec((colour.value as Record<string, string>)[mode] ?? '');
      const hex = (colours.get(primitive?.[1] ?? '') as Token).value as string;
      expect(side(ring, mode).endsWith(hex.toLowerCase()), mode).toBe(true);
    }
  });

  it('bali-softpulse’s glow is orange-400 at 35 %, orange-300 in dark (DESIGN.md §7)', () => {
    const glow = (mode: 'light' | 'dark', primitive: string) => {
      const value = (mode === 'light' ? light : dark).get('--bali-softpulse-glow') ?? '';
      const hex = (colours.get(primitive) as Token).value as string;
      expect(value, mode).toBe(`rgba(${bytes(hex).join(',')},0.35)`);
    };
    glow('light', 'orange-400');
    glow('dark', 'orange-300');
  });

  it('the radii are the tokens’ five and no other', () => {
    expect(theme.get('--radius-*')).toBe('initial');
    const radii = [...theme.keys()].filter((k) => k.startsWith('--radius-') && k !== '--radius-*');
    expect(radii.sort()).toEqual(tokens.radius.tokens.map((t) => `--${t.name}`).sort());
    for (const token of tokens.radius.tokens)
      expect(theme.get(`--${token.name}`)).toBe(token.value);
  });

  it('the spacing unit is space-1, so p-N is space-N', () => {
    const unit = parseInt(theme.get('--spacing') ?? '', 10);
    expect(`${unit}px`).toBe(tokens.spacing.tokens[0]?.value);
    for (const token of tokens.spacing.tokens) {
      const n = Number(token.name.slice('space-'.length));
      expect(`${n * unit}px`, token.name).toBe(token.value);
    }
  });

  it('the type scale is the tokens’, size, line height, weight and tracking', () => {
    const styles = tokens.type.groups.flatMap((g) => g.styles);
    expect(styles.length).toBe(11);
    for (const style of styles) {
      const key = `--text-${style.name}`;
      expect(theme.get(key), key).toBe(style.fontSize);
      expect(theme.get(`${key}--line-height`), key).toBe(style.lineHeight);
      expect(theme.get(`${key}--font-weight`), key).toBe(String(style.fontWeight));
      expect(theme.get(`${key}--letter-spacing`), key).toBe(style.letterSpacing);
    }
  });

  it('the families are the tokens’ stacks: the self-hosted face first, then its fallbacks', () => {
    const stack = (family: string) =>
      tokens.type.families[family as 'sans' | 'mono']
        .split(',')
        .map((f) => f.trim().replace(/"/g, ''));
    const [sansFace, ...sansRest] = stack('sans');
    const [monoFace, ...monoRest] = stack('mono');
    expect(sansFace).toBe('Instrument Sans');
    expect(monoFace).toBe('JetBrains Mono');
    const list = (names: string[]) => `[${names.map((n) => `'${n}'`).join(', ')}]`;
    expect(fonts).toContain(`fallback: ${list(sansRest)}`);
    expect(fonts).toContain(`fallback: ${list(monoRest)}`);
    expect(fonts).toContain("src: './fonts/instrument-sans-");
    expect(fonts).toContain("src: './fonts/jetbrains-mono-");
    expect(inline.get('--font-sans')).toBe('var(--font-instrument-sans)');
    expect(inline.get('--font-mono')).toBe('var(--font-jetbrains-mono)');
    expect(tokens.type.families.num.startsWith('ui-rounded, "SF Pro Rounded"')).toBe(true);
    expect(inline.get('--font-num')).toBe(
      "ui-rounded,'sf pro rounded',var(--font-instrument-sans)",
    );
  });

  it('the browser’s own chrome takes surface-page, light and dark (the layout’s viewport)', () => {
    const page = colours.get('surface-page') as Token;
    const hex = (mode: 'light' | 'dark') => {
      const raw = (page.value as Record<string, string>)[mode] ?? '';
      const ref = /\{([\w-]+)\}/.exec(raw)?.[1];
      return (ref ? ((colours.get(ref) as Token).value as string) : raw).toLowerCase();
    };
    const layout = read('./layout.tsx');
    for (const mode of ['light', 'dark'] as const) {
      expect(layout).toContain(
        `{ media: '(prefers-color-scheme: ${mode})', color: '${hex(mode)}' }`,
      );
    }
  });

  it('every semantic colour token is a Tailwind colour of the same name', () => {
    for (const token of semantic(tokens.color.tokens)) {
      const name = token.name === 'focus-ring-color' ? 'focus-ring' : token.name;
      expect(inline.get(`--color-${name}`), token.name).toBe(`var(--bali-${token.name})`);
    }
  });
});
