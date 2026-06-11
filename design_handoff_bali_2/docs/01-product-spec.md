# 01 · Product Spec (condensed, authoritative)

> Source of truth: `00-original-brief.md` (the full design brief, written when the product
> was code-named **FocusClass**). The product has since been renamed **Bali** — every
> design file and all copy now says Bali. Where this doc and the original brief conflict,
> this doc wins (it reflects decisions made during the design passes).

## What Bali is

Bali lets a teacher run a **focus session**. Students tap an NFC tag on the teacher's desk
with their iPhone; the app shields every app except a small allowed set (Phone, Messages,
Notes, Camera, class-defined extras) using Apple's Screen Time API. The teacher watches a
live status grid on the web dashboard or their own iPhone. Students always have an
**instant, unconditional Emergency Unlock** — one 1.0s hold, no confirmation, no network
needed — which unlocks everything and notifies the teacher. Sessions end automatically at
the bell.

## Product philosophy (drives every visual decision)

**Visibility and norms, not prison.** iOS Screen Time is consent-based; a student can
revoke it in Settings at any time, and the product shows that honestly ("Permission off")
instead of pretending to prevent it. The design must never feel like surveillance
software, a punishment system, or a security product. It is a shared agreement made
visible.

Two audiences, two emotional jobs:

- **Students (13–18).** Dark-mode-first, calm, almost-empty screens. The flagship screen
  (Focus Active) sits face-up on a desk for 50 minutes. Absolute confidence in the
  emergency exit. Nothing childish, nothing gamified-cute.
- **Teachers (25–65, mid-lesson, laptop at 6 feet).** The dashboard is ambient peripheral
  vision. One glance answers "is anything wrong?" Density, contrast, restraint.

**The single most important emotional beat:** Emergency Unlock must read as *safe* — not
an alarm, not a failure. Orange, never red. "Notified," never "reported."

## The canonical state system (non-negotiable)

Every surface showing a student's status uses this exact system. **Color is never the
only signifier** — each state is an icon + label + color triple, distinguishable in
grayscale and by colorblind users.

| State key            | Label            | Hue family   | Icon (Lucide / SF Symbol)            | Meaning |
|----------------------|------------------|--------------|--------------------------------------|---------|
| `not_joined`         | "Not in"         | neutral gray | `circle` / `circle`                  | Session running, hasn't tapped in |
| `focused`            | "Focused"        | brand green  | `circle-check` / `checkmark.circle.fill` | Tapped in, shields on |
| `pass`               | "Pass · 4:32"    | blue         | `ticket` / `ticket`                  | Teacher-granted temporary unlock (live countdown in label) |
| `emergency_unlocked` | "Unlocked"       | warm orange  | `lock-open` / `lock.open`            | Student used Emergency Unlock |
| `revoked`            | "Permission off" | red (reserved) | `shield-off` / `shield.slash`      | Screen Time permission turned off |
| `no_device`          | "No device"      | gray, dashed outline, no fill | `smartphone` / `iphone.slash` | Teacher marked: no phone today |
| `ended`              | "Ended"          | neutral      | `flag`                               | Session over |

**Hard rules:**
- Red appears **only** for `revoked` and destructive actions (delete, end session, errors). Nowhere else, ever.
- Emergency is orange and visually calm — never blinking, never alarm-styled.
- Staleness ("last seen 4m") is a small secondary badge layered on any state — it is **not** a state of its own. When stale, the chip's icon + label dim to 60% opacity and a small "4m" pill appears.
- `no_device` renders as a dashed 1.5px outline with transparent fill so a marked-absent student never reads as a colored status.

## Voice & microcopy laws

- Respectful, plain, zero shame. **Banned vocabulary anywhere in UI:** caught, violation,
  offender, lockdown, monitored, tracked, surveillance, jail, prison, cheating.
