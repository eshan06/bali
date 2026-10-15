import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { House } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buttonClass } from '../components/button';
import { CARD, CARD_ALONE, CARD_ENTRY } from '../components/card';

/*
 * The portal's tokens are the design system's own file, ios/Bali/UI/bali-tokens.json, as
 * AppTests.tokens pins Theme.swift to it: every `--bali-*` variable globals.css sets (their light
 * values: the portal is always light), each radius, the spacing unit and each type style in its
 * @theme, and the families in fonts.ts, so the two cannot drift apart unnoticed. A value the tokens
 * lack has no place here but the owner's: the sizes and colours the owner ruled, and v2's look's
 * radii and sizes (DESIGN.md §1, Its call: built exactly as drawn), each named and pinned below.
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
/**
 * The owner's colours beside the tokens', until the design system's next export carries them,
 * each pinned by a test of its own: bali-softpulse's glow (DESIGN.md §7) and border-input (§2).
 */
const RULED = new Set(['--bali-softpulse-glow', '--bali-border-input']);

/** v2's look's radii (DESIGN.md §1, Style facts), beside the tokens' five: built exactly as drawn. */
const V2_RADII = { item: '8px', frame: '12px', live: '16px' };
/**
 * v2's look's sizes off the tokens' scale (DESIGN.md §1, Style facts), built exactly as drawn (the
 * owner, 2026-10-12): size, line height, weight and tracking, as v2.css draws each.
 */
