import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
/** The portal's own source files under src/, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}
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
const light = declarations(/^:root\s*\{([^}]*)\}/m.exec(css)?.[1]);
// The dark values hold only under the device's dark mode: the :root inside that media query.
const dark = declarations(
  /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1],
);
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

  it('the three shadows are utilities of the tokens’ names; reduced motion stops everything', () => {
    for (const token of semantic(tokens.shadow.tokens)) {
      if (token.name === 'focus-ring') continue;
      expect(css).toMatch(
        new RegExp(
          `@utility ${token.name}\\s*\\{\\s*box-shadow: var\\(--bali-${token.name}\\);\\s*\\}`,
        ),
      );
    }
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*::before,\s*::after\s*\{\s*animation: none !important;\s*transition: none !important;/,
    );
  });

  it('every --bali- variable the stylesheet or a component references is declared on :root', () => {
    const refs = new Set<string>();
    for (const file of sources(fileURLToPath(new URL('../', import.meta.url)))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/var\((--bali-[\w-]+)\)/g)) {
        refs.add(m[1] ?? '');
      }
    }
    expect(refs.size).toBeGreaterThan(40);
    for (const ref of refs) expect(light.has(ref), ref).toBe(true);
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

  it('bali-softpulse is a 6 px glow ring, 1.2 s twice on the standard easing, and only the grid’s', () => {
    expect(css).toMatch(
      /@keyframes bali-softpulse\s*\{\s*0%,\s*100%\s*\{\s*box-shadow: 0 0 0 0 transparent;\s*\}\s*50%\s*\{\s*box-shadow: 0 0 0 6px var\(--bali-softpulse-glow\);\s*\}\s*\}/,
    );
    // Exactly twice, never `infinite`: the one pulse never loops (§7).
    expect(css).toMatch(
      /@utility animate-softpulse\s*\{\s*animation: bali-softpulse 1\.2s cubic-bezier\(0\.2, 0, 0, 1\) 2;\s*\}/,
    );
    const users = sources(fileURLToPath(new URL('../', import.meta.url))).filter(
      (file) => file.endsWith('.tsx') && readFileSync(file, 'utf8').includes('animate-softpulse'),
    );
    expect(users.map((file) => file.slice(file.indexOf('/src/') + 5))).toEqual([
      'components/live-grid.tsx',
    ]);
  });

  it('the radii are the tokens’ five and no other', () => {
    expect(theme.get('--radius-*')).toBe('initial');
    const radii = [...theme.keys()].filter((k) => k.startsWith('--radius-') && k !== '--radius-*');
    expect(radii.sort()).toEqual(tokens.radius.tokens.map((t) => `--${t.name}`).sort());
    for (const token of tokens.radius.tokens)
      expect(theme.get(`--${token.name}`)).toBe(token.value);
  });

  it('a transition is DESIGN.md §7’s `fast` 150 ms on the `standard` easing unless a class says otherwise', () => {
    // The tokens carry no motion group, so the two values are §7's own words.
    expect(theme.get('--default-transition-duration')).toBe('150ms');
    expect(theme.get('--default-transition-timing-function')).toBe('cubic-bezier(0.2,0,0,1)');
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

  it('beside them, only the input size the owner ruled (DESIGN.md §3), and every field types in it', () => {
    // 16 px, so iPhone Safari never zooms into a field when it is tapped (2026-10-05), its line
    // height on the 4-pt grid; the design system gains it at the owner's next export.
    const sizes = [...theme.keys()]
      .filter((k) => k.startsWith('--text-') && !k.slice(2).includes('--'))
      .map((k) => k.slice('--text-'.length));
    const styles = tokens.type.groups.flatMap((g) => g.styles.map((s) => s.name));
    expect(sizes.sort()).toEqual([...styles, 'input'].sort());
    expect(theme.get('--text-input')).toBe('16px');
    expect(theme.get('--text-input--line-height')).toBe('24px');
    expect(theme.get('--text-input--font-weight')).toBe('400');
    expect(read('../components/field.tsx')).toMatch(/<input[^]*className=\{`[^`]*\btext-input\b/);
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
    // Exactly the stacks: no metric-matched Arial ahead of them on either face.
    expect(fonts.match(/adjustFontFallback: false/g)).toHaveLength(2);
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

describe('the pages in Soft premium use the tokens’ utilities, never a Tailwind default', () => {
  // DESIGN.md: no `slate-*`, no `text-sm`. D2c's and D2e's pages and the pieces they share; D2f
  // and D2g add theirs as they redraw them, until the theme's default colours and sizes can go.
  const DRAWN = [
    'app/login/page.tsx',
    'app/auth/callback/page.tsx',
    'app/support/page.tsx',
    'app/privacy/page.tsx',
    'app/terms/page.tsx',
    'app/page.tsx',
    'components/portal-bar.tsx',
    'components/button.tsx',
    'components/mark.tsx',
    'components/text-link.tsx',
    'components/field.tsx',
    'components/tray.ts',
    'components/policy-draft.tsx',
    'components/invite-code.tsx',
    'components/blocks.tsx',
    'components/live-grid.tsx',
  ];
  const COLOUR =
    /\b(?:bg|text|border|ring|outline|divide|decoration|placeholder|fill|stroke|from|via|to|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)\b/;
  const SIZE = /\btext-(?:xs|sm|base|lg|\d?xl)\b/;
  const TYPE =
    /\b(?:tracking|leading)-(?:tighter|tight|snug|normal|relaxed|loose|wide|wider|widest)\b/;

  it.each(DRAWN)('%s', (file) => {
    const source = read(`../${file}`);
    expect(source).not.toMatch(COLOUR);
    expect(source).not.toMatch(SIZE);
    expect(source).not.toMatch(TYPE);
    // A field is the Field, so what is typed in it is the input size (the owner's ruling).
    if (file !== 'components/field.tsx') expect(source).not.toMatch(/<input\b/);
  });
});
