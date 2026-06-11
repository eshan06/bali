# 03 · Component Inventory

> Visual reference with every state rendered: `design-files/Pass 2 - Component Sheet.html`.
> Reusable CSS that implements all of these in the prototypes: `design-files/pass2/components.css`
> (class prefix `fc-`). Sizes are px on web ≡ pt on iOS. Components are shared concepts
> with per-platform execution — map to shadcn primitives on web, SwiftUI views on iOS.

---

## StatusChip — the hero component

**Anatomy:** state icon · student first name + last initial (600 weight) · state label or
live countdown (500 weight, tabular numerals) · optional staleness badge ("4m", 11/600 in
a translucent pill) · optional pass timer.

**Sizes:**
| size | spec | where |
|---|---|---|
| grid | 42px tall, padding 10/16, icon 18, name 16/600, label 16/500, radius full | web LiveGrid — legible at 3–4 m |
| projector | 52px tall, padding 13/20, icon 22, text 20/600 | W4 full-screen variant |
| row | 48pt list row: icon 22 (state-colored), name 17/400 primary, label right-aligned 15/500 state-colored + chevron | iOS lists |
| mini | 26px tall, padding 4/11, icon 13, text 13/600 | banners, summary strips |
| phone-grid | 46pt, 2-col: icon 16 + name 15/600 + label 12/500 stacked | T2 (teacher phone grid) |

**States:** all 7 canonical states (colors per `02-design-tokens.md`) plus:
- `stale`: icon+label at 60% opacity + "4m" badge (bg `rgba(22,21,19,0.08)` light / `rgba(241,239,235,0.1)` dark)
- `selected` (panel open): ring `0 0 0 2px page, 0 0 0 4px focus-ring-color`
- `hover`: brightness(0.965) light / brightness(1.18) dark, cursor pointer
- `pressed`: brightness(0.93)
- `keyboard focus`: standard focus ring; chips are tabbable (`tabindex="0"`), Tab order = roster order

**VoiceOver:** "Aisha K, pass, 4 minutes 32 seconds remaining, last seen 4 minutes ago.
Button." State before staleness; countdown announced once, not per tick.

---

## SessionCountdown — the arc

