# 01 · Teacher iOS Screens — Addendum (T1 rev · T6–T12 · T3 rev)

> Design files: `design-files/pass5/*.html` — open in a browser; each page shows multiple
> 393×852 device frames with edge-case notes in gray outside the frames, and a pill nav
> linking the addendum pages (plus the original brief's T1–T2 / T3–T5 sheets, included in
> `design-files/pass3/` for before/after context). Frames use the same presentation-only
> scaffold as the original handoff (React via Babel) — **the screens are the spec, not the
> scaffold code.** All teacher screens are light-mode-priority. Status-bar time is 10:22.

Everything inherits the original handoff's laws unchanged: the 7-state system (icon +
label, never color-only), red reserved for `revoked` + destructive actions, voice/banned
vocabulary, motion budget, SwiftUI-native surfaces, 44pt minimum targets, full Dynamic
Type. Layout constants are the same: 20pt safe-area padding, content ≥70pt from top,
full-width primary buttons radius 14.

**The content guardrail:** every addition is about *participation and status*. There is
no app-usage, browsing, or location data in the product — no screen may imply otherwise.

---

## T1 · Teacher Home — REVISED — `pass5/T1 Teacher Home rev.html` (3 frames)

The class list grows into the daily hub (the web portal W3a brought to the phone).
Top-to-bottom: greeting → live-now card → approvals row → today's schedule → class cards
→ recent activity. The whole screen scrolls; the greeting is plain text, not a nav title.