const V2_SIZES: Record<string, [string, string, number, string?]> = {
  greeting: ['28px', '34px', 600, '-0.015em'],
  'page-title': ['26px', '32px', 600, '-0.01em'],
  'dialog-title': ['19px', '25px', 600],
  meta: ['13.5px', '19px', 400],
  'section-label': ['11.5px', '15px', 600, '0.05em'],
  button: ['15px', '20px', 600],
  'tile-name': ['15px', '20px', 600],
  'tile-line': ['12.5px', '17px', 500],
  'home-countdown': ['30px', '34px', 600],
  'present-title': ['36px', '42px', 600, '-0.01em'],
  'present-countdown': ['44px', '48px', 600],
  'present-question': ['34px', '40px', 600, '-0.01em'],
  'present-tile-name': ['21px', '28px', 600],
  'present-tile-state': ['17px', '24px', 600],
  'code-chip': ['17px', '26px', 600, '0.16em'],
  'code-card': ['40px', '48px', 600, '0.16em'],
  'code-present': ['34px', '44px', 600, '0.16em'],
  // The side menu's (PV5), which v2.css draws and §1's facts don't list: the lockup's word, the
  // name at its foot and the initials in its avatar.
  lockup: ['16px', '22px', 600],
  'menu-name': ['13px', '17px', 600],
  'menu-initials': ['11px', '11px', 600],
  // The class page's (PV6): the small button's label and a segment of the length picker.
  'button-sm': ['13.5px', '18px', 600],
  segment: ['14px', '18px', 600],
  // The live header's (PV7): the line under the countdown, "ends 9:55 AM".
  'countdown-sub': ['12.5px', '17px', 400],
  // Present's (PV9): the line under its countdown, its code's label and its counts.
  'present-caption': ['16px', '22px', 400],
  // Reports' (PV13): a class's pill, a bar's row, a table's cell and the line under its words.
  pill: ['13.5px', '18px', 500],
  'bar-row': ['13.5px', '18px', 400],
  cell: ['14px', '19px', 400],
  'cell-sub': ['12px', '16px', 400],
  // The entry pages' (PV15): an entry page's card title and the sign-in's 48 px button's label.
  'entry-title': ['20px', '26px', 600],
  'button-lg': ['16px', '20px', 600],
  // The recap's (PV12b): its axis's times.
  axis: ['12px', '16px', 400],
};
/** The sizes §1 lists that the scale has, each its style: [style, size, line height]. */
const ON_SCALE = [
  ['h3', '18px', '24px'], // card titles
  ['caption', '13px', '18px'], // chips, a tile's state
  ['data', '14px', '20px'], // menu items
  ['data-lg', '28px', '32px'], // the class page's countdown
  ['h2', '24px', '30px'], // figures, Present's options
  ['body', '15px', '22px'], // a Present tile's line
];
/** The primitives v2's look draws with directly (DESIGN.md §1, Style facts). */
const V2_PRIMITIVES = [
  'green-50',
  'green-200',
  'green-800',
  'orange-400',
  'orange-700',
  'red-300',
  'stone-300',
  'stone-400',
  'stone-500',
];
/** A colour token's `#rrggbb` on one side, through its `{primitive}` if it names one. */
function hexOf(name: string, mode: 'light' | 'dark'): string {
  const token = colours.get(name) as Token;
  const raw = typeof token.value === 'string' ? token.value : token.value[mode];
  const primitive = /^\{([\w-]+)\}$/.exec(raw)?.[1];
  return primitive ? hexOf(primitive, mode) : raw;
}
/** WCAG 2.2's contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, bl = 0] = bytes(hex).map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the portal’s tokens are bali-tokens.json’s', () => {
  it('every --bali- variable on :root is a token’s light value', () => {
    expect(light.size).toBeGreaterThan(60);
    for (const [name, value] of light) {
      if (RULED.has(name)) continue;
      const token = colours.get(name.slice('--bali-'.length)) ?? shadows.get(name.slice(7));
      expect(token, name).toBeDefined();
      expect(value, name).toBe(side(token as Token, 'light'));
    }
  });

  it('every primitive v2’s look draws with is on :root, at its token’s value (PV4)', () => {
    for (const name of V2_PRIMITIVES) {
      expect(light.get(`--bali-${name}`), name).toBe(side(colours.get(name) as Token, 'light'));
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

  it('is always light (the owner, 2026-10-07): light declared, nothing for the device’s dark mode', () => {
    // Light alone, so native controls and scrollbars stay light whatever the device's mode.
    expect(css).toMatch(/:root\s*\{\s*color-scheme: light;/);
    // No dark override anywhere: no media query on the scheme (the stylesheet's, or the layout's
    // second chrome colour), and no `dark:` variant on any page or piece.
    const src = fileURLToPath(new URL('../', import.meta.url));
    for (const file of sources(src)) {
      const source = readFileSync(file, 'utf8');
      expect(source, relative(src, file)).not.toMatch(/prefers-color-scheme/);
      expect(source, relative(src, file)).not.toMatch(/\bdark:[\w[@-]/);
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
    // The ring's colour is focus-ring-color's: green-600.
    const colour = colours.get('focus-ring-color') as Token;
    const primitive = /\{([\w-]+)\}/.exec((colour.value as Record<string, string>).light ?? '');
    const hex = (colours.get(primitive?.[1] ?? '') as Token).value as string;
    expect(side(ring, 'light').endsWith(hex.toLowerCase())).toBe(true);
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

  it('bali-softpulse’s glow is orange-400 at 35 % (DESIGN.md §7)', () => {
    const hex = (colours.get('orange-400') as Token).value as string;
    expect(light.get('--bali-softpulse-glow')).toBe(`rgba(${bytes(hex).join(',')},0.35)`);
  });

  it('border-input, a text field’s edge, is the owner’s: 3:1 on the card, the page and the well', () => {
    // The owner's ruling (2026-10-06): stone-500, where border-default is 1.3:1, under WCAG
    // 1.4.11's 3:1 for a control's edge.
    expect(light.get('--bali-border-input')).toBe('var(--bali-stone-500)');
    expect(inline.get('--color-border-input')).toBe('var(--bali-border-input)');
    for (const surface of ['surface-card', 'surface-page', 'surface-sunken']) {
      const ratio = contrast(hexOf('stone-500', 'light'), hexOf(surface, 'light'));
      expect(ratio, surface).toBeGreaterThanOrEqual(3);
    }
    // Every field's, through the one Field; a refused field's edge stays `text-primary`. The field
    // is white in v2's look (DESIGN.md §1), its grey well gone (PV4).
    expect(read('../components/field.tsx')).toMatch(
      /<input[^]*className=\{`[^`]*\bborder-border-input\b[^`]*\bbg-surface-card\b[^`]*\baria-\[invalid=true\]:border-text-primary\b/,
    );
  });

  it('bali-softpulse is a 6 px glow ring, 1.2 s twice on the standard easing, and only the grid’s', () => {
    expect(css).toMatch(
      /@keyframes bali-softpulse\s*\{\s*0%,\s*100%\s*\{\s*box-shadow: 0 0 0 0 transparent;\s*\}\s*50%\s*\{\s*box-shadow: 0 0 0 6px var\(--bali-softpulse-glow\);\s*\}\s*\}/,
    );
    // Exactly twice, never `infinite`: the one pulse never loops (§7).
    expect(css).toMatch(
      /@utility animate-softpulse\s*\{\s*animation: bali-softpulse 1\.2s cubic-bezier\(0\.2, 0, 0, 1\) 2;\s*\}/,
    );
    const src = fileURLToPath(new URL('../', import.meta.url));
    const users = sources(src).filter(
      (file) => file.endsWith('.tsx') && readFileSync(file, 'utf8').includes('animate-softpulse'),
    );
    expect(users.map((file) => relative(src, file))).toEqual([join('components', 'live-grid.tsx')]);
  });

  it('Tailwind’s own colours, type sizes, tracking, leading and shadows are gone (D2g)', () => {
    for (const set of ['--color-*', '--text-*', '--tracking-*', '--leading-*', '--shadow-*']) {
      expect(theme.get(set), set).toBe('initial');
    }
  });

  it('the radii are the tokens’ five and v2’s three (8, 12, 16), and no other', () => {
    expect(theme.get('--radius-*')).toBe('initial');
    const radii = [...theme.keys()].filter((k) => k.startsWith('--radius-') && k !== '--radius-*');
    expect(radii.sort()).toEqual(
      [
        ...tokens.radius.tokens.map((t) => `--${t.name}`),
        ...Object.keys(V2_RADII).map((name) => `--radius-${name}`),
      ].sort(),
    );
    for (const token of tokens.radius.tokens)
      expect(theme.get(`--${token.name}`)).toBe(token.value);
    for (const [name, value] of Object.entries(V2_RADII))
      expect(theme.get(`--radius-${name}`), name).toBe(value);
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

  it('beside them, only the sizes the owner ruled (DESIGN.md §1, §3, §5), each where it belongs', () => {
    // The input size: 16 px, so iPhone Safari never zooms into a field when it is tapped
    // (2026-10-05), its line height on the 4-pt grid; the design system gains it at the owner's
    // next export. And v2's look's sizes, as drawn (2026-10-12), pinned below. The Present view's
    // old names and chip labels (20 and 14 px, 2026-10-05) went with its tiles (PV8), and its
    // code-lg (24 px, 2026-10-06) with its header (PV9), whose code is v2's `code-present`.
    const sizes = [...theme.keys()]
      .filter((k) => k.startsWith('--text-') && k !== '--text-*' && !k.slice(2).includes('--'))
      .map((k) => k.slice('--text-'.length));
    const styles = tokens.type.groups.flatMap((g) => g.styles.map((s) => s.name));
    expect(sizes.sort()).toEqual([...styles, 'input', ...Object.keys(V2_SIZES)].sort());
    expect(theme.get('--text-input')).toBe('16px');
    expect(theme.get('--text-input--line-height')).toBe('24px');
    expect(theme.get('--text-input--font-weight')).toBe('400');
    expect(read('../components/field.tsx')).toMatch(/<input[^]*className=\{`[^`]*\btext-input\b/);
    // v2's sizes off the scale, each as drawn; the ones the scale has, the scale's own.
    for (const [name, [size, line, weight, tracking]] of Object.entries(V2_SIZES)) {
      expect(theme.get(`--text-${name}`), name).toBe(size);
      expect(theme.get(`--text-${name}--line-height`), name).toBe(line);
      expect(theme.get(`--text-${name}--font-weight`), name).toBe(String(weight));
      expect(theme.get(`--text-${name}--letter-spacing`), name).toBe(tracking);
    }
    for (const [style, size, line] of ON_SCALE) {
      expect([theme.get(`--text-${style}`), theme.get(`--text-${style}--line-height`)]).toEqual([
        size,
        line,
      ]);
    }
    // A Present tile's two sizes are the live grid's alone (PV8), the header's its own (PV9).
    const src = fileURLToPath(new URL('../', import.meta.url));
    const present = sources(src).filter(
      (file) =>
        file.endsWith('.tsx') &&
        /\btext-present-tile-(?:name|state)\b/.test(readFileSync(file, 'utf8')),
    );
    expect(present.map((file) => relative(src, file))).toEqual([
      join('components', 'live-grid.tsx'),
    ]);
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
    // The sans's upright and its italic (PV4) fall back to the sans stack, the mono to its own.
    expect(fonts.split(`fallback: ${list(sansRest)}`)).toHaveLength(3);
    expect(fonts).toContain(`fallback: ${list(monoRest)}`);
    const files = [...fonts.matchAll(/src: '\.\/(fonts\/[\w-]+\.woff2)'/g)].map((m) => m[1]);
    expect(files).toEqual([
      'fonts/instrument-sans-latin-wght-normal.woff2',
      'fonts/instrument-sans-latin-wght-italic.woff2',
      'fonts/jetbrains-mono-latin-wght-normal.woff2',
    ]);
    for (const file of files)
      expect(existsSync(fileURLToPath(new URL(`./${file}`, import.meta.url))), file).toBe(true);
    // Exactly the stacks: no metric-matched Arial ahead of them on any face.
    expect(fonts.match(/adjustFontFallback: false/g)).toHaveLength(3);
    expect(inline.get('--font-sans')).toBe('var(--font-instrument-sans)');
    expect(inline.get('--font-mono')).toBe('var(--font-jetbrains-mono)');
    expect(tokens.type.families.num.startsWith('ui-rounded, "SF Pro Rounded"')).toBe(true);
    expect(inline.get('--font-num')).toBe(
      "ui-rounded,'sf pro rounded',var(--font-instrument-sans)",
    );
  });

  it('the italic is its own face, never preloaded, and every italic text is set in it (PV4)', () => {
    // Its own family, so next/font preloads it on no page (it preloads every file of a family);
    // the base layer then sets it on `italic`, `em` and `i`, so the upright is never slanted.
    expect(fonts).toMatch(
      /localFont\(\{\s*src: '\.\/fonts\/instrument-sans-latin-wght-italic\.woff2',\s*weight: '400 700',\s*style: 'italic',\s*variable: '--font-instrument-sans-italic',[^}]*\bpreload: false,\s*\}\)/,
    );
    expect(read('./layout.tsx')).toContain('${instrumentSansItalic.variable}');
    expect(css).toMatch(
      /:where\(\.italic, em, i\)\s*\{\s*font-family: var\(--font-instrument-sans-italic\);\s*\}/,
    );
  });

  it('the browser’s own chrome takes surface-page, one colour (the layout’s viewport)', () => {
    const page = hexOf('surface-page', 'light').toLowerCase();
    expect(read('./layout.tsx')).toContain(
      `export const viewport: Viewport = { themeColor: '${page}' };`,
    );
  });

  it('every semantic colour token is a Tailwind colour of the same name', () => {
    for (const token of semantic(tokens.color.tokens)) {
      const name = token.name === 'focus-ring-color' ? 'focus-ring' : token.name;
      expect(inline.get(`--color-${name}`), token.name).toBe(`var(--bali-${token.name})`);
    }
  });

  it('beside them, only border-input, the side menu’s avatar (PV5), a dialog’s backdrop (PV6), the reconnect pill’s dot (PV7), the unlock pop-up’s edge (PV10) and Open student (PV11b), the recap’s marks (PV12b), Reports’ opened row (PV13), and a live card’s edge (W3)', () => {
    const named = [...inline.keys()].filter((k) => k.startsWith('--color-'));
    const semanticNames = semantic(tokens.color.tokens).map((t) =>
      t.name === 'focus-ring-color' ? '--color-focus-ring' : `--color-${t.name}`,
    );
    expect(named.filter((k) => !semanticNames.includes(k)).sort()).toEqual([
      '--color-avatar-bg',
      '--color-avatar-fg',
      '--color-border-input',
      '--color-live-edge',
      '--color-mark',
      '--color-mark-off',
      '--color-pip',
      '--color-row-open',
      '--color-scrim',
      '--color-unlock-edge',
      '--color-unlock-link',
    ]);
    // A live card's edge: green-200, as v2.css's `.livecard` draws it.
    expect(inline.get('--color-live-edge')).toBe('var(--bali-green-200)');
    // Reports' opened row: green-50, as v2.css's `.wtable tr.is-open` fills it, under the
    // primary ink at 4.5:1 and more.
    expect(inline.get('--color-row-open')).toBe('var(--bali-green-50)');
    expect(contrast(hexOf('text-primary', 'light'), hexOf('green-50', 'light'))).toBeGreaterThan(
      4.5,
    );
    // The recap's marks' rings, as v2.css's `.mk` draws them: stone-400, and red-300 for a
    // protection off (an unlock's is `unlock-edge`). Graphics, not text: 1.4.11 asks 3:1 of a
    // control's edge, and a mark is no control; its icon is in its state's ink.
    expect(inline.get('--color-mark')).toBe('var(--bali-stone-400)');
    expect(inline.get('--color-mark-off')).toBe('var(--bali-red-300)');
    // The reconnect pill's dot (DESIGN.md §4): stone-500, as v2.css draws it.
    expect(inline.get('--color-pip')).toBe('var(--bali-stone-500)');
    // The unlock pop-up's 3 px top edge: orange-400, as v2.css's `.toast` draws it.
    expect(inline.get('--color-unlock-edge')).toBe('var(--bali-orange-400)');
    // Its Open student: orange-700, as v2.css's `.t-act` draws it, small text at 4.5:1 on white.
    expect(inline.get('--color-unlock-link')).toBe('var(--bali-orange-700)');
    expect(contrast(hexOf('orange-700', 'light'), hexOf('surface-card', 'light'))).toBeGreaterThan(
      4.5,
    );
    expect(inline.get('--color-avatar-bg')).toBe('var(--bali-green-200)');
    expect(inline.get('--color-avatar-fg')).toBe('var(--bali-green-800)');
    // Its initials are small text: 4.5:1 at least, as every chip's ink on its fill.
    expect(contrast(hexOf('green-800', 'light'), hexOf('green-200', 'light'))).toBeGreaterThan(4.5);
    // A dialog's backdrop (DESIGN.md §1 and §6): the shadows' own warm black, at 32 %.
    expect(inline.get('--color-scrim')).toBe('rgba(33,28,21,0.32)');
    for (const name of ['shadow-1', 'shadow-2', 'shadow-3']) {
      expect(side(shadows.get(name) as Token, 'light'), name).toContain('rgba(33,28,21,');
    }
  });
});

describe('every lucide icon draws at v2.css’s 1.75 stroke, set once (PV4b)', () => {
  // The owner, 2026-10-13: one base-layer rule, which beats the svg's own attribute, so no icon
  // passes a stroke of its own (it would draw nothing); one drawn otherwise takes a class, which
  // outranks the layer. Each test fails where the rule would quietly stop holding (PV4c).
  const src = fileURLToPath(new URL('../', import.meta.url));
  /** What the browser reads of globals.css: no comments. */
  const live = css.replace(/\/\*[^]*?\*\//g, '');
  const rule = /\bsvg\.lucide\s*\{\s*stroke-width: 1\.75;\s*\}/.exec(live);

  /** The heads of the blocks open at `index` in `live`, outermost first: `@layer base`, `@media …`. */
  function blocksAt(index: number): string[] {
    const open: string[] = [];
    let head = 0;
    for (let i = 0; i < index; i++) {
      const c = live.charAt(i);
      if (c === '{') open.push(live.slice(head, i).trim());
      if (c === '}') open.pop();
      if (c === '{' || c === '}' || c === ';') head = i + 1;
    }
    return open;
  }

  /**
   * Each lucide icon the portal draws, known by its props, lucide's (they take `nonScalingStroke`),
   * so one drawn under another name counts too (the shell's `Icon`); and of each, what would give
   * it a stroke of its own: a stroke prop of lucide's, or an inline style that sets one.
   */
  function lucideIcons(): { icon: string; own: string[] }[] {
    const files = sources(src).filter((file) => file.endsWith('.tsx'));
    const web = fileURLToPath(new URL('../../', import.meta.url));
    const tsconfig = ts.readConfigFile(join(web, 'tsconfig.json'), (path) => ts.sys.readFile(path));
    const { options } = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, web);
    const program = ts.createProgram(files, options);
    const checker = program.getTypeChecker();
    const ownStroke = (attr: ts.JsxAttributeLike): boolean => {
      if (!ts.isJsxAttribute(attr)) return false;
      const name = attr.name.getText();
      if (['strokeWidth', 'absoluteStrokeWidth', 'nonScalingStroke'].includes(name)) return true;
      const value =
        attr.initializer && ts.isJsxExpression(attr.initializer)
          ? attr.initializer.expression
          : undefined;
      if (name !== 'style' || !value) return false;
      // A style that sets it: written in place, held in a constant, or one side of `? :` with none.
      const stroke = checker
        .getNonNullableType(checker.getTypeAtLocation(value))
        .getProperty('strokeWidth');
      return stroke !== undefined && (stroke.flags & ts.SymbolFlags.Optional) === 0;
    };
    const icons: { icon: string; own: string[] }[] = [];
    for (const file of files) {
      const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const props = checker
            .getTypeAtLocation(node.tagName)
            .getCallSignatures()[0]
            ?.getParameters()[0];
          if (props && checker.getTypeOfSymbol(props).getProperty('nonScalingStroke')) {
            icons.push({
              icon: `${relative(src, file)}: <${node.tagName.getText()}>`,
              own: node.attributes.properties.filter(ownStroke).map((attr) => attr.getText()),
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      const source = program.getSourceFile(file);
      if (source) visit(source);
    }
    return icons;
  }

  it('by one rule the browser reads, at the base layer’s top, the only one naming the icons', () => {
    expect(rule).not.toBeNull();
    // Out of the layer it would outrank the class an icon drawn otherwise takes (PV12b, PV16); in a
    // media query it would hold only there.
    expect(blocksAt(rule?.index ?? 0)).toEqual(['@layer base']);
    // No other rule names the icons, so none puts them back at 2.
    expect(live.match(/\.lucide(?![\w-])/g)).toHaveLength(1);
  });

  it('on the class lucide still gives every svg it draws, whose paths take the svg’s stroke', () => {
    // As the portal draws an icon: sized, hidden from a screen reader, with a class of its own.
    const html = renderToStaticMarkup(
      createElement(House, { size: 17, 'aria-hidden': 'true', className: 'shrink-0' }),
    );
    const svg = /^<svg\b[^>]*\bclass="([^"]*)"[^>]*>/.exec(html);
    // `lucide`, the class `svg.lucide` targets: renamed in an update, every icon would go back to 2.
    expect(svg?.[1]?.split(' ')).toEqual(expect.arrayContaining(['lucide', 'shrink-0']));
    // The paths inherit the svg's stroke; a stroke of their own would beat the rule.
    expect(html.slice(svg?.[0].length)).not.toContain('stroke-width');
  });

  it('never set on one icon, by a prop or an inline style, under any name; any other component keeps its own', () => {
    const icons = lucideIcons();
    // Known by type, the aliases with the rest: finding none would mean it can no longer see them.
    expect(icons.length).toBeGreaterThan(0);
    expect(icons.filter((icon) => icon.own.length > 0)).toEqual([]);
  });
});

