# 06 · Interactions, Motion & Haptics

The motion budget is deliberately small. Everything in the PRODUCT is ≤300ms with
`--ease-standard` (cubic-bezier(0.2, 0, 0, 1)) except the one 600ms theatrical moment.
Every animation has a `prefers-reduced-motion` variant (crossfade or none). The marketing
landing page is allowed a slightly bigger budget (ambient loops, tilt) — the app is not.

## The five product choreographies (nothing else animates)

1. **Tap-in → Focus Active (the one theatrical moment).** The allowed-app chips settle
   first (quick fade/scale, ~200ms staggered), then the hero arc draws in ONCE over
   600ms (`--motion-arc`). Implementation pattern (from the prototypes): set
   `stroke-dasharray = C`, start `stroke-dashoffset = C`, then after a double
   `requestAnimationFrame` transition it to `C * (1 - pct)` (the prototypes use 1100ms
   on the marketing hero; the app spec is 600ms). Reduced motion: render at final
   position with a simple crossfade.
2. **Hold-to-unlock.** 1.0s linear fill, orange-400, edge-to-edge; iOS haptics ramp
   (light ticks → medium) during the hold; success = single "thud" + immediate unlock
   transition. Early release = 280ms spring-back (`--ease-spring`), no error, no haptic
   punishment. See 03-components.md for full anatomy and the duplicate-clipped-label
   technique used to keep text readable over the fill.
3. **Grid chip state changes.** 150–200ms crossfade of bg/fg (`--motion-fast`). An
   emergency chip additionally gets ONE soft pulse: `box-shadow: 0 0 0 0 rgba(219,147,71,.45)`
   → `0 0 0 14px transparent`, 1.2s, **2 iterations max**, then rest. No infinite blinking.
4. **Toast slide-in.** 200ms from the right (web) / from the top (iOS); crossfade under
   reduced motion. Sticky variants do not auto-dismiss.
5. **Countdown final-2-minutes emphasis.** A one-time visual shift (stroke 10→12,
   lighter fill, brighter numerals) — animated as a 300ms crossfade, announced once to AT.

Timers tick by swapping tabular-numeral text every second — never tweened, zero layout shift.

## Landing-page motion (marketing only)

- Section reveals: `.rise` fade-up 18px, 600ms, triggered at 92% viewport entry, with
  per-element `transition-delay` staggers (60–320ms).
- Child "pops": `.pop` elements (step icons, glance chips) scale 0.9→1 + fade with
  `--ease-spring`, staggered 50–160ms, triggered by the parent's reveal.
- Headline underline sweep: scaleX 0→1, origin left, 550ms, delay ~1.05s after load.
- Ambient rings: 80s/150s opposite-direction rotations, dash patterns 5/16 and 2/12.
- Cursor tilt + parallax: lerped rAF loop (factor 0.085), fine pointers only.
- CTA ring: 70s rotation.
- ALL of the above are disabled or finalized under `prefers-reduced-motion: reduce`.

## ⚠️ The frozen-timeline lesson (read before porting the landing/portal JS)

The prototypes were reviewed inside an embedded webview that **freezes the CSS
animation/transition timeline and rAF while keeping JS timers running**, and that can
report `window.innerHeight = 0` well past the `load` event. Two real bugs shipped and
were fixed during design review; the fixes are good practice for any embedded context
(iframes, previews,某些 webviews):

1. **Reveal-on-scroll must not depend on IntersectionObserver alone or on fixed-time
   retries.** Final pattern (in `Bali - Landing.html`): a rect-based `reveal()` using
   `innerHeight || clientHeight || 800` as the viewport, wired to scroll + resize, PLUS a
   250ms polling interval that keeps retrying until the first element matches (cleared
   after success or 8s).
2. **Entrance transitions must "snap" to their final state via JS timers.** After adding
   the revealed class AND inline `opacity: 1; transform: none`, a `setTimeout` (~1050ms,
   covering the longest stagger) sets `transition: none` on the element and on all its
   `.pop` children with final inline styles. A `body.anim-settled` class (added at 1.9s)
   force-finishes any pure-keyframe animations (the underline sweep).

In a normal browser none of this is visible — users get the full animation; the snaps are
no-ops that land after the transitions already finished. Keep the pattern when porting,
or replace it with Framer Motion / CSS `animation-fill-mode: forwards` + the same
settle-class fallback.

A third gotcha: a per-word staggered headline (`<span>` per word, inline-block transforms)
was attempted and **reverted** — it fought `text-wrap: balance` and broke line composition.
If you want word staggers, disable `text-wrap: balance` on that heading and test wrapping
at 1024 first.

## iOS haptics map

| moment | haptic |
|---|---|
| hold-to-unlock progress | `UIImpactFeedbackGenerator(.light)` ticks ramping to `.medium` |
| unlock completes | `UINotificationFeedbackGenerator(.success)` |
| early release | none (no punishment) |
| tap-in confirmed | `.light` single |
| pass granted (teacher) | `.light` |
| emergency toast arrives (teacher phone) | `.warning` notification |

## Navigation & flows (prototype link graph)

- Landing "Sign in" → Teacher Portal. Portal sidenav → W-page sheets (in production:
  real routes `/app`, `/app/classes/[id]/live`, `/app/classes/[id]/roster`,
  `/app/policies`, `/app/tags`, `/app/reports`, `/app/logs`, `/app/settings`).
- W4 chip click → StudentPanel slide-over; toast "Open student" → same panel.
- iOS: S2 join → S3 home; NFC tap → S4 (→ S5 if policy unmapped) → S6; unlock → S7 sheet
  → S3 (unlocked banner, Re-focus → S6); T2 chip → T3 sheet.
- Review sheets have a pill nav (crumbs) linking every iOS page and every web sheet —
  these are review aids, not product navigation.

## State machine (student session, for implementation)

```
not_member → (join code / QR, optional approval) → member
member + session_live + tap → needs_policy_setup? → S5 → ready
ready → start_focus → FOCUSED (shields on)
FOCUSED → hold 1.0s → EMERGENCY_UNLOCKED (notify teacher, queue offline) → S7 sheet
EMERGENCY_UNLOCKED → re-focus → FOCUSED
FOCUSED → teacher grants pass → PASS (shields off, timer) → auto → FOCUSED
FOCUSED/any → revoke Screen Time in iOS Settings → REVOKED (teacher sees "Permission off")
any → bell/end_session → ENDED (shields off automatically)
```
Teacher-side derived states: `not_joined` (session live, member hasn't tapped),
`no_device` (teacher-set flag for today only). Staleness = last-heartbeat age, an
overlay on any state, threshold badge at ~2–4 min (mock shows "4m" and "20s" variants).
