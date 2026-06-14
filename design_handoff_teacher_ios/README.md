# Handoff: Bali — Teacher iOS Addendum (full-control teacher app)

**For: Claude Code / any developer implementing this change.**
This bundle is the **delta** to `design_handoff_bali` — it covers ONLY the teacher iOS
app upgrade. The original handoff remains the source of truth for everything else
(tokens, components, student iOS, web). Read this bundle alongside it; where this bundle
is silent, the original applies unchanged.

---

## What changed

The brief scoped the teacher iOS app as a thin companion to the web dashboard. The
addendum (`docs/00-addendum-spec.md`) upgrades it so a teacher can **run everything from
the phone**: create classes, manage rosters and approvals, edit policies, start sessions
with intent, and close them with a recap.

| Screen | Status |
|---|---|
| **T1** Teacher Home | **revised** — bare class list → daily hub (greeting, live-now card, approvals badge, schedule with one-tap Start, loaded class cards, activity feed) |
| **T3** Student Detail | **revised** — adds "Recent": the student's last ~5 sessions as outcome rows |
| **T6** Class Detail | **new** — the per-class hub: Overview · Roster · Policy · Tags · Activity |
| **T7** Roster & Approvals | **new** |
| **T8** Policies (list + editor) | **new** |
| **T9** Start Session (confirm sheet) | **new** |
| **T10** Session Recap | **new** |
| **T12** Create Class | **new** |
| T2 Live Grid | unchanged UI — End now presents T10 |
| T4 Tags, T5 Settings | unchanged — T4 flow also reachable from T6 · Tags |

**The one content guardrail:** the new depth is about *participation and status* only.
No app-usage, browsing, or location surfaces exist anywhere in the product — if an
implementation choice seems to need that data, it's wrong.

## About the design files

`design-files/pass5/` contains the addendum screens as **HTML design references** —
high-fidelity mockups, not production code. Recreate them in SwiftUI (iOS 16+, stock
nav stacks / sheets with detents / List / Form, SF Symbols), matching the original
handoff's patterns. `design-files/pass3/` includes the original brief's two teacher
sheets so you can see exactly what T1 and T3 looked like before, and because T2, T4, T5
remain the spec for their screens.

Fidelity is **high**: colors, type, spacing, radii, and copy are final and normative.
Tokens are **unchanged** from the original handoff (`design-files/tokens/tokens.css` is
the same file, included so the HTML renders standalone). No new tokens, colors, or
components were introduced — every new screen composes the existing system (StatusChip,
SessionCountdown arc, EventTimeline, JoinCodeBadge, GrantPassForm, PolicyEditor,
AlertToaster).

## How to read this bundle

```
design_handoff_teacher_ios/
├── README.md                        ← you are here
├── docs/
│   ├── 00-addendum-spec.md          ← the addendum brief this work answers (parity map,
│   │                                  working order, per-screen requirements)
│   ├── 01-teacher-screens-addendum.md ← READ FIRST: screen-by-screen spec, frame by frame
│   └── 02-implementation-notes.md   ← SwiftUI mapping, data-model delta, the ship gate
├── design-files/                    ← open in a browser (loads Google Fonts/Lucide/React
│   │                                  from CDNs — needs network; serve the folder with a
│   │                                  static server for best results)
│   ├── pass5/                       ← THE ADDENDUM SCREENS
│   │   ├── T1 Teacher Home rev.html       (3 frames: live hub · idle · empty)
│   │   ├── T6 Class Detail.html           (7 frames incl. live banner + Dynamic Type XL proof)
│   │   ├── T9-T10 Start Session Recap.html(5 frames: prefilled · validation · no-members ·
│   │   │                                   recap-with-emergency · clean recap)
│   │   ├── T7-T8 Roster Policies.html     (6 frames: approvals · member sheet · remove
│   │   │                                   confirm · policy list · editor · delete guard)
│   │   ├── T12 Create Class.html          (3 frames: form · first-ever · code reveal)
│   │   ├── T3 Student Detail rev.html     (2 frames: this session · recent history)
│   │   └── pass5.css, scaffold5.jsx       (sheet chrome — presentation only, NOT spec)
│   ├── pass3/                       ← original teacher sheets for context (T1–T2, T3–T5)
│   ├── pass2/components.css         ← unchanged component CSS (class prefix fc-)
│   └── tokens/tokens.css            ← unchanged tokens (source of truth in the original bundle)
└── screenshots/                     ← quick visual orientation (the HTML is authoritative)
```

Note: the pill nav in pass5 pages links "Brief T1–T2" / "Brief T3–T5" to
`../pass3/…` — those work as-bundled. The pass3 pages' own pill navs reference student
screens that live only in the original bundle; ignore dead links there.

## Screenshots index

| file | shows |
|---|---|
| `01/02-t1-home-rev.png` | the live hub (greeting → live-now → approvals → schedule) · idle hub with context-aware Start |
| `01…04-t6-class-detail.png` | Overview idle + live banner · Roster approvals + swipe-remove / Policy · Tags / Activity · Dynamic Type XL |
| `01…04-t9-t10-start-recap.png` | start sheet prefilled + time validation · no-members + recap detail · recap stats · clean "Smooth period." |
| `01…04-t7-t8-roster-policies.png` | approvals + member sheet · roster + no-device default · remove confirm + policy list · editor + delete guard |
| `01/02-t12-create-class.png` | the form (+ first-ever variant) · join-code reveal `QV4N8R1C` |
| `t3-student-detail-rev.png` | This session (unchanged) beside the new Recent history |

## The things you must not get wrong (delta to the original 10)

All ten rules from the original handoff README still apply verbatim. The addendum adds:

1. **T10 recaps contain no red and no ranking.** `permission off` is a neutral count;
   emergencies are listed plainly with a check-in nudge, never a discipline hook.
2. **Approvals copy is invitational** — "3 students want to join", never "requests
   pending review".
3. **The framing line** ("Patterns are conversation starters, not verdicts.") is
   designed copy on T6 · Activity, T10, and T3 · Recent.
4. **T8's Phone toggle is locked on and honest** ("Always available — iOS can't shield
   it"), and the device-mapping explainer is verbatim — exceptions are display names the
   teacher typed, never read from devices.
5. **T9 never starts a useless session:** empty class → join-code path; past end time →
   inline validation; already active → blocked with a link to the live grid.
6. **Context-aware primary action** (Start vs Open live) must come from one shared
   component — T1 cards, T1 schedule, and T6 header may never disagree.
7. **T6 must survive Dynamic Type XL** exactly as the proof frame shows: reflow, never
   truncate; the segmented control scrolls.
8. **No surface may imply device contents.** T3 · Recent has deliberately no drill-down.

## Demo content

Same canonical data as the original handoff (Ms. Rivera · Period 3 — Algebra II ·
28 students with the exact §6 distribution · join code `KM3W7Q2A` · tag `T7XK2M9QPF`),
plus the addendum's: new-class **Period 4 — Precalculus** with join code **`QV4N8R1C`**,
join requests Dana Cole / Leo Marsh / Sofia Reyes, member-default-no-device Hana Sato
(Period 1) and Priya Shah (Period 3), recap medians 41–47 min. No lorem ipsum.

## Provenance

Designed as "pass 5" against `docs/00-addendum-spec.md`, in the addendum's working order
(T1 rev → T6 → T9 → T10 → T7 → T8 → T12 → T3 rev), reusing the original tokens and
components with zero additions. Every screen was gate-checked: icon+label states
(grayscale-safe), red discipline, voice laws, no surveillance-shaped layouts, 44pt
targets, and the T6 Dynamic Type XL proof.
