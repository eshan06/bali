# 02 · Implementation Notes — Teacher iOS Addendum

How to take the addendum screens into the SwiftUI teacher app. This supplements (does
not replace) `07-implementation-notes.md` in the original `design_handoff_bali` bundle —
tokens, type ramp, motion budget, and the base data model all carry over unchanged.

## Scope of change

| Screen | Status | Work |
|---|---|---|
| T1 Teacher Home | **revised** | rebuild body: greeting + live-now + approvals + schedule + loaded cards + activity feed |
| T2 Live Grid | unchanged UI | wire End → present T10 recap |
| T3 Student Detail | **revised** | add This session / Recent segmented control + history rows |
| T4 Tags, T5 Settings | unchanged | T4 flow now also reachable from T6 · Tags |
| T6 Class Detail | **new** | per-class hub, 5 segments |
| T7 Roster & Approvals | **new** | standalone + inlined in T6 |
| T8 Policies | **new** | list + Form editor |
| T9 Start Session | **new** | sheet with detents; replaces the brief's start sheet |
| T10 Session Recap | **new** | auto-presents on session end |
| T12 Create Class | **new** | sheet + join-code reveal |

## SwiftUI mapping

- **Navigation:** one `NavigationStack` per tab-less root. T1 → T6 is a push; T6 → T8
  editor is a push; T9, T12, the T3 sheet, and the T7 member sheet are `.sheet` with
  `.presentationDetents` (T9/T12: `.large`; member actions: `.medium`). T10 presents
  full-screen (`fullScreenCover`) when a session ends, regardless of where the teacher is.
- **T6 segments:** a pinned `Picker(.segmented)` inside a `ScrollView` with
  `LazyVStack(pinnedViews:)` — or `Section` headers in a `List`. At accessibility type
  sizes wrap the picker in a horizontal `ScrollView` (the XL frame shows the intent:
  grow, never truncate).
- **Live banner:** one shared `ActiveSessionBanner` view driven by the same session
  observable as T2's header; render on every T6 segment when `session != nil`.
- **Context-aware primary:** a single `ClassPrimaryAction` view — `.start(class)` vs
  `.openLive(session)` — reused by T1 cards, T1 schedule rows, and the T6 header so the
  logic never forks.
- **Swipe to remove (T7/T6 roster):** `.swipeActions(edge: .trailing)` with a
  `role: .destructive` button + `confirmationDialog`/alert before any mutation.
- **Forms (T8 editor, T12, T6 Edit class):** stock `Form`/`List` styling per the mocks'
  grouped cards; the Phone row is a disabled `Toggle` locked on — informational, with
  the honest footnote.
- **T9 reminder toggle:** `UNUserNotificationCenter` local notification scheduled for
  the end time; cancel on Extend/End. No APNs in v1.
- **Pulsing live dot:** 2s ease-in-out opacity loop; gate behind
  `accessibilityReduceMotion`.
- **SF Symbols** (the mocks use Lucide stand-ins): play.fill (Start), person.badge.plus
  (approvals/join), qrcode, square.and.arrow.up (share), checklist (policy), pencil,
  flag.checkered → flag (recap/session end), lock.open (emergency), shield.slash
  (revoked), iphone.slash or iphone + dashed ring treatment (no-device), wave.3.right
  (NFC tags), magnifyingglass, info.circle, bubble.left (check-in nudge), alarm (end
  reminder), bell (bell time).

## Data the new surfaces need (beyond the original model)

All of it is participation/status data the backend already implies — **nothing here
requires (or may use) app-usage, browsing, or location data; none exists.**

- `Class`: `schedule` (display string + next-bell derivation), `autoApprove: Bool`,
  `defaultPolicyId`, `memberCount`, `lastMetAt`, `archived`.
- `JoinRequest`: student, class, `createdAt`, source (code/tag) — approve / decline /
  approve-all mutations; count badge aggregated across classes for T1.
- `Membership`: `joinedAt`, `defaultNoDevice: Bool`, remove mutation.
- `Policy`: `usedByClassCount` (drives the delete guard), exceptions as display-name
  strings + count (the honesty model: names are labels the teacher typed, never read
  from devices).
- `Session`: `endsAt` editable pre-start (T9), `expectedCount`, and on end a computed
  `Recap` (focusedCount, emergencies[{student, time, reason?, refocusedAt?}], passCount,
  permissionOffCount, neverJoinedCount, noDeviceNames, medianFocusMinutes, duration).
- `StudentSessionHistory`: last N sessions per (student, class) → outcome rows for T3 ·
  Recent (date, minutes, events summary). Status outcomes only.
- Per-class event feed: cursor-paginated (T6 · Activity = the W9 query filtered to one
  class).
- Class stats for T6 · Overview: `sessionsThisWeek`, `lastSessionDuration`,
  `medianFocusMinutes`.

## The gate (run on every screen before shipping)

1. Every state rendered icon + label — legible in grayscale.
2. Red only on `revoked` state color and destructive actions (Remove, Delete, End).
   The T10 recap has **zero** red. The T8 delete *guard* alert has zero red.
3. No banned vocabulary (caught, violation, offender, lockdown, monitored, tracked,
   surveillance, jail, prison, cheating) — and approvals copy stays invitational.
4. "Patterns are conversation starters, not verdicts." visible on T6 · Activity, T10,
   and T3 · Recent.
5. Nothing implies seeing device contents; the T8 explainer and T3 boundary line are
   verbatim.
6. 44pt targets; Dynamic Type XL: T6 Overview must reflow exactly as the proof frame
   (stat grid → one column, segmented control scrolls).
7. System surfaces (NFC sheet, alerts, share sheet) stock and unrestyled.
