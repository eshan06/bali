# Bali — Verified Improvement Roadmap

> Produced 2026-06-12 by a four-lens ideation pass (student / teacher / administrator /
> design-vs-code auditor), where **every idea was adversarially verified against the
> actual source** — each entry below survived a judge agent that checked it isn't
> already built, doesn't violate the product's hard values (no surveillance, no
> rankings, privacy contract, honesty over theater), and is buildable on the current
> architecture. Judge notes carry file:line evidence and implementation corrections —
> read them before building; several fix mistakes in the original proposal.
>
> **Hard values gate every item** (from design_handoff_bali_2/docs/01-product-spec.md):
> teacher sees focus STATUS only; no leaderboards/comparisons/grades-adjacent anything;
> red only for revoked/destructive; banned vocabulary; the student always holds the exit.

## Recommended build order

1. **P0 — the honesty-bug cluster** (all small, ~1-2 days total): honest arc math ·
   queue the volunteered reason · S2 preview-before-join · S6 reconnecting pill ·
   wire the email notifier. Each one is a place the app currently *promises something
   it doesn't do* — the product's own standard makes these bugs, not features.
2. **P1 — highest felt-value per line of code, one per persona**: Lock-screen Live
   Activity (student) · join approvals on the teacher phone (teacher) · school invite
   code gating teacher bootstrap (admin — this is the closest thing to a security hole:
   today ANYONE who signs into Cognito and picks "teacher" becomes a teacher).
3. **P2 — finish the designed S4/S2 variants**: auto-start arm, join-with-code-prefilled,
   QR scan, offline tap-in (large), T4 verify, keep-awake S6.
4. **P3 — bigger swings**: sessions that start themselves at the bell · solo focus ·
   bell schedules · multi-school · retention/rollover/exports.

## Overlap map (same idea surfaced from multiple lenses — build once)

- Offline tap-in: `student` + `gap-audit` entries describe the same feature; the
  gap-audit judge note has the server-side caveats (late-replay 409, tag-code caching).
- QR scan: `student` + `gap-audit` — gap-audit judge note has the critical routing
  correction (W7 QRs carry TAG codes, not JOIN codes — resolve first, then join).
- Teacher phone approvals: `teacher` + `gap-audit` — endpoints live in routes/teacher.ts.
- S4 auto-start + S4 join-prefill: `student` combined entry + two separate `gap-audit`
  entries with deeper evidence.


---

## Designed-but-unbuilt (the design already blessed these — highest legitimacy)

### Restore S2 informed consent: preview before join  `(small)`

**What:** Add a lookup endpoint (e.g. GET /v1/classes/preview?code=) that returns class name, teacher, schedule, and allowed apps WITHOUT creating a membership, and change JoinView so the 8th character shows the preview card with an explicit 'Join class' button — exactly the doc 04 §S2.2 frame. Today JoinView.swift:141 fires POST /v1/join on code completion and domain.ts joinByCode creates the membership instantly; the card's button is 'Done', meaning the student is enrolled (or files a pending request) before seeing what they agreed to.

**Why:** The design calls this frame 'informed consent' — the student reads 'During focus, this class allows…' before committing. A kid who mistypes or copies a code from the wrong board is currently silently joined to a stranger's class with no decision moment. This is the privacy contract's front door and the code inverted it.

**Surface:** apps/api/src/routes/student.ts + domain.ts (new preview lookup), ios/Bali/Bali/Features/JoinView.swift

**Judge notes (evidence + build corrections):** Verified, not built, and the friction is real: JoinView.swift:141 POSTs /v1/join the instant the 8th character lands, and domain.ts:817-833 inserts the membership and appends a member_joined/member_requested audit event in that same call — so the 'preview' card (whose buttons read 'Done', lines 99/118) is shown after enrollment, inverting doc 04 §S2 frame 2 which requires the consent info 'ALL BEFORE the Join class button'. The file header even claims 'preview BEFORE the join (informed consent)', which the code contradicts — an honesty-over-theater bug in itself. No preview endpoint exists in apps/api/src/routes/. Fix is small and schema-free: a read-only GET preview that reuses joinByCode's lookup/response shape (minus the transaction, plus existing-membership status) with the same limited(10) rate limit (the join endpoint already returns identical class/teacher/schedule/policy data on a valid code, so no new exposure), and a JoinView change making the card's primary button 'Join class' that fires the existing POST /v1/join. Also closes a quiet privacy wart: a mistyped code matching a stranger's class currently writes the student's name into that teacher's append-only event log with no decision moment.


### S4 'Start my focus when the session starts' (the early-student arm)  `(medium)`

**What:** When a tap resolves to session_not_started, replace the bare 'OK' (TapInView.swift:188-195) with the designed primary 'Start my focus when the session starts': store the armed class locally, have HomeModel poll student/home while armed, and when the session goes live auto-route through the S5 policy gate into startFocus, with a Home banner row showing 'Starting with Period 3 when the bell rings — cancel any time.' Cancel is one tap.

**Why:** Doc 04 §S4.4 designed this verbatim ('we can start you automatically'). The early student is the BEST-intentioned user in the whole product — they tapped before the bell — and today the app tells them 'you're early' and drops them back into their phone, which is exactly the drift the product exists to prevent.

**Surface:** ios/Bali/Bali/Features/TapInView.swift + HomeView.swift/HomeModel + FocusEngine.swift (no API change needed)

**Judge notes (evidence + build corrections):** Verified unbuilt: TapInView.swift:188-195 ships the bare 'OK' dismiss for session_not_started, and no arming/auto-start mechanism exists anywhere in the iOS app (only SessionWatchdog.arm, which handles session end). The behavior is designed verbatim in docs/04-ios-screens.md:87-89 ('we can start you automatically' / primary 'Start my focus when the session starts'), making this a designed-but-unbuilt gap that closes real friction for the best-intentioned user. Buildable iOS-only: GET /v1/student/home (apps/api/src/routes/student.ts:47) already returns per-class open session + participation state for the armed poll, and FocusEngine.startFocus is the existing entry point — no API or schema change. One implementation note the proposer got right: at not_started time resolution.session is nil, so the live-transition must re-check ScreenTime.hasSelection for the now-known labels and detour through PolicySetupView (S5) before startFocus.

**Value reframe required:** Mild strain on 'honesty over theater': iOS suspends backgrounded apps, so foreground polling can't literally guarantee focus starts at the bell if the phone is locked — it starts on next foreground. Reframe fixes it: honest banner copy ('starts the moment we see the session begin — or when you next open your phone') plus a foreground-trigger check in HomeModel; the opt-in, one-tap cancel, and ever-present emergency unlock keep the student holding the exit.


### S4 not-a-member tap routes into Join with the code prefilled  `(small)`

**What:** The not_member variant (TapInView.swift:197-204) currently says 'the code from the board works any time' over an 'OK' button. Build the designed version: primary 'Join Period 3 — Algebra II' that opens JoinView with all eight cells prefilled from resolution.joinCode (the field already exists on TagResolution — HomeView.swift:248 constructs it) and the preview card already showing. One tap from desk tag to joined.

**Why:** Doc 04 §S4.3 specifies 'the code's already filled in.' The real moment: first day of class, a student taps the tag before joining, hits a dead end, and now has to find the board, read 8 characters, and type them — while the teacher is starting the lesson. The tag already knows the class; making the student re-type it is friction the design explicitly removed.

**Surface:** ios/Bali/Bali/Features/TapInView.swift + JoinView.swift (accept an initial code)

**Judge notes (evidence + build corrections):** Verified unbuilt: TapInView.swift:197-204 not_member variant is a dismiss-only 'OK' dead end, while design doc 04 §S4.3 explicitly specifies primary 'Join Period 3 — Algebra II' with the code prefilled. All plumbing exists: the API resolve response returns joinCode for every variant (apps/api/src/routes/student.ts:164), TagResolution already decodes it (ios/Bali/BaliCore/Models.swift:56), and JoinView only needs an initialCode init param plus one routing callback from TapInView wired in HomeView. No schema, auth, or API changes. It closes a real, pointable friction (first-day tap-before-join dead end) and is literally finishing a designed-but-skipped frame.

**Value reframe required:** empty-ish nuance, not a conflict: JoinView auto-POSTs /join when the 8th character fills (JoinView.swift:57-58, 141), so prefilling means joining on arrival — but consent is preserved because the student reaches it only via an explicit 'Join Period 3 — Algebra II' tap on a screen naming the class and teacher; pending memberships idempotently show 'Request sent'. No reframe needed.


### S6 Reconnecting pill — the code already claims it exists  `(small)`

**What:** Add a published reachability flag to FocusEngine (flip false on heartbeat failure, true on success) and render the designed quiet pill under the FocusActiveView header: 'Reconnecting — focus continues offline.' Non-blocking, no animation, disappears on the next good heartbeat. FocusEngine.swift:141 literally comments 'offline: focus continues, the UI shows the reconnect pill' — but no pill exists anywhere in the view and no state is published.

