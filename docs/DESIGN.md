# Bali design (DESIGN.md)

How Bali's user-facing surfaces look, sound and move, written for the agents
that build them. It follows the nine-section DESIGN.md format from Google
Stitch (the one [awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
collects), plus Bali's design tooling at the end.

**Scope: user-facing UI only.** That means the portal's pages and components
(`apps/web/src/app`, `apps/web/src/components`), the student app's screens
(`ios/Bali/UI`), the shield (`ios/BaliShield`), a future demo site, and the
words any of them show. It never covers the API, `packages/`, `apps/web/src/lib`
or the iOS engine and outbox.

**Sources, and who wins.** The source of truth is the
[Bali Design System](https://claude.ai/artifact/UPEBLz6nAmGXrzYnQ75qVz)
(`docs/DECISIONS.md`, 2026-09-20). Its token export sits in the repo, byte for
byte, at `ios/Bali/UI/bali-tokens.json`. Where this file and the tokens
disagree on a value, the tokens win: fix this file. The approved screen designs
(D1, the student app, `docs/PLAN.md`) win over both for the screens they draw.
Changing any of it is the owner's call, made on a design canvas, never a
side effect of a PR.

**Where it stands today:** the iOS app draws from the tokens (`Theme.swift`,
pinned by `AppTests.tokens`). The portal does not yet: it is Tailwind v4 with
its defaults and a system font. Bringing the tokens into the portal is a later
planned step.

## 1. Visual theme and atmosphere

**The mirror, not the cage.** Bali locks a classroom's phones into focus, so
its design has a delicate job: feel calm, warm and on the student's side while
doing something students won't always love. Every visual decision serves
honesty without harshness.

- **Calm authority, never alarm.** It is used at 8am in real classrooms.
  Nothing flashes, nothing screams. Even the emergency state is warm.
- **Honesty is the brand.** The teacher's grid never claims what it can't
  verify: muted states look muted, staleness is labelled, silence is never
  painted green.
- **Shame-free.** Emergency Unlock is a sanctioned exit and looks like one:
  warm orange, round and friendly, never red, never a warning triangle.
- **Warm, not corporate.** Paper-warm stone neutrals, an evergreen brand, warm
  shadow blacks. Never blue-grey, never pure black, never acid green.

Density: the teacher's live grid is dense (many students at a glance); the
student app is airy and simple. Theme: **light**. D1 was approved light-only,
and the app renders light in every appearance. The tokens carry designed dark
values, unused until a plan step adopts them.

## 2. Colour palette and roles

Use the semantic tokens; the primitives (green, stone, orange, blue, red,
50–950) exist to be referenced by them. Light values:

| Role | Token | Light |
| --- | --- | --- |
| Page background | `surface-page` | stone-50 `#F7F5F2` |
| Cards, sheets | `surface-card` | `#FFFFFF` |
| Wells, inputs | `surface-sunken` | stone-100 `#EFECE7` |
| Brand block | `surface-brand` | green-700 `#245A43` |
| Hairlines, card edges | `border-default` | stone-200 `#E3DFD8` |
| Emphasis borders | `border-strong` | stone-300 `#D2CCC2` |
| Primary ink | `text-primary` | `#211F1B` |
| Supporting ink | `text-secondary` | `#5B564E` |
| Captions, labels | `text-tertiary` | stone-600 `#6B665D` |
| Disabled only | `text-disabled` | stone-400 `#ABA59A` |
| Brand text, links | `text-brand` | green-700 `#245A43` |
| Primary button | `action-primary-bg` / `-hover` / `-fg` | green-700 / green-800 / `#FFFFFF` |
| Destructive button | `action-destructive-bg` / `-fg` | red-600 `#A93D31` / `#FFFFFF` |
| Countdown arc | `arc-fill` / `arc-track` / `arc-final2` | green-600 / stone-200 / green-400 |
| Focus ring | `focus-ring-color` | green-600 `#2C6F51` |

**The seven states** are the heart of the product: every surface shows a
student with the same chip, always colour + icon + label, never colour alone.

| State | Label | Tokens | Icon (lucide / SF Symbol) |
| --- | --- | --- | --- |
| not_joined | "Not in" | `state-notjoined-*` | circle / circle |
| focused | "Focused" | `state-focused-*` | circle-check / checkmark.circle.fill |
| pass | "Pass" | `state-pass-*` | ticket / ticket |
| emergency_unlocked | "Unlocked" | `state-emergency-*` | lock-open / lock.open |
| revoked | "Permission off" | `state-revoked-*` | shield-off / shield.slash |
| no_device | "No device" | `state-nodevice-fg`, dashed `border-default`, no fill | smartphone / iphone.slash |
| ended | "Ended" | `state-ended-*` | flag / flag |

The words for a state are decided per surface, and several are owner rulings
(`docs/PLAN.md`, `docs/DECISIONS.md`): the portal's grid says "Protection off",
the student app says "Screen Time off". Staleness ("last seen 4m ago") is a
badge on any state, never a state of its own, and never a reason to keep
showing green.

**Colour rules (law):**

- **Red is reserved** for exactly two things: the revoked (protection off)
  state and destructive actions. Nowhere else, ever.
- **Emergency is warm orange**, never red: the unlock is allowed, and the
  colour must say so.
- **Blue belongs to passes** and nothing else.
- **Contrast is pre-solved.** Every chip's ink on its fill is at least 4.5:1.
  Don't remix the pairs; `text-tertiary` is stone-600 because stone-500 fails
  AA at small sizes.

## 3. Typography rules

- **Families:** Instrument Sans on the web; the system font (SF Pro) on iOS at
  the same sizes, scaled with Dynamic Type (`docs/DECISIONS.md`: the shield
  takes no custom font, so the app matches it). JetBrains Mono for join codes
  only. Large numerals: ui-rounded / SF Pro Rounded.
- **Numerals:** every data and countdown numeral is `tabular-nums`.

| Style | Size / line | Weight | Use |
| --- | --- | --- | --- |
| display | 56 / 60, −0.02em | 600 | Marketing hero only |
| h1 | 32 / 38, −0.01em | 600 | Page titles |
| h2 | 24 / 30 | 600 | Section titles, sheet headers |
| h3 | 18 / 24 | 600 | Card titles |
| body-lg | 17 / 26 | 400 | Lead paragraphs, student-facing copy |
| body | 15 / 22 | 400 | Default body |
| caption | 13 / 18 | 400 | Timestamps, helper text (`text-tertiary` or darker) |
| label | 12 / 16, +0.06em, uppercase | 600 | Chips and micro-labels |
| data | 14 / 20 | 500 | Tables and stats, tabular |
| data-lg | 28 / 32, rounded | 600 | Medium countdowns, tabular |
| code | 14 / 20, mono | 500 | Join codes only |

## 4. Component stylings

- **Primary button:** `action-primary-bg`, white label, hover or pressed
  `action-primary-bg-hover`, no shadow. On iOS (D1): full width, 56 pt tall,
  `radius-md`, a 17 semibold label, dimmed to 60% while disabled or busy. On
  the web, `radius-sm` per the tokens.
- **Secondary button:** the primary's shape, `surface-card` with a
  `border-strong` stroke and `text-primary` ink; pressed, `surface-sunken`.
- **Destructive button:** `action-destructive-*`, only for removing a student
  or deleting a class.
- **Emergency Unlock control:** warm orange, `radius-full`, a hold-to-release
  spring-back (the `spring` easing). Always reachable when the shields are on.
- **Card:** `surface-card`, `radius-lg`, `shadow-1`, 20 pt padding on iOS
  (D1). Use a card only when elevation means hierarchy; otherwise group with
  spacing or a hairline.
- **State chip:** the state's fill and ink, its icon, the `label` style in
  uppercase, 6 × 12 padding, `radius-md`.
- **Inputs:** `surface-sunken` well, label above, helper and error text below;
  focus shows the focus ring.
- **The mark:** the session arc as emblem: a green-200 track ring and a
  green-600 arc (~330° with its round caps), open at the upper left. Never
  recolour it, never close the arc. D1 uses it without its stone-50 tile.
- **Every error path** says what happened and offers a way to retry, right
  where it happened (CLAUDE.md: no silent failures).

## 5. Layout principles

- **4-point grid**, px on the web and pt on iOS; nothing sits off-grid.
  Spacing tokens: `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 ·
  `space-5` 20 · `space-6` 24 · `space-8` 32 · `space-10` 40 · `space-12` 48 ·
  `space-16` 64.
- **iOS (D1):** the page colour to the edges, 24 pt side gutters, content
  16 pt below the status bar; a screen scrolls only once the phone's text size
  outgrows it, so no line is ever cut off.
- **Web:** 40 px page gutters on desktop; the live grid is the page's main
  object, laid out with CSS Grid.
- **Radii:** `radius-xs` 6 (small controls, badges) · `radius-sm` 10 (buttons,
  inputs) · `radius-md` 14 (cards, chips) · `radius-lg` 20 (sheets, hero
  containers) · `radius-full` (pills and Emergency Unlock). One system, used
  everywhere.

## 6. Depth and elevation

- Light mode uses soft warm shadows (warm black, never blue-grey):
  `shadow-1` for resting cards, `shadow-2` for popovers, `shadow-3` for modals
  and sheets.
- **Focus ring, everywhere, no exceptions:** a 2 px page-colour gap, then a
  2 px `focus-ring-color` ring.
- Dark values (for later): elevation from lighter surfaces and hairlines, not
  shadows; state inks move to the 300 step; tints are hand-mixed, never alpha
  overlays.

## 7. Do's and don'ts

**Do**

- Show every state as colour + icon + label.
- Keep motion inside its budget: `fast` 150 ms (a chip's crossfade), `base`
  200 ms (toasts, sheets), `slow` 300 ms (the ceiling for everything else),
  `arc` 600 ms (the one theatrical moment: the countdown arc drawing in).
  Easing `standard` `cubic-bezier(0.2, 0, 0, 1)`; `spring`
  `cubic-bezier(0.34, 1.3, 0.64, 1)` for Emergency Unlock's spring-back.
- Turn all animation off under `prefers-reduced-motion` (on iOS, Reduce
  Motion): fades become instant.
- Write short, warm, second-person copy: "You're in." Never blame, never alarm,
  never an exclamation mark. The student always holds the exit, and the copy
  sounds like it.
- Use sentence case for headings and buttons.
- Show real data in product UI; label an example or a mock as one.

**Don't**

- Use red for anything but protection off and destructive actions, or blue for
  anything but passes.
- Pulse or loop anything. The emergency chip may pulse softly exactly twice
  (`bali-softpulse`, 1.2 s × 2), never forever.
- Use pure black, blue-grey neutrals, purple-to-blue gradients, neon glows,
  glassmorphism for decoration, or emoji in the UI.
- Paint silence or staleness green, or show a state the server can't vouch for.
- Add an animation library, font, icon set or component kit without a plan
  step that names it.
- Add new em-dashes to user-facing strings. Existing ones stay until the
  owner's em-dash cleanup; don't strip them piecemeal in unrelated PRs.

## 8. Responsive behaviour

- **iOS:** one column, Dynamic Type everywhere (the type scale scales with the
  phone's text size), screens scroll once the text outgrows them, and touch
  targets are at least 44 pt (buttons are 56).
- **Web:** the portal is desktop-first (a teacher at a desk or on a projector)
  and must still work on a tablet. The grid reflows by column count, never by
  shrinking chips or text below the type scale. Mobile collapse is declared per
  layout, not assumed.

## 9. Agent prompt guide

Before building user-facing UI, read this file, then the screen's approved
design if it has one. Then:

- **Name the design read** in one line before code, as
  `design-taste-frontend` §0 asks. For example: "the teacher's live grid, for a
  teacher mid-lesson, calm and dense, in the Bali Design System."
- **Use the dials for product UI:** `DESIGN_VARIANCE 3`, `MOTION_INTENSITY 2`,
  `VISUAL_DENSITY 7` on the live grid and 4 elsewhere. The demo site sets its
  own when it is built.
- **Use tokens, never raw values.** A value the tokens lack is a question for
  the owner, not an invention.
- **Look before shipping** (web): run the portal (`npm run dev -w @bali/web`),
  take a Playwright screenshot of the changed page, and check it against this
  file.
- **Run the checks** listed under Design tooling before `/santa-loop`.

Example prompts that fit this system:

- "Add a 'Last seen' badge to a student's chip on the live grid: `caption` in
  `text-tertiary`, beside the chip, never replacing it; no colour change."
- "Draw the student's session-over screen: the mark at 72, an h1, a body-lg
  line, one primary button; light; no animation beyond a 200 ms fade."

## Design tooling

Copied into `.claude/skills/` at a fixed upstream version, each with a Bali
block at its top that limits it to user-facing UI and puts this file first.
They are **for user-facing UI only**; a task that touches no UI never loads
them.

| Skill | When | Source |
| --- | --- | --- |
| `design-taste-frontend` | Designing or building any UI. The portal and the app take its product-safe parts; the demo site takes all of it | [taste-skill](https://github.com/Leonxlnx/taste-skill) v2, MIT |
| `redesign-existing-projects` | Auditing an existing screen for a design step; its fixes happen only inside an approved plan step | taste-skill, MIT |
| `minimalist-ui`, `high-end-visual-design`, `industrial-brutalist-ui` | Style options, for the owner's comparison on a design canvas only. The pick is written into this file; the other two are deleted | taste-skill, MIT |
| `full-output-enforcement` | Any UI deliverable: no placeholders, nothing left unfinished | taste-skill, MIT |
| `image-to-code` | Dormant: the demo site, once an image-generation tool is set up | taste-skill, MIT |
| `web-design-guidelines` | Reviewing the portal's UI; `/santa-loop` runs it on PRs that touch it (WARNs only) | [Vercel](https://github.com/vercel-labs/web-interface-guidelines), MIT, rules pinned in `rules.md` |

**Updating one:** copy the newer upstream file over it, put its Bali block and
`description` prefix back, update the pinned commit in the block, and say why
in `docs/DECISIONS.md`. Prettier skips these folders (`.prettierignore`), so an
update is a clean diff.
