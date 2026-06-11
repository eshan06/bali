# 02 · Design Tokens

> Machine-readable sources: `tokens/tokens.css` (CSS custom properties, light + dark) and
> `tokens/tailwind.tokens.js` (Tailwind `theme.extend` block). The CSS file is the single
> source of truth — every design file in this bundle links it directly. The visual
> reference is `design-files/Pass 1 - Foundations.html`, which renders all of this and
> computes WCAG contrast ratios live from rendered pixels.

## Rationale (why these values)

Warm stone neutrals give both platforms paper-like calm instead of clinical blue-gray. A
desaturated **evergreen** carries both the brand and the `focused` state — "the product's
color" literally means "things are fine." Students get a dark-first world of true warm
darks where elevation comes from surface steps and hairline borders, not shadows. Orange
is reserved for emergency and reads earthy/supportive (deliberately NOT safety-vest);
red exists only for `revoked` and destructive actions. Type does the personality work:
Instrument Sans on web, system SF Pro on iOS, SF Pro Rounded only at large numeral sizes,
JetBrains Mono strictly for codes.

## 1. Color primitives

### Evergreen (brand · focused · primary actions)
| step | hex | step | hex |
|---|---|---|---|
| 50 | `#F0F7F3` | 500 | `#3F8765` |
| 100 | `#DCEDE3` | 600 | `#2C6F51` |
| 200 | `#BCDCCA` | 700 | `#245A43` |
| 300 | `#92C3A9` | 800 | `#1E4936` |
| 400 | `#62A483` | 900 | `#18392B` · 950 `#0E251C` |

### Stone (warm neutrals · surfaces · text)
| step | hex | step | hex |
|---|---|---|---|
| 50 | `#F7F5F2` | 500 | `#8A847A` |
| 100 | `#EFECE7` | 600 | `#6B665D` |
| 200 | `#E3DFD8` | 700 | `#524E47` |
| 300 | `#D2CCC2` | 800 | `#3A3733` |
| 400 | `#ABA59A` | 900 | `#26241F` · 950 `#161513` |

### Orange (emergency_unlocked — warm, never alarm)
50 `#FBF4EC` · 100 `#F7E6D2` · 200 `#EFCEA4` · 300 `#E5AF6F` · 400 `#DB9347` ·
500 `#C97A2D` · 600 `#AE6322` · 700 `#8C4F1E` · 800 `#6F3F1B` · 900 `#5A3418`

### Blue (pass state only)
50 `#EFF4FC` · 100 `#E0EBFA` · 200 `#BDD4F2` · 300 `#8FB4E8` · 400 `#5E90D9` ·
500 `#3D77C9` · 600 `#2F62AC` · 700 `#28528E` · 800 `#224371` · 900 `#1C3659`

### Red (RESERVED: revoked + destructive only)
50 `#FCF0EE` · 100 `#FAE3E0` · 200 `#F2C3BD` · 300 `#E89B92` · 400 `#D96E61` ·
500 `#C44A3C` · 600 `#A93D31` · 700 `#8C342B` · 800 `#702B24` · 900 `#59241F`

## 2. Semantic aliases — LIGHT (default)

| token | value | use |
|---|---|---|
| `--surface-page` | stone-50 `#F7F5F2` | app/page background |
| `--surface-card` | `#FFFFFF` | cards, sheets |
| `--surface-sunken` | stone-100 `#EFECE7` | wells, inputs, code bg |
| `--surface-raised` | `#FFFFFF` (+ shadow-2) | popovers |
| `--surface-brand` | green-700 | brand-solid blocks |
| `--border-default` | stone-200 `#E3DFD8` | hairlines |
| `--border-strong` | stone-300 `#D2CCC2` | inputs, secondary buttons |
| `--text-primary` | `#211F1B` | |
| `--text-secondary` | `#5B564E` | 6.7:1 on page |
| `--text-tertiary` | stone-500 `#8A847A` | **3.4:1 on page — ≥18px or non-essential metadata ONLY** |
| `--text-disabled` | stone-400 | |
| `--text-brand` | green-700 | links, ghost buttons |
| `--action-primary-bg` | green-700 (hover green-800, pressed green-900) | white text |
| `--action-destructive-bg` | red-600 | white text |

State chip pairs (fg on bg — all ≥4.5:1, verified):
| state | fg | bg |
|---|---|---|
| not_joined | stone-700 `#524E47` | stone-100 `#EFECE7` |
| focused | green-700 `#245A43` | green-100 `#DCEDE3` (6.6:1) |
| pass | blue-700 `#28528E` | blue-100 `#E0EBFA` (6.5:1) |
| emergency | orange-800 `#6F3F1B` | orange-100 `#F7E6D2` (7.2:1) |
| revoked | red-700 `#8C342B` | red-100 `#FAE3E0` |
| no_device | stone-600 `#6B665D` | transparent + 1.5px dashed currentColor |
| ended | stone-600 `#6B665D` | stone-100 |

Arc: track stone-200, fill green-600, final-2-minutes fill green-400 (lighter, never red).
Focus ring: `0 0 0 2px var(--surface-page), 0 0 0 4px var(--green-600)`.

## 3. Semantic aliases — DARK (`[data-theme="dark"]` — student default)

True warm darks. Elevation = lighter surface + hairline border, **not** shadows.
Not an inversion: state fg jumps to the soft 300 step; tints are hand-mixed hexes, not alpha.