**Why:** Doc 04 §S6 frame 3 is one of the six required flagship frames. On flaky school Wi-Fi a student staring at this screen for 50 minutes gets zero signal that anything changed — and 'honesty over theater' means telling them the truth: connection dropped, focus continues, unlock still works offline. The comment proves the engineer intended it and the wire was never connected.

**Surface:** ios/Bali/Bali/Core/FocusEngine.swift + Features/FocusActiveView.swift

**Judge notes (evidence + build corrections):** Verified gap: FocusEngine.swift:141 comments 'offline: focus continues, the UI shows the reconnect pill' on heartbeat failure, but no reachability state is published (@Published vars are only state/session/className/teacherDisplayName) and grep finds zero reconnect/pill UI in FocusActiveView, the rest of ios/Bali, or HANDOFF.md. Design doc 04-ios-screens.md:121 specifies this exact pill as S6 frame 3, a required flagship frame. Fix is purely client-side: one published Bool flipped in the existing heartbeat success/failure paths (debounce 1-2 misses to avoid flicker) plus a conditional pill in FocusActiveView. No API, schema, or auth changes. Honest copy is accurate because emergency unlock is already local-first and offline-safe.


### Offline-verified tap-in (S4 frame 2)  `(large)`

**What:** Generalize the existing UserDefaults unlock queue into an event queue and make tap-in offline-safe: cache tag-code→class/session mappings from student/home and prior resolves, and when tags/resolve or tap-in fails on network, start focus locally (shields on, watchdog armed from the cached endsAt) while queueing the idempotent tap-in (clientEventId already exists, FocusEngine.swift:38) for replay. Show the designed chip: 'Verified offline — your tap still counts.'

**Why:** Doc 04 §S4.2 designed this frame; today startFocus throws on any network error and the student just can't tap in. The real moment is brutal and common: the bell rings, 28 phones hit the school AP simultaneously, and the students trying hardest to comply get an error. The unlock path is already fully offline-safe — the product protects the exit but not the entrance.

**Surface:** ios/Bali/Bali/Core/FocusEngine.swift (queue), Features/HomeView.swift resolveTag fallback, TapInView.swift chip; API untouched (tap-in is already idempotent)

