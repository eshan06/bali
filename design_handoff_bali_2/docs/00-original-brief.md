# FocusClass — UI Design Brief

You are the design lead for FocusClass. Your job in this session: produce the complete
visual design for the iOS app (student + teacher) and the web dashboard — design tokens,
component system, and high-fidelity mockups of every screen listed below, in the order
given in §13. This brief is self-contained; do not invent features beyond it. Where the
brief pins something down, follow it exactly. Where it leaves an axis free, make one
opinionated choice and state it — do not present three options or hedge.

---

## 1. Product context (read twice)

FocusClass lets a teacher run a "focus session." Students tap an NFC tag on the teacher's
desk with their iPhone; the app then shields every app except a small allowed set (Phone,
Messages, Notes, Camera, class-defined extras) using Apple's Screen Time API. The teacher
watches a live status grid on the web dashboard or their own iPhone. Students always have
an **instant, unconditional Emergency Unlock** — one hold, no confirmation, no network
needed — which unlocks everything and notifies the teacher. Sessions end automatically at
the bell.

**Product philosophy — this drives every visual decision:** *visibility and norms, not
prison.* iOS Screen Time is consent-based; a student can revoke it in Settings at any time
and we show that honestly instead of pretending to prevent it. The design must therefore
never feel like surveillance software, a punishment system, or a security product. It is
closer to a shared agreement made visible.

**Two audiences, two emotional jobs:**
- **Students (13–18).** The app takes something from them for 50 minutes. Every screen
  they see must give something back: calm, clarity, a sense that the time is theirs, and
  absolute confidence that the emergency exit works. If the student UI feels like a trap,
  detention, or a parental-control app, the design has failed. It also must not be
  childish or gamified-cute — these are teenagers who will mock anything that condescends.
- **Teachers (25–65, mid-lesson, laptop at 6 feet on a desk or projector).** The dashboard
  is ambient peripheral vision, not a workstation. One glance from across the room must
  answer "is anything wrong?" Density, contrast, and restraint over decoration. Think air
  traffic control built by someone who loves teachers, not an analytics SaaS.

**The single most important emotional beat:** the Emergency Unlock must read as *safe*,
not as an alarm and not as a failure. A kid having a panic attack or a family emergency
should feel zero friction and zero shame using it. Orange, never red. "Notified," never
"reported."

---

## 2. Canonical state system (non-negotiable, memorize)

Every surface that shows a student's status uses this exact system. Color is never the
only signifier — each state has an icon + label, and the set must be distinguishable by a
colorblind user and in grayscale.

| State | Meaning | Hue family | Icon concept | Label |
|---|---|---|---|---|
| `not_joined` | Session running, hasn't tapped in | Neutral gray | empty circle | "Not in" |
| `focused` | Tapped in, shields on | Brand green | filled circle / leaf-check | "Focused" |
| `pass` | Teacher-granted temporary unlock | Blue | ticket / hourglass | "Pass · 4:32" |
| `emergency_unlocked` | Student used Emergency Unlock | **Warm orange** | open lock | "Unlocked" |
| `revoked` | Screen Time permission turned off | Red (reserved) | shield-slash | "Permission off" |
| `no_device` | Teacher marked: no phone today | Gray, struck/dashed outline | phone-slash | "No device" |
| `ended` | Session over | Neutral | — | "Ended" |

Rules: red appears **only** for `revoked` and destructive actions — nowhere else, ever.
Emergency is orange and visually calm. Staleness ("last seen 4m") is a small secondary
badge on any state, not a state of its own.

---

## 3. Design direction

**Mood words:** calm, present, trustworthy, quietly confident. **Anti-mood:** carceral,
clinical-surveillance, gamified candy, generic SaaS.

**Signature motif — the arc.** Focus is time made visible. A circular arc/ring (the
session countdown) is the product's recurring visual signature: hero-sized on the
student's Focus Active screen, miniature in status banners and grid chips' progress, echoed
in the shield screen icon and the app icon. Use it with discipline — it is the one
memorable element; everything around it stays quiet.

