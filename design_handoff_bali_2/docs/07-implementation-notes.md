# 07 · Implementation Notes — how the prototypes were built & how to recreate them

## How this design was produced (context for reading the files)

The work followed a four-pass process against the brief in `00-original-brief.md`:

1. **Pass 1 — Foundations** (`Pass 1 - Foundations.html` + `tokens/`): the token system.
   The sheet computes WCAG contrast ratios live from rendered pixels and includes a
   grayscale toggle to prove the state system survives colorblindness. Two AA fixes were
   made during review: light `ended`/`no_device` fg moved stone-500→stone-600; dark
   moved `#837D74`→`#A39D94`; dark primary buttons use green-400+ink because green-500
   fails AA with any text color.
2. **Pass 2 — Component sheet** (`Pass 2 - Component Sheet.html` + `pass2/components.css`):
   every component in every state. `components.css` is REUSED by all later files — it is
   the de-facto component library of the prototypes and the best single file to study.
3. **Pass 3 — iOS** (`pass3/`): 10 review sheets, 393×852 frames, dark-first. Built with
   React 18 + Babel-standalone purely as a templating convenience (`ios-frame.jsx` device
   bezel + `scaffold.jsx` helpers: `Frame`, `Sheet`, `Arc`, `Chip`, `Unlock`, `AppsRow`).
   The React code is NOT product code — read the rendered output as the spec.
4. **Pass 4 — Web** (`pass4/web.css` + root `W*.html`): static HTML/JS sheets showing
   1440px page states. Then two standalone pages were added on request: the **marketing
   landing** and the **teacher portal home**, plus a product rename
   (FocusClass → **Bali**) applied across every file.

Review happened with a verifier on every pass; notable corrections beyond the AA fixes:
unlock label clipping at 393pt (label now wraps, never clips), W4 chip-label ellipsis at
5 columns (grid is 4-up now), toast overlapping the header when the StudentPanel is open
(toast docks below header at top≈150px), and the landing reveal/frozen-timeline saga
documented in `06-interactions-motion.md`.

## What the design files are (and are not)

**These are high-fidelity design references in HTML — not production code.** Recreate
them in the target codebase's environment using its patterns. Pixel values, hexes, copy,
and interaction timings in these docs are normative; the HTML/JS implementation details
(Babel, lucide CDN, the scaffolding) are not.

## Recreating on iOS (SwiftUI, iOS 16+)

- Tokens → an asset-catalog + `Color`/`Font` extension layer. Dark variants are explicit
  hexes (NOT system inversions); set them as any-/dark-appearance colors per token.
- Type: Dynamic Type text styles per the mapping in `02-design-tokens.md`;
  `.fontDesign(.rounded)` + `.monospacedDigit()` for countdowns and join codes' numerals.
- The arc: `Circle().trim(from: 0, to: pct).stroke(style: .init(lineWidth:, lineCap: .round)).rotationEffect(.degrees(-90))`;
  draw-in with a single 0.6s `withAnimation` on first appear; respect `accessibilityReduceMotion`.
- EmergencyUnlockControl: `LongPressGesture(minimumDuration: 1.0)` driving a width-anchored
  overlay fill + `CoreHaptics`/`UIImpactFeedbackGenerator` ramp; on `.accessibilityAction`
  expose "Unlock now". Spring-back via `.spring(response: 0.28, dampingFraction: 0.7)`.
- Screen Time: `FamilyControls` (AuthorizationCenter), `ManagedSettings` (shields),
  `DeviceActivity` (session schedule), `ShieldConfigurationDataSource` for S10 — its six
  fields are the ONLY customization; values in `04-ios-screens.md`.
- NFC: `NFCNDEFReaderSession` (system sheet appears as mocked); tag payload = the tag
  code; offline tap verification per S4.2 ("Verified offline — your tap still counts").
- System surfaces (permission alert, FamilyActivityPicker, NFC sheet) come from the OS —
  the mocks show how the app frames them before/after, never restyles them.