The product's one signature motif. SVG: circle track + rounded-cap dasharray arc,
rotated −90° (progress from 12 o'clock). Time text in SF Pro Rounded / `--font-num`,
semibold, tabular.

| size | spec | where |
|---|---|---|
| hero | 244pt ring, 10pt stroke; time 56pt; "until 10:45" 15pt secondary below | S6 Focus Active |
| hero (XL type) | 218pt, type ×1.24 | S6 accessibility variant |
| medium | 44px ring, 5pt stroke + adjacent block: time 28/32 data-lg + "ends 10:45 AM" caption | teacher headers (W4, T2, portal 46px) |
| micro | 18px ring, 3px stroke, currentColor; replaces state icon in a chip while a pass ticks | pass chips |
| banner | 36–40pt ring, 4–4.5pt stroke | S3 StatusBanner lead |

**Final 2 minutes:** stroke 10→12pt, fill shifts to `--arc-final2` (green-400 light /
green-300 dark), numerals lift one step brighter (green-200 on dark). NO red, no pulsing.

**Draw-in:** once, 600ms, on tap-in only (the one theatrical moment). Implementation in
prototypes: animate `stroke-dashoffset` from full circumference C to `C*(1-pct)` with
`transition: stroke-dashoffset 1100ms cubic-bezier(0.3,0,0.2,1)` after a double-rAF.
Reduced motion: render at final position.

**Ticking:** update text + dashoffset every 1s with transition disabled (no tween between
seconds — tabular digits mean zero layout shift).

**VoiceOver:** "Session countdown. 23 minutes 14 seconds until 10:45 AM." Announce at
start, then only on minute boundaries ≤5 min. Final-2 shift announced once: "Two minutes left."

---

## EmergencyUnlockControl

Full-width, 60pt tall (64pt where label wraps to 2 lines; 76pt at XL type), radius full.
Resting: bg `#2A2723`, border 1px `#3C3934`, text `#F1EFEB` 600. Label ALWAYS visible and
reads exactly: **"Hold to unlock — your teacher will be notified"** (with lock-open icon
18). At 393pt frames the label wraps to two centered lines (15/20) — never clip it.

**Hold interaction (1.0s):**
- 0%: resting.
- Holding: an orange fill (`--orange-400 #DB9347`) grows edge-to-edge, `width` 0→100%
  linear over 1s; the label inside the fill region renders in ink `#2B1604`
  (implementation: duplicate label clipped inside the fill element, width locked to the
  control's width). iOS haptics ramp light→medium ticks.
- Release early (<1s): 280ms spring-back (`--ease-spring`), **nothing happens, no error,
  no toast**.
- 100%: success haptic ("thud"), instant transition to unlocked state; control becomes
  solid orange with ink label "Unlocked — Ms. Rivera was notified" (check icon). The
  post-unlock sheet (S7) presents after — it never blocks the unlock.
- Never disabled. Never red. Never styled as destructive. Works fully offline
  (notification queues).
- Web focus: ring `0 0 0 2px #141312, 0 0 0 4px orange-300`.

**Assistive:** VoiceOver/Switch Control exposes a direct "Unlock now" activate action —
one activation, zero confirmations. Announced: "Emergency unlock. Your teacher will be
notified." (Prototype maps Enter/Space to immediate completion.)

**HoldHintLabel** (companion component): footnote 13pt, text-tertiary, centered beneath.
Copy rotates context, never guilt — e.g. "Works without Wi-Fi. Releasing early does nothing."

---

## AlertToaster (web + teacher iOS)

380px wide card: 36px icon tile (state bg/fg, radius 10) · title 15/600 · sub 13 secondary ·
action row (13/600 links) · dismiss X (16px). Card on `--surface-card`, border 1px default,
radius 14, shadow-3, plus a 3px top border in the state hue.

| variant | behavior |
|---|---|
| emergency (orange) | **sticky until dismissed**; sub shows "Reason pending · 10:31 AM" and updates in place when reason arrives ("Family · 10:31 AM"); action "Open student" |
| revoked (red — the only red surface) | sticky; "Diego M. turned off Screen Time permission" / "Their shields are off"; action "Open student" |
| info (neutral) | auto-dismiss 6s, no action row (e.g. "Pass ended for Aisha K. · Shields returned automatically") |

Position web: top-right stack, 18px inset; when the StudentPanel slide-over is open the
stack docks left of it AND below the header (so countdown/summary stay readable).
Slide-in 200ms (crossfade under reduced motion). The matching grid chip gets ONE soft
pulse (2 iterations max, `box-shadow` ripple in orange at 45%→0 alpha) — no infinite blinking.
ARIA: emergency/revoked `role="alert"` (assertive once), info `role="status"`.

---

## EventTimeline

Compact vertical log. Row: 26px icon dot (state bg/fg, radius full) · what 14/400 with
optional 12.5 secondary subline · relative-or-clock time right-aligned 12.5/500 tabular
tertiary. 1px connector line between dots (border-default), 18px row gap.
Used in: StudentPanel, T3 sheet, S8 session detail, W9 logs, portal recent activity.

---

## JoinCodeBadge

Mono (JetBrains Mono), 600, letter-spacing 0.16em, on `--surface-sunken` with 1px border.
| size | font | where |
|---|---|---|
| projector | 88/96 | W5 "Project this" full-screen |
| card | 40/48 | roster side card, create-class success |
| row | 22/28 | inline + one-click Copy (web) / Share (iOS) buttons |

---

## Base controls (web — map to shadcn)

- **Buttons** (radius 10, 15/600, padding 9/18; lg: 17/600 padding 14/24 radius 14 full-width on iOS):
  - primary: green-700 bg / white (hover green-800, pressed green-900; DARK: green-400 bg / ink `#06130D`)
  - secondary: card bg, border-strong, text-primary (hover sunken)
  - ghost: transparent, text-brand (red-600 text when destructive-quiet, e.g. "End session…")
  - destructive: red-600 bg / white (hover red-700) — confirms before acting
  - states: default / hover / pressed / focus(ring) / disabled(45% opacity) / loading(spinner replaces label)
- **Input:** 15/400, padding 9/12, radius 10, border-strong; focus = ring + green border;
  error = red-500 border + 13px red-600 helper text naming the fix.
- **Toggle:** 48×29, radius full; off stone-300, on green-600; 24px white knob, 200ms;
  locked-on variant at 50% opacity (Phone toggle — informational).
- **Segmented control:** sunken bg, 3px padding, active segment = card bg + shadow-1 (GrantPassForm presets).
- **Tag chip (tag-input):** 13/500, sunken bg, 1px border, radius full, X button 13px.
- **ReconnectingPill:** 31px pill, card bg + border-strong + shadow-2, 13/500 secondary text,
  7px orange-400 dot pulsing 1.6s (static under reduced motion). Copy: "Reconnecting — data
  may be 20s stale." Pinned top-center of LiveGrid; non-blocking.

---

## Web composites

- **LiveGrid:** header (medium countdown + class h3 + policy caption + Extend / "End
  session…" quiet-destructive) · summary strip (mini chips with counts, one per non-zero
  state) · chip grid `repeat(4, 1fr)` gap 10 — 28 students fit without scroll at 1440;
  4-up guarantees the longest label ("Permission off") never truncates. Projector variant:
  no sidebar, `repeat(4,1fr)` gap 14 with projector-size chips, header one size up
  (h1 36, countdown 44). VoiceOver: grid is a list "Live status, 28 students"; summary
  announces first; emergency announces assertively once.
- **StudentPanel:** 372px slide-over, radius 20 (0 when docked to edge), shadow-3.
  Head: name h3 + joined-time caption + current-state mini chip + close. Body sections
  (uppercase 12/600 tertiary labels): "This session" EventTimeline · "Grant a pass"
  GrantPassForm · "No device today" toggle row ("Marks Sam out of today's grid only").
- **GrantPassForm:** segmented 5/10/15/Custom (10 default) · reason input
  (placeholder "Reason (optional) — e.g. nurse") · primary "Grant 10-minute pass" ·
  caption "Shields return automatically when it ends."
- **PolicyEditor:** name input · toggle rows: Phone (locked-on, "Always available — calls
  can't be shielded"), Messages (default on, "Recommended on for family reachability") ·
  "Also allowed" tag-input (Notes, Camera, Calculator) with the honesty explainer:
  "Students pick the matching apps on their own phones — Bali never sees anyone's app
  list." · footer: "Used by N classes" + guarded delete ("Detach from 3 classes first").
- **TagCard:** 268px card: 170px print-ready QR · label 16/600 · mono code + class ·
  Active toggle · "Print sheet" secondary. Deactivating warns: "Every printed copy of
  this tag stops working immediately. Students can still join by code." Deactivated cards
  stay visible at 62% opacity.

---

## iOS pieces

- **StatusBanner** (Home, 68pt, radius 20): Free (empty-circle lead, "Free" + "Next:
  Period 3 — Algebra II · 10:00") · Focused (36pt live mini arc, "Focused until 10:45" +
  class/teacher) · Unlocked (lock-open on emergency tint, "Unlocked — focus when ready" +
  "Ms. Rivera was notified" + small secondary **Re-focus** button — invited, never demanded).
- **PermissionHealthRow:** ok = card bg, shield-check green-500, "Screen Time is on"
  (quiet reassurance) · off = emergency-tint bg (amber posture, NOT red), shield-off,
  "Screen Time permission is off" / "Focus can't start until it's back on." + "Open
  Settings" secondary button. Appears on Home only while off; lives at top of Settings always.
- **AllowedAppsRow:** 48pt rounded-square chips (raised bg + border) with **generic Lucide
  glyphs + policy labels** — never real app icons (honest: students map names to actual
  apps themselves). 11px tertiary captions. Min 44pt touch targets.