| token | value |
|---|---|
| `--surface-page` | `#141312` |
| `--surface-card` | `#1D1B19` |
| `--surface-sunken` | `#100F0E` |
| `--surface-raised` | `#262421` |
| `--border-default` | `#2E2B27` · strong `#3C3934` |
| `--text-primary` | `#F1EFEB` |
| `--text-secondary` | `#B0AAA1` (8.1:1) |
| `--text-tertiary` | `#837D74` |
| `--action-primary-bg` | green-400 `#62A483` with ink `#06130D` (6.5:1 — green-500 FAILS AA with any fg, do not use) |

State chip pairs (dark):
| state | fg | bg |
|---|---|---|
| not_joined | `#B0AAA1` | `#242220` |
| focused | green-300 `#92C3A9` | `#1E2F27` (7.2:1) |
| pass | blue-300 `#8FB4E8` | `#1D2938` |
| emergency | orange-300 `#E5AF6F` | `#38291A` |
| revoked | red-300 `#E89B92` | `#341F1C` |
| no_device | `#A39D94` | transparent + dashed (5.9:1 vs page) |
| ended | `#A39D94` | `#242220` |

Arc dark: track `#2E2B27`, fill green-400, final-2 green-300.
Focus ring dark: ring color green-300.

## 4. Typography

### Families
- `--font-ui`: **Instrument Sans** (Google Fonts, 400–700, italic axis) — all web UI.
  On iOS the system stack (`-apple-system` / SF Pro) replaces it inside app screens.
- `--font-num`: `ui-rounded, "SF Pro Rounded"` — **large numerals only** (countdowns,
  join codes' companion text). Always with `font-variant-numeric: tabular-nums`.
- `--font-mono`: **JetBrains Mono** — codes ONLY (join codes, tag codes). Chosen for
  unmistakable 0/O and 1/l/I at projector distance. Never used for body text.

### Web scale
| token | spec | use |
|---|---|---|
| display | 600 56/60, -0.02em | projector join code header, W4 hero |
| h1 | 600 32/38, -0.01em | page titles |
| h2 | 600 24/30 | section titles |
| h3 | 600 18/24 | card titles |
| body-lg | 400 17/26 | framing copy |
| body | 400 15/22 | default |
| caption | 400 13/18 | metadata |
| label | 600 12/16, +0.06em, uppercase | section labels |
| data | 500 14/20, tabular | table numbers, chip labels |
| data-lg | 600 28/32, tabular, rounded | medium countdown |
| code | 500 14/20 mono | tag codes |

### iOS Dynamic Type mapping (defaults at Large)
LargeTitle 34/41 (700 in nav) · Title1 28/34 · Title2 22/28 600 · Title3 20/25 600 ·
Headline 17/22 600 · Body 17/22 · Callout 16/21 · Subheadline 15/20 · Footnote 13/18 ·
Caption1 12/16 · Caption2 11/13.
Hero countdown: SF Pro Rounded ~56–76pt semibold tabular (custom size, scales down at
accessibility sizes — see S6 XL frame: type ×1.24, arc 244→218pt, control 60→76pt).

## 5. Spacing · Radius · Elevation

- **Spacing:** 4pt grid. Tokens: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 (`--space-1…16`, px ≡ pt).
- **Radius:** xs 6 (badges) · sm 10 (buttons/inputs) · md 14 (cards/chips) · lg 20
  (sheets/hero) · full 999 (pills, EmergencyUnlockControl).
- **Elevation light:** shadow-1 `0 1px 2px rgba(33,28,21,.06)` (resting cards) ·
  shadow-2 `0 2px 8px rgba(33,28,21,.08), 0 1px 2px rgba(33,28,21,.05)` (popovers/toasts) ·
  shadow-3 `0 8px 24px rgba(33,28,21,.12), 0 2px 6px rgba(33,28,21,.06)` (slide-overs/modals).
- **Elevation dark:** surface-lightness steps + 1px hairline borders; shadow-1 none,
  shadow-2/3 plain black blurs for overlays only.

## 6. Motion tokens (budget is small and purposeful — see 06-interactions-motion.md)

| token | value | use |
|---|---|---|
| `--motion-fast` | 150ms | chip state crossfades |
| `--motion-base` | 200ms | toast slide-in, sheet present |
| `--motion-slow` | 300ms | ceiling for everything else |
| `--motion-arc` | 600ms | THE theatrical moment: arc draw-in on tap-in (once) |
| `--ease-standard` | cubic-bezier(0.2, 0, 0, 1) | everything |
| `--ease-spring` | cubic-bezier(0.34, 1.3, 0.64, 1) | hold-release spring-back, pop-ins |

Every animation has a `prefers-reduced-motion` fallback (crossfade or none).

## 7. Iconography

- **iOS:** SF Symbols (state mapping in `01-product-spec.md`), default weights.
- **Web:** Lucide at 1.75px stroke, single set, no mixing. Key glyphs: circle,
  circle-check, ticket, lock-open, shield-off, smartphone, flag, timer, wifi-off, nfc,
  printer, copy, monitor, chevron-*, x, plus, user-plus, scroll-text, chart-bar,
  layout-grid, list-checks, settings, house, log-out, bell, eye-off, shield-check.
- The **arc mark** (brand) is product-drawn, not an icon-set glyph: a circle track
  (stone-200 / 3px stroke in small sizes) with a ~270° rounded-cap arc in green-600,
  rotated -90° so progress starts at 12 o'clock. SVG recipe used everywhere:
  `<circle r stroke=track/> + <circle r stroke=fill stroke-dasharray="C*pct C*(1-pct)" stroke-linecap=round transform=rotate(-90)/>`.

## 8. Anti-default guardrails (checked during design — keep honoring them)

No cream+serif+terracotta · no near-black+acid-green · no gradient meshes · no
glassmorphism cards · no emoji-as-iconography · no left-border accent cards · mono only
for codes · SF Rounded only for large numerals · red only for revoked/destructive.
