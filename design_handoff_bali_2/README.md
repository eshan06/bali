# Handoff: Bali — Classroom Focus Sessions (full product design)

**For: Claude Code / any developer implementing this design.**
This bundle is self-sufficient: a developer who never saw the design conversation should
be able to recreate the entire product — iOS student app, iOS teacher app, web teacher
dashboard, teacher portal home, and the marketing landing page — from these docs and files.

---

## Overview

**Bali** lets a teacher run a classroom "focus session." Students tap an NFC desk tag
with their iPhone; Apple's Screen Time API shields every app except a small allowed set
until the bell. The teacher watches a live status grid (web dashboard or iPhone).
Students always have an instant, unconditional **Emergency Unlock** — one 1-second hold,
no confirmation, works offline — which unlocks everything and notifies the teacher.

The design's core philosophy: **visibility and norms, not prison.** Calm, trustworthy,
zero shame. Emergency is orange (never red), "notified" (never "reported"), and the
product is honest that shielding is consent-based. Read `docs/01-product-spec.md` first —
it is the condensed, authoritative spec.

## About the design files

The files in `design-files/` are **design references created in HTML** — high-fidelity
prototypes showing intended look and behavior, **not production code to copy directly**.
Your task is to **recreate these designs in the target codebase's environment** using its
established patterns:

- **iOS** (student + teacher apps): SwiftUI, iOS 16+, stock navigation/sheets/lists,
  SF Symbols, FamilyControls/ManagedSettings/DeviceActivity for Screen Time.
- **Web** (dashboard + portal): Next.js + Tailwind + shadcn/ui (the tokens ship as a
  Tailwind config block). The marketing landing can live on the same stack as a public route.

If no codebase exists yet, those are the intended frameworks — start there.

## Fidelity

**High-fidelity.** Colors, type, spacing, radii, copy, and interaction timings are final
and normative — recreate pixel-perfectly using the docs' values (don't eyeball the
screenshots; the docs have exact numbers). The only placeholders are: QR codes (render
real ones), the App Store badge, and app icons in "allowed apps" rows (which are
*deliberately* generic glyphs — see the honesty rules; do not replace with real app icons).

## How to read this bundle

```
design_handoff_bali/
├── README.md                  ← you are here
├── docs/
│   ├── 00-original-brief.md   ← the full original design brief (product was then code-named
│   │                            "FocusClass"; renamed to Bali — docs 01–07 supersede it)
│   ├── 01-product-spec.md     ← READ FIRST: product, state system, copy laws, constraints
│   ├── 02-design-tokens.md    ← every color/type/space/motion value, light + dark, AA notes
│   ├── 03-components.md       ← component inventory: anatomy, sizes, all states, a11y
│   ├── 04-ios-screens.md      ← S1–S10 student + T1–T5 teacher, screen by screen
│   ├── 05-web-pages.md        ← W1–W10 + teacher portal + landing, page by page
│   ├── 06-interactions-motion.md ← motion budget, hold-to-unlock, haptics, state machine,
│   │                            and the frozen-timeline implementation lesson
│   └── 07-implementation-notes.md ← how the prototypes were built; SwiftUI + Next.js
│                                 recreation guidance; suggested data model; done-criteria
├── tokens/
│   ├── tokens.css             ← THE source of truth (CSS custom props, light + dark scopes)
│   └── tailwind.tokens.js     ← same values as a Tailwind theme.extend block
├── design-files/              ← the HTML design references (open in a browser)
│   ├── Pass 1 - Foundations.html      ← token sheet w/ live WCAG contrast + grayscale toggle
│   ├── Pass 2 - Component Sheet.html  ← every component, every state (unlock demo is live)
│   ├── pass2/components.css           ← the prototypes' reusable component CSS (class prefix fc-)
│   ├── pass3/S*.html, T*.html         ← iOS screens in 393×852 frames (dark-first; edge-case
│   │                                    notes in gray outside frames; pill nav links pages)
│   ├── pass3/{ios-frame,scaffold}.jsx, sheet.css ← review-sheet scaffolding (NOT product spec)
│   ├── W4 Live Dashboard.html         ← THE web page: all six required states at 1440
│   ├── W1-W3 / W5-W7 / W8-W10 *.html  ← remaining dashboard pages as framed states
│   ├── Bali - Teacher Portal.html     ← standalone logged-in portal home (full viewport)
│   ├── Bali - Landing.html            ← standalone animated marketing page (hero unlock
│   │                                    demo + cursor tilt are interactive — try them)
│   └── pass4/web.css                  ← web app-shell CSS used by the W pages + portal
└── screenshots/               ← quick visual orientation (PNG; the HTML is authoritative)
```

