# 04 · iOS Screens (Student S1–S10 · Teacher T1–T5)

> Design files: `design-files/pass3/*.html` — open any of them in a browser; each page
> shows multiple 393×852 device frames with edge-case notes in gray outside the frames,
> and a pill nav linking all iOS pages. Frames use a shared scaffold
> (`pass3/scaffold.jsx` + `pass3/ios-frame.jsx`, React via Babel) — that scaffolding is
> presentation-only; the screens themselves are the spec. Student screens are
> **dark-mode-first** (`[data-theme="dark"]` token scope); teacher screens light.
> Status-bar time inside frames is 10:22 (mid-session realism).

Common layout constants: safe-area horizontal padding 20pt · content starts ≥74pt from
top (status bar) · bottom-anchored content ends 48pt from bottom (home indicator) ·
primary full-width buttons 50pt radius 14.

---

## S1 · Onboarding — `pass3/S1 Onboarding.html` (5 frames)

3 cards + the permission moment. Page dots under content; full-width primary CTA.

1. **What it does:** 150pt arc illustration (72% progress, check center) · Title1 "Your
   class, focused together" · body secondary "Bali quiets every app except the ones your
   class allows — until the bell." · Continue.
2. **The privacy contract (the trust moment — most visual weight):** Title1 "What your
   teacher sees". Card (radius 20) with two columns split by hairline:
   SEES (green-300 label, circle-check icons): "Your focus status" / "When you tap in and
   out" / "When you unlock, and the reason if you share one".
   NEVER SEES (tertiary label, eye-off icons): "Your screen" / "Your apps or what's in
   them" / "Your messages or location".
   Footnote: "This is the whole list. It never grows without asking you again."
   This card is restated verbatim on S9 Privacy.
3. **How tap-in works:** simple-shapes illustration (circle tag labeled TAG mono, tilted
   phone rectangle, green waves icon) · "Tap the desk tag to start" · "Everything comes
   back at the bell — or instantly, any time, with Emergency Unlock. No questions asked."
