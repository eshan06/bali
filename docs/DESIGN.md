# Bali design (DESIGN.md)

How Bali's user-facing surfaces look, sound and move, written for the agents
that build them. It follows the nine-section DESIGN.md format from Google
Stitch (the one [awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
collects), plus Bali's design tooling at the end.

**Scope: user-facing UI only.** That means the portal's pages and components
(`apps/web/src/app`, `apps/web/src/components`), the student app's screens
(`ios/Bali/UI`), the shield (`ios/BaliShield`), the Cognito sign-in page (its
logo and CSS; D2d, `docs/PLAN.md`), a future demo site, and **user-facing
strings wherever they live**. Several live outside those folders (found by
grep, 2026-10-05; a new one joins this list). In
`ios/BaliOutbox/Sources/BaliOutbox/`: `ShieldWords.swift`; the `words` in
`Screen.swift` and `Join.swift`, sign-in's included; `FocusWords` in
`Focus.swift`; `UnlockedWords` in `Unlocked.swift`; `ProtectionOffWords` in
`ProtectionOff.swift`; History's row labels and refusals in `History.swift`;
Me's name, leave and `SignOutWords` sentences in `Me.swift`; Delete account's
question, its screen's titles and lines in `Deleting` (`Deletion.swift`), the gap's fallback's
included; the 13+ stop screen's title and line in `AgeCheck` (`Age.swift`); and the two
refusals `SyncEngine.swift` hands a screen ("Bali couldn't save your reason.
Try again.", "Bali couldn't lock your apps. Try again."). In
`apps/web/src/lib`: `errors.ts`; `grid-state.ts` (the grid's notes and
badges); `api-client.ts` (`UnauthorizedError`'s words; a `NetworkError` is
said as `errors.ts`'s `CANT_REACH`, its own message a log line, D2c-2);
`recap.ts` ("No reason given", the reasons, and the session's "9:05 AM to
9:30 AM"). `blocks.ts`, `classes.ts`, `reports.ts` and `invite.ts` hold none:
their words are in `blocks.tsx`, the classes home (`app/page.tsx`), the
reports page, `invite-code.tsx` and `errors.ts`. In
`ios/Bali/` outside `UI/`: the NFC sheet's words in `BlockReader.swift`
("Hold the top of your iPhone to your teacher's Bali block.", "This isn't a
Bali block.", "Bali block read.", "A scan is under way."); the `problem` a
start that failed shows in `BaliApp.swift` (RootView's "Bali couldn't start"); and
`Info.plist`'s `NFCReaderUsageDescription`, iOS's own NFC prompt. The
Debug readout's words are not user-facing. Their voice follows this file;
their logic does not. It never
covers the API, `packages/`, or `apps/web/src/lib` and the iOS engine and
outbox beyond those strings.

**Sources, and who wins.** The source of truth is the
[Bali Design System](https://claude.ai/artifact/UPEBLz6nAmGXrzYnQ75qVz)
(`docs/DECISIONS.md`, 2026-09-20). Its token export sits in the repo, byte for
byte, at `ios/Bali/UI/bali-tokens.json`. Where this file and the tokens
disagree on a value, the tokens win: fix this file. A usage note is not a
value: the notes on `radius-sm` ("Buttons, inputs"), `radius-md` ("Cards,
chips"), `radius-lg` ("Sheets, hero containers") and `space-5` ("Sheet
padding") predate the pick and follow it at the owner's next export. The
style is the owner's
pick on the
[Bali style canvas (D2a)](https://claude.ai/artifact/MVBkdwGKFHKUtEEsEC94sd)
(2026-10-04; `docs/DECISIONS.md`, 2026-10-05): its B artboards and its answers
to Q2–Q7 are the reference for what this file says about it. The approved
screen designs win over both for the screens they draw: D1 for the student app
(`docs/PLAN.md`), with the app's
[Sign in & sign up](https://claude.ai/artifact/McyYhpX1UTq1nU6oCCwPwG) for Sign in, the 13+
question, the intro, the gap's fallback, Your name and Home in no class (the owner, 2026-10-06
and 2026-10-07; drawn in D1's look), and for
the portal the four canvases below. Changing any of
it is the owner's call, never a side effect of a PR: every user-facing screen
is designed in Claude Design and approved by the owner before it is built
(CLAUDE.md, Working rules).

**The portal's approved designs** (the owner, 2026-10-06; `docs/DECISIONS.md`):
[Entry & info](https://claude.ai/artifact/K7vJUJLDNpHgtZV9cYcXbF) (sign-in, the
callback, the invite code, Cognito's pages, Help and the policy pages),
[Classes home](https://claude.ai/artifact/Shc2dz4xn8Qc9iDHDuYT2N),
[Class page & live grid](https://claude.ai/artifact/662Zkg7urbM64BXvNbq2GX) and
[Recap & reports](https://claude.ai/artifact/BuiyWgXpVNkhPR8osDBcHZ). They
replace D2's look of the portal, built on its code in PB1–PB5 (`docs/PLAN.md`).
A design draws only what the backend does today, and only the screens Phases 2
to 6 ask for: it never promises what the API lacks. The portal is designed
desktop-first: no phone layout is drawn but where students arrive from the app
(Cognito's pages, Help and the policy pages), and no page may break on a phone
or a tablet (§8).

**Where it stands today:** the iOS app draws from the tokens (`Theme.swift`,
pinned by `AppTests.tokens`) in D1's shapes. Its Soft premium redraw (D2h–D2j)
was rolled back on 2026-10-06, the owner's call on seeing it
(`docs/DECISIONS.md`): every app screen looks as it did before D2h, and a new
look for any of them waits for a design the owner approves. The words and the
fixes those steps made stayed (`docs/PLAN.md`, D2). The portal draws from them too, from D2c on
(`apps/web/src/app/globals.css`, pinned by `tokens.test.ts`): every semantic
token as a `--bali-*` variable (and the primitives they and the mark
reference), their light values on `:root` and only those (the portal is
always light since 2026-10-07, §1), and as Tailwind's theme
(`bg-surface-page`, `text-text-secondary`,
`rounded-md`, `p-4` for `space-4`, `text-h1`, `shadow-1`); Instrument Sans
and JetBrains Mono self-hosted through `next/font` (`fonts.ts`); lucide
(`lucide-react`) as the icon set; the buttons (`components/button.tsx`), the
mark and the lockup (`components/mark.tsx`), a link in running text
(`components/text-link.tsx`), the labelled text field
(`components/field.tsx`) and the cards (`components/card.ts`);
the focus ring on every control and all
animation off under reduced motion, both global rules. The entry pages are in
the picked style (D2c): the bar and `/login` (D2c-1), and the callback,
`/support`, the two policy pages and the invite-code screen (D2c-2); so are
the classes home and its "Your block" (D2e), the live grid (D2f-1: its
chips, states, `bali-softpulse`, badges and standard columns), the class
page with Present, its controls and its join code (D2f-2, D2f-3), and the
recap card and the reports page (D2g), which finished the portal. The owner
judged that look poor and approved four new designs (above): PB1 laid what they
share (no grey tray, `border-input`, `code-lg`, the field, the buttons'
pressed look, the nav link), PB2 redrew the entry and info pages (one card
centred under a bar that holds the lockup, `components/entry-page.tsx`; Help
and the policy pages under the same bar), PB3 the classes home (the classes
and their create row in one column, the block's card beside it), PB4a the
class page's live session (the bell's card, the grid's cells, Present's folded
header), PB4b the class page before a session (the length picker and Start in
one card, New code's confirm a raised card under the header, a Loading or Error
card in the session's place until the class is read), and PB5 the recap and the reports (the
session after the bell as a timeline of marks, `components/timeline.tsx`; the reports list a card
per session with its counts in their states' inks), which finished the four designs.
Every
portal source file is held to the tokens' utilities by `tokens.test.ts`, and
since D2g the theme holds none of Tailwind's own colours, type sizes,
tracking or leading, so a default draws nothing. **A portal page uses the
tokens' utilities and no Tailwind default** (no `slate-*`, no `text-sm`): a
value the tokens lack is a question for the owner.

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

**The style: Soft premium** (the owner's pick, 2026-10-04, Q1 B on D2a's
canvas; the `high-end-visual-design` skill's language, inside Bali's tokens).
The portal is drawn in it (D2c–D2g), and its approved designs of 2026-10-06
keep it, without the tray. The app is not: its redraw (D2h–D2j) was
rolled back on 2026-10-06, and it keeps D1's look. In this file's terms:

- **Cards straight on the page, no grey tray** (the owner's ruling,
  2026-10-06, which retired D2's tray). A card is `surface-card` with its own
  `border-default` hairline and `shadow-1` (§4, Card). No grey frame takes the
  tray's place.
- **Pills.** State chips, buttons and Emergency Unlock are `radius-full`;
  inputs keep `radius-sm`. Three radii do the work: 20 / 14 / full (§5).
- **A soft warm shadow.** `shadow-1` at rest, `shadow-2` on a raised disc or
  popover, `shadow-3` on sheets: warm black, never blue-grey, never a hard
  drop (§6).
- **Tinted chips on plain cells** (Q5 A). The chip is filled with its state's
  tint; the cell stays the card colour and the name stays `text-primary`.
- **Capped by the tokens.** No 2 rem radii, no glass, no gradient washes, no
  OLED black, no font but §3's, no icons but §2's (lucide, SF Symbols), motion
  inside §7's budget. Where the skill and this file disagree, this file wins.

Density: the teacher's live grid is dense (many students at a glance); the
student app is airy and simple. Theme: **light, everywhere.** The app and the
shield were approved light-only (D1; the owner kept them so on 2026-10-04,
Q6 A), and **the portal is light only too** (the owner, 2026-10-07: "remove
dark mode for now"): each renders light whatever the device's appearance,
native controls and scrollbars included. The portal followed the device's dark
mode from D2c to PB5; the approved canvases' dark boards no longer apply.

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
| Text field edges | `border-input` | stone-500 `#8A847A` |
| Primary ink | `text-primary` | `#211F1B` |
| Supporting ink | `text-secondary` | `#5B564E` |
| Captions, labels | `text-tertiary` | stone-600 `#6B665D` |
| Disabled only | `text-disabled` | stone-400 `#ABA59A` |
| Brand text, links | `text-brand` | green-700 `#245A43` |
| Primary button | `action-primary-bg` / `-hover` / `-fg` | green-700 / green-800 / `#FFFFFF` |
| Destructive button | `action-destructive-bg` / `-fg` | red-600 `#A93D31` / `#FFFFFF` |
| Countdown arc | `arc-fill` / `arc-track` / `arc-final2` | green-600 / stone-200 / green-400 |
| Focus ring | `focus-ring-color` | green-600 `#2C6F51` |

**`border-input`** is the owner's ruling (2026-10-06), not in the tokens yet:
every text field's edge, 3:1 against the card, the page and the field's own
well (WCAG 1.4.11), where `border-default` is 1.3:1. A refused field's edge
stays `text-primary`. Cognito's sign-in fields take it too
(`infra/cognito/hosted-ui/hosted-ui.css`, PB2a).
`globals.css` holds it, pinned by `tokens.test.ts`, until the design system's
next export carries it (`bali-tokens.json` is that export, byte for byte, never
edited by hand).

**The states** are the heart of the product: every surface shows a student's
state with a chip, always colour + icon + label, never colour alone. The design
system names seven states in its own (v2) ids; Bali's code has its own. Build
from the code's states, never the design system's ids: `@bali/shared`'s
`PARTICIPATION_STATES` and `DisplayState` (ARCHITECTURE rule 2), and the
portal's `GridDisplay` (`apps/web/src/lib/grid-state.ts`).

| Bali state (code) | Design-system state | Tokens | Icon (lucide / SF Symbol) | Words today |
| --- | --- | --- | --- | --- |
| `focused` | focused | `state-focused-*` | circle-check / checkmark.circle.fill | "Focused" |
| `unlocked` | emergency_unlocked | `state-emergency-*` | lock-open / lock.open | "Unlocked" |
| `protection_off` | revoked | `state-revoked-*` | shield-off / shield.slash | grid "Protection off"; app "Screen Time off" |
| `ended` | ended | `state-ended-*` | flag / flag | grid "Left" |
| `silent` (derived, never stored) | none: the design system has staleness as a badge only | `state-ended-*` fill and ink, with a 1 px dashed `border-strong` edge (Q3 A) | wifi-off / wifi.slash | grid "Silent · 2 min" (D2f): the whole minutes since the last check-in, in the label |
| grid `absent` / app "not in" | not_joined | `state-notjoined-*` | circle / circle | grid "Not here"; app "Not in" |
| app waiting (a tap before the Start, decision 5) | none | `state-notjoined-*` (D2i): no shield is on yet, so never green | clock / clock | Home's "Waiting" |
| app Screen Time back on (#167, a moment, not a state) | none | `state-notjoined-*` (D2j): the student goes back to focus or to an unlock, so never green | shield-check / checkmark.shield | History's "Screen Time back on" |
| grid `left_unprotected` | none | `state-emergency-*` (Q2 A) | flag, then lock-open | "Left · unlocked" |
| grid `left_protection_off` | none | `state-revoked-*` (Q2 A) | flag, then shield-off | "Left · protection off" |
| grid `unknown` | none | no fill (`state-nodevice-bg`), a 1 px dashed `border-strong` edge, `text-primary` ink (Q3 A) | circle-help / questionmark.circle | "Unknown · refresh": refresh is the action |
| none in v3 | pass (passes became an unlock's reason at launch) | `state-pass-*`, unused | ticket / ticket | none |
| none in v3 | no_device | `state-nodevice-*`, unused | smartphone / iphone.slash | none |

The words for a state are decided per surface, and several are owner rulings
(`docs/PLAN.md`, `docs/DECISIONS.md`): the grid's "Protection off" is the app's
"Screen Time off" (the owner's 2026-09-27 ruling replaced D1's "Permission
off"). `silent` is a real display state, derived from the last check-in and
never stored (data-model decision 7), so it is never green, and neither is
`unknown`; staleness short of silence ("last seen 4 min ago") is a `caption` in
`text-tertiary` under any chip, never a colour change: on the grid, under
a focused, unlocked or protection-off chip whose phone hasn't checked in for a
whole minute, and a focused one reads Silent from 90 s, its label carrying the
time from then (`lastSeenNote`, `grid-state.ts`). A grid chip says its state
alone; an unlock's reason sits on that line too, before "last seen" (PB4a, the
Class page design). Unknown's dashed edge
is `border-strong` on purpose, the pick's (Q3 A), where the borrowed
`state-nodevice-bg` token's own note says `border-default`. The two Left chips
each take their state's own colour (the owner's pick, 2026-10-04, Q2 A), and
ISSUES #2's reason still stands: a phone that left the roster while unshielded
must never read as the quiet "Left", so the icon and the label carry it, the
flag first and the state's icon after it. Two app chips the canvas did not
draw get their look in their screen group's step: Home's Waiting has its own
since D2i, the not-joined pair with a clock (a waiting phone is not in yet, so
it takes not in's colour, and the clock and the word say the tap counted and
the lock comes with the Start); History's "Screen Time back on" has its own
since D2j, the not-joined pair with Screen Time off's shield made whole and
checked (`Chip.Kind.protectionOn`): it puts the student back where they stood,
in focus or unlocked, so it is never focus's green. A sentence that tells the
student what their teacher sees says it in its own words and quotes neither
label (D2j): "your teacher sees that Screen Time is off", never "your teacher
sees “Screen Time off”", which the grid never says.

**Colour rules (law):**

- **Red is reserved** for exactly two things: the revoked (protection off)
  state and destructive actions. No exception stands: "Left · protection off"
  is the revoked state, so it is red, and "Left · unlocked" is emergency
  orange (the owner's pick, 2026-10-04, Q2 A). The grid painted both red until
  D2f-1 recoloured them (`apps/web/src/components/live-grid.tsx`).
- **Emergency is warm orange**, never red: the unlock is allowed, and the
  colour must say so.
- **Blue belongs to passes** and nothing else.
- **Contrast is pre-solved.** Every chip's ink on its fill is at least 4.5:1.
  Don't remix the pairs; `text-tertiary` is stone-600 because stone-500 fails
  AA at small sizes.

## 3. Typography rules

- **Families:** Instrument Sans on the web, self-hosted through `next/font`
  (the CSP has no `font-src`; D2c); the system font (SF Pro) on iOS at
  the same sizes, scaled with Dynamic Type (`docs/DECISIONS.md`: the shield
  takes no custom font, so the app matches it). JetBrains Mono for codes only,
  whatever is read symbol by symbol: join codes and teacher invite codes alike
  (the owner's ruling, 2026-10-05), and a block's ID. Large numerals:
  ui-rounded / SF Pro Rounded.
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
| code | 14 / 20, mono | 500 | Codes only: join codes, invite codes, block IDs |
| code-lg | 24 / 32, mono | 500 | The join code in Present only, read from the back of the room |
| input | 16 / 24 | 400 | Text typed in a field, on the web; a code typed in one is mono at 500 |

**The input size** is the owner's ruling (2026-10-05): iPhone Safari zooms
into a field whose text is under 16 px when it is tapped, so every portal
field types at 16 px, through the one field component (`components/field.tsx`),
the invite code, the block ID and the class name included; a code typed in one
keeps the code style's face and weight. It is for inputs only, never for text
around them, and it is not in the tokens yet: the next export of the design
system should gain it (`bali-tokens.json` is that export, byte for byte, so it
is never edited by hand), as it should the Present view's sizes (§5) and
`code-lg` (the owner's ruling, 2026-10-06, with the approved designs). The
class page's minutes field types in it too, on the Field since D2f-2.

## 4. Component stylings

- **Primary button:** `action-primary-bg`, `action-primary-fg` label, hover
  or pressed `action-primary-bg-hover`, no shadow; a pill (`radius-full`) in
  Soft premium. On iOS: full width, 56 pt tall, a 17 semibold label, dimmed
  to 60% while disabled or busy, at D1's `radius-md` (the app's pills were
  rolled back with D2h, 2026-10-06). On the web: 40 px tall, `space-4` side
  padding, a `body` semibold label.
- **Secondary button:** the primary's shape, `surface-card` with a
  `border-strong` stroke and `text-primary` ink; hovered, `surface-sunken`;
  pressed (Present, `aria-pressed`) or open (New code, `aria-expanded`),
  `surface-sunken` with a `text-primary` edge, the Button's own, never by
  colour alone. The class page's length picker draws each length as this pill
  and its pick pressed the same way, with a check.
- **Destructive button:** `action-destructive-*`, only for removing a student
  or deleting a class.
- **Emergency Unlock control:** a one-second hold, always (the owner's ruling,
  2026-09-29; D1's "Hold to unlock"). The second stops a pocket touch or a
  stray tap from filing an unlock the teacher sees, and still keeps it quick;
  letting go early does nothing. Never a confirmation, and no wait beyond that
  second. VoiceOver's action unlocks in one step, so the hold never stands
  between anyone and the exit. Warm orange, `radius-full`; the hold's progress
  is a ring, and the `spring` easing is its spring-back on an early release.
  Always reachable when the shields are on. Its words are D1's on two lines
  (D2i, kept in the rollback): "Hold to unlock" in the button's label style, "Your teacher will see
  it" under it in `body`, each one line at the default text size.
- **Card:** `surface-card` straight on the page, with its own
  `border-default` hairline and `shadow-1` at rest. **No grey tray** behind a
  card or a group of cards, and no other grey frame in its place (the owner's
  ruling, 2026-10-06;
  `components/card.ts`). Grey stays only where the approved designs keep it: a
  text field's well, the state chips' fills, the grid's stale banner, a
  button's hover and pressed states, and the policy draft's banner and badge.
  Cards in a list (the grid's cells, the classes, the reports) are
  `radius-md` with `space-4` padding, `space-2` apart; a card standing alone
  (sign-in, the invite code, the block's card, the recap, a sheet) is
  `radius-lg` with `space-6` padding (`space-5` on iOS); inside one, a list is
  rows between hairlines (the blocks). An empty list says so in a plain line in
  `text-secondary`, never in a box. The app draws no tray either: its cards
  stand alone as D1 drew them. Use a card only when elevation means hierarchy;
  otherwise group with spacing or a hairline.
- **State chip:** a pill (`radius-full`) filled with the state's tint, its
  icon and label in the state's ink, the `label` style in uppercase; padding
  `space-2` × `space-3` on the web (the tokens' values, kept by the owner's
  ruling of 2026-10-05 over the canvas's 4 × 10 px), and D1's 6 × 12 pt on
  iOS, at D1's `radius-md` there.
  Silent and Unknown add a 1 px dashed `border-strong` edge (§2). A chip
  never pulses but as §7 allows.
- **The grid's stale banner** ("Live feed has gone quiet…", drawn on D2a's
  canvas): stone, not amber. `surface-sunken` with a `border-default`
  hairline and `text-primary` ink, at `radius-sm`: the grid is honest, not
  alarmed.
- **Inputs:** `surface-sunken` well with a `border-input` edge (§2), label
  above, helper and error text below; focus shows the focus ring, and a
  refusal draws the edge in `text-primary`, never red. What is typed is the
  input size (§3), 16 px, so
  iPhone Safari never zooms in; a label is always a real label, never a
  placeholder standing in for one. A button that acts on one field (the
  classes home's Create class) may sit on the input's row, wrapping under it
  on a narrow form (the Field's `trailing`). A refusal of what was typed sits
  right under the input, before the help (the Field's `refusal`), and any
  other answer right above the button that retries it: the invite code (PB2),
  so an error never reads as help. The app keeps D1's fields (2026-10-06's
  rollback): Join's code a white field whose border turns green while typing,
  the age screen's menus drawn as that field, Your name's field drawn as it too
  in the name's type (the approved Sign in & sign up design), Me's name a sunken
  well with the same green edge.
- **Links:** `text-brand`, medium, underlined, so a link never rests on colour
  alone: the portal's `TextLink` (`components/text-link.tsx`). A link across
  the portal (All classes, Reports, back to the class) is `text-brand`
  semibold beside its 16 px arrow, which carries it at rest, underlined on
  hover (`NAV_LINK`). The app's policy
  links (`PolicyLinks`, C2-app) keep their look from before D2h, `caption` in
  the brand's ink and no underline: on colour alone, a known gap until the
  owner approves the app's next design.
- **The mark:** the session arc as emblem: a green-200 track ring and a
  green-600 arc (~330° with its round caps), open at the upper left. Never
  recolour it, never close the arc. D1 uses it without its stone-50 tile.
- **The app icon and the portal's icon** are the mark on its stone-50 tile (the
  owner's pick, 2026-10-04): track r 240 and arc stroked 100 on a 1024 square, the
  mark's geometry ×10. One source, `apps/web/public/icon.svg`, opaque and unrounded
  (iOS rounds it); the app's `AppIcon` and the portal's PNGs are renders of it.
- **Every error path** says what happened and offers a way to retry, right
  where it happened (CLAUDE.md: no silent failures). Error text is a sentence
  in `text-primary` beside its retry, never red (red is protection off and
  destructive actions, §2): the portal's shipped `text-red-600` lines change
  in D2c and the screen-group steps, not before.

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
- **The grid's density** (the owner's pick, 2026-10-04, Q4): **standard** is
  six columns at the desktop width, cells straight on the page, the name in `body`
  (15 px) over the chip in `label` (12 px). **Present**, a toggle in the
  grid's header (a secondary pill whose pressed state is shown, never by
  colour alone), switches into the **projector view**: four columns, names at
  20/28 semibold, chip labels at 14/20, cells at least 88 px tall, readable
  from the back of a classroom; the same chips and words, but an unlock's
  reason (below). Those two
  sizes are a Present-only style on the type scale (the owner's ruling,
  2026-10-05): names 20 px and labels 14 px, as drawn, with their line
  heights on the 4-pt grid (the canvas drew 26 and 18; D2f-2 took them up to
  28 and 20, never tighter than drawn, 14/20 being the scale's own pair for
  14 px: `text-present-name`, `text-present-label`), and the design system
  gains them when the owner next exports it. The grid reflows by column count
  below the desktop width, never by shrinking type: as many columns as fit,
  each at least 212 px, so six at 1440, in the class page 1400 px wide at most
  (PB4a); Present's four from a 56 rem grid, three and then two narrower. In Present the page's header folds the bell, the
  join code in `code-lg` and the controls into one row, so a class of 28 fits
  one 1080p screen.
- **Present never shows an unlock's reason**, because the class can see it:
  no line under "Unlocked" where the teacher's view says "Nurse" there
  (2026-10-06).
- **A session that ends in Present stays so** (D2g): the recap lists each unlock
  by who and when with no reason, How it ended is the projector view, and the
  toggle beside it leaves Present, the reasons back.
- **Present is kept for the browser tab** (2026-10-06), class by class: a
  reload or a return from Reports comes back in it until the teacher turns it
  off, and another class's page, a new tab or a new window opens without it;
  back in it with no session running, the recap carries the toggle at the end
  of its header.
- **Radii:** `radius-xs` 6 (small badges) · `radius-sm` 10 (inputs) ·
  `radius-md` 14 (cards in a list) · `radius-lg` 20 (sheets, a card on its
  own) · `radius-full` (chips, buttons and Emergency Unlock). One system,
  used everywhere. These roles are this file's (the pick): the tokens win on
  values, and their usage notes still name `radius-sm` for buttons and
  `radius-md` for chips until the owner next exports the design system.

## 6. Depth and elevation

- Light mode uses soft warm shadows (warm black, never blue-grey):
  `shadow-1` for resting cards, `shadow-2` for popovers, `shadow-3` for modals
  and sheets.
- **Focus ring, everywhere, no exceptions:** a 2 px page-colour gap, then a
  2 px `focus-ring-color` ring.
- Dark values: the tokens carry them, and nothing renders them. The app, the
  shield and, since 2026-10-07, the portal are light only (§1).

## 7. Do's and don'ts

**Do**

- Show every state as colour + icon + label.
- Keep motion inside its budget: `fast` 150 ms (a chip's crossfade), `base`
  200 ms (toasts, sheets), `slow` 300 ms (the ceiling for everything else,
  `bali-softpulse` excepted, below), `arc` 600 ms (the one theatrical moment:
  the countdown arc drawing in).
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
- Pulse or loop anything. The one pulse is `bali-softpulse` (defined below):
  the emergency chip, exactly twice, never forever.
- Use pure black, blue-grey neutrals, purple-to-blue gradients, neon glows,
  glassmorphism for decoration, or emoji in the UI.
- Paint silence or staleness green, or show a state the server can't vouch for.
- Add an animation library, font, icon set or component kit without a plan
  step that names it.
- Add new em-dashes to user-facing strings. Existing ones go in D2's screen
  group steps, each cleaning the strings it owns (the owner's em-dash cleanup,
  `docs/PLAN.md`); don't strip them piecemeal in unrelated PRs.

**`bali-softpulse`** (the owner's pick, 2026-10-04, Q7 A: a glow ring). When
an Emergency Unlock lands on the grid, its chip's ring swells and fades, 1.2 s
× 2, then is still: a `box-shadow` ring of orange-400 at 35%
(`rgba(219,147,71,0.35)`; the token's own note names it the soft-pulse glow),
from 0 to 6 px at the midpoint and back. Nothing moves and the chip's shape
stays. Easing `standard`, exactly two iterations, never a loop, and nothing at all under
reduced motion. The student's own Unlocked chip never pulses: the pulse is
the teacher's cue.

```css
:root { --bali-softpulse-glow: rgba(219, 147, 71, 0.35); } /* orange-400 */
@keyframes bali-softpulse {
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  50% { box-shadow: 0 0 0 6px var(--bali-softpulse-glow); }
}
.chip-emergency.just-unlocked { animation: bali-softpulse 1.2s cubic-bezier(0.2, 0, 0, 1) 2; }
@media (prefers-reduced-motion: reduce) { .chip-emergency.just-unlocked { animation: none; } }
```

(D2c's theme variables carry the glow; the snippet names it so it stands
alone.) In the portal (D2f-1) it is the `animate-softpulse` utility
(`globals.css`, pinned by `tokens.test.ts`), on the chip of an unlock the stream
brings while the grid is open, orange only (`softpulses`, `grid-state.ts`), once
per unlock: never one the grid booted with or the stream's overlap replays, never
a red chip.

## 8. Responsive behaviour

- **iOS:** one column, Dynamic Type everywhere (the type scale scales with the
  phone's text size), screens scroll once the text outgrows them, and touch
  targets are at least 44 pt (buttons are 56).
- **Web:** the portal is designed desktop-first (a teacher at a desk or on a
  projector; the owner's ruling, 2026-10-06: its approved designs draw no phone
  layout but where students arrive from the app), and no page may break on a
  phone or a tablet. The grid reflows by column count, never by
  shrinking chips or text below the type scale. Mobile collapse is declared per
  layout, not assumed. The reports list (D2g, PB5b) is a card per session: one row
  under the column names where the session and its six figures
  fit (the list 56 rem wide, a 1024 px window included); narrower, each figure
  sits under its own name, three to a row and then two. Never a table that
  scrolls sideways. The recap's timeline (PB5a) keeps each name beside its row
  from a 40 rem card, and over it narrower; its axis shows every other time
  under 64 rem and only its ends under 28 rem, so no two labels touch. Its marks
  never overlap while the row has room for them, at any width: one too close to
  the mark before it sits right after it, moved no further than it must be
  (`lefts`, 2026-10-07), so each is seen and hovered on its own, and its card
  opens toward the middle from where the mark sits.

## 9. Agent prompt guide

Before building user-facing UI, read this file, then the screen's approved
design if it has one. Then:

- **Name the design read** in one line before code, as
  `design-taste-frontend` §0 asks. For example: "the teacher's live grid, for a
  teacher mid-lesson, calm and dense, in the Bali Design System."
- **Build with both skills:** `design-taste-frontend` for the read, the
  discipline and the tells; `high-end-visual-design` for Soft premium's shape
  language (the pills, the soft shadow, the spacing rhythm; never a tray, §4)
  on the portal, under its approved designs; an app screen follows its
  approved design. Where
  either disagrees with this file, this file wins; neither's fonts, palette,
  icons or motion override the tokens.
- **Use the dials for product UI:** `DESIGN_VARIANCE 3`, `MOTION_INTENSITY 2`,
  `VISUAL_DENSITY 7` on the live grid and 4 elsewhere. The demo site sets its
  own when it is built.
- **Use tokens, never raw values.** A value the tokens lack is a question for
  the owner, not an invention.
- **Write the words with `no-ai-slop`:** draft each new or changed string in
  this file's voice, then run the skill's Edit job on it and check it against
  its `eval.md`. Its Bali block says what it may and may not change.
- **Look before shipping** (web): run the portal (`npm run dev -w @bali/web`),
  screenshot the changed page with the `playwright` CLI (installed in cloud
  sessions; elsewhere `npx playwright`), and check it against this file.
  Never add Playwright to a `package.json` for this.
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
| `high-end-visual-design` | Bali's style, Soft premium (the owner's pick on D2a's canvas, 2026-10-04): used alongside `design-taste-frontend` whenever UI is designed or built, under this file (§1, The style). This file wins where they disagree, and its fonts and palette never override the tokens. The two style options not picked were deleted with the pick (`docs/DECISIONS.md`, 2026-10-05) | taste-skill, MIT |
| `full-output-enforcement` | Any UI deliverable: no placeholders, nothing left unfinished | taste-skill, MIT |
| `image-to-code` | Dormant: the demo site, once an image-generation tool is set up | taste-skill, MIT |
| `web-design-guidelines` | Reviewing the portal's UI; `/santa-loop` runs it on PRs that touch it (WARNs only) | [Vercel](https://github.com/vercel-labs/web-interface-guidelines), MIT, rules pinned in `rules.md` |
| `no-ai-slop` | Writing or changing any user-facing string, wherever it lives: its Edit job on your own draft, checked against its `eval.md`; `/santa-loop` runs its Detect job over a PR's changed strings (WARNs only). This file's voice and the owner's ruled words win | [petergyang/no-ai-slop](https://github.com/petergyang/no-ai-slop), MIT, its checks pinned in `eval.md` |

**Updating one:** copy the newer upstream file over it, put its Bali block and
`description` prefix back, update the pinned commit in the block, and say why
in `docs/DECISIONS.md`. Prettier skips these folders (`.prettierignore`), so an
update is a clean diff.