**Color.** Build a token set roughly on: warm paper neutrals for light mode (off-white
surfaces with warmth, not blue-gray, and *not* the clichéd cream-plus-terracotta look);
true dark elevated surfaces for dark mode (students live in dark mode — design dark
first for student screens). Brand/primary accent: a deep, confident **evergreen** family
(the `focused` state and primary actions share this family at different steps). Semantic
state hues per §2 with light/dark variants, all meeting WCAG AA against their surfaces.
Define exact hex values yourself as a named token scale (e.g., `green/100…900`,
`orange/…`, `surface/…`, `text/…`) — you own the final values; the constraints above own
the relationships.

**Typography.** iOS uses the system stack — SF Pro via Dynamic Type text styles
(LargeTitle…Caption2), with **SF Pro Rounded reserved for large numerals** (countdowns,
join codes) as the warmth note; monospaced digits (tabular) for anything that ticks. Web:
choose one free, highly legible geometric-humanist grotesque with true tabular numerals
(e.g., Instrument Sans — you may swap once with one-line justification); join/tag codes
render in a mono face. Set a full type scale for web (display, h1–h3, body, caption,
data/tabular) with weights and line heights. Type does personality work; decoration does not.

**What to avoid (these read as AI-template defaults):** cream background + serif display +
terracotta accent; near-black + single acid-green/vermilion accent; broadsheet hairline
newspaper layouts; gradient-mesh hero backgrounds; glassmorphism cards everywhere;
emoji-as-iconography in the product UI (SF Symbols on iOS, a single consistent icon set
like Lucide on web).

---

## 4. Platform constraints

**iOS (SwiftUI-native, iOS 16+).** Design must be buildable in stock SwiftUI: standard
navigation stacks, sheets with detents, `List`/`Form` where appropriate, SF Symbols, system
materials. Respect safe areas; min touch target 44×44pt; full Dynamic Type support (show
one screen at XL type to prove the layout survives); light **and** dark for every student
screen (dark first), light-priority for teacher screens. Frame mockups at 393×852 (iPhone
Pro logical size). System UI you must *not* redesign, only style around: the Screen Time
permission dialog, FamilyActivityPicker (Apple's app-selection sheet), NFC scan sheet —
show these as native iOS surfaces in flows.

**The shield screen has a hard API surface.** Apple's ShieldConfiguration allows ONLY:
background blur style + tint color, one icon image, title (text + color), subtitle (text +
color), primary button (label + background color), secondary button label. Design strictly
within those primitives. No custom layout, no countdown ring here — fake nothing.

**Web (Next.js + Tailwind + shadcn/ui).** Tokens must be expressible as CSS variables /
Tailwind config; components should map to shadcn primitives plus the customs in §7.
Desktop-first at 1440, must hold at 1024 (Chromebook) and degrade gracefully to tablet;
the live grid specifically must stay legible full-screened on a classroom projector
(assume mediocre contrast — bump sizes/weights accordingly). Light mode is primary on web;
dark optional later.

**Accessibility floor (both platforms):** WCAG 2.2 AA contrast; state never by color
alone (§2); visible keyboard focus on web; `prefers-reduced-motion` variants for every
animation in §10; VoiceOver labels specified for the five most complex components
(EmergencyUnlockControl, StatusChip, LiveGrid, SessionCountdown, AlertToaster). The
hold-to-unlock gesture gets an assistive alternative: with VoiceOver/Switch Control, the
control exposes a direct "Unlock now" activate action — still zero confirmation steps.

---

## 5. Voice & microcopy (you write the copy in mockups — these are the laws)

Respectful, plain, zero shame. Banned vocabulary anywhere in UI: *caught, violation,
offender, lockdown, monitored, tracked, surveillance, jail, prison, cheating.* Emergency
language is supportive: the control reads exactly **"Hold to unlock — your teacher will be
notified."** Post-unlock sheet asks "Everything OK?" with optional reason chips (Family ·
Medical · Safety · Other · **Skip**) — Skip is a first-class, equally weighted option.
Honesty rules: never claim blocking is unbypassable; the privacy screen states verbatim
what teachers see (focus status + timing) and never see (screen contents, app lists,
location). Buttons name outcomes ("Start Focus," "End Session"), not gestures ("Submit").
Empty states give the next action, not mood. Teacher-facing pattern data carries the
framing line: "Patterns are conversation starters, not verdicts."