- **Greeting:** Title1 "Good morning, Ms. Rivera" + footnote meta ("Wednesday, June 10 ·
  next bell 10:45"). Trailing settings glyph (→ T5).
- **Live-now card** (only when a session is active; green-200 1.5pt border to read
  "alive"): 44pt arc · class headline · "Live · 23:14 · ends 10:45" (pulsing 8pt dot,
  2s ease, none under reduced-motion) · the six §2 summary mini-chips with counts ·
  full-width primary "Open live grid" (→ T2).
- **Approvals row** (only when requests exist): user-plus glyph in 36pt sunken circle ·
  "3 students want to join" semibold + "Period 1 — Algebra I · newest 2 min ago" ·
  chevron → T7. Copy is invitational — never "requests pending review".
- **Today's schedule** (card, hairline rows 48pt): bell time tabular semibold · class
  name · trailing **Start** secondary button (play glyph) that opens T9 prefilled — or
  "● Live now" in brand green for the active class.
- **Class cards** (radius 18, shadow-1): name headline + chevron (tap → T6) · meta line
  "MWF · 9:50 · 28 students · last met Mon". **Context-aware action row:** when live →
  primary "Open live grid" + secondary "Roster"; when idle *and scheduled now* → primary
  "Start session"; otherwise no buttons (one-line quiet).
- **Recent activity:** EventTimeline card with the last ~3 cross-class events, each with
  class name in the small line. Never opens empty — shows yesterday's tail when today is
  quiet.

**States:** live (frame 1) · idle-scheduled-now (frame 2) · new-teacher empty (frame 3 —
greeting stays, arc-plus illustration, "Set up your first class", primary → T12).

## T6 · Class Detail — NEW — `pass5/T6 Class Detail.html` (7 frames)

The per-class hub a class card taps into. **Header (always):** back link "‹ Classes" ·
Title1 class name · meta "MWF · 9:50–10:45 · 28 students" · join-code chip (mono
`KM3W7Q2A` + qr glyph, 44pt; tap → full-screen projectable JoinCodeBadge with share) ·
context-aware primary: **Start session** (→ T9) or **Open live grid** (→ T2).
**Sticky segmented control** below the header: Overview · Roster · Policy · Tags ·
Activity (12.5pt/600 segments; scrolls horizontally at accessibility type sizes).

- **Live banner** (when a session is active, pinned under the header on *every*
  segment): 36pt arc · "● Live · 23:14 · ends 10:45" + "22 focused · 1 unlocked ·
  1 pass" · chevron → T2.
- **Overview:** 2×2 quick-stat cards (members 28 · sessions this week 4 · last session
  47 min Tue · median focus 41 min) — with the measurement-honesty footnote directly
  beneath: "Focus minutes count time in session — nothing else is measured." Then rows:
  "Last session recap" (→ T10 for that session) and "Edit class" (→ Form sheet: name,
  schedule, auto-approve toggle, default policy picker).
- **Roster:** inline T7 scoped to this class (see T7 below for anatomy). One member row
  is shown mid-swipe in the mock: trailing red **Remove** (88pt) — destructive, the only
  red on the screen, confirms before acting.
- **Policy:** the class default read-only — policy name + "default for this class" ·
  allowed summary "Notes, Camera, Calculator allowed" · generic-glyph AppsRow (never
  real app icons) · info row "Phone stays available — iOS can't shield it. Messages is
  shielded." Buttons: "Edit policy" (→ T8 editor) + "Change default" (picker). The
  device-mapping explainer is restated as a footnote (verbatim — see T8).
- **Tags:** this class's tags as T4 TagCard rows (`T7XK2M9QPF` etc.) · primary "Write a
  new tag" (→ the T4 flow, system NFC sheet untouched) · deactivate keeps its
  destructive confirm.
- **Activity:** per-class slice of W9. Framing line italic on top ("Patterns are
  conversation starters, not verdicts."), then EventTimeline cards grouped by day,
  ghost "Load earlier" (cursor pagination). Event copy is factual: "Diego M. turned
  permission off · rejoined 4 min later".

**States:** idle (frame 1) · live banner (frame 2) · Dynamic Type XL proof (frame 7 —
stat grid reflows to one column, rows grow, nothing truncates) · archived class =
read-only with a restore action (annotated) · empty roster = "Share the join code to add
students."

## T7 · Roster & Approvals — NEW — `pass5/T7-T8 Roster Policies.html` (frames 1–3)

Standalone screen the T1 approvals row lands on (same content inlined in T6 · Roster).
Header: back to class · Title1 "Roster" · "24 students · auto-approve off".

- **Want to join · N** (section only exists when requests do): rows of name + "2 min ago
  · joined by code" + inline **Decline** (secondary) / **Approve** (primary), both 44pt;
  "Approve all" text button on the section header.
- **Members · N:** search field (filters as you type — required for large classes) ·
  rows of name + "joined Aug 28" + chevron. Default no-device members carry the dashed
  `no_device` chip.
- **Member sheet** (tap a row; small detent): "No device by default" toggle ("Hana
  starts every session marked no-device" — carries into sessions as `no_device`) ·
  "Remove from class" (red text — destructive) · Cancel.
- **Remove confirm** (native alert): "Remove Hana from Period 1?" / "Her focus history
  stays hers. She can rejoin any time with the class code." / Cancel · red Remove.

## T8 · Policies — NEW — same file (frames 4–6)

- **List:** Large title "Policies" + sub "What stays available while a class is focused.
  A policy can be shared by several classes." Rows: name 600 · allowed summary footnote ·
  trailing "used by N classes" (the delete guard's source of truth) · chevron. Primary
  "New policy". Empty state CTA: "Create your first policy".
- **Editor (SwiftUI Form):** Name field · SYSTEM group: **Phone** row disabled with
  toggle locked on + "Always available — iOS can't shield it" (informational, honest);
  **Messages** toggle ("Shielded during focus") · ALLOWED DURING FOCUS: tag-input of app
  display names (Notes / Camera / Calculator chips with ×, "Add an app name…") · the
  device-mapping explainer **verbatim**: *"Students pick these apps on their own phones.
  Bali can't choose apps for them, and can't see which they picked — it only knows how
  many."* · primary "Save policy" · ghost red "Delete policy" at the bottom.
- **Delete guard** (native alert, no red — nothing is destroyed, the action is
  prevented): "Lecture is in use" / "3 classes use it as their default. Give them a
  different policy first, then delete." / OK.

## T9 · Start Session — NEW — `pass5/T9-T10 Start Session Recap.html` (frames 1–3)

Sheet with detents over T6 (or T1 via a schedule Start). Replaces the brief's two-row T1
start sheet — same anatomy, two additions.

- **Prefilled rows:** "Ends at **10:45** · next bell" (wheel-editable) · "Policy
  **Lecture**" (class default, changeable) · the policy's allowed list restated as a
  caption · "Expecting **27 students** · 1 no-device" (informational) · "Remind me at
  the end" toggle + "A notification on this phone, nothing else" (local notification —
  no APNs in v1) · full-width primary **Start session** → creates session → T2.
- **End-time-in-past:** row outlines red (the component sheet's form-error treatment),
  helper "That's already past — pick a time after 10:22.", Start disabled.
- **No members:** the form is replaced by the path forward: "No students have joined
  yet" · "Share the join code first…" · code chip `KM3W7Q2A` + share · secondary "Show
  it big to project". Start never creates a useless session.
- **Already active** (annotated): sheet blocks with "End the current session first" +
  link to the live grid.

## T2 · Live Grid — unchanged file, two wiring notes

The brief's T2 (`pass3/T1-T2 Teacher Home Live.html`, frames T2.1–T2.2) already carries
the summary strip and Extend/End. The addendum only wires **End → T10** (recap
auto-presents) and notes the summary strip doubles as the 6-foot read. No visual changes.

## T10 · Session Recap — NEW — same file as T9 (frames 4–5)

Auto-presents when a session ends; also reachable from T6 · Overview ("Last session
recap") and T6 · Activity.

- **Header:** Title1 "Session recap" · "Period 3 — Algebra II · today 9:50–10:45 ·
  55 min".
- **Stats:** quick-stat grid — 22 stayed focused · 1 emergency unlock · 1 pass · 1
  permission off — plus the footnote "41 min median focus · 2 never joined · Priya S.
  marked no-device". Neutral counts; **no per-student ranking, no scoreboard, no red**
  (a recap is history, not an alarm — `permission off` appears as plain text).
- **Emergencies card:** each listed plainly — "Sam Torres · 10:31 / Reason shared:
  family · re-focused 10:35" — followed by the quiet nudge row: "A quiet check-in with
  Sam later might be welcome." (a prompt to talk, never a discipline hook).
- **Framing line** visible above the actions. Actions: primary **Done** · secondary
  "View full log" (→ T6 · Activity).
- **Clean session:** Title1 "Smooth period." · full arc-check · "Everyone who tapped in
  stayed focused to the bell" · "25 students · 47 min median focus". Light celebration,
  one sentence, no confetti. Short/aborted sessions use the same layout with duration
  stated plainly ("7 min — ended early").

## T12 · Create Class — NEW — `pass5/T12 Create Class.html` (3 frames)

Sheet over T1 — iOS parity with the web's W3b.

- **Form:** Name (the only required field — Create disables while empty) · Meets
  (schedule string) · Policy picker prefilled to most-used with allowed list restated
  ("…or create a new policy" → T8) · "Auto-approve joins" toggle default ON with the
  consequence in plain words ("Anyone with the code is in — no waiting on you") ·
  primary "Create class". Esc/swipe closes without residue.
- **First class ever:** same form + one orienting line under the title: "Students join
  with a code you put on the board — that's the whole setup."
- **Reveal:** arc-check · "Period 4 — Precalculus is ready" · "Put the join code on the
  board — students join from the Bali iOS app." · card-size JoinCodeBadge **`QV4N8R1C`**
  · "Project this" (full-screen projectable) + "Share" (system sheet) · bottom-anchored
  primary "Open the class" → T6 (empty-roster state).

## T3 · Student Detail — REVISED — `pass5/T3 Student Detail rev.html` (2 frames)

The brief's sheet + one segmented control: **This session · Recent**.

- **This session:** unchanged from the brief — current-state chip, this-session
  EventTimeline, GrantPassForm (5/10/15/Custom + optional reason + auto-return caption),
  "No device today" toggle.
- **Recent:** the last ~5 sessions as compact outcome rows — day + state-colored icon
  dot (per §2, grayscale-safe) + factual label: "Focused 41 min · 1 unlock, re-focused" /
  "Focused 47 min, full session" / "Focused 39 min · 10-min pass" / "Permission off ·
  rejoined 4 min later" / "No device that day". The framing line sits directly under the
  list, then the boundary restated: "Session status only — Bali never sees Sam's screen,
  apps, messages, or location." **There is deliberately no drill-down** — no device
  contents exist to drill into.

## T5 · Settings & Passes — unchanged

As in the original handoff (`pass3/T3-T5 Teacher Detail Tags.html`, frame T5). The
notification prefs remain local/on-device in v1.