describe('every page and piece uses the tokens’ utilities, never a Tailwind default', () => {
  // DESIGN.md: no `slate-*`, no `text-sm`. Every screen is drawn from the tokens since D2g, and the
  // theme holds no default colour or size, so one would draw nothing: each source file is held to it.
  const src = fileURLToPath(new URL('../', import.meta.url));
  // Each under src/, its parts joined by `/` on every OS (Windows' own is `\`), so a case is named
  // alike everywhere and the field's exception below finds it.
  const DRAWN = sources(src)
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => relative(src, file).split(sep).join('/'));

  it('covers the redrawn screens, the recap and Reports included', () => {
    expect(DRAWN.length).toBeGreaterThan(30);
    expect(DRAWN).toContain('components/recap-card.tsx');
    expect(DRAWN).toContain('app/reports/page.tsx');
    expect(DRAWN).toContain('components/reports-list.tsx');
  });

  // A side's border, a ring's offset and a shadow take a colour too (`border-t-slate-200`).
  const COLOUR =
    /\b(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|decoration|placeholder|fill|stroke|from|via|to|accent|caret|(?:inset-|drop-)?shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)\b/;
  const SIZE = /\btext-(?:xs|sm|base|lg|\d?xl)\b/;
  const TYPE =
    /\b(?:tracking|leading)-(?:tighter|tight|snug|normal|relaxed|loose|wide|wider|widest)\b/;

  it.each(DRAWN)('%s', (file) => {
    const source = read(`../${file}`);
    expect(source).not.toMatch(COLOUR);
    expect(source).not.toMatch(SIZE);
    expect(source).not.toMatch(TYPE);
    // A field is the Field, so what is typed in it is the input size (the owner's ruling); a radio
    // types nothing (the class page's length picker).
    if (file !== 'components/field.tsx') {
      expect(source).not.toMatch(/<input\b(?![^>]*type="radio")/);
    }
  });
});