Note on `design-files/`: pages load Google Fonts (Instrument Sans, JetBrains Mono),
Lucide, and (pass3 only) React+Babel from CDNs — open them with network access. All
relative paths work as-bundled; serve the folder with any static server
(`python3 -m http.server`) for best results.

## Screenshots index

| file | shows |
|---|---|
| `01/02/03-landing.png` | marketing hero (post-animation) · dark "exit" band · book-a-demo band |
| `teacher-portal.png` | logged-in portal home |
| `01/02/03-w4-live.png` | W4 healthy state · emergency toast + StudentPanel · projector variant |
| `01…04-components.png` | StatusChip matrices · SessionCountdown arcs · EmergencyUnlockControl · web composites |
| `01/02/03-foundations.png` | token sheet top · canonical state table (light+dark, live AA ratios) · typography |
| `01/02-ios-s6-focus-active.png` | the flagship student screen, 6 states |
| `ios-s1-onboarding.png` | onboarding incl. the privacy-contract card |
| `ios-teacher.png` | teacher home / start sheet / live grid on phone |
| `w8-reports.png` | reports with the framing line |

## The 10 things you must not get wrong

1. **The state system is law.** Seven states, each icon + label + color — color is never
   the only signifier. Exact mapping in `01-product-spec.md`.
2. **Red appears only for `revoked` + destructive actions.** Emergency is warm orange,
   calm, never blinking.
3. **The emergency control reads exactly** "Hold to unlock — your teacher will be
   notified", is always visible on Focus Active, never disabled, never red, fully
   offline; releasing early does nothing (no error). VoiceOver gets a one-step
   "Unlock now" action.
4. **Skip is a first-class answer** on the post-unlock sheet — same size and weight as
   the other reason chips.
5. **Honesty copy:** never claim blocking is unbypassable; the privacy contract
   (sees / never sees) is verbatim in onboarding, Settings → Privacy, and the landing;
   allowed-apps rows use generic glyphs because Bali cannot see app lists.
6. **Dark mode is designed, not inverted** — student screens dark-first with explicit
   dark tokens; dark primary buttons are green-400 + ink (green-500 fails AA).
7. **The arc is the one signature motif** and the 600ms draw-in on tap-in is the one
   theatrical moment. Everything else is ≤300ms; reduced-motion variants everywhere.
8. **W4 must pass the 6-foot squint test:** summary strip first, 4-up grid with full
   labels, 28 students without scroll at 1440, projector variant one size up.
9. **Banned vocabulary** anywhere in UI: caught, violation, offender, lockdown,
   monitored, tracked, surveillance, jail, prison, cheating.
10. **System surfaces are never redesigned** (Screen Time dialog, FamilyActivityPicker,
    NFC sheet), and the Shield screen uses only ShieldConfiguration's six primitives.

## Demo content

Use the canonical demo data everywhere while building (class "Period 3 — Algebra II",
Ms. Rivera, ends 10:45 AM, 28 students with the exact distribution, join code `KM3W7Q2A`,
tag `T7XK2M9QPF`) — full roster and details in `01-product-spec.md`. No lorem ipsum.

## Provenance

Designed in four reviewed passes (foundations → components → iOS → web) against
`docs/00-original-brief.md`, then extended with the marketing landing, teacher portal
home, class-creation flow, and the FocusClass→Bali rename. Accessibility was verified
live (WCAG ratios computed from rendered pixels); every page passed an automated
design-review check for layout, console errors, and label truncation.
