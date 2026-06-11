# 05 · Web Pages (W1–W10 · Teacher Portal · Marketing Landing)

> Design files at bundle root of `design-files/`. W-pages are presented as labeled
> 1440px frames inside review sheets (multiple page-states per file); the **Teacher
> Portal** and **Landing** are full standalone pages (open them directly — they are the
> closest thing to "the real product" in this bundle). Target stack: Next.js + Tailwind +
> shadcn/ui. Tokens map via `tokens/tailwind.tokens.js`.

## App shell (all /app pages)

216px sticky sidenav on `--surface-card` with 1px right border: brand row (18px arc mark +
"Bali" 16/600) · nav items 14/500 secondary (17px Lucide icons, 8/10 padding, radius 8;
active = sunken bg + 600 primary) — Home, Classes, Policies, Tags, Reports, Logs,
Settings · footer row: 28px avatar circle (green-200 bg, initials green-800) + "Ms.
Rivera / Jefferson High" + sign-out icon. Main column: max 1190px, padding 24–30/32–36.
Realistic viewport min-height 790px. At 1024 the shell holds (sidebar fixed, content
flexes); cards stack full-width.

---

## W1 · /login — in `W1-W3 Login Fallback Classes.html`

Centered 380px stack on page bg: 40px arc mark · "Bali" 24/600 · "Focus sessions for your
classroom" 14 secondary · card (radius 14, padding 24): Email + Password labeled inputs,
full-width primary "Sign in", "or" hairline divider, secondary "Continue with Google" ·
footnote below card: "Students don't sign in here — they use the iOS app." Quiet,
brand-forward, no marketing hero.

## W2 · /t/[code] phone fallback (mobile-width, 393)

What a phone browser shows when a tag/QR resolves without the app: 52px arc mark · 24/600
"This desk tag opens in Bali" · explainer naming the class · mono tag-code pill
`T7XK2M9QPF` · bottom: full-width primary **"Open in Bali"** (deep link) + App Store
badge (placeholder — replace with the real badge asset).

## W3 · /app — class list (+ create flow)

- **List:** "Classes" h1 + secondary "+ New class". Class cards: name 17/600; live class
  gets mini focused-chip "Live · ends 10:45" + primary "Open live grid" + secondary
  Roster; idle classes show sub "24 students · next session 12:05" + ghost Roster + chevron.
- **Empty state (new teacher):** empty arc ring · "Set up your first class" 20/600 ·
  "Name it, pick a policy, and put the join code on the board. Desk tags can come later —
  students can always join by code." · primary "Create a class".
