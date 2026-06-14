# Bali — Teacher iOS Addendum (full-control teacher app)

> **Purpose.** The brief scoped the teacher iOS app as a thin companion to the web
> dashboard. This addendum upgrades it so a teacher can **run everything from the phone** —
> create classes, manage rosters and approvals, edit policies, write tags, watch the live
> grid, and review reports — without ever opening a laptop. It revises T1 and T3 from the
> brief and adds T6–T12.
>
> **Inherits all the brief's laws.** State system (§2), voice/microcopy (§5), motion budget
> (§11), and the non-negotiables (red only for revoked/destructive; lock-status-only;
> patterns are conversation starters, not verdicts) apply unchanged. Teacher screens are
> **light-mode-priority** per the brief; SwiftUI-native (nav stacks, sheets with detents,
> `List`/`Form`, SF Symbols); 393×852; 44pt min targets; full Dynamic Type.
>
> **The one guardrail for "more comprehensive."** Add depth about *participation and
> status*, never about *what students are doing on their phones*. No app-usage, no browsing,
> no location surfaces exist to add — if a proposed addition would need that data, it's out.

---

## Parity map (web → iOS home for each capability)

| Web | iOS home in this addendum |
|---|---|
| Teacher hub (W3a) + class list (W3) | **T1** (revised) |
| Create class (W3b) | **T12** |
| Live grid (W4) | T2 (brief) |
| Student detail (sheet) | **T3** (revised — adds cross-session history) |
| Roster + approvals (W5) | **T7**, also surfaced in **T6** |
| Policies (W6) | **T8** |
| Tags (W7) | T4 (brief), also surfaced in **T6** |
| Reports (W8) | **T11** |
| Cross-class logs (W9) | T1 activity feed + **T6** per-class activity |
| Settings (W10) + passes | T5 (brief) |
| — (gap on both) | **T6 · Class Detail** (the missing hub for a single class) |
| — (flow gap) | **T9 · Start Session** (pre-session ready), **T10 · Session Recap** |

---

## T1 · Teacher Home — REVISED (the daily hub)

**Problem with the current version:** the class list is bare — no counts, no schedule, no
sense of what's live. Fix it on two levels.

**Loaded class cards.** Each class card now carries, at a glance: class name, meeting
schedule ("MWF · 9:50"), **student count** (e.g. "28 students"), a **live indicator** when a
session is running (pulsing dot + countdown), and "last met" relative time when idle. Tap a
card → **T6 Class Detail**. A card's primary action button is context-aware: **Start** when
idle and scheduled now, **Open live** when a session is active.

**Hub content above the cards** (this is the W3a portal brought to iOS):
- **Greeting + live-now card.** "Good morning, Ms. Rivera." If any session is active, a
  prominent card (class, medium countdown, summary counts per §2 state) → T2.
- **Today's schedule** with prefilled **Start** buttons — each scheduled class today as a
  row with one-tap start that opens T9 pre-filled.
- **Approvals badge** — if pending join requests exist across classes, a count chip linking
  to T7's approvals view. Time-sensitive, so it lives up top.
- **Recent activity** — last handful of cross-class events (EventTimeline style) → T1 expands
  or links to a full feed.

**States:** new-teacher empty (no classes → big Create Class CTA → T12); idle (no live
session — schedule + cards); live (live-now card present); approvals-pending vs none.

## T6 · Class Detail — NEW (the per-class hub the app was missing)

**Purpose.** Everything about one class, on the phone. This is what a class card taps into
and the screen that makes "operate from iOS" real. A segmented control or scrolling sections
— pick one and commit (recommend a sticky segmented control: **Overview · Roster · Policy ·
Tags · Activity**).

- **Header:** class name, schedule, student count, join-code chip (tap → big projectable
  `JoinCodeBadge` + share), and a primary **Start Session** button (→ T9) or **Open Live**
  (→ T2) when active.
- **Overview:** quick stats — members, sessions this week, last session recap link,
  this-class focus-minutes average (framed neutrally). Edit class (name, schedule,
  auto-approve toggle, default policy) lives here behind an Edit button.
- **Roster:** inline T7 content scoped to this class (members + pending approvals).
- **Policy:** the class's default policy shown read-only with an Edit → T8 link, plus
  "change default policy" picker.
- **Tags:** this class's tags (T4 TagCard rows) with Write New Tag (→ T4 flow) and
  deactivate.
- **Activity:** this class's event stream (EventTimeline, cursor-paginated) — the per-class
  slice of W9.

**States:** active-session banner pinned at top when live; archived class (read-only,
restore action); empty roster ("Share the join code to add students").

## T7 · Roster & Approvals — NEW

**Purpose.** Manage membership from the phone — the time-sensitive one (a kid joining
mid-class) that no teacher will walk to a laptop for.

- **Pending approvals** section at top when present: each request = student name + "Approve"
  / "Decline" inline, with a batch "Approve all." This is the screen the T1 approvals badge
  and T6 Roster tab point at.