- Lists/forms: stock `List`/`Form` with inset-grouped styling; cards via `RoundedRectangle`
  backgrounds on the token surfaces.

## Recreating on web (Next.js + Tailwind + shadcn/ui)

- Drop `tokens/tokens.css` into the global stylesheet; merge `tokens/tailwind.tokens.js`
  into `tailwind.config.js` `theme.extend`. Dark mode = `[data-theme="dark"]` attribute
  strategy (students never see web, so web ships light-first; dark optional later).
- Fonts: `next/font/google` — Instrument Sans (400–700 + italic) and JetBrains Mono
  (400–700). Apply `font-variant-numeric: tabular-nums` (Tailwind `tabular-nums`) on
  every timer/table number.
- Icons: `lucide-react`, strokeWidth 1.75 everywhere.
- shadcn mapping: Button/Input/Switch/Tabs(segmented)/Dialog(create-class)/Sheet
  (StudentPanel)/Toast(AlertToaster — extend with the 3px state top-border + sticky
  variants)/Table(wtable)/Badge(StatusChip — custom component, don't force Badge).
- StatusChip, SessionCountdown (SVG as in `pass2/components.css`), EmergencyUnlockControl,
  EventTimeline, JoinCodeBadge, ReconnectingPill: build as first-class components with
  the exact state classes from `03-components.md`.
- Live data: the grid expects server push (WebSocket/SSE); ReconnectingPill appears on
  transport loss with the honest staleness copy; chip changes are 150ms crossfades, an
  emergency arrival pulses the chip twice and raises a sticky toast.
- Routes per `05-web-pages.md`; the portal home is `/app`.
- The landing page is a separate marketing route (or separate site) sharing only tokens.

## Suggested data model (minimum to drive every screen)

```
School(id, name)
Teacher(id, school_id, name, display_name)            // "Shown to students as"
Class(id, school_id, teacher_id, name, schedule, policy_id, join_code, require_approval)
Policy(id, name, messages_allowed, extra_app_labels[]) // Phone always allowed
Tag(id, class_id, label, code, active)
Membership(student_id, class_id, status: pending|active, joined_at)
Session(id, class_id, policy_id, started_at, ends_at, ended_at?)
Participation(session_id, student_id, state: not_joined|focused|pass|emergency_unlocked|revoked|no_device|ended,
              tapped_in_at?, last_seen_at)
Pass(id, session_id, student_id, minutes, reason?, granted_at, ends_at)
Event(id, session_id?, class_id, student_id?, type: tap_in|focus_start|pass_granted|pass_ended|
      emergency_unlock|reason_shared|revoked|session_start|session_end, payload, at)
```
Privacy invariants to enforce server-side: no screen/app/location data exists anywhere;
emergency reasons are nullable and student-supplied only; student history (S8) is
student-visible only; reports expose averages, never per-student minute rankings.

## Known prototype artifacts (ignore when porting)

- React/Babel + lucide CDN `<script>` tags, `mountSheet`, crumbs pill navs, gray
  annotation notes outside frames — review-sheet chrome only.
- The reveal-polling/snap JS on the landing/portal (port the PATTERN, see 06, or use a
  proper animation library).
- QR placeholders (striped), the App Store badge placeholder, generic app glyphs — all
  await real assets.
- File names use plain hyphens (e.g. `Bali - Landing.html`); em-dashes in titles are
  display-only.
- `0.55em`-style numbers in dead code paths were removed; if you spot a stray
  `anim-settled` rule with no animation left to settle, it guards the underline sweep.

## Definition of done (per the brief's self-review checklist)

Every §2 state visible somewhere with icon+label, never color-only · red only for
revoked/destructive · emergency path reads safe and shame-free · the grid passes a
6-foot squint test · dark student screens feel native, not inverted · the XL Dynamic
Type layout doesn't break · copy obeys the voice laws (no banned words; "notified,"
never "reported"; Skip first-class) · no banned visual defaults · every interactive
element has a visible focus state · `prefers-reduced-motion` respected everywhere.