**Judge notes (evidence + build corrections):** Verified against code: not built (FocusEngine.swift:37-49 startFocus throws on any network error; the UserDefaults queue at line 26 is unlock-only; HomeView.swift:81-88 even mislabels network failure as 'This tag isn't active'), designed (doc 04 §S4.2 specifies the exact 'Verified offline — your tap still counts' chip), and the server already supports it (tapIn in domain.ts is idempotent on clientEventId line 456 and accepts backdated tappedAt clamped to now line 430). Two caveats the proposal undersells: (a) student/home (student.ts:47-126) returns no tag codes, so offline verification only works for previously-resolved tags unless a tiny additive tagCode field is added to the home payload — no schema change needed (tags already has classId); (b) a tap-in replayed after the bell hits the 409 session_over guard (domain.ts:420-421) and would be silently dropped by the queue's 4xx-drop rule, so the offline tap never reaches the audit trail — needs a deliberate decision (accept, or small server allowance for late tapped_in events). Neither blocks the idea; both are build-time line items. It also fixes an existing honesty bug (network error shown as 'tag isn't active') and restores entrance/exit symmetry with the already-offline-safe unlock path.


### S2 'Scan QR instead' — close the loop the copy already promises  `(medium)`

**What:** Add the designed 'Scan QR instead' affordance (qr-code icon, brand-green, above the keyboard) to JoinView using VisionKit's DataScannerViewController, parsing both the printed-QR URL form (<origin>/t/<code>, which W7's print sheets encode) and bare codes, then feeding the existing resolve/join path. JoinView.swift:24 already says 'Enter the code from the board, or scan its QR' — the scanner just doesn't exist.

**Why:** W7 (built, with real SVG QRs and a print stylesheet) produces classroom QR sheets whose only in-app consumer is missing: a student inside the join screen who points their camera at the sheet has no way to use it, despite the screen's own copy telling them to. Camera scan also beats typing 8 characters from 6 feet away at the back of the room.

**Surface:** ios/Bali/Bali/Features/JoinView.swift + BaliCore DeepLinks URL parsing (reuse /t/<code> route)

**Judge notes (evidence + build corrections):** Verified unbuilt: no QR/camera/VisionKit code anywhere in the student app (grep clean; no NSCameraUsageDescription in any Info.plist) — JoinView.swift:24 promises 'or scan its QR' with no scanner, and the design spec (04-ios-screens.md:51) explicitly calls for the 'Scan QR instead' affordance. The friction is real and pointable: W7 (apps/web/src/app/app/tags/page.tsx:26) prints QRs encoding <origin>/t/<code> with no in-app consumer from the join screen. Buildable as proposed with one routing correction: W7 QRs carry desk TAG codes, not class JOIN codes (different code spaces — POST /v1/join takes an 8-char join code; tags use POST /v1/tags/resolve). The fix is already in the API: tags/resolve returns joinCode and a 'not_member' variant (student.ts:152-164), so the scanner resolves a tag URL and either feeds joinCode into the existing join preview or hands off to S4 if already a member; bare 8-char scans go straight to /v1/join. URL parsing for both https://<host>/t/<code> and bali://t/<code> already exists in BaliCore/NFC.swift:14 — reuse it verbatim. Implementation surface is exactly as claimed plus NSCameraUsageDescription and iOS 16+/device gating with graceful fallback to typing. No schema or auth changes.


### Teacher iOS roster with join approvals (the missing T1 'Roster')  `(medium)`

**What:** Doc 04 §T1 puts a Roster button on every class card; grep shows zero roster surface in BaliTeacher/. Build a roster sheet reusing the existing manage.ts endpoints web W5 already calls: member list with current-state mini chips, the pending-approval card on top (Approve / Decline), and the quiet remove path. Light theme, same wtable hierarchy as W5.

**Why:** Today a student who enters the code sits at 'Pending' (JoinView.swift:93-99 promises 'you'll see the class once you're in') until the teacher gets back to a laptop — but the teacher with approval-required classes is standing at the door with their iPhone as students file in. The approval moment is a hallway moment, and the phone app can't do it.

**Surface:** ios/Bali/BaliTeacher/ (new TRoster view + T1Home card button), existing apps/api/src/routes/manage.ts endpoints

**Judge notes (evidence + build corrections):** Genuine designed-but-unbuilt gap with verified friction. Doc 04 line 168 puts a Roster button on the T1 class card, but BaliTeacher/ contains only T1Home/T2Live/T3Student/T4Tags/T5Passes with zero calls to roster or membership endpoints (HANDOFF.md:127 confirms T1's built scope is class cards + live chip + start-session sheet). The student-side promise is real: JoinView.swift:96 tells pending students "approves new members. You'll see the class on Home once you're in" — and the teacher's phone cannot deliver that approval today, only the web portal can. All needed API exists and is teacher-gated: GET /v1/classes/:id/roster (active+pending split), POST /v1/memberships/:id/approve and /decline, DELETE /v1/memberships/:id — though in apps/api/src/routes/teacher.ts, not manage.ts as the proposal says (minor mislabel, does not affect buildability). Pure new-SwiftUI-view work reusing the existing TeacherModels API client pattern; no schema changes, no auth redesign.


### Wire the email notifier so the notify toggles stop being theater  `(medium)`

**What:** Implement the stubbed notifier (HANDOFF §7) behind the four notify_* prefs that T5 and W10 already expose: on emergency-unlock and permission-revoked events (hook the existing bus.ts publish points), send a calm, banned-vocabulary-clean email to teachers who opted in ('Sam T. used Emergency Unlock in Period 3 at 10:31 — reason: shared/skipped'), plus the weekly summary job. SES or SMTP via env, dev mode logs to console.

**Why:** Both apps ship fully-built toggle UI — 'Email me about Emergency unlocks (on)' — that silently does nothing. That is the product's own honesty rule violated against the teacher: the UI promises a behavior that doesn't exist. The felt moment is the one the spec centers: a student unlocks for a safety reason during a teacher's prep period and the teacher who explicitly asked to be notified never is.

**Surface:** apps/api/src (new notifier module + bus.ts/domain.ts unlock+revoked hooks, env.ts), no UI changes

**Judge notes (evidence + build corrections):** Verified not built: HANDOFF §7 backlogs exactly this ('email notifier stub wiring for the four notify_* prefs'), env.ts has no email config, and no mailer code exists in apps/api/src — while the four prefs are real in schema.ts:80-84 and exposed as toggles in W10 (apps/web/src/app/app/settings/page.tsx) and BaliTeacher T5. The idea repairs the product's own honesty rule twice: the teacher toggle that silently does nothing, and the student-facing promise 'your teacher will be notified' (docs/01 line 63) which is currently only true if the teacher is watching the live grid. Disclosure stays inside the existing contract — doc 01 line 68 already tells students teachers see unlock times + shared reasons. Concretely buildable with zero schema changes: users.email exists (schema.ts:76), clean hook points sit at domain.ts's emergency_unlock event write (~651) and permission_revoked (~518); minor correction that hooks belong in domain.ts, not bus.ts (per-session SSE fanout, no teacher identity).

**Value reframe required:** Mild strain, fixable by framing: (1) reason is usually pending at unlock time (post-unlock sheet) — email must honestly say 'no reason shared yet' or delay briefly, never imply the student owes one; (2) the notifyWeekly summary must mirror the existing aggregate reports (class-level), never per-student minute rankings; (3) email copy is a new surface for the banned-vocabulary rule ('notified' never 'reported') — the proposal already commits to this.


### Honest arc math: stop hardcoding 50-minute sessions  `(small)`

**What:** FocusActiveView.pct (lines 191-199) and MiniArc.pct (HomeView.swift:409-413) divide remaining time by a hardcoded 50*60, so a 30-minute session draws at 60% from the first second and a 5-minute pass renders a sliver instead of 'counting the pass' as doc 04 §S6.4 specifies. Carry startsAt (and pass grant time) through ResolvedSession/MyParticipation so the arc fraction is remaining/(end-start) for sessions and remaining/passDuration for the blue pass arc.

**Why:** The arc is the product's single theatrical moment and its main honesty instrument — a face-up phone showing visibly wrong progress for any non-50-minute period quietly teaches students the display lies. Any teacher who extends a session (already supported on web and T2) makes the arc jump dishonestly today.

**Surface:** packages/shared/dto.ts + apps/api/src/serialize.ts (add startsAt/pass duration), ios FocusActiveView.swift + HomeView.swift MiniArc

**Judge notes (evidence + build corrections):** Verified bug, not built: FocusActiveView.swift:191-199 and HomeView.swift:409-413 both hardcode 50*60 as the arc denominator, and ResolvedSession (BaliCore/Models.swift:67-73) carries no start field, so any non-50-minute session or pass draws a wrong fraction. Doc 04 line 123 explicitly specifies the pass arc 'counts the pass' and line 119 ties arc percent to session fraction. Fix needs no schema change — sessions.startedAt and passes.grantedAt already exist in the DB; gaps are the inline session payloads in apps/api/src/routes/student.ts (resolve ~L170, home ~L112), heartbeat session info in serialize.ts:53, and the two iOS pct computations. Minor correction: serializeSession already emits startedAt, so the API work is in the student route payloads and heartbeat, not the session serializer. Directly serves the 'honesty over theater' value; teacher extend (already shipped) makes the current arc actively dishonest today.


### T4 'Verify with my phone' after writing a tag  `(small)`

**What:** After the NFC write succeeds, the built screen only shows advisory copy ('Test it with your own phone before class', T4Tags.swift:278-283); doc 04 §T4 designed a secondary 'Verify with my phone' button. Add it: invoke TagCodeReader (already in BaliCore, teacher app already has NFC entitlements), resolve the scanned code, and confirm with the full-arc check that it maps to this class and tag — or say plainly which tag it actually is.

**Why:** A teacher sticking tags on desks before first period has no way to know a write took until a student fails to tap in mid-lesson — the worst possible discovery moment. The design closed this loop with one button and all the pieces (reader, resolve endpoint, written-state screen) already exist in the codebase.

**Surface:** ios/Bali/BaliTeacher/T4Tags.swift + BaliCore TagCodeReader; possibly a teacher-auth allowance on tags/resolve in apps/api/src/routes

**Judge notes (evidence + build corrections):** Designed but unbuilt: doc 04 line 194 specifies the secondary 'Verify with my phone' button; the built written state in ios/Bali/BaliTeacher/T4Tags.swift has only advisory copy + Done, and BaliTeacher has zero TagCodeReader usages. All pieces exist — TagCodeReader is in BaliCore/NFC.swift:30, and the teacher target already uses TagCodeWriter from the same file, proving BaliCore membership and the NFC entitlement are in place. The minimal build needs no API or schema change: compare the scanned code locally against createdTag.code and the already-fetched class tag list; cross-class identification would optionally need a teacher-auth allowance on /v1/tags/resolve (currently studentGate-only, apps/api/src/routes/student.ts:129), which the proposal correctly flagged. Closes real friction at the worst discovery moment (a failed write found mid-lesson by a student).



---

## Student experience

### Lock-screen Live Activity: the phone face-up on the desk stays honest while locked  `(medium)`

**What:** Start an ActivityKit Live Activity at tap-in: the arc mark, 'Focused with Ms. Rivera', and a native countdown timer to the bell (Apple renders the timer with zero updates needed). It turns blue with the pass countdown when a pass is granted, and ends itself at the bell with a brief 'Everything's back' state. Dynamic Island compact view shows the tiny arc + remaining time.

**Why:** The design's whole premise is the phone sitting face-up for 50 minutes — but iOS auto-locks after ~1 minute and the flagship screen becomes a black rectangle, which to a 16-year-old reads as 'my phone is dead and confiscated.' A calm timer on the lock screen makes the locked phone look intentional, like a clock — the most Apple-native 'ok this is actually fine' moment available. Purely on-device, shows nothing a teacher can see.

**Surface:** New iOS widget-extension target (ActivityKit) + start/update/end hooks in ios/Bali/Bali/Core/FocusEngine.swift (startFocus, heartbeat extend, pass case, sessionEnded); no API changes.

**Judge notes (evidence + build corrections):** Novel and closes documented friction: zero ActivityKit anywhere in shipping code (only hit is a legacy README's preview-bezel note), no widget extension target exists, and the in-app countdown goes dark the moment iOS auto-locks — the system-rendered Text(timerInterval:) lock-screen timer is the only honest countdown that survives app suspension. All claimed FocusEngine hooks exist as named (startFocus, heartbeat endsAt-extension sync, pass case, sessionEnded), and the repo already has the multi-extension Xcode setup (BaliMonitor, BaliShield) to add a widget target. One implementation caveat to carry forward: no background runtime and no push, so mid-lock state changes (pass grant recolor, formal end at bell) can only apply on next app wake — use the native timer plus staleDate=endsAt for the bell, and update the pass state on wake/heartbeat, which is when the student looks anyway. No API or schema changes.


### Offline tap-in — build the designed 'Verified offline — your tap still counts' frame  `(large)`

**What:** Cache each class's live-session snapshot (sessionId, endsAt, policy labels) from /v1/student/home; when an NFC tap can't reach the server, match the tag code locally, apply shields immediately, queue the tap-in POST (the API already accepts clientEventId + tappedAt for exact-time idempotent replay), and show S4's specced 'Verified offline' chip. Also add S6's 'Reconnecting — focus continues offline' pill, which FocusEngine.swift:141 already promises in a comment but FocusActiveView never renders.

**Why:** School Wi-Fi dies exactly when 28 phones hit one AP at the bell. Today the student taps, the resolve POST fails, and they're left looking like they refused to join while everyone around them is in — the worst possible first-week moment. The emergency unlock already got the offline-queue treatment (FocusEngine's pendingUnlocks); the design (doc 04, S4 frame 2 and S6 frame 3) specs the same dignity for tap-in, and the code skipped it.

**Surface:** ios/Bali/Bali/Core/FocusEngine.swift (session cache + tap-in queue mirroring the unlock queue), Features/TapInView.swift + FocusActiveView.swift (offline chip, reconnect pill); apps/api/src/routes/student.ts unchanged (tappedAt already supported).

**Judge notes (evidence + build corrections):** Verified gap, not speculation: FocusEngine.startFocus (ios/Bali/Bali/Core/FocusEngine.swift:37-49) does a blocking tap-in POST with tappedAt:nil and no queue, while the emergency unlock got the full offline queue (lines 173-219) — and the line-141 comment promises a reconnect pill that FocusActiveView never renders (grep confirms zero offline UI). The design explicitly specs both frames (doc 04 lines 82-83 'Verified offline — your tap still counts'; 121-122 'Reconnecting — focus continues offline'), so this is finishing designed work, not inventing. API is ready: student.ts:180-191 accepts clientEventId+tappedAt for idempotent backdated replay; the drop-on-4xx replay pattern already exists in flushUnlockQueue. One correction to the proposal: /v1/student/home (student.ts:47-127) does NOT return tag codes, so 'match the tag code locally' needs either (a) adding the class tag code to the home response (tags table already has code+classId; one join, no schema change) or (b) client-side caching of tagCode→class from prior successful /v1/tags/resolve calls (zero API change; first-ever tap of a tag still needs network, fine since that happens with the teacher present). SessionWatchdog already bounds offline shields at cached endsAt, so teacher-ends-early-while-offline degrades safely.


### Keep the flagship screen awake while it's on the desk  `(small)`

**What:** Set isIdleTimerDisabled while FocusActiveView is frontmost (cleared on disappear/background), and after ~60 untouched seconds soften the screen — dim the non-arc chrome so just the ticking countdown and the emergency control remain prominent, like the iOS Clock app during an alarm. Reduced-motion gets a plain crossfade.

**Why:** Doc 04 calls S6 'the screen that sits face-up on a desk for 50 minutes,' but nothing in FocusActiveView.swift prevents auto-lock — the product's only theatrical moment (the 600ms arc draw-in) is followed by the screen going black two minutes later. Mid-focus boredom is real; glancing at a live arc that says '23:14 left' is calming in a way a dark slab isn't.

**Surface:** ios/Bali/Bali/Features/FocusActiveView.swift only (onAppear/onDisappear idle-timer toggle + a dim phase state).

**Judge notes (evidence + build corrections):** Novel and verified unbuilt: no isIdleTimerDisabled anywhere in ios/, and FocusActiveView.swift's onAppear only handles the arc draw-in. It closes real, doc-pointable friction — doc 04 designs S6 as the screen that sits face-up on a desk for 50 minutes, but the build lets it auto-lock to a black slab in ~2 minutes, killing the product's flagship moment. Surface is exactly as claimed: one file, idle-timer toggle in onAppear/onDisappear plus a scenePhase clear, and the dim phase rides the existing 1s timer publisher (line 18) and a last-touch timestamp. No API, schema, or auth changes. Builder caveats: re-enable the idle timer when engine.state becomes .unlocked so an unlocked phone sleeps normally; any touch during dim restores chrome instantly and the emergency hold must work identically while dimmed; the dim doubles as battery mitigation for 50 min screen-on.

**Value reframe required:** Minor strain only, not a hard value: doc 04 says nothing on S6 animates after the one-time arc draw-in. Reframe fixes it — the soften is a single calm crossfade into a static dimmed state (no looping motion), reduced-motion gets a plain crossfade, and the emergency control stays at full prominence, which actually reinforces 'the student always holds the exit'.


### A volunteered reason never silently vanishes — queue it like the unlock  `(small)`

**What:** shareReason in FocusEngine.swift currently does `try? await api.postVoid(...)` and clears the pending unlock id regardless — if the student is offline (the exact moment they just emergency-unlocked, possibly walking out of the building), their chosen 'Medical' or 'Safety' evaporates and the teacher sees 'reason pending' forever. Persist the reason in the same UserDefaults-backed replay queue the unlock uses and flush it alongside.

**Why:** The reason chips are the one place a student volunteers something personal; Bali's contract says it 'goes only to Ms. Rivera.' A student who tapped 'Family' on a genuinely bad day believes the teacher knows — discovering it never arrived is a trust breach the audit-grade events table can't paper over. Honesty over theater means the sheet's promise must survive airplane mode.

**Surface:** ios/Bali/Bali/Core/FocusEngine.swift (extend PendingUnlock queue or a sibling pendingReasons queue + flush); apps/api/src/routes/student.ts /v1/unlocks/:id/reason already idempotent enough.

**Judge notes (evidence + build corrections):** Verified bug, not speculation: FocusEngine.swift:90-94 uses `try? await api.postVoid(...)` then unconditionally clears pendingReasonUnlockId, so an offline reason tap silently evaporates while the unlock itself enjoys a UserDefaults replay queue flushed on every heartbeat. Server side is already idempotent (domain.ts:673 `if (unlock.reason) return`) and 404s match the existing 4xx-drop path in flushUnlockQueue, so the fix is a sibling pendingReasons queue flushed alongside — client-only, no schema or auth changes. Builder note: key queued reasons by the unlock's clientEventId so a chip tapped fully offline (before the queued unlock has posted and yielded an unlockId) still attaches when the unlock lands.


### Build the designed S4 actions: one-tap join and 'Start my focus when the session starts'  `(medium)`

**What:** The not_member variant currently dead-ends at an 'OK' button even though the resolve response already carries joinCode — replace it with the designed primary 'Join Period 3 — Algebra II' that calls /v1/join inline and flows straight into tap-in. The session_not_started variant gets the designed 'Start my focus when the session starts': arm the class locally, and when the home poll/foreground refresh sees an open session, auto tap-in and shield.

**Why:** Both frames are fully specced in doc 04 §S4 (frames 3–4) and the code shipped 'OK' instead (TapInView.swift notStarted/notMember). The student who shows up early and taps the tag is doing exactly the right thing — telling them 'you're early, go away, remember to come back' punishes initiative; the new kid who taps before joining shouldn't have to find the board code when the server already told us it.

**Surface:** ios/Bali/Bali/Features/TapInView.swift (both variants), HomeView/FocusEngine (armed-class auto-start on refresh); student.ts resolve already returns joinCode.

**Judge notes (evidence + build corrections):** Verified gap: TapInView.swift lines 188-204 ship both not_member and session_not_started variants as dead-end 'OK' buttons, while design doc 04 §S4 frames 3-4 spec primary 'Join Period 3 — Algebra II' and 'Start my focus when the session starts' actions. No armed/auto-start logic exists anywhere in the student app. Server side is ready: /v1/join exists (student.ts:39) and resolve already returns joinCode (student.ts:164). Buildable with zero schema changes. One nuance to handle: joinByCode (domain.ts:815) returns membershipStatus 'pending' when the class requires approval, so inline join flows straight to tap-in only for no-approval classes — the pending branch needs a 'request sent' state, not the ready screen. Auto-start firing only on poll/foreground (no push) is an honest, acceptable limit the proposal already acknowledges.


### Tell a pending student the truth at the tag: 'Request sent', not 'Join it first'  `(small)`

**What:** student.ts's resolve variant collapses membership.status === 'pending' into 'not_member', so a student who already requested to join taps the desk tag and is told 'You're not in this class yet. Join it first' — gaslighting them into re-entering a code they already entered. Add a 'pending' variant returning the designed S2.4 copy ('Ms. Rivera approves new members…') and render it as its own calm frame in TapInView.

**Why:** First contact with Bali for a kid in an approval-required class is this exact tap, and the current copy makes them doubt their own memory in front of the class. The fix is a three-line server change plus one view variant, and the design already wrote the words.

**Surface:** apps/api/src/routes/student.ts (/v1/tags/resolve variant decision, line ~153) + ios/Bali/Bali/Features/TapInView.swift (new case).

**Judge notes (evidence + build corrections):** Verified bug: apps/api/src/routes/student.ts:153-158 maps membership.status==='pending' to 'not_member', and TapInView.swift:197-204 tells that student 'You're not in this class yet. Join it first' — false for a kid who already requested. Fix is even smaller than proposed: membershipStatus is already in the resolve response (student.ts:166) and already decoded on iOS (BaliCore/Models.swift:58); add a 'pending' variant server-side (preserving the 'server decides one truth' pattern) plus one infoVariant case in TapInView. The exact pending frame already exists in JoinView.swift:92-101, so copy and styling can be reused verbatim. No schema, auth, or events-table changes. Directly serves 'honesty over theater' at the highest-stakes moment (first tap in front of the class).

**Value reframe required:** Minor honesty strain only: the design's literal S2.4 copy promises 'You'll get a notification when you're in,' but no push notifications exist anywhere. Reframe fixes it — use JoinView's already-shipped honest rewrite ('You'll see the class on Home once you're in.') for the new TapInView pending case.


### Scan the board instead of typing: QR join (S2's promised 'Scan QR instead')  `(medium)`

**What:** JoinView's subtitle literally says 'or scan its QR' but no scanner exists. Add an in-app camera scanner (AVCaptureMetadataOutput) to S2, and add a join-code QR to the web ProjectCodeOverlay (QrSvg already exists for tags) encoding bali://join/<code> with the /t/-style web fallback, so the projected board carries both the 88px code and a scannable square.

**Why:** Eight-character mono codes typed under time pressure are where the red-bordered invalid-code frame actually gets seen — a typo on day one is the student's first failure in the app. Pointing the camera at the projector is the gesture this generation already trusts; it removes the only typing Bali ever asks of them.

**Surface:** ios/Bali/Bali/Features/JoinView.swift (scanner sheet) + BaliCore DeepLinks (bali://join), apps/web ProjectCodeOverlay + QrSvg reuse, small route in apps/web for the fallback.

**Judge notes (evidence + build corrections):** Verified unbuilt: no AVCapture/scanner code exists anywhere in ios/Bali, yet JoinView.swift:24 ships the promise 'or scan its QR' and the design spec (04-ios-screens.md:48,51) explicitly calls for a 'Scan QR instead' affordance on S2 — this closes a designed-but-unbuilt gap the current UI copy already commits to. Web side verified too: ProjectCodeOverlay (apps/web/src/components/bali/ProjectCode.tsx) shows only the 88px mono badge with no QR, while QrSvg.tsx already exists for W7 desk tags, so the reuse is real. Concretely buildable with no schema/auth changes: POST join + JoinBody already exist, the bali:// scheme is registered in Info.plist, and DeepLinks (NFC.swift:197) handles only 10-char tag codes so an 8-char bali://join/<code> branch is non-colliding; web fallback mirrors the existing /t/[code] route. One implementation refinement to pass along: encode the https fallback URL in the projected QR (system Camera handles https better than custom schemes) and accept both forms in the in-app scanner; also add an honest NSCameraUsageDescription (currently absent) stating the camera only reads the board code.


### Let students fix their own name in S9 Account  `(small)`

**What:** Add PATCH /v1/me (student branch) accepting firstName/lastName, and make the Settings Account row editable — two text fields, save, done. Today no student name-edit endpoint exists anywhere (auth.ts has none; only teachers get 'Shown to students as' on web settings).

**Why:** A signup autocorrect typo ('Jordna') is currently permanent, and that string is exactly what renders on the teacher's live grid in front of the class every day. For a teenager, a misspelled name on a projected dashboard isn't cosmetic — it's daily low-grade humiliation they're powerless to fix. Their name is the one piece of data in Bali that is unambiguously theirs.

**Surface:** apps/api/src/routes/auth.ts (PATCH /v1/me student fields), packages/shared dto, ios/Bali/Bali/Features/SettingsView.swift (Account row → edit form).

**Judge notes (evidence + build corrections):** Verified not built: no student name-write exists anywhere. apps/api/src/routes/auth.ts has only POST /v1/auth/bootstrap and GET /v1/me; the only PATCH /v1/me/settings (manage.ts:285) is teacher-gated and touches teacher/school fields only. Teachers can't fix it either — teacher.ts only SELECTs students.firstName/lastName, never writes. And in ios/Bali/Bali/Features/SettingsView.swift:27 the S9 Account row's tap action is literally `confirmSignOut = true` — the name is display-only. So the proposal's core claim holds: a typo entered at bootstrap (auth.ts trims/validates body.firstName/lastName then INSERTs, line ~185) is permanent and renders on the teacher's live grid. Values: clean fit — the name is the student's own data; self-correction is agency, not surveillance, and it strengthens 'honesty over theater' if the rename is recorded as an append-only event. Buildable with zero schema changes: students.firstName/lastName exist (packages/db schema.ts:97-98); the bootstrap name-dedupe (case-insensitive first+last match) only runs at signup, so post-link renames break nothing; teacher dashboards re-query names per snapshot, so the fix propagates on the next poll/SSE tick for free. Two small build notes: (1) reuse bootstrapBodySchema's trim/non-empty validation and add a length cap to blunt prank names on the projected grid; (2) the endpoint fits naturally as PATCH /v1/me in auth.ts (mirroring the existing teacher PATCH /v1/me/settings pattern), plus a `student_renamed` event row for the audit-grade events table.


### Solo focus: 'Just you' sessions that never touch a server  `(large)`

**What:** From Home, a student can start their own focus block: pick one of their existing PolicyBuckets (or all-apps-off), pick a duration, get the same arc, the same emergency hold, the same watchdog — entirely on-device. No API call, no events row, no teacher anywhere; sessions appear in S8 History in a 'Just you' section stored locally, with the footnote 'This never leaves your phone.'

**Why:** The strongest proof Bali is a tool and not a punishment is a student choosing to use it at 9pm for homework. All the machinery already exists (RealScreenTimeService buckets, SessionWatchdog, EmergencyUnlockControl, the arc) — only the server dependency stands between 'thing done to me' and 'thing I use.' Local-only by architecture keeps the privacy contract literal: nobody could see it even if they asked.

**Surface:** iOS only: FocusEngine local mode (skip tap-in/heartbeats), HomeView entry point, FocusActiveView reuse, HistoryView local-session merge; zero API/web changes.

**Judge notes (evidence + build corrections):** Novel (no solo/local mode in HANDOFF §3, FocusEngine.swift, HistoryView, or the S1-S10 design; not on the spec's out-of-scope list) and concretely buildable iOS-only with zero API/schema changes: ScreenTimeService, PolicyBuckets (with shield-all fallback), SessionWatchdog, ShieldContext, and the local-first emergency unlock are all already decoupled primitives — only FocusEngine's tap-in/heartbeat/unlock-queue path is server-bound and gets bypassed in a local mode. Screen Time auth is already .individual, so no new entitlement. It directly reinforces the spec's 'not a punishment system' framing and makes the privacy contract architectural (nothing to subpoena). Build-time copy details: solo unlock must skip the notify/reason flow (nobody is notified, say so), and ShieldContext needs a solo variant of 'Focused with {teacher}'. Moderate caveat: it adds a second session lifecycle to FocusActiveView/HistoryView, so scope it as reuse-with-parameters, not a fork.



---

## Teacher experience

### Join approvals on the teacher phone  `(small)`

**What:** Add a 'Waiting to join' row to T1 Home (badge on the class card, tap to a sheet with Approve/Decline rows mirroring W5's pending card). The API already exposes everything needed: /v1/portal/home returns pending memberships and /v1/memberships/:id/approve|decline exist; only the SwiftUI surface is missing.

**Why:** 7:55am: kids entered the board code while the teacher stands at the door with their phone. Today those students sit in 'Request sent' limbo (S2 frame 4) until the teacher gets to a laptop — the one device they don't have between rooms. This is the single biggest phone-vs-web capability gap in the current build.

**Surface:** ios/Bali/BaliTeacher/T1Home.swift + new approvals sheet + TeacherModels; zero API changes

**Judge notes (evidence + build corrections):** Verified novel and accurately scoped: BaliTeacher has zero membership-approval code (grep confirms; HANDOFF T1 list confirms), while the API side exists exactly as claimed — POST /v1/memberships/:id/approve|decline (teacher.ts:169,181) and GET /v1/portal/home returning an approvals array with membershipId/name/className/requestedAt (teacher.ts:314,419). Web W5/W6 already render the same pattern, so this is a faithful port of a built design to the one device teachers carry between rooms. Pure SwiftUI surface; only nuance is T1Home currently fetches GET /v1/classes (no pending counts), so it adds one call to the existing /v1/portal/home — no schema or auth changes. Builder note: keep Decline neutral-styled per the red-only-for-destructive rule, and note the badge is pull-based until push notifications exist.


### Sessions that start themselves at the bell  `(medium)`

**What:** Per-class toggle 'Start sessions on schedule' — the existing 15s sweeper (which already IS the bell for ending) symmetrically opens a session at the class's start time with the class's policy, logging an honest 'Session started on schedule' event. The student side is already designed for it: S4 frame 4's 'Start my focus when the session starts' finally has something to attach to.

**Why:** The teacher who 'forgets to click things' teaches 5 periods; one forgotten Start means a dead grid and 28 unshielded phones for 50 minutes. The product already ends sessions automatically on the principle that the bell is the authority — starting is the same principle, currently half-implemented.

**Surface:** packages/db schema flag + apps/api domain.ts sweeper + W3 create/edit dialog + T1 start sheet

**Judge notes (evidence + build corrections):** Not built: sweep() (domain.ts:729) only ends sessions; no autoStart flag in schema; HANDOFF lists nothing scheduled. The 'half-implemented' claim checks out literally — design S4 frame 4's 'Start my focus when the session starts' button was dropped in the built TapInView.swift notStarted variant (line 188: bare 'OK' dismiss), so this idea retroactively un-degrades a shipped screen. Symmetry argument is real code precedent: the lazy bell already ends sessions on sight (findOpenSessionForClass, domain.ts:149-153). Buildable additively via startSession() reuse (cls.teacherId, cls.endTime available), but proposer understated two schema gaps: daysLabel is free-text display-only (web hardcodes 'Mon–Fri', classes/page.tsx:52) so a structured days column is needed, and there is no timezone anywhere (schools table bare, startTime is naive time) so single-school MVP needs SCHOOL_TZ env. Also needs an idempotency guard so the sweeper doesn't reopen a session the teacher ended early. None of this touches auth or the data model's shape.


### Calm push notification for emergency unlocks  `(large)`

**What:** APNs registration in BaliTeacher and a notifier that delivers 'Sam T. used Emergency Unlock — Period 3' (default sound off, orange-semantics copy, deep-links to the student sheet). Gated by the T5 'Notify me' toggles that already exist and persist via /v1/me/settings — only the delivery mechanism is missing.

**Why:** The spec promises the teacher 'is notified', but today that's only true if T2 or W4 is literally open and polling. The teacher walking between rooms with the phone in a pocket misses the exact moment the product exists for. (Spec's out-of-scope item was an APNs *settings UI* — T5 already is the designed settings surface.)

**Surface:** apps/api (device-token endpoint + APNs sender), BaliTeacher push registration, T5 wiring

**Judge notes (evidence + build corrections):** Novel and concretely buildable. No APNs/push/device-token code exists anywhere in apps/api or ios (verified by grep; HANDOFF confirms the notifier is an email stub). Every prerequisite the proposer cites is real: /v1/me/settings GET/PATCH persist notifyEmergency and friends (apps/api/src/routes/manage.ts:266,285), T5 with NOTIFY ME toggles is built (ios/Bali/BaliTeacher/T5Passes.swift), and emergencyUnlock in apps/api/src/routes/student.ts:211 is a clean server hook. The spec's out-of-scope item is literally 'APNs settings UI' (01-product-spec.md:123), not APNs delivery, and T5 is the designed settings surface — so no scope violation. It directly serves 'honesty over theater': the student is promised 'your teacher will be notified' (spec line 63), which today is only true if T2/W4 happens to be open and polling every 5s. Needs one minor additive schema change (device-token table + register endpoint) — no auth/data-model redesign; paid Apple team exists for the push entitlement.

**Value reframe required:** None hard. Mild strain: a student's name appearing on the teacher's lock screen could be glimpsed by bystanders; reframe fixes it — title-only preview ('Emergency unlock — Period 3') with the name revealed on unlock/expand, keeping copy 'notified' not 'reported', sound off, orange semantics, gated by the teacher's own T5 toggle.


### Quiet check-in tracker for unlocks  `(medium)`

**What:** A teacher-private 'Checked in' mark on each emergency unlock: a small button on the W4 StudentPanel, the T3 sheet, and a column on the W8 unlocks table ('Check in' → 'Checked in ✓'). Stored in its own small table referencing the unlock event — never in the shared event stream, never visible to the student, never exported as judgment.

**Why:** The reports page says 'Patterns are conversation starters, not verdicts' — but nothing tracks whether the conversation happened. Friday afternoon, the teacher can't remember if they ever circled back to Sam's Tuesday unlock with the skipped reason. This closes the loop the copy promises without adding an ounce of surveillance.

**Surface:** apps/api (migration + 2 endpoints + reports join), apps/web reports + StudentPanel, BaliTeacher T3Student.swift

**Judge notes (evidence + build corrections):** Novel (no check-in tracker exists anywhere in code; only the 'conversation starters' copy it cites), closes a real loop the reports page promises but doesn't deliver, and is concretely buildable: one small drizzle table FK-ing events(id), two teacher-authed endpoints, a join in unlocksReport, plus existing surfaces (StudentPanel in live/page.tsx:385, W8 unlocks table in reports/page.tsx, BaliTeacher/T3Student.swift). It records the teacher's own action, not student data, and leaves the append-only events stream untouched.

**Value reframe required:** Mild strain on 'honesty over theater / shared agreement made visible' — it's a hidden teacher-side record adjacent to a student. Reframe fixes it: boolean-only (no free-text notes, which would become a shadow record), copy framed as the teacher's to-do ('Check in' → 'Checked in'), excluded from CSV export and all comparative views; the proposal already specifies most of this.


### SSE for the teacher iPhone live grid  `(small)`

**What:** Replace T2Live's 5-second Task.sleep poll with a URLSession.bytes consumer of the existing /v1/sessions/:id/stream endpoint (same fetch-streamed Authorization pattern the web uses), with the current poll kept as the fallback path.

**Why:** Mid-lesson glance while walking the room: an emergency unlock can sit invisible for 5 seconds, and pass countdowns jump in steps. The web gets sub-second toasts; the device the teacher actually carries deserves the same — and the server work is already done.

**Surface:** ios/Bali/BaliCore/API + BaliTeacher/T2Live.swift; API untouched

**Judge notes (evidence + build corrections):** Verified not built: T2Live.swift:236-241 polls with a 5s Task.sleep and no SSE consumer exists anywhere in ios/. Server side is done: /v1/sessions/:id/stream exists in apps/api/src/routes/teacher.ts:248 and the web already consumes it fetch-streamed with an Authorization header, so URLSession.bytes with a bearer header ports directly. Closes real, code-visible friction (emergency toast only fires on poll diffs, so an emergency unlock can be invisible for up to 5s on the device the teacher carries). API untouched, no schema/auth changes; poll kept as fallback handles iOS stream drops on backgrounding.


### Pass reason chips  `(small)`

**What:** Replace/augment the free-text reason TextField in GrantPassForm (both platforms) with one-tap chips — Nurse · Office · Restroom · Counselor · Custom — prefilling the reason. These are teacher-entered words about a teacher-granted pass, so no privacy tension with student-volunteered reasons.

**Why:** The kid asks to see the nurse mid-sentence; the teacher is holding a phone in one hand and a whiteboard marker in the other. Today granting that pass means typing 'nurse' into a text field (T3Student.swift line 144) while 27 students watch. Two taps should do it.

**Surface:** BaliTeacher/T3Student.swift + apps/web GrantPassForm component

**Judge notes (evidence + build corrections):** Novel and verified unbuilt: both pass forms are free-text only (ios/Bali/BaliTeacher/T3Student.swift:144 and apps/web/src/app/app/classes/[id]/live/page.tsx:478 use the same 'Reason (optional) — e.g. nurse' placeholder; no chip UI exists in either codebase, and the design docs only show free-text reasons in the T5 passes list). It closes real friction — the cited two-handed-teacher moment is exactly the flow today. Buildable with zero schema/auth changes: POST /v1/sessions/:id/passes already accepts an optional reason string (apps/api/src/routes/teacher.ts:269,279); chips merely prefill it, with Custom falling back to the existing field. Surface is two small UI edits, one per platform.


### End-of-bell session recap card  `(medium)`

**What:** When a session ends, the portal home's done-row and T2's ended state show a one-line factual recap: '47 min · 24 tapped in · 1 unlock (reason shared) · 1 permission off · 1 check-in waiting'. Counts only — no per-student minutes, no names except in the check-in link, which routes to the existing student sheet.

**Why:** The minute after the bell, the teacher's eyes were on the class, not the grid; today the session just evaporates ('ended · 45 min session' is all the portal shows). A glanceable recap is how the teacher learns whether anything needs a quiet word before period 4 files in.

**Surface:** apps/api (recap serializer over existing events), apps/web portal home + W4 ended state, BaliTeacher T2

**Judge notes (evidence + build corrections):** Not built: portal home shows only 'ended · N min session' (teacher.ts:368), W4 falls back to the no-session state on end (live/page.tsx:66-73), and T2 just dismisses via onClosed() (T2Live.swift:261) — the session genuinely evaporates. Buildable with zero schema changes: every needed event type (tapped_in, emergency_unlock, reason_shared, refocused, permission_revoked, session_ended) already exists in the append-only events enum (packages/db/src/schema.ts:38-59), and the focus-minutes report already establishes the walk-the-event-stream serializer pattern. Counts-only with no per-student minutes stays inside the privacy contract and below the granularity of the existing live grid and W8 reports.

**Value reframe required:** Mild strain on 'emergency unlock is no-questions-asked': the phrase 'check-in waiting' could read as the student owing an explanation, and no acknowledgment tracking exists to define 'waiting'. Reframe fixes it: derive it honestly as 'unlocked, didn't re-focus before the bell' from existing events (no new seen/unseen flag), keep the 'conversation starters, not verdicts' framing tone, and never present a skipped reason as a deficit (W8 already renders skipped/pending neutrally).


### Substitute day link  `(large)`

**What:** From a class page, the teacher mints a one-day, revocable link that opens a scoped live view — the W4 grid plus Start/End for that day's scheduled session, nothing else (no roster edits, no reports, no settings). Token-scoped auth, expires at midnight, every action it takes is attributed 'via substitute link' in the append-only event log.

**Why:** A sub covering Thursday currently has two options: nothing, or the teacher sharing real credentials (made worse by the open teacher bootstrap). Status-only visibility is exactly what the privacy contract already promises teachers see, so a narrower-than-teacher scope introduces zero new data exposure.

**Surface:** apps/api (scoped-token table + auth gate), apps/web /sub/[token] page reusing the live grid + mint UI on the class page

**Judge notes (evidence + build corrections):** Novel (no substitute/scoped/share-link feature exists anywhere; public.ts serves only the tag lookup, projector mode is just a class-code overlay), value-aligned (sub view is a strict subset of the teacher's status-only grid, so zero new data exposure; student-held emergency unlock untouched; events.teacherId + jsonb payload supports honest 'via substitute link' attribution without impersonation), and concretely buildable: one additive table (token hash, classId, teacherId, expiresAt, revokedAt), a requireSubLink gate parallel to requireTeacher in apps/api/src/auth.ts, scoped routes that reuse existing getSessionDetail/streamSession/start/end handlers, and a /sub/[token] web page reusing W4 grid components. Needs a schema migration but purely additive, with precedent (0001_lazy_dreadnoughts). Closes a real gap the repo documents: open teacher bootstrap doesn't help a sub see an existing class, so credential sharing is currently the only option. Implementation notes: hash the token at rest, hard midnight expiry + revocation (link holders see student first names + focus status), and scope must exclude passes/no-device/roster as proposed.


### Weekly summary email, for real  `(medium)`

**What:** Implement the notifier behind W10's existing 'Weekly summary' toggle: a Friday digest per class with sessions run, average focused minutes ('out of a 50-minute period — averages only'), unlock count, and outstanding check-ins, with 'Patterns are conversation starters, not verdicts' printed in the email body the same way the CSV header already carries it.

**Why:** End-of-week reflection is a designed moment the build silently drops — the toggle saves to the DB and nothing ever sends. A teacher who lives on their phone will read one calm Friday email far sooner than they'll open /app/reports.

**Surface:** apps/api (notifier module + weekly job alongside the sweeper, SES creds from legacy); web/iOS untouched

**Judge notes (evidence + build corrections):** Genuinely closes a designed-but-dropped loop: the W10 'Weekly summary' toggle persists (manage.ts:280/299) yet no notifier exists, and HANDOFF §7 lists the notifier stub as explicit backlog. Content is value-safe by construction — reports.ts already computes 'averages only, by design' (line 137) and exports REPORTS_FRAMING_LINE ('Patterns are conversation starters, not verdicts.', line 5) for reuse in the email body. Implementation is small and architecture-compatible: a weekly job beside the existing sweeper in apps/api/src/index.ts, reusing reports.ts aggregation; no auth or schema redesign (optional send-log table for idempotency). One correction: legacy/ has no SES/nodemailer sender, so 'SES creds from legacy' is false — fresh SES/SMTP credentials are needed in .env, which is config work only.

**Value reframe required:** Mild privacy strain: email travels outside the authenticated portal, so per-student names and pending unlock reasons must not appear in the body. Reframe fixes it — digest carries class-level counts and averages only ('3 check-ins to finish' with a link to /app/reports), names and reasons stay behind auth; print the conversation-starters framing line in the body like the CSV header does.



---

## Administrator / school-level (v2 scope: the "no admin portal" rule is now load-bearing)

### School invite code gates teacher bootstrap  `(small)`

**What:** Add a `teacherJoinCode` (and optional allowed email domain) to the schools table. POST /v1/auth/bootstrap with role=teacher requires the code (or a seed-adoption email match, which already exists); without it the row is created with status='pending' and requireTeacher returns a calm 'waiting for your school' state instead of full access. Existing seed adoption keeps working unchanged.

**Why:** Today any stranger with a Cognito account who picks role=teacher becomes a teacher at the school (auth.ts:144-152), can create classes with join codes, and can see real students' focus statuses. No privacy-conscious district signs a contract while that door is open — this is the single most load-bearing gap before a second customer.

**Surface:** apps/api/src/auth.ts (bootstrapIdentity, requireTeacher), packages/db schema (schools.teacher_join_code, teachers.status), one extra field on the web login bootstrap step and iOS S0 needs-name step

**Judge notes (evidence + build corrections):** Verified against the code: apps/api/src/auth.ts:144-152 really does create a full teacher (with access to real students' focus statuses via requireTeacher-gated routes) for any Cognito identity choosing role=teacher; packages/db/src/schema.ts has no teacher_join_code on schools and no status on teachers — nothing like this exists. It is concretely buildable without auth redesign: bootstrapIdentity is the single creation chokepoint and requireTeacher the single gate for all teacher routes (teacher.ts, manage.ts, reports.ts), so the change is two additive migrations (schools.teacher_join_code nullable, teachers.status enum defaulting 'active' to grandfather existing rows), two function edits, and one optional field on the existing web login bootstrap step and iOS S0 needs-name step. Seed adoption is preserved as claimed. One implementation note: /v1/me resolves teacher-first (HANDOFF caution), so the pending state must also surface in the /me payload or clients can't render the 'waiting for your school' screen.

**Value reframe required:** None — it strengthens the no-surveillance value (the open bootstrap is the repo's one real privacy hole: strangers can view live student focus statuses). The 'pending / waiting for your school' framing is calm and honest, no banned words. Soft tension with 'no admin portal in v1' resolves without reframing: the join code is seeded/set on the schools row directly for the single-school MVP, no portal needed.


### Minimal admin surface: teacher roster with approve / deactivate  `(medium)`

**What:** An `is_admin` flag on teachers (first teacher of a school, or seed-set) unlocks a single web page at /a: the school's teacher list with pending approvals, a deactivate action, and the school name field (currently hardcoded 'My School'). Deactivating a teacher ends their sessions, archives their classes, and blocks requireTeacher — and is recorded in the events table.

**Why:** Sixty teachers means churn: someone leaves in March and today their account works forever — they could still open live grids of their old classes. The admin deliberately sees LESS than teachers do (names and roles only, never any student's focus status), which keeps the no-surveillance contract intact while giving the principal the one lever they actually need.

**Surface:** packages/db schema (teachers.is_admin/status), new apps/api/src/routes/admin.ts (reuses authenticate + a requireAdmin sibling of requireTeacher), small apps/web/src/app/a/ route group using the existing component kit

**Judge notes (evidence + build corrections):** Not built: teachers table (packages/db/src/schema.ts:68-89) has no is_admin/status, no admin route in apps/api/src/routes/, no /a page; requireTeacher (apps/api/src/auth.ts:80) only checks row existence, so a departed teacher keeps live-grid access forever — the friction is real and pointable. It also closes the open-teacher-bootstrap hole (any Cognito sign-in becomes a teacher and can see student focus statuses), which is the repo's closest thing to a genuine no-surveillance risk. Buildable with additive schema changes only (is_admin + status/deactivated_at mirroring the existing tags.deactivated_at pattern, plus new eventType enum values); requireAdmin is a small sibling of requireTeacher, and the 'row IS the role' comment at auth.ts:116 shows status-on-row fits the existing auth model. Session-ending/class-archiving reuses existing domain.ts logic.

**Value reframe required:** Strains the spec's explicit 'Out of scope (do not build): Admin portal' (01-product-spec.md:119-121), not a hard value. Reframe fixes it: pitch it as a single teacher-roster page (not a portal) where the admin sees strictly LESS than a teacher — names and roles only, never any student's focus status — and frame it as closing the open-bootstrap hole that currently lets any Cognito sign-in view live student status grids, i.e. it defends the no-surveillance contract rather than expanding visibility.


### School bell schedules (the WIRING_PLAN §8.4 punt, now due)  `(large)`

**What:** A `bell_schedules` table (name + ordered period slots) owned by the school, plus a 'today's schedule' selector (regular / assembly / half-day). Classes optionally bind to a period slot instead of a raw end_time; the start-session sheet and the sweeper derive ends_at from the active schedule, with the existing per-class end_time as fallback.

**Why:** Right now 60 teachers each hand-type their period times, and on an assembly day every one of them must remember to edit their class or the shields hold past the real bell — students sitting locked after dismissal is the exact 'theater' failure Bali promises to never commit. One admin tap ('today is the assembly schedule') fixes it school-wide.

**Surface:** packages/db schema (bell_schedules, schedule_periods, schools.active_schedule_id), apps/api start-session prefill + sweeper in domain.ts, ends-at prefill in web W3/W4 and iOS BaliTeacher T1 start sheet, one admin page

**Judge notes (evidence + build corrections):** Not built: schema.ts has no bell/schedule entity, classes carry a single hand-typed end_time, and WIRING_PLAN §8 item 4 explicitly punts this ('Future: school bell table'). It closes documented real friction (assembly day = every teacher edits their class or shields hold past the real bell, the exact honesty-over-theater failure), touches zero student data, and is additive on the current architecture: start-session already takes explicit endsAt, the sweeper already keys off ends_at, and per-class end_time stays as fallback. Needs schema changes (bell_schedules, schedule_periods, schools.active_schedule_id, optional classes.period_slot) but no auth or data-model redesign. One build note: flipping the active schedule mid-day must re-derive ends_at on open sessions bound to a period slot, or the flip only affects future periods.

**Value reframe required:** No hard-value conflict (no student data, no comparisons; it strengthens honesty-over-theater). Scope strain only: product spec lists 'Admin portal' as do-not-build, and the proposal includes 'one admin page'. Reframe fixes it: in the single-school MVP with open teacher bootstrap there is no admin role, so make 'today's schedule' a teacher-accessible school-settings affordance on the existing web portal (or the start-session sheet) rather than a new admin surface.


### Records-request export, admin-only, and the export is itself an event  `(small)`

**What:** GET /v1/admin/records?studentId=&from=&to= streams a CSV/JSON of that student's events (the append-only stream already carries denormalized, self-contained payloads). Every export appends a `records_exported` event naming who exported and what range — the audit trail audits itself. Reuses the unlocksCsv machinery and the same honest vocabulary as W8/W9.

**Why:** The events table was built audit-grade precisely for the day a parent or district files a records request — and today literally nobody can answer it: teachers see only their own classes' slice (reports.ts:65-77) and there is no school-level reader. This is the difference between 'audit-grade' as a design claim and as a deliverable.

**Surface:** apps/api/src/routes/admin.ts + reports.ts CSV helpers, one new event_type enum value, a download button on the admin page

**Judge notes (evidence + build corrections):** Novel and verified buildable. Nothing like it exists: no admin.ts route, no records_exported in eventTypeEnum (packages/db/src/schema.ts:38-59), no admin web page, and the cited gap is real — apps/api/src/routes/reports.ts:65-77 scopes /v1/events to the teacher's own classes, so no one can answer a per-student records request today. The architecture is ready for it: events has a (student_id, at) index and denormalized self-contained payloads, and the CSV helpers (csvCell/unlocksCsv in apps/api/src/reports.ts) are directly reusable. Two honest caveats: (1) 'admin-only' references a role and page that do not exist — needs an additive teachers.is_admin flag or env email allowlist plus a requireAdmin helper, with the button on the existing W8 reports page instead of 'the admin page'; (2) the gate is only as strong as the open teacher bootstrap unless the admin list is env-pinned. Both are small additive changes, not auth/data-model redesigns.

**Value reframe required:** Mild strain on slice-scoping/data-minimization (first school-wide per-student view, crossing the teacher-sees-only-their-classes boundary). Reframe fixes it and is mostly built into the idea: position it as one-shot records-request fulfillment rather than a browsing surface — no persistent per-student dashboard, export gated to an explicit env-pinned admin allowlist, and every export appends a records_exported event naming exporter and range so the access is itself audit-grade. Contents stay within what events already record (statuses, student-volunteered reasons); no surveillance data exists to leak.


### End-of-term rollover: archive the year without losing the record  `(medium)`

**What:** An admin 'Close out term' action: bulk-archives all classes (refusing while any session is live, same 409 guard manage.ts already has), marks departed students inactive so they stop appearing in rosters and join flows, and clears stale pending memberships. Events stay untouched — the schema comment already promises history 'survives roster churn' (schema.ts:282).

**Why:** In June, 1200 students' memberships and 200 classes go stale at once; today each teacher would archive classes one by one and graduated students remain joinable identities forever. The first September with Bali is when a school decides whether the product respects their time.

**Surface:** packages/db schema (students.status or archived_at), apps/api admin route doing the transactional sweep, a single confirm-with-consequences card on the admin page

**Judge notes (evidence + build corrections):** Novel — only per-class archive (manage.ts PATCH /v1/classes/:id with the 409 session_running guard) and single-membership removal (teacher.ts:196) exist; no bulk rollover, no student status column, no admin surface anywhere. The friction is real: ending a term today is one manual archive per class. But as written it presupposes an admin route and admin page that violate the spec's explicit out-of-scope list and would sit behind a role that doesn't exist (teacher bootstrap is open, so 'admin' auth is currently meaningless for a destructive school-wide sweep). Keep it in reframed form: a per-teacher 'Close out my term' bulk action on the existing W3 classes page + manage.ts, transactionally archiving all non-live classes and clearing pending memberships via existing paths — no auth redesign, no schema change. The school-wide students.archived_at piece is a one-column follow-up deferred until an admin role exists. Events stay untouched, matching the append-only schema promise.

**Value reframe required:** Strains the spec's explicit 'Out of scope (do not build): Admin portal' (01-product-spec.md:121) and the open teacher bootstrap (no real admin role to gate a school-wide destructive sweep) — not the surveillance/comparison values. Reframing fixes it: scope the sweep per-teacher on the existing classes page, defer school-wide student inactivation until an admin role exists.


### Real multi-school: retire DEFAULT_SCHOOL_ID  `(medium)`

**What:** School creation becomes an explicit flow (first admin signs up, names the school, gets the teacher invite code from idea 1) instead of ensureDefaultSchool() silently materializing 'My School' from an env var. Students inherit school_id from the first class they join (the column is already nullable for exactly this). Every query already filters by teacher → class → school, so this is mostly bootstrap-path surgery, not a query rewrite.

**Why:** The second school is the moment the env-var crutch breaks: with one DEFAULT_SCHOOL_ID, school #2's teachers and students land in school #1's tenant and the privacy contract is breached structurally, not by a bug. Doing it now, while the dataset is one school, costs a tenth of doing it after.

**Surface:** apps/api/src/auth.ts (ensureDefaultSchool removal), env.ts, packages/db seed.ts, web signup flow for the first-admin path

**Judge notes (evidence + build corrections):** Not built: ensureDefaultSchool() at apps/api/src/auth.ts:102-112 and required DEFAULT_SCHOOL_ID (env.ts:15) confirm single-tenant-by-env-var. The cross-tenant breach claim is verifiable in code: teacher.ts:399-403 queries recent events by events.schoolId = teacher.schoolId only, so a second school sharing DEFAULT_SCHOOL_ID would expose school #1's events to school #2's teachers. Buildable as bootstrap-path surgery without auth/data-model redesign: students.schoolId is already nullable (schema.ts:95) and event school attribution comes from the class in domain.ts, so 'inherit school from first class' works — though note the proposal slightly misstates current behavior (bootstrap assigns default school to students today at auth.ts:184-185; that line changes to null). Wrinkles to carry into the build: scope or retire the global first/last-name seed-adoption (auth.ts:168-175), and the second-teacher path depends on the teacher-invite-code idea landing first. Schema change near-zero (schools table exists; maybe an invite-code column).

**Value reframe required:** Strains the explicit v1 anti-goal 'Admin portal' (01-product-spec.md:121) via its 'first admin signs up' framing; reframe fixes it: a founding TEACHER creates the school at bootstrap (create-school vs join-with-invite-code fork), no admin role or portal — precedent exists since teachers already rename the school in settings (manage.ts:305).


### Aggregate-only school health report  `(medium)`

**What:** One admin report: sessions run this week, classes using Bali, total emergency unlocks (count only — no names, no reasons), and permission-revoked counts, as school-level totals and a week-over-week trend. Carries the designed framing line ('Patterns are conversation starters, not verdicts') and deliberately offers no per-student and no per-teacher breakdown — no rankings of any kind.

**Why:** The principal who signed the PO needs to answer 'is this working?' at a staff meeting, and the privacy-conscious version of that answer is counts, not kids. Building the aggregate view ourselves — shaped by the same no-comparison values as the rest of the product — prevents the worse outcome where an admin demands raw exports and builds a spreadsheet leaderboard.

**Surface:** apps/api/src/reports.ts (new aggregate query over events, same walking pattern as focusMinutesReport), one card-based admin web page

**Judge notes (evidence + build corrections):** Not built: existing reports (apps/api/src/reports.ts) are teacher-scoped only — every query filters on classes.teacherId; no school-level aggregate or admin surface exists anywhere. The aggregate-only shape (counts, no names/reasons, no per-student or per-teacher breakdowns, school-vs-itself trend) is squarely inside Bali's no-comparison/no-surveillance values and reuses the already-shipped REPORTS_FRAMING_LINE. Data is fully derivable today from sessions/unlocks/events (permission_revoked is an existing event type) scoped by DEFAULT_SCHOOL_ID — no schema change for the query itself. Keep only with the reframe applied (see valueConflict): the 'admin web page' vehicle must go, because the spec forbids an admin portal and the codebase has no admin role (teachers/students tables only, row-existence-is-role), so adding one atop the open teacher bootstrap would be a self-assignable gate.

**Value reframe required:** Strains the product spec's explicit 'Out of scope (do not build): Admin portal' (01-product-spec.md) and the no-admin-auth reality (no admin role in schema; teacher bootstrap is open, so an admin gate would be spoofable theater — violating 'honesty over theater'). Reframe fixes it: ship the identical aggregate as a 'School this week' section/CSV on the existing W8 teacher reports page behind requireTeacher — same privacy-preempting payload, zero new role, zero schema change, anti-goal untouched.


### Retention policy: append-only does not mean keep-forever  `(small)`

**What:** A per-school retention setting (e.g., 'purge events older than 2 school years', district-configurable, default conservative). A scheduled job deletes expired event rows and appends a single `retention_purge` event recording the window and row count — the purge itself stays on the record. Unlock reasons (the most sensitive student-volunteered data) can carry a shorter window than session mechanics.

**Why:** Districts run on data-minimization checklists: 'how long do you keep records of when my kid unlocked her phone, and why?' Today the honest answer is 'forever,' which fails procurement review. A logged, bounded purge is more audit-grade than an unbounded archive, and it honors that unlock reasons were volunteered for a teacher's context that week — not for a permanent file.

**Surface:** packages/db schema (schools.retention_days, retention_purge event type), a small sweeper alongside the existing bell sweeper in apps/api domain.ts, one row on the admin settings page

**Judge notes (evidence + build corrections):** Novel and concretely buildable. Nothing retention-shaped exists in the repo (grep across api/db/HANDOFF/docs: zero hits; the only sweeper is the bell sweeper at apps/api/src/domain.ts:732). It closes a real procurement-facing gap: today the honest answer to 'how long do you keep unlock records' is forever, which contradicts the spec's data-minimization posture (privacy contract enumerates exactly what teachers see; unlock reasons are volunteered for that week's context). Architecture fits: schools table (packages/db/src/schema.ts:62) takes a retention_days column, eventTypeEnum takes a retention_purge value, and the daily pass slots next to the existing setInterval sweeper in apps/api/src/index.ts. FKs cooperate — nothing references events or unlocks, so windowed deletes need no cascade work. Two corrections to carry into the build: (1) reasons live in unlocks.reason AND denormalized event payloads (schema.ts:283), so the shorter reason-window must delete whole rows, never redact payloads in place; (2) there is no admin settings page (admin portal out of scope v1) — config lives on the schools row with an env/seed default for the single-school MVP, not in any UI, and explicitly not on teacher settings W10 since it's school policy.

**Value reframe required:** Strains 'events table is append-only and audit-grade'. The reframe fixes it: append-only means no edits and no silent deletions, not keep-forever; the purge appends a retention_purge tombstone (window + row count) so the deletion itself stays on the audit record. One condition: implement reason expiry as whole-row deletion past the window, not in-place payload redaction — editing payloads would genuinely break append-only.