---

## 6. Realistic demo content (use everywhere; no lorem ipsum)

Class **"Period 3 — Algebra II"**, teacher **Ms. Rivera**, session ends **10:45 AM**, 28
students with realistically diverse names. Grid distribution for the hero mock: 22 focused,
2 not_joined, 1 pass (4:32 left, "nurse"), 1 emergency_unlocked (reason pending), 1
revoked, 1 no_device. Policy: "Lecture — Notes, Camera, Calculator allowed." Join code
`KM3W7Q2A`, tag code `T7XK2M9QPF`. Student persona: Jordan, iPhone 14, dark mode.

---

## 7. Component inventory

Design these once, reuse everywhere. Deliver a component sheet showing **all states** of
each (default / hover / pressed / focus / disabled / loading / error where applicable).

Shared concept, per-platform execution:
- **StatusChip** (the hero component). Anatomy: state icon, student first name + last
  initial, state label or live countdown, staleness badge ("4m"), optional pass timer.
  Sizes: grid (web, legible at 3–4 m: ≥16px name, ≥600 weight), row (iOS lists), mini
  (banners). Spec every state from §2 including stale-overlay and selected.
- **SessionCountdown** — the arc. Hero (student Focus Active, ~240pt, rounded tabular
  numerals, remaining time + "until 10:45"), medium (teacher header), micro (chips). Final
  2 minutes: subtle emphasis shift, no alarm red.
- **EmergencyUnlockControl** — full-width, ≥56pt tall, high-contrast on dark; label always
  visible; 1.0s hold fills the control edge-to-edge with orange while haptics ramp;
  release early = spring back, nothing happens, no error; completion = immediate unlock
  transition. Show 0% / 50% / 100% fill frames. Never styled as destructive-red.
- **AlertToaster** (web + teacher iOS) — emergency (orange, sticky until dismissed, shows
  student + reason-when-it-arrives, "Open student" action) vs revoked (red) vs info.
- **EventTimeline** — compact vertical log (icon, label, relative time) used in student
  detail panel and history.
- **JoinCodeBadge** — projector-sized join code, mono, letter-spaced, one-click copy (web)
  / share (iOS).