4. **Permission framing → native dialog:** shield-check icon · Title1 "iOS will ask for
   Screen Time permission" · honest body (it's the switch that lets Bali shield apps;
   stays under student control; teacher just sees "permission off" if revoked) · CTA "Ask
   me" · footnote "You can change this any time in Settings." Overlaid: the NATIVE iOS
   alert ("'Bali' Would Like to Set Up Screen Time" / Don't Allow · Continue) — system
   surface, untouched.
5. **Denied state (calm):** shield-off tertiary icon · "Screen Time stayed off" · "No
   problem — Bali just can't shield apps without it. Turn it on whenever you're ready." ·
   primary "Open Settings" · quiet secondary "Join without focus (status-only)" with the
   one-line consequence: "You'll show as 'not in' during sessions, and apps stay unshielded."

## S2 · Join Class — `pass3/S2 Join Class.html` (4 frames)

Large title "Join a class" + sub "Enter the code from the board, or scan its QR."

1. **Code entry (keyboard up):** 8 cells 38×48, radius 10, mono 22/600, auto-uppercase;
   active cell ring-green border; "Scan QR instead" (qr-code icon + brand-green 15/600)
   above the system keyboard. Paste fills all eight.
2. **Class found (informed consent):** filled cells · preview card (radius 20): Title2
   class name, "Ms. Rivera · Mon–Fri, 10:00–10:45", "During focus, this class allows"
   tertiary footnote + AllowedAppsRow — ALL BEFORE the "Join class" button. Footnote
   "You can leave any time in Settings."
3. **Invalid code:** cells border red-500 (clears on next keystroke, no shake) + red-300
   13px helper "That code doesn't match a class — check the board."
4. **Pending approval:** full green arc with hourglass center · Title1 "Request sent" ·
   "Ms. Rivera approves new members… You'll get a notification when you're in." · Done (secondary).

## S3 · Home — `pass3/S3 Home.html` (6 frames)

Large title "Today" + settings glyph. StatusBanner on top (see components), then CLASSES
label + class rows (name headline, "10:00–10:45 · Ms. Rivera" footnote, trailing
next-time hint or live Focused chip + chevron).

Frames: Free · Focused (banner mini-arc live; class row shows Live chip) · Unlocked
(banner with Re-focus) · Permission-off (amber PermissionHealthRow slots between banner
and classes) · **Light variant** (same structure on warm paper) · Empty state (empty arc
+ plus, "No classes yet", "Join with the code your teacher put on the board.", primary
"Join a class").

## S4 · Tap-In Confirmation — `pass3/S4 Tap-In.html` (4 frames)

The breath before focus — one screen, one decision, generous space.

1. **Ready:** centered: "You tapped into" subhead → Title1 "Period 3 — Algebra II" →
   Title2-light "until 10:45" → AllowedAppsRow (+ "These stay available. Everything else
   rests.") → bottom: primary **Start Focus** + footnote "Ends at the bell — or instantly
   with Emergency Unlock."
2. **Verified offline:** same + top mini chip (focused style, wifi-off icon) "Verified
   offline — your tap still counts."
3. **Not a member:** user-plus icon · "This tag belongs to Period 3 — Algebra II" ·
   "You're not in this class yet. Join it first — the code's already filled in." ·
   primary "Join Period 3 — Algebra II".
4. **Session not started:** clock icon · "Ms. Rivera hasn't started a session" · "You're
   early. Focus begins when the session does — we can start you automatically." · primary
   "Start my focus when the session starts".
   (A needs-policy-setup tap routes to S5 before ever reaching this screen.)

## S5 · Policy Setup — `pass3/S5 Policy Setup.html` (3 frames)

One-time per policy; shaped by the honesty constraint (iOS never reveals chosen apps).

1. **The ask:** list-checks icon · "One-time setup for Ms. Rivera's policy" · "This policy
   allows **Notes, Camera, Calculator**. iOS keeps your app list private, so you pick the
   matching apps yourself:" + 3-app AllowedAppsRow · primary "Select apps on my phone" ·
   footnote "Opens the iOS app picker. Bali never sees the list."
2. **Native FamilyActivityPicker:** Apple's sheet rendered as-is (dark system list,
   Cancel/Choose Activities/Done, search, app rows with blue circle checks). Untouched.
3. **Return — count mismatch:** scan-eye orange-300 icon · "You picked 2 apps" · "The
   policy lists **3** — Notes, Camera, Calculator. We can't see which apps you chose, so
   double-check your picks match the list." · secondary "Re-open picker" + primary
   "Looks right — confirm". (Matching count: green check, "iOS will keep exactly these
   available during focus," single Confirm.)

## S6 · Focus Active — `pass3/S6 Focus Active.html` (6 frames) — THE flagship

Layout (dark): header 74pt down — Title2 class name + "with Ms. Rivera · ends 10:45 AM"
subhead secondary, centered → flex space → hero arc 244pt (time 56pt rounded tabular,
"until 10:45" 15pt) → 34pt gap → AllowedAppsRow → flex space → bottom-anchored
EmergencyUnlockControl (64pt, label wraps 2 lines) + HoldHintLabel, 48pt above bottom.

Frames:
1. **Normal** — motion note: on tap-in the apps settle first, then the arc draws in once
   (600ms): the product's only theatrical moment. Nothing else on this screen animates;
   time ticks with tabular digits.
2. **Final 2 minutes** — arc 4% remaining, stroke 12, `--arc-final2`; numerals green-200.
   Emphasis, not alarm.
3. **Reconnecting** — quiet pill under header: "Reconnecting — focus continues offline."
   Non-blocking; unlock works offline.
4. **Pass active** — arc adopts blue-400 and counts the pass: time 4:32, subline "pass
   ends 10:39"; mini pass chip under header: "Pass — shields return automatically."
   Unlock control never leaves.
5. **Light variant** — same hierarchy on warm paper.
6. **XL Dynamic Type (~XXL)** — type ×1.24, arc 218pt, control 76pt with wrapped label.
   Nothing truncates.

## S7–S9 — `pass3/S7-S9 Sheet History Settings.html` (5 frames)

- **S7 Post-emergency sheet** (auto-presents after unlock, over dimmed unlocked Home):
  grabber · Title2 centered "You're unlocked. Everything OK?" · subhead "Sharing a reason
  is optional — it goes only to Ms. Rivera." · five chips **Family / Medical / Safety /
  Other / Skip** — identical size (flex 1 1 30%, 13pt pad, radius 14, raised bg, 16/600),
  Skip not smaller/grayer · one tap dismisses · quiet footnote "Ms. Rivera was notified."
  Zero guilt styling.
- **S8 History** (personal-only): "This week" card — day bars Mon 88 / Tue 41 / Wed 63 /
  Thu 0 / Fri 37 min (today's bar green-400, others green-700) + "3h 12m focused" ·
  streak row (flame icon green-300) "4 school days in a row with a full session" ·
  SESSIONS rows ("Fri · Period 3 — Algebra II", "37 min · 1 unlock" — unlocks logged
  factually, never flagged). **No comparisons, no leaderboards, nothing grades-adjacent.**
- **S8 Session detail:** back link · "Tuesday, June 9" Title1 · "Period 3 — Algebra II ·
  41 focused minutes" · EventTimeline card (Tapped in 10:02 / Emergency Unlock — reason:
  skipped 10:31 / Re-focused 10:35 / Session ended at the bell 10:45) · footnote "Only
  you see this page. Teachers see session status, never this history."
- **S9 Settings:** PermissionHealthRow-ok on top · groups: Account (Jordan Park) +
  Privacy · class rows (tap to see policy or leave) · About Bali 1.0.
- **S9 Privacy page:** "The contract from day one — unchanged." Restates S1 card verbatim
  + the honest revocation note: "Shielding runs through Apple's Screen Time on your
  phone. You can revoke it in iOS Settings at any time — your teacher would simply see
  'permission off.'"

## S10 · Shield screen — `pass3/S10 Shield.html` (2 frames)

Strictly within Apple's six ShieldConfiguration primitives (see 01-product-spec). Dark
and light wallpaper variants: blurred material with green-tinted darkness (or warm-neutral
tint on light) · arc-mark icon 64pt · title 22/600 "Focused with Ms. Rivera" · subtitle
15 "Until 10:45 · Emergency? Open Bali" · primary "OK" (#2C6F51, radius 14, max 280pt) ·
secondary text button "Open Bali" (green-300 dark / green-600 light). The subtitle names
the emergency path — the shield never traps.

---

## T1–T2 — `pass3/T1-T2 Teacher Home Live.html` (5 frames, light)

- **T1 Home:** large title "Classes" · class cards (shadow-1, radius 18): live class
  shows "Live · ends 10:45" focused-chip + primary "Open live grid" + Roster; idle
  classes one-line with next-session time · ghost "+ New class".
- **T1 Start Session sheet:** grabber · "Start a session" + class name · two prefilled
  rows: "Ends at **12:50** (next bell)" + "Policy **Lecture**" with chevrons · caption
  restating the policy's allowed list · full-width primary "Start session".
- **T1 Empty state:** empty arc + "Set up your first class" + "A class takes about a
  minute: name it, pick a policy, and put the join code on the board." + primary.
- **T2 Live Grid (phone, walking the room):** compact header (38pt arc + class headline +
  "23:14 · ends 10:45" + Extend / End small buttons) · summary mini chips with counts ·
  2-column grid of 46pt phone-chips (icon 16, name 15/600, label 12.5 stacked) · §6
  distribution · scrolls to all 28.
- **T2 + emergency toast:** AlertToaster slides under the header, full-width, sticky;
  Sam's chip gets one soft pulse.

## T3–T5 — `pass3/T3-T5 Teacher Detail Tags.html` (6 frames, light)

- **T3 Student detail sheet** (tap any chip): name Title2 + "tapped in 10:02 · iPhone" +
  current-state chip · this-session EventTimeline card · GRANT A PASS (segmented
  5/10/15/Custom + reason input + primary + auto-return caption) · "No device today"
  toggle ("Marks Sam out of today's grid only").
- **T4 Tag list:** rows (nfc icon, label 600, mono code, Active chip / Off) + primary
  "Write a new tag". Tags are class-scoped; printing happens on web (W7).
- **T4 Write flow:** label input ("Only you see labels — name it by where it'll live.")
  → NATIVE iOS NFC sheet ("Ready to Scan", blue NFC tile, "Hold your iPhone near the
  tag.", Cancel) — system surface, untouched.
- **T4 Written + verify:** full arc check · "'Window desk' is live" · "Stick it where
  students tap. Test it with your own phone before class…" + secondary "Verify with my phone".
- **T4 Deactivate confirm (native alert):** "Deactivate 'Front desk'?" / "Every printed
  copy of this tag stops working immediately. Students can still join by code." /
  Cancel · red Deactivate.
- **T5 Passes & alerts:** ACTIVE PASSES rows (ticket icon, "Aisha Khan", "'nurse' ·
  Period 3", live 4:32 tabular blue) · NOTIFY ME toggles: Emergency unlocks (on) /
  Permission turned off (on) / Pass endings (off) · footnote "Emergencies always alert on
  the dashboard regardless of phone settings."