describe('no grey tray behind a card, anywhere (the owner, 2026-10-06)', () => {
  // Cards sit straight on the page with their own hairline (DESIGN.md §4). Grey stays only where
  // the approved designs keep it: the grid's stale banner, the policy draft's banner, and a
  // control's hover, pressed or open state, the side menu's item on its own page (PV5) among them;
  // a chip's fill is its state's own tint, the Placeholder chip's Not here's (PV15). A field is
  // white in v2's look (PV4); the grey v2 adds comes with the step that draws each: the length
  // picker's track and the join code's chip (PV6); the recap's name pills (PV12b); a table's head
  // and the bars' tracks (PV13); the help page's two lists of what a teacher sees (PV15).
  const src = fileURLToPath(new URL('../', import.meta.url));
  const files = sources(src).filter((file) => /\.tsx?$/.test(file));

  it('surface-sunken fills nothing else', () => {
    // Each fill with its variants: none at rest, or only a control's states.
    const STATES = new Set([
      'hover',
      'active',
      'aria-pressed',
      'aria-expanded',
      'aria-[current=page]',
    ]);
    const fills = (file: string) =>
      [
        ...readFileSync(file, 'utf8').matchAll(/((?:[\w-]+(?:\[[\w=]+\])?:)*)bg-surface-sunken\b/g),
      ].map((m) => m[1] ?? '');
    for (const file of files) {
      for (const variants of fills(file).filter(Boolean)) {
        const states = variants.split(':').filter(Boolean);
        expect(
          states.every((v) => STATES.has(v)),
          `${relative(src, file)}: ${variants}`,
        ).toBe(true);
      }
    }
    const bare = (file: string) => fills(file).filter((v) => v === '').length;
    const filled = Object.fromEntries(
      files.filter((file) => bare(file) > 0).map((file) => [relative(src, file), bare(file)]),
    );
    // The stale banner, the policy draft's banner, and v2's on the class page: the length
    // picker's track, the join code's chip, the student panel's moments' dots and the recap's name
    // pills; on Reports (PV13) its table's head, its bars' tracks and the place-lost notice, drawn
    // as the stale banner is; and on Help (PV15, SupportPage) the two lists of what a teacher sees,
    // drawn so too.
    expect(filled).toEqual({
      [join('app', 'classes', '[id]', 'page.tsx')]: 1,
      [join('app', 'support', 'page.tsx')]: 1,
      [join('components', 'join-code.tsx')]: 1,
      [join('components', 'live-grid.tsx')]: 1,
      [join('components', 'policy-draft.tsx')]: 1,
      [join('components', 'reports-list.tsx')]: 3,
      [join('components', 'student-panel.tsx')]: 1,
      [join('components', 'timeline.tsx')]: 1,
    });
  });

  it('a card keeps its own hairline and soft shadow, at radius-md', () => {
    for (const card of [CARD, CARD_ALONE, CARD_ENTRY]) {
      expect(card).toMatch(/\bbg-surface-card\b/);
      expect(card).toMatch(/\bborder border-border-default\b/);
      expect(card).toMatch(/\bshadow-1\b/);
      expect(card).toMatch(/\brounded-md\b/);
    }
    // v2's card on its own, 20 px in, and an entry page's, 24 px in (DESIGN.md §4); a list's cards
    // keep space-4 until the step that draws the list in v2's look.
    expect(CARD_ALONE).toMatch(/\bp-5\b/);
    expect(CARD_ENTRY).toMatch(/\bp-6\b/);
    expect(CARD).toMatch(/\bp-4\b/);
  });
});