- Web-specific: **LiveGrid** (responsive chip grid + header), **StudentPanel** (slide-over),
  **GrantPassForm** (5/10/15 presets + custom + reason), **PolicyEditor** (system toggles +
  exceptions tag-input + "students map these on their device" explainer), **TagCard** (QR
  render, code, label, active toggle, print affordance), **ReconnectingPill** ("reconnecting
  — data may be 20s stale").
- iOS-specific: **StatusBanner** (Home: Free / Focused until 10:45 / Unlocked — with mini
  arc), **PermissionHealthRow** (ok / off states), **AllowedAppsRow** (icon chips from the
  policy's allowed list), **HoldHintLabel**.

---

## 8. iOS — Student screens (design all, dark mode first; show light variants)

For each: purpose, the layout you choose, all listed states, and exact microcopy.

**S1 · Onboarding (3 cards + permission).** Card 1: what FocusClass does (one sentence +
arc illustration). Card 2: the privacy contract — verbatim two-column "Your teacher sees /
never sees" list; this card is the trust moment, give it weight. Card 3: how tap-in works
(NFC gesture illustration). Then the Screen Time permission request moment: a framing
screen ("iOS will ask…") → native dialog → **denied state**: calm explainer, "Open
Settings" primary, and a quiet secondary path "Join without focus (status-only)" with an
honest one-line consequence.

**S2 · Join Class.** Big code field (auto-uppercase, mono, 8 cells) + "Scan QR instead."
Success state: class preview card — class name, Ms. Rivera, schedule, and the policy's
allowed-apps list *before* the Join button (informed consent posture). States: invalid
code, pending-approval confirmation.

**S3 · Home.** StatusBanner on top (three variants: Free / Focused-with-mini-arc /
"Unlocked — focus when ready" with a gentle **Re-focus** button). Today's classes list
with next-session hints. PermissionHealthRow appears only when Screen Time is off (amber,
not red, with fix action). Empty state: no classes yet → join CTA.

**S4 · Tap-In Confirmation** (arrives via NFC/QR). The breath-before-focus screen: class
name, "Until 10:45," AllowedAppsRow, single **Start Focus** button. One screen, one
decision, generous space. Variants: not-a-member (join first), session-not-started ("Ms.
Rivera hasn't started a session"), needs PolicySetup first (routes to S5), offline-verified
copy.

**S5 · PolicySetup** (one-time per policy). "Ms. Rivera's policy allows **Notes, Camera,
Calculator**. Select those apps on your phone:" → button opens the native
FamilyActivityPicker (render as system sheet) → return state shows picked apps via system
labels with an honest mismatch notice if count ≠ expected ("We can't see which apps you
chose — double-check it matches the list"). Confirm persists.

**S6 · Focus Active.** The flagship student screen. Hero SessionCountdown arc centered;
class + teacher line; AllowedAppsRow; bottom-anchored EmergencyUnlockControl with
HoldHintLabel beneath. Calm, almost empty, beautiful in the dark — this screen sits on
desks face-up. States: normal, final-2-minutes, reconnecting (subtle, non-blocking),
pass-active variant ("Pass · 4:32 — shields return automatically").

**S7 · Post-Emergency sheet** (auto-presents after unlock). "You're unlocked. Everything
OK?" Reason chips + Skip, equal visual weight; one tap dismisses. Below, quiet line: "Ms.
Rivera was notified." Absolutely no guilt styling.

**S8 · History.** Personal-only: focus minutes this week, simple streak, session list with
EventTimeline detail. No comparisons, no leaderboards, no grades-adjacent framing.

**S9 · Settings.** Permission health (live status + fix), account, **Privacy** page
(restates the S1 contract), leave class, about. Form-style, fast.

**S10 · Shield screen** (within Apple's primitives only, per §4): blurred dark background
with brand tint, arc-mark icon, title "Focused with Ms. Rivera," subtitle "Until 10:45 ·
Emergency? Open FocusClass," primary button "OK," secondary "Open FocusClass." Mock it
inside an iOS frame as it would actually render.

---

## 9. iOS — Teacher screens

**T1 · Teacher Home.** Class cards (name, period, member count, live-session indicator).
**Start Session** sheet: end-time picker defaulting to next bell, policy select, big start.
Empty state for new teachers.

**T2 · Live Grid (iOS).** Compact chip grid tuned for a phone held while walking the room:
header with class + medium countdown + End/Extend; chips at thumb scale; alert banners
slide in for emergency/revoked. Show the §6 distribution.

**T3 · Student Detail sheet.** Name + current state, this-session EventTimeline,
GrantPassForm, "Mark no device" toggle. Reachable from a chip tap.

**T4 · Tag Writer.** Tag list (TagCard rows: label, code, active). "Write new tag" flow:
label entry → hold-near-tag system NFC sheet → success/verify state → "stick it where
students tap." Deactivate with confirm.

**T5 · Teacher Settings / Passes log.** Minimal: active passes list with countdowns,
account, notification prefs.

---

## 10. Web — pages (1440 primary, 1024 must hold)

**W1 · /login.** Email/password + Google. Quiet, brand-forward, no marketing hero.
**W2 · /t/[code] fallback** (what a phone browser shows if the app isn't installed):
"Open in FocusClass" deep-link button, App Store badge, one-line explainer. Mobile-width.

**W3 · /app — class list.** Cards with live-session pulse on active classes, member count,
quick actions (Live, Roster). New-teacher empty state → create class.

**W4 · /app/classes/[id]/live — THE page; spend a third of your web effort here.**
Header: class name, big SessionCountdown, policy name, Extend, End (confirm), session-less
variant with inline Start controls. Body: LiveGrid of StatusChips, auto-fitting 28–36
students without scroll at 1440; summary strip (counts per state) above the grid for the
6-foot read. Right slide-over StudentPanel on chip click. AlertToaster top-right.
Required states to mock: (a) healthy mid-session per §6 distribution, (b) the moment an
emergency toast lands, (c) no active session, (d) session live but 0 tapped in ("Students
tap the desk tag to start"), (e) ReconnectingPill active, (f) projector/full-screen
variant with everything one size up.

**W5 · Roster.** Members table (name, status, joined), pending-approval queue with
approve/decline, remove member, JoinCodeBadge prominently placed with "Project this" hint.

**W6 · Policies.** Policy list + PolicyEditor: name, system toggles (Phone — always-on
informational, Messages), exceptions tag-input, the device-mapping explainer, "used by N
classes." Delete with in-use guard.

**W7 · Tags.** TagCard grid: QR (print-ready), code, label, class, active toggle,
deactivate-with-warning ("kills all copies of this tag"), print-sheet action.

**W8 · Reports.** Emergency log table (time, student, reason, session) with student/date
filters and per-student frequency sparkline; focus-minutes per session bar list; CSV
export. The framing line from §5 sits at the top as designed copy, not an afterthought.

**W9 · /app/logs.** Cross-class event stream: filter chips by type/class, EventTimeline
rows, cursor pagination.

**W10 · /app/settings.** Profile, school, notification prefs. Plain shadcn forms.

---

## 11. Motion & haptics

Motion budget is small and purposeful; everything ≤300ms, standard easing, with
reduced-motion variants (crossfade or none). The choreography that matters: (1) tap-in →
Focus Active: allowed apps settle, then the arc draws in once, ~600ms — the product's one
theatrical moment; (2) hold-to-unlock fill + iOS haptic ramp (light ticks → success
thud), spring-back on release; (3) grid chip state changes: 150–200ms crossfade,
emergency chips get a single soft pulse (no infinite blinking); (4) toast slide-in;
(5) countdown final minutes emphasis. Nothing else animates.

---

## 12. Out of scope — do not design

Admin portal, Android, parent-facing anything, leaderboards/class comparisons, location or
app-usage visualizations (the product cannot and will not have this data), APNs settings,
seating-chart grid (post-v1), redesigns of Apple system sheets, marketing site beyond W2.

---

## 13. Working process & deliverables (follow this order)

Work in four passes; pause after Pass 1 for my approval before continuing.

1. **Foundations.** Token sheet: full color scale (light+dark) with the semantic state
   mapping from §2, type scales (iOS Dynamic Type mapping + web scale), spacing/radius/
   elevation, icon set choice. Deliver as a visual sheet **plus** copy-pasteable CSS
   variables / Tailwind config block. Include a one-paragraph rationale and a §3
   anti-default self-check: name anything that drifted generic and how you corrected it.
2. **Component sheet.** Every §7 component, all states, both platforms where shared,
   annotated with sizes in pt/px.
3. **Student iOS flow** (S1→S10, dark-first, light variants for S3/S6/S10; one S6 at XL
   Dynamic Type), then **Teacher iOS** (T1–T5).
4. **Web** (W4 first with all six states, then W1–W3, W5–W10).

Render mockups as high-fidelity single-file HTML artifacts (one per screen or per small
flow), pixel-sized to the frames in §4, using the real content from §6 and final copy per
§5 — every screen reviewable as if screenshotted from the shipped product. Annotate edge
cases inline in small gray notes outside the device frame.

**Self-review checklist before presenting each pass:** every §2 state visible somewhere
with icon+label, not color-only · red appears only for revoked/destructive · emergency
path reads safe and shame-free · grid passes the 6-foot squint test · dark-mode student
screens feel native, not inverted · Dynamic Type screen doesn't break · copy obeys §5 ·
nothing resembles the §3 banned defaults · every interactive element shows a focus state.