- The emergency control reads **exactly**: "Hold to unlock — your teacher will be notified."
- Post-unlock sheet asks "You're unlocked. Everything OK?" with reason chips
  **Family · Medical · Safety · Other · Skip** — Skip is a first-class, equally weighted
  option (same size, same style, never grayed).
- Honesty rules: never claim blocking is unbypassable. The privacy contract states
  verbatim what teachers see (focus status + timing, unlock times + shared reasons) and
  never see (screens, app lists, messages, browsing, location).
- Buttons name outcomes ("Start Focus", "End Session"), not gestures ("Submit").
- Empty states give the next action, not mood.
- Teacher pattern data carries the framing line, set as designed copy:
  **"Patterns are conversation starters, not verdicts."**

## Demo content (used consistently everywhere)

- Class: **"Period 3 — Algebra II"**, teacher **Ms. Rivera**, Jefferson High, session ends **10:45 AM**, 28 students.
- Grid distribution (the canonical "hero mock"): 22 `focused`, 2 `not_joined`,
  1 `pass` (4:32 left, reason "nurse" — Aisha K.), 1 `emergency_unlocked` (reason pending — Sam T.),
  1 `revoked` (Diego M.), 1 `no_device` (Priya S.).
- Policy: **"Lecture — Notes, Camera, Calculator allowed."**
- Join code `KM3W7Q2A` · tag code `T7XK2M9QPF` (mono, letter-spaced).
- Student persona: **Jordan Park**, iPhone 14, dark mode.
- Other roster names: Lena W., Marcus J., Tavi O., Noor H., Ethan C., Zoe B., Amara D.,
  Felix G., Hana S., Ivan K., Jade L., Kai N., Luca F., Mei T., Nia W., Omar A., Rosa V.,
  Theo B., Uma P., Vik R., Wren H., Yusuf E., Maya R.

## Platform targets

- **iOS app (student + teacher): SwiftUI-native, iOS 16+.** Standard navigation stacks,
  sheets with detents, `List`/`Form`, SF Symbols, system materials. Min touch target
  44×44pt. Full Dynamic Type. Student screens designed dark-first with light variants;
  teacher screens light-priority. Mockups framed at 393×852 (iPhone Pro logical size).
- **Web dashboard: Next.js + Tailwind + shadcn/ui.** Desktop-first at 1440, must hold at
  1024 (Chromebook); the live grid must stay legible full-screened on a mediocre
  classroom projector.
- **System surfaces never redesigned, only framed:** the Screen Time permission dialog,
  FamilyActivityPicker, the NFC scan sheet, and the Shield screen (see below).

### The Shield screen API constraint (hard limit)

Apple's `ShieldConfiguration` allows ONLY: background blur style + tint color, one icon
image, title (text + color), subtitle (text + color), primary button (label + background
color), secondary button label. The design uses exactly these six knobs:
dark blurred material with green-tinted darkness, the arc mark as the static icon,
title "Focused with Ms. Rivera", subtitle "Until 10:45 · Emergency? Open Bali",
primary "OK" (#2C6F51 bg), secondary "Open Bali". **No fake countdown ring. No custom layout.**

## Accessibility floor (both platforms)

- WCAG 2.2 AA contrast (state chip pairs are all ≥4.5:1 — verified live on the token sheet).
- State never by color alone (§ state system above).
- Visible keyboard focus on web: `0 0 0 2px var(--surface-page), 0 0 0 4px var(--focus-ring-color)`.
- `prefers-reduced-motion` variants for every animation (crossfade or none).
- VoiceOver specs exist for the five complex components (see `03-components.md`).
- The hold-to-unlock gesture exposes a direct **"Unlock now"** activate action under
  VoiceOver/Switch Control — one activation, zero confirmation steps.

## Out of scope (do not build)

Admin portal, Android, parent-facing anything, leaderboards/class comparisons,
location or app-usage visualizations (the product cannot and will not have this data),
APNs settings UI, seating-chart grid, redesigns of Apple system sheets.