describe('the buttons in v2’s look (DESIGN.md §1 and §4, PV4)', () => {
  const look = buttonClass('primary').split(' ');

  it('are 40 px tall with 10 px corners, 18 px in, their label 15/20 semibold on one line', () => {
    expect(look).toEqual(
      expect.arrayContaining(['h-10', 'rounded-sm', 'px-4.5', 'text-button', 'whitespace-nowrap']),
    );
    // No pill (Soft premium's, superseded) on any variant.
    for (const variant of ['primary', 'secondary', 'destructive'] as const) {
      expect(buttonClass(variant)).not.toMatch(/\brounded-full\b/);
    }
  });

  it('dim to 55 % while disabled or busy, as v2.css draws them', () => {
    expect(look).toEqual(
      expect.arrayContaining(['disabled:opacity-55', 'aria-disabled:opacity-55']),
    );
  });

  it('come small too (PV6): 34 px tall, 14 px in, a 13.5/18 label, the rest as the others', () => {
    const small = buttonClass('secondary', '', 'sm').split(' ');
    expect(small).toEqual(
      expect.arrayContaining(['h-8.5', 'px-3.5', 'text-button-sm', 'rounded-sm', 'gap-2']),
    );
    expect(small).not.toEqual(expect.arrayContaining(['h-10']));
    expect(small).not.toEqual(expect.arrayContaining(['text-button']));
  });

  it('come large too (PV15, the sign-in’s): 48 px tall, 18 px in, a 16/20 label, the rest as the others', () => {
    const large = buttonClass('primary', '', 'lg').split(' ');
    expect(large).toEqual(
      expect.arrayContaining(['h-12', 'px-4.5', 'text-button-lg', 'rounded-sm', 'gap-2']),
    );
    expect(large).not.toEqual(expect.arrayContaining(['h-10']));
    expect(large).not.toEqual(expect.arrayContaining(['text-button']));
  });
});

describe('Reports’ sessions are a table in a box that scrolls sideways (PV13; DESIGN.md §8)', () => {
  // v2's look superseded the card per session (D2g) and "never a table that scrolls sideways": the
  // box scrolls, never the page, and no figure wraps or shrinks below its size to fit.
  const list = read('../components/reports-list.tsx');

  it('scrolls in its own box, and only there', () => {
    expect(list.match(/<table\b/g)).toHaveLength(1);
    expect(list.match(/overflow-x-auto/g)).toHaveLength(1);
    expect(list).toMatch(/<div className="@container overflow-x-auto [^"]*">\s*<table\b/);
    expect(read('./reports/page.tsx')).not.toMatch(/overflow-x|<table\b/);
  });

  it('keeps each figure on one line in the cells’ own size', () => {
    expect(list).toMatch(/const FIGURE = `\$\{CELL\} text-right whitespace-nowrap`;/);
    expect(list).toMatch(/const CELL = '[^']*\btext-cell\b[^']*';/);
  });
});
