# Bali v3 — build plan & live status

The one file every session reads (after ARCHITECTURE.md) and updates when it
finishes work. ARCHITECTURE.md says *how*; this file says *what* and *where we
are*. Update rules are at the bottom.

It holds the current state only: a finished step is one line (its PR, its DECISIONS date), the why
is in `docs/DECISIONS.md`, and finished history is word for word in
[`docs/PLAN-ARCHIVE.md`](PLAN-ARCHIVE.md): search it like DECISIONS, never read it front to back.

_Last updated: 2026-10-14 (Central) — the owner's calls on PV8's results (`docs/DECISIONS.md`,
2026-10-14), both built in PV9: the reconnect pill once a first connect has taken over about 3 s,
and each phone tile's line as PhoneClassLive draws it; the demo students get plain names on dev;
and dev's `bali-ios` client is the demo's, in use, not one to delete. Before it, PV8, tiles (#377).
Next: PV9, Present._

## Now

A short handoff. The step lines are the record (the open ones below, the finished ones' full notes
in `docs/PLAN-ARCHIVE.md`), `docs/DECISIONS.md` the why, Open owner items the owner's queue.

**Production is live (2026-10-05):** the API `https://bali-prod-production.up.railway.app`
(Railway `bali prod`), the portal `https://bali-portal.vercel.app`, the Cognito pool
`bali-production` (sign-up for `@vanderbilt.edu` only); the sweep every minute in the API, with
`sweep-cron` its backup and Sentry Cron `api-sweep` its monitor; deck storage on in both
environments (M0); the portal's sign-in lasting the school day (2026-10-13); the school
"Vanderbilt" set up, its year end 2026-12-18. **No prod backups yet:** L0b turns them on before
the Vanderbilt pilot's first class. The details: `docs/DEPLOY.md`, `docs/RUNBOOKS.md`,
`docs/PILOT.md`.

**In flight.**
- **The conductor on the Windows PC (the owner, 2026-10-14):** an always-on PC runs the conductor,
  one worker at a time, and builds the portal's UI steps from PV7 on, screenshotted in a preview tab
  the owner signs in; its traps are `docs/GOTCHAS.md`'s "The Windows PC" (DECISIONS 2026-10-14).
  The test-only PR for the three tests that failed only there ✅ (#376): two pass there now, and the
  boot test's SIGINT-then-SIGTERM case is skipped there alone (Windows has no POSIX signals); CI's
  runs unchanged, and `npm test` passes whole on the PC.
- **The owner's Mac session (Xcode and the iPhone):** the app's Sign in & sign up is built; the app
  keeps D1's look until the owner approves a new one (its redesign rolled back, 2026-10-06). Left:
  the push's app half (not started), TestFlight build 9 for C7's phone test (📱), and the phone's
  Phase 7 screens (L8, M8). C2's legal words (⚖️) go into the portal's pages, on the Windows PC.
- **The portal redesign in v2's look (PV0–PV17, the owner, 2026-10-12):** PV0–PV8 done, with PV3b,
  PV4b, PV4c and PV5b; next PV9, on the Windows PC. Phase 7's web screens follow
  PV15.
- **The workflow review's last steps** ✅ (the owner, 2026-10-13; DECISIONS 2026-10-14): the
  migration guard (#369), docs-only PRs skipping the test jobs (#365), moved files (#368) and two
  tests (#364), each in full in `docs/PLAN-ARCHIVE.md`.

- **The "class started" push (N1–N6, decided 2026-10-06):** a visible alert to the students
  whose waiting tap a Start converts; a doorbell, never the truth. N1 (the docs), N2 (CI) and N3 (the
  token endpoints; the app half's interface is on N3's line) ✅; **the backend half is done**
  (N4–N6 ✅, 2026-10-06). Left: the app half (the Mac session) and the owner's console steps
  (`docs/RUNBOOKS.md`, runbook 7); until then push is off on both deploys. Not on
  the pilot's critical path: it never delays C2 or the external TestFlight steps.

- **Deleted accounts' Cognito sign-ins (C3-cognito, 2026-10-09):** the server queues and deletes
  them; until the owner's runbook 9 sets each environment's key, dev and prod only queue (the
  boot log says `Cognito sign-in deletion is off`), and the phone's own DeleteUser still deletes
  one when it lands.

- **CI speed (2026-10-13):** "Typecheck · lint · unit tests" is a gate of that name over two jobs
  side by side, "Typecheck · lint · build" (x64) and "Unit tests (PGlite)" (Arm, a Vitest worker
  per core); each PGlite test database is restored from one migrated copy per test file. The
  real-Postgres lane (~5 minutes, unchanged) and Claude Review (6–12) now bound a PR's merge.

- **Worker effort (the owner, 2026-10-14):** a worker that only builds an approved portal screen runs at `xhigh`, every other worker and santa's Claude reviewers at `max` (`.claude/commands/plan.md`, `santa-loop.md`); the first 3–5 `xhigh` screen steps' blockers and times, against earlier screen steps', decide whether it stays (DECISIONS 2026-10-14).

**The pilot's critical path.** The prod TestFlight build (✅ uploaded) → the owner's phone
test on prod, a block tap included (✅ the tap, 2026-10-12) → the privacy page (C2, the lawyer's words) → the external
TestFlight group `Vanderbilt pilot` and Beta App Review (`docs/APP-STORE.md`, section 5) →
Apple's answer on §3.3.3(P) (ISSUES #3; asked 2026-10-13, case 102994872143, waiting); and before the
first class, production backups (L0b, the owner's console step; the owner, 2026-10-12).

**Who does what.**
- Cloud sessions: the backend, CI and docs. Never UI, never a console.
- The Windows PC (since 2026-10-14): the conductor, whose workers build the steps one at a time,
  the portal's UI included (`apps/web/src/app`, `apps/web/src/components`, its user-facing strings).
- The Mac session: Xcode and the iPhone (`ios/Bali/UI`, `ios/BaliShield`, the app's user-facing
  strings): L8, M8, TestFlight build 9, the push's app half.
- The owner: the consoles (AWS, Railway, Vercel, Sentry, App Store Connect), Apple, the
  lawyer, the school, and every iPhone check.

**Phase 7, Live lesson: building.** Every step with no screen is done but L3c (added 2026-10-12);
M0 is done (deck storage on, 2026-10-12); the web screens come after the redesign's PV15, then the
phone's (L8, M8). L0b, production backups, is the owner's, before the Vanderbilt pilot's first
class.

## Phases

One line each. Phases 3–6's step lists, the push's (N1–N6) and this table in full are in
`docs/PLAN-ARCHIVE.md`.

| Phase | What | Status |
|---|---|---|
| 0 | iOS enforcement spike | ✅ proven on the owner's iPhone (2026-09-27) |
| 1 | The spine: monorepo, CI, schema, transition engine, auth, taps, sessions, Railway dev | ✅ on `main` |
| 2 | Walking skeleton: race tests, enrollments, sessions, events feed + SSE, portal + live grid, phone simulator | ✅ **complete** (2026-09-22) |
| 3 | iOS student app: BaliCore, outbox + sync, enforcement, sign-in, screens, device test gate | ✅ **complete** (2026-10-03) |
| 4 | Reports + recap, rate limits, the one-address load gate, the OpenAPI check, the authorization matrix | ✅ **complete** (2026-10-05); the sweep's per-row retry left unbounded at this size: bound it if the sweep grows (L3) |
| 5 | Pilot readiness: prod, Sentry, TestFlight, App Store, runbooks | ✅ cloud steps done; **prod live 2026-10-05**; open: the owner's items |
| 6 | Security and compliance; gates Phase 5's student-facing steps | ✅ cloud steps done; open: C2 (⚖️ the lawyer's words), C7's phone check 📱, S8 (the owner's decision), S10 📱 |
| 7 | Live lesson: questions and PDF slides in a running session, followed on the phone and the web | building (Phase 7 steps) |

### Portal redesign (v2's look) steps (PV; one PR each; 👀 = the owner looks at screenshots)

Approved by the owner 2026-10-12 (`docs/DECISIONS.md`): the portal and the student web redrawn in
v2's look, to the canvas [Bali portal in v2's look](https://claude.ai/artifact/PxWUcuMvv2CGngMqAtqvq4) (its boards named on each
step; its row "An idea, not in the plan: questions suggested from your slides" is out), its look
`v2.css` (DESIGN.md §1: the style facts, what it changes, what it supersedes, its call). Its
own plan, beside Phase 7: the drawings, the reads and the pages Phase 7's web screens sit on first
(PV1–PV15), then Phase 7's web screens (Phase 7 steps: L7, W3, W4, L7b, L3c, L7c; M5, M6, W5), then
the rest (PV16, PV17). Each UI step builds its boards with every state they draw, the words and
states of the canvases v2's replaces carried over except where it changes them (DESIGN.md,
Sources); a state no board draws is built only once PV1 has drawn it and the owner approved it; a
page keeps today's layout until its step lands, while PV4's shared pieces (buttons, fields, chips,
cards) change on every page at once. Each step is one PR from a fresh worker, under ~400
changed lines not counting tests (the estimates below are from the boards; a step past it splits,
as noted). **Cloud-buildable:** PV2, PV3, PV3b. **The Mac session's:** PV4–PV6; **the Windows PC's:** PV7–PV17 (2026-10-14). **A UI step's
validation** (each 👀): vitest, `npm run typecheck && npm run lint && npm test`, `/santa-loop` with
`web-design-guidelines` and `no-ai-slop`, and screenshots beside its boards for the owner.

- **PV0** The redesign's plan (docs) — ✅ (#342; DECISIONS 2026-10-12)
- **PV1** 👀 What no board draws, approved on the canvas — ✅ (2026-10-12, #346; DECISIONS 2026-10-12)
- **PV2** API: each class's summary on `/v1/me` — ✅ (#344; DECISIONS 2026-10-12)
- **PV3** API: Recent activity, `GET /v1/me/activity` — ✅ (#345; DECISIONS 2026-10-12)
- **PV3b** A class list in a fixed order — ✅ (#347; DECISIONS 2026-10-12)
- **PV4** 👀 The groundwork, `v2.css`'s shared pieces — ✅ (#351; DECISIONS 2026-10-13)
- **PV4b** 👀 The icons at the canvas's 1.75 stroke — ✅ (#353; DECISIONS 2026-10-13)
- **PV4c** PV4b's tests — ✅ (#357; DECISIONS 2026-10-13)
- **PV5** 👀 The shell, v2's side menu — ✅ (#352; DECISIONS 2026-10-13)
- **PV5b** 👀 The shell's read of the account — ✅ (#356; DECISIONS 2026-10-13)
- **PV6** 👀 A class before a session — ✅ (#355; DECISIONS 2026-10-13)
- **PV7** 👀 A class live — ✅ (#375; DECISIONS 2026-10-14)
- **PV8** 👀 Tiles — ✅ (#377; DECISIONS 2026-10-14)
- **PV9** 👀 Present (~200; ClassPresent at 1920 × 1080): no menu (the shell draws none in Present since PV5; Present keeps its old column until here), its header one size up, the join code at 34/44, the counts (PV7's `LiveCounts`), the four columns, the reconnect pill (PV7's, `livePage` on `LiveGrid`), and **+5, +10 and End kept** (the owner, 2026-10-12; the board leaves them off); after the bell "Class is over" alone, the figures left to the recap (PV1); PV7 left Present's page as it was, its nav, its header's code with New code and its roster under the grid, none of which ClassPresent draws; and the owner's two calls on PV8's results (2026-10-14), on the class page and Present alike: the reconnect pill once the stream's first connect has taken over about 3 s (PV8 left a first connect that hangs unsaid for 60 s, where the old line said it at once), and at phone width each tile's line as PhoneClassLive draws it, the state and its reason alone, every tile one height ("last seen" and the rest stay on a computer and come to PV11's panel) — validation: as above, a class of 28 on one 1080p screen
- **PV10** 👀 The unlock pop-up (~150; ClassUnlock): an unlock the stream brings opens a pop-up that stays until closed, beside the tile's pulse, never on the projector, several at once as PV1 draws them; its Open student opens PV11's panel — validation: as above
- **PV11** 👀 The student panel (ClassStudent; its states as PV1 draws them), in two: **PV11a** the logic in `apps/web/src/lib` (~150, no words): when the student tapped in, their state, this session's moments and their last check-in, from `GET /v1/sessions/{id}/events` and the grid's state; **PV11b** the panel (~250): 372 px from the right, opened by a tile and by the pop-up's Open student; PV8 left each tile a plain list item, so here it becomes the button ClassStates draws, marked while its panel is open (`.tile.is-selected`) — validation: vitest for PV11a; as above for PV11b
- **PV12** 👀 The recap (ClassEnded), in two: **PV12a** the grouping in `lib/recap.ts` (~200): *focused the whole time* as the owner ruled (2026-10-12: from the student's own tap-in to the session's end, with no unlock, no Screen Time off, no going silent and no leaving; a late tap-in still counts), focused part of the time (each student's moments, for their line and their words), and didn't join, a late or superseded unlock and a record after the bell placed by `sessionReport`'s rules, as the report places them; **PV12b** the recap (~300; `components/recap-card.tsx`, `timeline.tsx`): the Start card, the last session's figures, those not focused the whole time first, then who was, then who didn't join, the roster and the join code (PV6's); the header's line after the bell, "28 students · the session ended at 9:55 AM", where PV6 says "no session running"; **"How it ended" removed**; the marks' icons at `v2.css`'s 2.25 (`.mk .ic`), by a class, since PV4b's 1.75 rule beats the `strokeWidth` prop — validation: vitest for PV12a (a late tap-in; an unlock and a return; Screen Time off and back on; a silence; a leave; each at the session's edges); as above for PV12b
- **PV13** 👀 Reports (~350; Reports, ReportStates): `/reports` in the menu, the class picked with pills (no "All classes"), the framing line in italic (the `italic` class alone, never with `font-sans`, which re-slants the upright; PV4's review), the sessions as a table, newest first, with Show earlier, each session's average focus as a bar; `/classes/[id]/reports` redirects to it with that class picked; downloading waits for #339; Help's "Reports, on the class page, lists your past sessions." becomes "Reports, in the menu, lists each class's past sessions." (PV1) — validation: as above, the old URL's redirect
- **PV14** 👀 A session's report (~250; ReportOpened, ReportStates' "Loading this session…" and "Couldn't load this session."): one session on a page and a URL of its own, its recap card and its Unlocks table; its Questions card is L7c's — validation: as above
- **PV15** 👀 The entry pages (~250; SignIn, Invite, EntryStates): v2's centred sign-in with W3's words for students ("Sign in to Bali", its line for teachers and students, and "Students: set up Bali in the app on your iPhone first."), the invite card under a bar with Sign out and its line for students; `/auth/callback`, `/support`, `/privacy` and `/terms` as PV1 draws them (`app/login/page.tsx`, `components/entry-page.tsx`, `components/invite-code.tsx`); and W2's `homeFor` routing wired into `/` here (PV0's review), so a student who said 13+ in the app no longer lands on the invite page and `/` reads the 13+ check before `/v1/me`, which covers the shell's `/v1/me` read too (PV5's `useMe`, which a class page's link also makes; the owner, 2026-10-13); and a tab with no sign-in on a URL with no page goes to `/login` instead of "Loading…" forever (PV5b's review; the owner, 2026-10-14) — validation: as above. **Then Phase 7's web screens** (Phase 7 steps)
- **PV16** 👀 Classes (~350; Classes, ClassesNew, ClassesCreated, HomeStates' New class states): `/classes` in the menu, a card per class with its student count, last session (PV2) and Live chip, New class as a dialog (Creating…, a `5xx` with Try again) in place of the inline create row, "Period 4 Biology is ready" with its join code, Copy code and Done (its 40 px check at the board's 1.5 stroke, by a class, as PV4b says), and the block's card — validation: as above
- **PV17** 👀 Home (Main, HomeIdle, HomeNew, HomeStates), in three: **PV17a** (~300) the greeting and date, each class once (Live and Open, or Start…), the block's card with Register block, and "Set up your first class" for a new teacher; Home's error state with a real heading, focus kept on Try again and one `<main>` while it waits (PV5b's review; the owner, 2026-10-14); **PV17b** (~300) the live class's card on the session's snapshot and stream (its ring, countdown, six state counts, Open the class, Present and the latest unlock); **PV17c** (~250) Last session (PV2; hidden until a class's first session ends) and Recent activity (PV3; hidden under 640 px; no empty state, a live class's own start always listed): for up to a minute after a bell `lastSession` names a session whose report still says `ended: false`, which means only "not swept yet" (PV2's review), so the card never reads that flag as still running; if Recent activity is polled rather than read once, its read is narrowed first to the three kinds and the reason changes (PV3's review) — validation: as above

### Phase 7 steps (live lesson; one PR each; 👀 = the owner looks at screenshots, 📱 = needs the owner's iPhone, 🔧 = the owner in a console)

Planned 2026-10-05 (`docs/DECISIONS.md`); the design is ARCHITECTURE's "Live lesson (Phase 7)",
and every step builds against it. **Status: building** (the owner lifted the hold and approved both canvases on 2026-10-10): the steps with no screen are done but L3c, and M0 is done (2026-10-12). **The web screens come after the portal redesign's PV15** (the owner, 2026-10-12: its groundwork, its side menu and the pages they sit on first; "Portal redesign (v2's look) steps"). Then the UI, **web first** (the owner, 2026-10-10): in each slice the teacher's portal, then the student web, then the phone (Slice 1: L7, W3, W4, L7b, L3c, L7c, then L8; Slice 2: M5, M6, W5, then M8); the redesign's PV16 and PV17 follow the web screens, not waiting for the phone's (L8, M8). Each step is one PR from a fresh worker, under ~400 changed
lines not counting tests; a step that grows past that is split (L1a, L1b…). **Cloud-buildable:**
L1–L6 (L3b and L3c included), M1–M4, M7, M9, W1, W2. **The UI steps:** the web's, L7, L7b, L7c, M5,
M6, W3, W4, W5, on the Windows PC, and the phone's, L8 and M8, on the Mac (2026-10-14), each built to its canvas: the
[app screens](https://claude.ai/artifact/CZpFbFuxnRrLcuywtJGfVQ) (L8, M8; approved 2026-10-10) and
[Bali portal in v2's look](https://claude.ai/artifact/PxWUcuMvv2CGngMqAtqvq4) (L7, L7b, L7c, M5, M6, W3–W5; approved
2026-10-12), which replaced the look of the [portal screens](https://claude.ai/artifact/BxHbGud1xMeyXLUUvsewHM)
of 2026-10-10, their words and states carried over except where it changes them (ARCHITECTURE,
"Live lesson", decisions 11–13; DESIGN.md, Sources). The exit checks, M0 and L0b are
the owner's.

Slice 1 — live questions:
- **L0** The plan (docs) — ✅ (#230; DECISIONS 2026-10-05)
- **L0b** 🔧 The owner: production backups on before the first actual pilot, the Vanderbilt pilot's first class (the owner, 2026-10-12: "we will do the backups later before our first actual pilot", and that pilot is the Vanderbilt one, withdrawing the ruling of 2026-10-05 that ran it without them; until then it was before any build that can answer reaches prod, answers being education records, and before any screen, settled and ordered 2026-10-10), holding back no screen: Railway's Pro plan (runbook 1, step 4), or the nightly `pg_dump` to encrypted S3 that is built ready to enable (Open owner items) — validation: runbook 4's restore drill
- **L1** Database and engine: questions and answers — ✅ (#310; no DECISIONS entry of its own)
- **L2** Privacy plumbing for answers and questions — ✅ (#311; DECISIONS 2026-10-11)
- **L3** Teacher API — ✅ as L3a and L3r
- **L3a** Open and close — ✅ (#312; DECISIONS 2026-10-11)
- **L3r** Results through one guarded count, `questionCounts` (for L3c, L7c) — ✅ (#314, amended by #341; DECISIONS 2026-10-12)
- **L3b** Saved questions — ✅ as L3b1 and L3b2
- **L3b1** Their data, engine and privacy paths — ✅ (#316; DECISIONS 2026-10-11)
- **L3b2** Their routes (for L7b) — ✅ (#318; DECISIONS 2026-10-11)
- **L3c** A session's questions for its report, before L7c (v2's canvas draws L7c's Questions on a session's report page, `ReportOpened`, not on the class page's recap): a read of the questions asked in a session, in the order asked, each with its words and its totals through L3r's one guarded count (`questionCounts`: N of M, `counts` null under 3 answers); the class's own teacher only; S1 rows, the OpenAPI snapshot — validation: integration tests (the guard at 2 and 3 answers, the order asked, a session with none, validation of a malformed id, authz), `npm run typecheck && npm run lint && npm test`
- **L4** Student API — ✅ as L4a and L4b
- **L4a** The poll and the answer — ✅ (#320; DECISIONS 2026-10-11)
- **L4b** The demo's question and the load gate's polling classes — ✅ (#321; DECISIONS 2026-10-11)
- **L5** BaliCore's poll and answer, `LiveLesson` (for L8) — ✅ (#330; DECISIONS 2026-10-12)
- **L6** Portal logic, `lib/live-question.ts` (for L7) — ✅ (#332; DECISIONS 2026-10-12)
- **L7** 👀 Portal UI to v2's canvas (LessonClass, LessonWrite, LessonWaiting, LessonLive, LessonClosed, LessonStates' L7 lines; PresentQuestion, PresentAnswer), on the redesign's shell (PV5) and class page (PV6–PV11): the class page's "Questions and slides" card, Ask in the side panel (prompt, 2–6 options, the correct one optional), the live results with "N of M answered" and the guard's wording, close and reveal, and Present showing the question in place of the live grid, the counts per option only once it closes (L6's poller already reads the results once more after a close); the three of its sentences the canvas drops are not built (DESIGN.md §1, The words); two PRs (the class page's, then Present's); after PV15 (M0 ✅; the canvas approved 2026-10-12) — validation: `/santa-loop` with `web-design-guidelines` and `no-ai-slop`, screenshots for the owner
- **L7b** 👀 Portal saved questions to v2's canvas (Questions, QuestionsEdit, LessonAsk's drafts, LessonStates' L7b lines): the questions page in the menu (write, edit and remove a draft; its empty state), the side panel's drafts with a one-click Ask and "Write a new question"; the classes home's "Questions and slides" card gives way to the menu's Questions and Slides (confirmed by the owner, 2026-10-12); each save's `eventId` minted after the draft's own, a reply under another `eventId` treated as not saved (#318); "Your questions" oldest first, as the canvas lists them, sorted in the portal (the API answers newest first); two PRs (the page, then the panel's drafts) — validation: `/santa-loop` with the UI skills, screenshots
- **L7c** 👀 A session's Questions to v2's canvas (ReportOpened's Questions card, PV14's page; LessonStates' L7c lines): each question asked with its totals through L3c's read, the guard applied ("Too few answers to show a breakdown"); on the report page only, not under the class page's recap (the owner, 2026-10-12) — validation: vitest, `/santa-loop`, screenshots
- **L8** 👀📱 iOS answer card to the app canvas: while a question or a slide shows, the Focus screen's ring as a strip and Emergency Unlock pinned at the bottom; a tap answers and changes it until the close; the revealed answer marked, never red; a closed question's Hide; the same card on Unlocked, Screen Time off and Home; the consent list's two new lines and the one-time screen for a student who saw the old list (`no-ai-slop`); M0 ✅ (the canvas approved 2026-10-10; L0b, before the first actual pilot since 2026-10-12, holds back no screen). **No build that can answer ships (TestFlight included) before L2's documents and this wording have landed** — validation: XCTest, then the device check on the owner's iPhone: a shielded phone answers, the battery cost of the 2 s poll over a lesson, VoiceOver
- **L9** 📱 Exit check: a real class on prod asks and answers, the recap and the stream show the lifecycle, no screen names an answer

Slice 2 — slides:
- **M0** 🔧 The owner: an S3 bucket per environment — ✅ (2026-10-12; DECISIONS 2026-10-12)
- **M1** The storage interface, `DeckStorage` — ✅ (#308; DECISIONS 2026-10-10)
- **M2** Deck endpoints — ✅ as M2a and M2b
- **M2a** The table and the teacher's routes — ✅ (#323; DECISIONS 2026-10-11)
- **M2b** The check — ✅ as M2b1 and M2b2
- **M2b1** Complete and the check — ✅ (#324; DECISIONS 2026-10-11)
- **M2b2** The 5-minute rule and the deck sweep — ✅ (#325; DECISIONS 2026-10-11)
- **M3** Slide state — ✅ as M3a and M3b
- **M3a** The slide change — ✅ (#327; DECISIONS 2026-10-12)
- **M3b** The poll's slide and a deck's download (for M6) — ✅ (#328; DECISIONS 2026-10-12)
- **M4** Decks in the privacy paths — ✅ (#329; DECISIONS 2026-10-12)
- **M5** 👀 The slides page and upload to v2's canvas (Slides, LessonStates' M5 lines): the page in the menu; pick a PDF, upload with its percentage and Cancel (XHR's upload progress: `fetch` gives none), Checking…, the server's verdict said honestly (the size refusal, password-protected), "showing right now", a removal's confirm line; its in-use line names the class ("It's showing in Biology, period 3 right now"), so `409 deck_in_use` first carries that class (additive, in the error's `details`), its API half its own PR if M5 outgrows one; the bucket's origin in the CSP's `connect-src` (moved here from M6: without it the browser refuses the upload); an upload still running 25 minutes after its URL was minted is aborted and said honestly (#326) — validation: integration tests for the refusal's class, `/santa-loop` with the UI skills, screenshots
- **M6** 👀 Portal presenter to v2's canvas (LessonDecks, LessonSlide, PresentSlide, LessonStates' M6 lines: picking a deck in the side panel, the class page's slide controls and Present's slide; the presenter card's "Every phone in this class shows this slide, and so does Present." not built), in two PRs (PDF.js and the CSP, then the presenter): PDF.js ≥ 4.2.67, `isEvalSupported: false`, its worker self-hosted; the bytes checked against the slide's `sha256`, a mismatch refused with a retry (settled 2026-10-10); the CSP's `worker-src` (the bucket's `connect-src` came with M5) — validation: CSP tests, a tampered deck refused, `/santa-loop`, screenshots
- **M7** BaliCore's deck download and cache (for M8) — ✅ (#331; DECISIONS 2026-10-12)
- **M8** 👀📱 iOS slide view to the app canvas: PDFKit, pinch zoom, each page's text as its VoiceOver label, Emergency Unlock untouched — validation: XCTest, the device check on a shielded phone
- **M9** Load and demo with a deck — ✅ (#335; DECISIONS 2026-10-12)
- **M10** 📱 Exit check: a real class on prod follows a deck

Slice 3 — students on the web (added 2026-10-10; ARCHITECTURE, "Live lesson", decision 13; built web first, each step after the steps it reads):
- **W1** The phone's state in the presentation read — ✅ (#322; DECISIONS 2026-10-11)
- **W2** Portal student logic, `lib/student-web.ts` (for W3, W4) — ✅ (#333; DECISIONS 2026-10-12)
- **W3** 👀 The student's home to v2's canvas (StudentHome, StudentHomeEmpty, StudentStates' W3 lines; after W2), in the teacher's layout, its menu holding Your classes and Help: the student's classes (the one in class now with "Open the lesson"; none yet, with a teacher's link to the invite page); the sign-in page's and the invite page's words for students land in PV15; the privacy policy names the student pages; after PV15 (M0 ✅; the canvas approved 2026-10-12) — validation: `/santa-loop` with `web-design-guidelines` and `no-ai-slop`, screenshots for the owner
- **W4** 👀 The lesson page to v2's canvas (StudentLesson, StudentNotIn, StudentClosed, StudentWaiting, StudentEnded, StudentPhoneStates, StudentStates' W4 lines, StudentZoom at 720 px; after L7 and W3), in two PRs: the question card (answer, change, the revealed answer, the privacy line), the phone's chip and line (`phoneChip`'s kinds in the canvas's words, the unknown chip in the grid's Unknown look, the "as of" time passed so Silent's minutes freeze while Bali can't be reached, #333; the Unlocked line's bell from `/v1/me`'s `liveSession.endsAt`), nothing shared yet, class over, loading, every said line, 200% zoom (one column under 1024 px, the question first) — validation: `/santa-loop` with the UI skills, screenshots, one student answering from the web and then the phone; #334 (a timeout on the portal's polls) fixed before W4 ships
- **W5** 👀 Slides on the student web to v2's canvas (StudentLesson's slide, its full-screen view as PV1 draws it; after M3, M6 and W4): PDF.js as M6 configures it, the `sha256` check, the download's `no-store`, the text layer for screen readers, full screen — validation: CSP tests, a tampered deck refused, `/santa-loop`, screenshots
- **W6** 📱 Exit check: a real class on prod follows a lesson on laptops and phones at once; each student's chip agrees with the teacher's grid

**The open design questions are settled** (the owner, 2026-10-10, each as recommended;
ARCHITECTURE's "Live lesson", "Settled"): `event_id` refused both ways (L1, L3b), the guard
wherever counts are read (L3, L7c), the portal's `sha256` check (M6, W5), the PDF check in its
own worker (M2), and a load gate of several classes on phones and laptops (L4, M9).

### Still open in earlier phases

One line each; each step's full notes are on its line in `docs/PLAN-ARCHIVE.md`.

- **C2** 👀 ⚖️ The privacy policy and terms (Phase 6, **gate**): the portal's pages and the app's links are built with placeholder text, which the lawyer's words replace in place
- **C7** 📱 The 13+ screen (Phase 6, **gate**): built, C7-server with it; left, the owner's first-launch check on the next TestFlight build
- **S8** 🔧 Least-privilege database roles (Phase 6): the owner's decision (Open owner items, 1)
- **S10** 📱 A release guard: a Release build never ships dev's API or user pool (Phase 6)
- **D2k** ⏸ The shield's new look (Phase 3): waits for a design the owner approves in Claude Design
- **The push's app half** (N1–N6's backend is done): the Mac session's, its interface on N3's line and its notes on N2's, N4's and N6's; then runbook 7, the owner's

### Phase 3: known edges, carried forward

- Screen Time turned back on in Settings: the Screen Time off screen stays until its Turn on Screen Time button is pressed (#175).
- Access taken back while Bali is closed: found at the next open, or by the monitor's note if a window was running; the grid says silent meanwhile.
- The silent `requestAuthorization` was seen only on iOS 18.6.2 (the target is 17.0): check other versions before the App Store (#130).
- A shared phone: a sign-out while waiting leaves the wait for the next student, until they tap.
- An upgrade edge: a protection off reported before the update can relock over a recorded unlock until the server answers.
- `GET /v1/me`'s `armed` doesn't skip a waiting tap superseded by a later recorded tap (rare).
- A failed save of the wait's end isn't retried.
- An Emergency Unlock made while signed out files under the next sign-in (the owner's question, from C1a).
- Waiting's "Tap in again" wording, where Waiting has no Tap in.
- History's card ids can swap on a same-day return to a class (cosmetic).
- A PR that rewrites `claude-review.yml` runs its own copy, so it could pass "Claude Review" without a review (a ruleset decision for the owner).

### Proposed future phases (not scheduled)

Researched 2026-10-05; findings in [`docs/ROADMAP-RESEARCH.md`](ROADMAP-RESEARCH.md). Each starts with a docs PR and the owner's go; presenting and live questions is planned as Phase 7, its build under way since 2026-10-10.

- **SIS / LMS rosters.** Not for Vanderbilt (LTI and Okta need VUIT's approval). Smallest step: an expected roster of pasted emails or a CSV, offered on the consent screen to a student whose verified email matches (the server needs the email; S3's access tokens carry none). K-12 later: the data agreements first, then Clever SSO as a Cognito IdP, then rostering (Clever, ClassLink/OneRoster or Edlink); roster changes through the engine with deterministic event ids; no grade or attendance writeback before Apple's answer (ISSUES #3) and a FERPA review.
- **Presenting and live questions** — planned as **Phase 7, Live lesson** (2026-10-05): see "Phase 7 steps" above and ARCHITECTURE's "Live lesson (Phase 7)".

### Open owner items

**Decisions from the 2026-10-05 overnight investigation** (each the owner's call):

1. S8 least-privilege DB roles: grant the runtime role column-level `UPDATE(payload)` on `events` (C3, C6a and C6b de-identify through it, guarded by migrations 0015/0016's trigger), and decide whether migrations get their own role and a `MIGRATION_DATABASE_URL` (that changes the `Dockerfile`'s `CMD`, so a prod deploy).
2. ✅ S6, pinning the Claude workflows: merged as #270.
3. ✅ P8, Railway's config-as-code migration: both environments applied from `.railway/railway.ts` (2026-10-06), `railway.json` deleted.
4. A nightly `pg_dump` to an encrypted S3 bucket, built ready to enable (needs a bucket and an IAM user); the owner declined backups for the pilot (2026-10-05), then put them before the first actual pilot, the Vanderbilt pilot (L0b, 2026-10-12).
5. Sentry alert rules and an external uptime monitor on `/healthz` (the owner, in the consoles): runbook 6 (`docs/RUNBOOKS.md`), P9.
6. Vercel `bali-portal`: an Ignored Build Step `[ "$VERCEL_GIT_COMMIT_REF" != "main" ]`, so PR previews (which fail without env, by design) stop building.

**Phase 6's owner list** (not PRs — the owner, the lawyer and the school):

- 🚨 Apple's §3.3.3(P) (ISSUES #3): ask App Review whether a teacher-started session and the teacher's grid are allowed, and settle a fallback design if not — **gate**, and the first thing to do — asked by the owner 2026-10-13, case 102994872143 (`docs/APP-STORE.md` §5.6, as sent); waiting on Apple's answer
- Confirm the later K-12 pilot's state (likely Los Angeles or New Jersey) and the school's phone policy (ISSUES #4); the first, preliminary pilot is adults at Vanderbilt, on their own phones
- ⚖️ The privacy policy and terms; the school's data agreement (FERPA's school-official terms, the state's law or the SDPC NDPA); a breach plan; opinions on the state's phone-ban and app-store age laws
- Decision: who sees unlock reasons. (How accounts are made: decided 2026-10-04, self sign-up gated to `@vanderbilt.edu`, S11; MFA Optional with TOTP; the portal on `<project>.vercel.app` for now)
- 🔧 Cognito for prod: self sign-up gated (S11's Lambda) ✅, a password policy ✅, MFA Optional (TOTP) ✅, MFA on the AWS root ✅; to check: no password-auth clients, unused clients deleted, user-existence errors off; skipped for the pilot: threat protection, CloudTrail — runbook: `docs/RUNBOOKS.md`, 2 (its status list). In dev's pool, the candidate to delete: the old `bali-ios-dev` (`33qr62dl4ee4inigneidmfe2s9`, made with a secret); the clients in use are `bali-ios-dev-public`, `bali-web-dev`, and `bali-ios` (`6qcvcp0ubqmb8gunkt1d6dpkeo`), the demo's password sign-ins, on dev's `AUTH_AUDIENCE` (found 2026-10-14; `docs/DEPLOY.md`)
- 🔧 Railway for prod: the database on the private network only ✅, `CORS_ORIGINS` set exactly ✅, a long `INTERNAL_API_KEY` ✅; 2FA deferred by the owner; **no backups yet, so no restore drill**: backups before the Vanderbilt pilot's first class (L0b; the owner, 2026-10-12, withdrawing the ruling of 2026-10-05), the drill once a backup exists — runbooks: `docs/RUNBOOKS.md`, 1 and 4
- 🔧 GitHub: a ruleset and CODEOWNERS so no PR changes `.github/**`, the `Dockerfile` or `.railway/` without the owner; secret scanning with push protection; private vulnerability reporting; CodeQL ✅ (default setup, 2026-10-13: JavaScript/TypeScript and GitHub Actions; Swift not yet; blocks merges on high-or-worse security alerts and errors via `protect-main`'s code-scanning rule since 2026-10-14); 2FA — runbook: `docs/RUNBOOKS.md`, 5
- ✅ The reviewers' rules (#359; `docs/DECISIONS.md`, 2026-10-13): security holes, personal data the privacy paths miss and loosened tests block; reviews judge by `main`'s rules and clear the last failed review first; santa's Reviewer B reviews as an attacker; both Claude workflows on Opus 5.5; merged by the owner's ruleset toggle (GOTCHAS)
- The school: its phone policy allows Bali, its FERPA notice names vendors as school officials, the agreement is signed, parents are told, students with 504 or IEP plans are accommodated

**Phase 5's owner list:**
Owner-only (not PRs): the Sentry, Vercel, Railway-prod and App Store Connect accounts and keys; Sign in with Apple (needed only if Google sign-in stays, guideline 4.8); writing the NFC tags; iPhone checks. The student-facing steps wait for Phase 6's gate items.

**The rest of the owner's queue:**

- 🔧 Sentry: confirm monitor `api-sweep`'s `production` environment is active and alerting (dev checks in to the same slug, #239's review; runbook 6, step 2).
- ⏳ Apple's developer agreement §3.3.3(P) on Family Controls (ISSUES #3): asked by the owner on 2026-10-13, **case 102994872143** (`docs/APP-STORE.md` §5.6 holds the question as sent); waiting on Apple's answer, to record in ISSUES #3.
- #165 the Me page: D2j's redesign was rolled back (2026-10-06), so a better Me waits for a design the owner approves; the issue, closed by #266, is the owner's to reopen.
- #130 App Store readiness.
- #175 Screen Time turned back on in Settings, noticed by Bali itself.
- #176 reading and sending at once when the network comes back (filed 2026-10-03, not now).
- D2, the redesign: the picks are made (2026-10-04); 👀 the owner looks at each screen group's screenshots, D2c first (Phase 3 steps).
- #143's optional "you were removed" message.
- The parked PRs #61 and #49.
- 🔧 Production, still open: check that the next push to `main` deploys `bali-portal` on its own now that `vercel.json` is deleted (runbook 3, step 6); Railway 2FA, threat protection, CloudTrail, the backups (L0b) and the restore drill are on Phase 6's owner list above.
- 👀 After the next deploy of `bali` and `bali prod` (P8's follow-up): the deploy log shows the migrations, then `Server listening`; a later redeploy's log for the old deployment shows `shutting down` with `signal: SIGTERM`.
- Phase 7: **to decide**, #313 (what a teacher's own deletion, and the retention run, do with their words), kept as today for now (the owner's ruling, 2026-10-12); **tracked fixes**, #319 (saved questions' id case), #326 (a slow upload outliving its deck; M5 aborts it), #334 (a timeout on the portal's polls, before W4), #336 (capacity at the bell, before the class-started push reaches a school); L0b is the owner's (Railway, above). The calls confirmed on 2026-10-12: this line in full in `docs/PLAN-ARCHIVE.md`.
- Left for the owner on finished steps' lines (in full in `docs/PLAN-ARCHIVE.md`): P7's App Review path (decide its section 4, then fill the accounts and paste); P6's restore drill, its result recorded once a backup exists; S4's CSP check on the deployed portal after each Next upgrade; ⚖️ whether C7-server's yes rides Other Data Types; device rounds still marked pending (B5b's round 2, steps 7 and 9; B5c's round 3, steps 1 and 3; round 4, B6a and B6b); smaller calls on F (a refused tap's end-of-day drop or dismiss button; the waiting card's Tap in), B6c-2 (`.keep`/`.retry`), B5b (a rule for a replaced window, a code step to schedule) and D2 (Present's key per class).
- ✅ **Answered** (the owner, 2026-10-14; DECISIONS 2026-10-14): PV5b's whole-page error kept; its review notes folded into PV15 and PV17a; PV4c's two test limits left.
- 🔧 Before the pilot's first class: the owner's prod block gets a fresh code (its first reached the repo's history in #228), and a session builds an owner command that retires a block, to retire the old code (`docs/PILOT.md`, setup step 6). The portal's three class-page controls are built (P10, P11).
- **Before the pilot's first class, four steps for sessions** (the owner's workflow review, 2026-10-13; one PR each; after the redesign's PV17c, the owner, 2026-10-14):
  - a column-level privacy test: every column classified personal or not, each personal one placed by the privacy paths that handle it (the account deletion, the disposal, the retention run, the export), so a new column fails until it is placed; FERPA covers university students too;
  - a repeated-`event_id` check on every data-changing route, driven from the authorization matrix's route list;
  - pilot deploy rules: no deploys during class hours, and a documented one-command rollback in `docs/RUNBOOKS.md`;
  - Dependabot PRs can't pass Claude Review (the action rejects bot actors: add `allowed_bots` for dependabot in `claude-review.yml`, bundled with the next edit to that protected file); until then #309 (`next` 15.5.27, fixing two moderate SSG/ISR cache-poisoning alerts that likely don't apply: the portal renders per request on Vercel) waits.
- 🔧 The Cognito sign-in deleter: runbook 9 (`docs/RUNBOOKS.md`) — per environment an IAM policy
  allowing only `AdminGetUser` and `AdminDeleteUser` on its own pool, a user and its access key,
  the two `COGNITO_DELETER_*` variables on dev's `bali` and prod's `bali prod`; the end-to-end
  check on dev (C3-cognito).
- 🔧 Push: runbook 7 (`docs/RUNBOOKS.md`) — the APNs key, Push Notifications on the App ID,
  the three `APNS_*` variables on dev and prod; its end-to-end check once the app half ships
  (N6).
- 🔧 Dev's Cognito pool (`us-east-1_YTloqilwT`): turn on email as the attribute to verify, so a sign-up on its hosted page can be confirmed; today it ends on Cognito's error page with the account unconfirmed (found 2026-10-12; `docs/GOTCHAS.md`). The demo accounts sign in as they are.
- 🔧 Delete dev's unused phone client `bali-ios-dev` (`33qr62dl4ee4inigneidmfe2s9`) in the dev pool; keep `bali-ios`, the demo's (2026-10-14).
- 🔧 S4a's Sign out: check dev's web app client lists `http://localhost:3000/login` under Allowed sign-out URLs, and add it if not (`docs/WEB.md`).

## Go-live features

### In scope for launch (phase noted)

One line each; every row's full notes, as they stood on 2026-10-13, are in `docs/PLAN-ARCHIVE.md`.

| Feature | Phase | Notes |
|---|---|---|
| Core loop: tap→shield offline, armed taps, live grid, unlock always-recorded, refocus, join codes, roster, removal, self-expiry | 1–2 | ✅ built: leaving a class never in session (A19), self-expiry to the minute (A15), the tap over NFC offline (B6a), an unlock before the tap's answer filed under it (B6b) |
| 30s check-in that verifies shields before claiming them | 3 | rule 3 · ✅ (A2, A2c, B3b-2, B5a) |
| Shields survive force-quit; bell frees phone via extension | 3 | ✅ confirmed on the owner's iPhone (B5b's round 2, 2026-09-27) |
| Onboarding: Sign up or sign in → Sign up's 13+ check and intro → sign-up → your name → Screen Time grant → Home | 3 | ✅ built (B4, B5a, C1a–C1c, C7 and C7-server, the approved Sign in & sign up design), no allow-list step; 📱 C7's first-launch check on the next TestFlight build |
| Consent preview before joining a class | 3 | ✅ (A6, C2b) |
| Unlock with optional, skippable reason (bathroom/nurse/other) | 3 | replaces full "passes" at launch · ✅ (A1, A9, C5a) |
| Custom shield screen ("Focused with Bali") | 3 | ✅ (B5c, B5c-2): Bali's own shield, no time, nothing read |
| Minimal student personal history + edit own name | 3 | backs the privacy contract · ✅ (A7, A8, C6b) |
| Sign in with Apple (App Review guideline 4.8) | 5 | Cognito IdP |
| End-of-session recap card (portal) | 4 | ✅ (R4) |
| Reports: class focus minutes + unlock list; aggregates only, never rankings | 4 | ✅ (R1–R3, R5); `sessionReport` counts by this row's rules, in its full notes |
| Teacher signup gating (invite code) | 4 | ✅ (T1a, T1b, T2) |
| Block provisioning: pre-written tags + portal register-by-ID fallback | 5 | no teacher iOS app at launch · ✅ the portal's half (P3) |
| Privacy policy, terms, pilot agreement, support/FAQ page | 5 | policy work, launch-blocking |

### Out at launch (fast-follow order)

Passes as a real state → QR join → teacher push notification on unlock →
lock-screen Live Activity → teacher iOS app → auto-start at bell / bell
schedules → weekly summary email → admin portal / multi-school self-serve →
substitute-day link → parent links (cut in v3) → solo focus → VPN enforcement
layer → roster import (CSV / Google Classroom).

### Open product decisions (owner to confirm; lean in parentheses)

1. Bathroom breaks: unlock-with-reason at launch vs real passes (lean: reasons).
2. Custom shield screen in launch scope (lean: in).
3. Minimal student history in launch scope (lean: in).
4. Under-13: pilot with 13+ classes only at launch (lean: yes).
5. Recap card in Phase 4 (lean: yes).

6–12 are decided and built, each in full in `docs/PLAN-ARCHIVE.md`: (6) how a waiting phone learns
of the Start, (7) the end of a tap made with no signal, (8) policing an edited display name, (9)
macOS CI for the iOS build (revisit if the repo goes private), (10) a protection-off reaching the
server after the bell, (11) an emergency unlock made while its tap is unanswered, (12) extending a
session already past its bell.

Parked by design, blocking before real students: data-deletion policy,
under-13 parental-consent machinery.

Deferred to a later phase (2026-10-12, an issue each): downloading a session's report (#339) and a saved question shared by several classes (#340).

## External / waiting

- Apple checklist: bundle IDs registered, App Store Connect record created.

No longer waiting: the **Family Controls distribution entitlement** (Apple) —
✅ granted (owner, 2026-09-24), so TestFlight and the App Store no longer wait
on Apple. Apple approves it per bundle ID, and all three targets use it:
`com.bali.Bali`, `com.bali.Bali.BaliMonitor` and `com.bali.Bali.BaliShield` —
v2's identifiers, which the request used and v3 reuses (B2). In the developer
portal each one shows "Family Controls (Distribution)" among its capabilities;
one without it can't ship through TestFlight.

## Decision log

Moved to `docs/DECISIONS.md` (2026-09-23). A pointer of the form "docs/PLAN.md
decision log, <date>" means the entry with that date there.

## How to update this file (every session that changes code)

- Flip statuses, refresh **Now** (a short handoff: production, what's in flight, the critical
  path, who does what), and re-date the header line with the newest change and what's next; the
  status it replaces goes word for word to the top of `docs/PLAN-ARCHIVE.md`'s first section.
- A step done: its line becomes one line (id, title, ✅, PR, DECISIONS date), its full line moved
  word for word to `docs/PLAN-ARCHIVE.md`. Before building a step, search the archive for its id:
  finished steps' notes say what they left for it ("for L7 to wire").
- Made a real decision? It goes at the top of `docs/DECISIONS.md`, not here.
- Built a new feature? Add a row under Go-live features with a one-line
  architecture note; if a design decision changed, ARCHITECTURE.md is updated
  too.
- Keep it scannable — statuses and one-liners, not essays. History belongs in
  git; this file is the current truth.
- Past 8,000 words the "Plan doc updated" check fails: move finished detail to the archive, word
  for word, and the why to `docs/DECISIONS.md`.