- **Create dialog** (460px modal over dimmed list, radius 14, shadow-3): "New class"
  19/600 · Class name input · two half-width selects: "Meets" (Mon–Fri · 11:00–11:45)
  and "Policy" (Lecture, hinted "most used") · caption restating the policy's allowed
  apps · hairline · "Require approval to join" toggle (off; sub "Otherwise the code
  admits anyone who has it") · Cancel ghost + "Create class" primary.
- **Created state:** arc-check mark · "Period 4 — Precalculus is ready" · "Put the join
  code on the board — students join from the Bali iOS app." · JoinCodeBadge card-size
  (`QV4N8R1C`) + Copy / "Project this" · full-width primary Done · footnote "Desk tags
  are optional — add them any time from Tags."

## W4 · /app/classes/[id]/live — THE page — `W4 Live Dashboard.html`

Spend the most engineering care here. Header: 44px medium arc · h1 26/600 class name ·
policy caption · countdown block (28/32 rounded tabular + "ends 10:45 AM") · right:
secondary "Extend" + quiet-destructive "End session…" (red text, confirm dialog — not a
red slab). Below: summary strip (mini chips with per-state counts) · LiveGrid
`repeat(4, 1fr)` gap 10 — 28 grid-size chips, full labels, **no scroll at 1440**.
AlertToaster stack top-right (18px inset). StudentPanel slides over the right edge
(372px, full height, border-left) on chip click.

Six required states (all mocked in the file):
| state | specifics |
|---|---|
| (a) Healthy mid-session | the §6 distribution; mostly quiet green by design |
| (b) Emergency toast lands | sticky orange toast; with the panel open the toast docks LEFT of it and BELOW the header (top ~150px) so countdown + summary stay readable; Sam's chip pulses twice softly; panel shows timeline + GrantPassForm + no-device toggle |
| (c) No active session | header drops countdown ("28 students · no session running"); inline start card: Ends-at (next bell 10:45) + Policy selects, allowed-list caption, primary "Start session"; no fake empty grid |
| (d) Live, 0 tapped in | summary "0 Focused / 28 Not in"; hint row with nfc icon: "Students tap the desk tag to start — names light up here as they join."; all-gray grid |
| (e) Reconnecting | ReconnectingPill pinned top-center; recently-unsynced chips carry an extra "20s" stale badge; grid stays interactive |
| (f) Projector / full-screen | sidebar gone; padding 36/48; h1 36, countdown 44; summary at grid-chip size; projector chips (52px, 20/600); must read in grayscale by icon+label alone |

## W5 · Roster — in `W5-W7 Roster Policies Tags.html`

Two columns (1fr / 360px). Left: **pending-approval card floats above the table** —
orange-50 header strip ("Waiting for approval", user-plus icon), rows: name 600 +
"entered code today" + primary Approve / secondary Decline. Members table (wtable style:
uppercase 11.5/600 tertiary headers on sunken bg, 14px cells): Member / Right now (mini
state chips) / Joined / quiet "Remove…" ghost. Right: join-code card — JoinCodeBadge
card-size + Copy + "Project this" (projects the code at 88px full-screen).

## W6 · Policies

Left: policy list cards (Lecture — selected w/ focus ring, Quiz, Lab; each "used by N
classes"). Right: PolicyEditor (spec in 03-components.md) with Save primary and guarded
delete: red ghost "Delete policy…" + caption "In use — detach from 3 classes first."

## W7 · Tags

h1 + caption "NFC tags + printable QR — students tap either to start focus" + primary
"New tag". TagCard grid (3 cards in mock). Deactivation warning + the note that NFC
writing happens on iPhone (T4); web prints the QR sheets. QR in mocks is a striped
placeholder — production renders a real QR as SVG, print-ready.

## W8 · Reports — in `W8-W10 Reports Logs Settings.html`

Header: h1 "Reports" + **the framing line as designed copy directly beneath, italic
body-lg: "Patterns are conversation starters, not verdicts."** + secondary "Export CSV"
(the export embeds the same framing line in its header row). Filter chips row (flat
pills; active = green-700 bg white text): class filters + time range. Two columns
(1.4fr/1fr), **labels OUTSIDE both cards at the same y so the table and card tops align**:
- "Emergency unlocks · 6 this month" table: When (tabular) / Student / Reason ("skipped"
  in tertiary — never highlighted) / Session / "Last 6 wks" sparkline (5px orange-300
  bars, zero-weeks stone-200). Caption: "A repeating sparkline is a nudge to check in
  privately…"
- "Focus minutes per session" card: per-class bars (green-700 on sunken track) + "41 min
  avg" tabular. Caption: "Out of a 50-minute period. No per-student minute rankings exist
  anywhere — averages only."

## W9 · /app/logs

Filter chips by type (All/Emergencies/Passes/Permission/Sessions) and class. EventTimeline
rows reused verbatim (state dots, what + sub, clock time). Cursor pagination: secondary
"Load older events."

## W10 · /app/settings

Plain fast forms, max 560px: Profile card (Name / "Shown to students as" — the one
opinionated field: it's what every student screen prints / School) · "Email me about"
toggles (Emergency unlocks — always also on the dashboard / Permission turned off
mid-session / Weekly summary) · primary Save.

---

## Teacher Portal home — `Bali - Teacher Portal.html` (standalone, full-viewport)

The logged-in landing (route suggestion: `/app` home). Sidenav has **Home** active
(padding-top 32px so the brand row's center aligns with the greeting h1 center at 47px
from the top edge — keep this alignment).

- **Greeting:** h1 28/34 "Good morning, Ms. Rivera" + meta "Wednesday, June 10 ·
  Jefferson High · next bell 10:45".
- **Live-now card** (green-200 border to read "alive"): 46px arc + class h2 + "Live ·
  Lecture — …" meta + ticking countdown 30/34 right · full six-state summary strip ·
  primary "Open live grid" + secondary Roster + tertiary note "Sam T.'s unlock is waiting
  in the grid."
- **Today schedule rows:** time column 78px rounded tabular; past rows 55% opacity
  ("Done"); the live row green-bordered with "Now" + Open link; future rows get secondary
  "Start at 12:05" buttons (prefilled start = bell + last policy). Sublines must stay
  one line (`.what { flex: 1; min-width: 0 }`).
- **Right rail (340px):** "Waiting to join" approvals card (same rows as W5) · "Recent
  activity" EventTimeline (3 events) + "Open the full log" link.
- Entrance: 450ms fade-up stagger (60ms steps), snap-safe (see 06).

## Marketing landing — `Bali - Landing.html` (standalone)

Public page; separate world from the app but same tokens. Sticky blur topnav (wordmark ·
How it works / The exit / Privacy / **Sign in → Teacher Portal** · small primary "Book a
demo"). Sections, in order, each `data-screen-label`ed:

1. **Hero** (grid 1.05/0.95): kicker "Bali for schools" · display 64/68 "Fifty focused
   minutes. *One tap.*" — em in green-700 with an 11px green-200 **underline bar that
   sweeps in** (scaleX 0→1, 550ms, delay ~1.05s, z-index −1) · 19/30 lede · "Book a demo"
   primary-big + "See how it works" ghost-big · trustline "Built on Apple Screen Time ·
   Students always hold the exit". Right: 330px dark phone card — class header, **198px
   live arc that draws in on load and ticks every second**, allowed-apps row, and a
   **fully interactive hold-to-unlock demo** ("Try it — hold for one second"). Three
   floating mini chips around the phone (gentle 5.5s float loop, staggered).
   **Ambient layer:** two huge dashed SVG rings (960 + 1340px, green-200/stone-200
   strokes) centered ~72% left, rotating 80s/150s in opposite directions behind everything.
   **Cursor tilt:** on fine pointers, the phone tilts up to ±8°/±6° (perspective 1100px)
   following the mouse with 0.085 lerp; chips parallax-translate by `data-depth`
   (0.9/1.5/1.2 × 24px). Disabled for touch + reduced-motion.
2. **How it works** (#how): 3 step cards (mono num, 46px icon tile green-100/green-700 —
   icons **pop in** with springy scale stagger, 0/80/160ms) — Tap the desk tag / Focus
   together / The bell ends it.
3. **The exit** (#trust): dark band (radius 28, #141312): orange kicker "The part we
   designed first" · "The exit is always unlocked" · supportive copy + 3 orange-icon
   bullets (offline, optional reason w/ Skip, honest-by-design) · right: second live
   hold-to-unlock demo.
4. **For teachers:** two-col — copy ("'Is anything wrong?' — answered from six feet") +
   glance card: summary chips + 3×3 chip grid that **cascades in** (50ms stagger pops).
5. **Privacy** (#privacy): the contract card, two columns, marketing-voiced but same content.
6. **Book a demo** (#demo): green-800 band, radius 28, with a slow-spinning thin dashed
   ring (70s) + a static thick ring bottom-left · h2 42 "Bring Bali to your classroom" ·
   email input + white primary "Book a demo" · fine print "Free for your first class. No
   student accounts, no credit card."
7. Footer: wordmark + "Focus sessions for classrooms" + links.

Scroll behavior: sections fade-up (`.rise`, 600ms) on entering 92% viewport; see
06-interactions-motion.md for the robust reveal implementation (polling + snap) — this
matters, do not regress it.