- **Members** list: name, status, joined date; swipe or detail action to remove (confirm).
  Search/filter when a class is large.
- **Mark default no-device** per student (carries into sessions as the `no_device` state).

**States:** approvals-present vs clean; empty class; member-removed confirmation; large-class
search. **Microcopy:** "3 students want to join Period 3" — invitational, never "requests
pending review."

## T8 · Policies — NEW (list + editor on iOS)

**Purpose.** Create and edit policy descriptors without the web. Reuses the web PolicyEditor
concept in a SwiftUI `Form`.

- **List:** policies the teacher owns, each showing name + allowed summary ("Notes, Camera,
  Calculator") + "used by N classes."
- **Editor:** name; **system toggles** (Phone — always-on, shown informational and disabled,
  with the honest note that Phone can't be shielded on iOS; Messages); **exceptions** as a
  tag-input list of app display names; and the device-mapping explainer verbatim — *"Students
  pick these apps on their own phones. Bali can't choose apps for them, and can't see which
  they picked — it only knows how many."* Delete guarded when in use.

**States:** create vs edit; in-use delete guard; empty (first policy CTA). Keep the
explainer prominent — this is where the §6/D6 token-opacity honesty lives.

## T9 · Start Session — NEW (the pre-session "ready" beat)

**Purpose.** Replace the abrupt jump from tap-Start to live grid with a confirmation that
gives the teacher control and content. A sheet with detents.

- **Confirm:** class, **policy** (defaults to class default, changeable), **end time**
  (defaults to next bell from schedule, editable via wheel), and **expected students** count.
- Big **Start Session** button → creates the session → T2 Live Grid.
- Optional "remind me at end" toggle (local notification, no APNs needed in v1).

**States:** default prefilled; another session already active for this class (block with
"End the current session first" → link); end-time-in-past validation; no active members
("No students have joined yet — share the join code" with a path to T6).

## T2 · Live Grid — keep, with two additions

Unchanged from the brief, plus: a **summary strip** above the grid (counts per §2 state, the
6-foot read) and **Extend/End** in the header wired to T10 on end. Alert banners for
emergency/revoked as specced.

## T3 · Student Detail — REVISED (pattern, not just this moment)

The brief's sheet showed only the current session. Add a **second tab/section: recent
history** — this student's last ~5 sessions as compact rows (date, outcome: focused / N
emergencies / permission-off), so the teacher can see a pattern. Keep the framing line
("Patterns are conversation starters, not verdicts") visible. Current-session timeline,
GrantPassForm, and Mark-no-device stay. **No drill-down into device contents — none exists.**

## T10 · Session Recap — NEW (the closing beat)

**Purpose.** When a session ends, give it a summary instead of a blank return. Auto-presents
on end (and reachable from T6 history).

- Headline stats: stayed-focused count, emergencies (with reasons, listed plainly),
  permission-off count, pass count. A small focus-minutes figure.
- Tone: neutral recap, not a scoreboard. No per-student ranking, no "worst offenders."
- Actions: "Done," "View full log" (→ T6 Activity), and for any emergency, a quiet "follow
  up with [student]" note — a nudge to talk, not a discipline hook.

**States:** clean session (all focused — celebrate lightly, "Smooth period."); session with
emergencies/revocations (calm, factual); short/aborted session.

## T12 · Create Class — NEW (iOS parity with W3b)

**Purpose.** Spin up a class from the phone. Sheet form: class **name**, **meets**
(schedule string), **default policy** (picker, or "create one" → T8), **auto-approve joins**
toggle (default on). On create → the **join-code reveal**: big projectable `JoinCodeBadge`,
"Project this for students," share action, and a link onward to T6.

**States:** form validation (name required); first-class-ever variant with a one-line
"here's how students join" explainer; success/reveal.

## T5 · Settings & Passes — keep

As briefed: active passes list with countdowns; account; **local** notification prefs
(session-end reminder, emergency alert — all on-device in v1); about; privacy page (restates
what teachers see / never see). No additions needed.

---

## What this deliberately still does NOT add

No app-usage charts, no browsing/website data, no location, no per-student "focus score"
exported anywhere, no leaderboards or class-vs-class comparisons, no discipline/referral
hooks. The teacher app is now comprehensive for *operating the product* — sessions, rosters,
policies, tags, recaps — while staying inside the lock-status-only, conversation-starter
posture that is the whole reason schools can trust it.

## For the designer — working order

Do these after the brief's T1–T5 pass, in this order: **T1 revision → T6 → T9 → T10**
(the core operate-from-phone loop), then **T7 → T8 → T12** (management parity), then the
**T3 history revision**. Same deliverable format as the brief §13: high-fidelity SwiftUI-
shaped mockups, light mode priority, real §6 demo content (Ms. Rivera / Period 3 / the
28-student distribution), final copy per §5, edge-case states annotated outside the frame.
Run the §6 non-negotiable gate on every screen before presenting.
