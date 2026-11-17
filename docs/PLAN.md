# Bali v3 — build plan & live status

The one file every session reads (after ARCHITECTURE.md) and updates when it
finishes work. ARCHITECTURE.md says *how*; this file says *what* and *where we
are*. Update rules are at the bottom.

It holds the current state only: a finished step is one line (its PR, its DECISIONS date), the why
is in `docs/DECISIONS.md`, and finished history is word for word in
[`docs/PLAN-ARCHIVE.md`](PLAN-ARCHIVE.md): search it like DECISIONS, never read it front to back.

_Last updated: 2026-11-16 (Central) — Bali's portal becomes a phone lock only: the Lock-only portal
phase is planned (LO0, #614; DECISIONS 2026-11-16), rebuilding it from the approved canvas, with
questions and slides switched off but kept in the code, and two workers at once on its lanes. Before
it, a student holds at most five push tokens (AN11a2, #599). Next: LO1 and LO10 at once, then LO2,
then lanes A and B; while the phase runs, its step lines below are its status and this line waits
for its end. Also open: the owner's switch of prod's domain, the release call and disabling the
review account (Open owner items); a session builds the retire-a-block command; the owner the
sitting's findings' calls; GA5's known limit, the owner's call (DECISIONS 2026-11-02); AN11b, AN12;
AN1's part 2 on the owner's phones; the audit's polish waits._

## Now

A short handoff. The step lines are the record (the open ones below, the finished ones' full notes
in `docs/PLAN-ARCHIVE.md`), `docs/DECISIONS.md` the why, Open owner items the owner's queue.

**Production is live (2026-10-05):** the API `https://bali-prod-production.up.railway.app`
(Railway `bali prod`), the portal `https://app.getbali.app` (below), the Cognito pool
`bali-production` (sign-up for `vanderbilt.edu,gmail.com` only, Gmail for the owner's testing and
students with no Vanderbilt address); the sweep every minute in the API, with
`sweep-cron` its backup and Sentry Cron `api-sweep` its monitor; deck storage on in both
environments (M0); the portal's sign-in lasting the school day (2026-10-13); the school
"Vanderbilt" set up, its year end 2026-12-18. **No prod backups yet**: on before the Vanderbilt
pilot (the owner, 2026-11-05; L0b). The details: `docs/DEPLOY.md`, `docs/RUNBOOKS.md`,
`docs/PILOT.md`.

**The website** (www.getbali.app) is the Vercel project `bali-web`, built only from the orphan
branch `demo3`, never `main`: seven pages from the canvas "Bali website". A change there is tested,
reviewed by santa and pushed straight to the branch, with no PR, as its README says
(`docs/DECISIONS.md`, 2026-11-06). `demo2`, the one-page demo it replaced, is kept for a rollback.

**The portal's address** ✅ (#540; DECISIONS 2026-11-07): `https://app.getbali.app` since
2026-11-07, its sign-in round trip passing at the sitting (2026-11-08); the old
`https://bali-portal.vercel.app` redirects there, and Cognito and the API's CORS keep it until no
build in use links it. The iPhone's build 13 links the new address, Android's from AN9i.

**In flight.**
- **The conductor on the Windows PC (the owner, 2026-10-14):** an always-on PC runs the conductor,
  one worker at a time, or two at once on a phase's lanes (the owner, 2026-11-16), and builds the
  portal's UI steps from PV7 on, screenshotted in a preview tab the owner signs in; its traps are
  `docs/GOTCHAS.md`'s "The Windows PC" (DECISIONS 2026-10-14).
- **The lock-only portal (the owner, 2026-11-16; DECISIONS 2026-11-16):** the portal rebuilt from
  its approved canvas as a phone lock only, questions and slides switched off but kept in the code;
  its steps under "Lock-only portal (LO)" below.
- **The owner's Mac session (Xcode and the iPhone):** the app's Sign in & sign up is built; the app
  keeps D1's look, Sign in the sign-in redesign's (#583), until the owner approves a new one (its
  redesign rolled back, 2026-10-06). The push's app half and the phone's Phase 7 screens are built
  (#443–#456), their 📱 checks passed at the sitting (2026-11-08) but for the three steps it didn't
  run (Before the pilot, item 2); this line in full in `docs/PLAN-ARCHIVE.md`.
- **A teacher's account on the iPhone (the owner, 2026-11-07)** ✅ (#541; DECISIONS 2026-11-07):
  once `GET /v1/me` names a teacher's account, one screen, the app is for students, with Open the
  portal and Sign out, and no device token registered; the server unchanged. Left: Android's twin.
- **The sign-in pages on Cognito's managed login (the owner, 2026-11-12)** ✅ (#581; DECISIONS
  2026-11-12): Bali's style on both pools' four clients, the username and password on one page
  (`infra/cognito/managed-login/`); dev's domain switched, prod's the owner's (Open owner items).
  Rebuilt from the approved
  [Bali sign-in redesign](https://claude.ai/artifact/XJomxBFajxnK5yHjEC32HB): the portal's sign-in
  page ✅ (#582) and the app's Sign in ✅ (#583), DECISIONS 2026-11-12; whether the 13+ question and
  Delete account's screen follow it, and the app's text scale at the large sizes, the owner's calls.
- **Android (the owner, 2026-11-02)**: Phases 8–11, the steps in `docs/PLAN-ANDROID.md`;
  AN1's part 2 on a Pixel and a Samsung, with its battery test, waits for the owner's phones (📱),
  before launch; AN2–AN10's and AN13's code ✅ (#488–#593), signing in on dev since AN6d; AP2b
  ✅ (#597), the help page; AN11a ✅ (#598), the push token's service; AN11b, AN12 next. Not on the
  pilot's critical path.
- **The portal's tests drive the page (the owner, 2026-10-22: "Yes, go gradually")**: the setup ✅
  (#434; DECISIONS 2026-10-22), jsdom and Testing Library, dev only, opted into per file
  (`docs/WEB.md`, Testing the portal), `try-again.test.tsx` the pattern. Each UI step from now on
  converts the source-text tests it touches and adds none; `src/source-text-tests.test.ts` lists the
  28 left (New class's converted, 2026-10-23; the policy pages', and the help page's moved to its guards, C2-text; the unlock pop-ups', GA2; the student lesson's, WC7), a list that only shrinks.
- **Two finished lines, each with calls left for the owner** (in full in `docs/PLAN-ARCHIVE.md`):
  a stuck slide upload stops (#436; DECISIONS 2026-10-22), and the owner's follow-up fixes of
  2026-10-16 (#426–#433; DECISIONS 2026-10-16, 2026-10-22).

- **The "class started" push (N1–N6, decided 2026-10-06)** ✅: the backend half (N4–N6) and the
  app half (#456; DECISIONS 2026-10-24), N6's end-to-end check passed on prod at the sitting
  (2026-11-08); left, dev's step 4 (Open owner items), and Android's sender, AN11b. Its line in
  full: `docs/PLAN-ARCHIVE.md`.

- **Deleted accounts' Cognito sign-ins (C3-cognito, 2026-10-09):** the server queues and deletes
  them; until the owner's runbook 9 sets each environment's key, dev and prod only queue (the
  boot log says `Cognito sign-in deletion is off`), and the phone's own DeleteUser still deletes
  one when it lands.

- **CI speed (2026-10-13):** "Typecheck · lint · unit tests" is a gate of that name over two jobs
  side by side, "Typecheck · lint · build" (x64) and "Unit tests (PGlite)" (Arm, a Vitest worker
  per core); each PGlite test database is restored from one migrated copy per test file. The
  real-Postgres lane (~5 minutes, unchanged) and Claude Review (6–12) now bound a PR's merge.

- **Worker and reviewer effort (the owner, 2026-10-14 and 2026-10-24):** a worker that only builds an approved portal screen runs at `xhigh`, every other worker at `max`; santa's reviewers run at `xhigh` on a screen step and at `max` on every other (`.claude/commands/plan.md`, `santa-loop.md`); the first 3–5 `xhigh` steps' blockers and times decide whether each stays (DECISIONS 2026-10-14, 2026-10-24).

**Before the pilot (the owner, 2026-11-03; DECISIONS 2026-11-03).** Left, in order (the list in full
as it stood until LO0: `docs/PLAN-ARCHIVE.md`):
1. A new prod TestFlight build from `main` — ✅ builds 12 and 13 (2026-11-07), 13 the first linking
   `app.getbali.app`.
2. 📱 The phone sitting, whole (`ios/README.md`, "Phase 7's phone sitting, on prod") — ✅ 2026-11-08
   (#545). Not run, left for the owner: Part 2's battery half hour, and Part 3's tap on a deck's link
   (no deck had one) and its second iPhone.
3. The block's fresh code (`docs/PILOT.md`, setup step 6): a session builds the owner command that
   retires a block; the owner writes the new code, registers it and retires the old one.
4. PostHog — ✅ A1–A6 (#503–#536) and the owner's key on `bali prod` (2026-11-07). The notice
   `/privacy`'s section 11 promises: owed to no one yet, and due for any change that matters from
   the first pilot user on (the owner; DECISIONS 2026-11-07).
5. The App Store submission — ✅ approved 2026-11-12 on build 14 (`docs/APP-STORE.md`, sections 1–4),
   Apple's answer on §3.3.3(P) (ISSUES #3); released by hand, not yet (the owner); no external beta
   for now (the owner, 2026-11-04).
6. The App Store privacy label — ✅ published 2026-11-09 (`docs/APP-STORE.md` §3).
7. Production backups on (L0b), before the pilot's first class: `/privacy` (sections 4, 6 and 7)
   already promises a daily and a weekly backup (the owner, 2026-11-05: "we will have those backups
   before we go live").

Not needed for the Vanderbilt pilot (the owner, 2026-11-03): the lawyer's words (C2); the owner's
drafts stand on `/privacy` and `/terms`.

**Who does what.**
- Cloud sessions: the backend, CI and docs. Never UI, never a console.
- The Windows PC (since 2026-10-14): the conductor, whose workers build the steps one at a time, or
  two at once on a phase's lanes (2026-11-16), the portal's UI included (`apps/web/src/app`,
  `apps/web/src/components`, its user-facing strings).
- The Mac session: Xcode and the iPhone (`ios/Bali/UI`, `ios/BaliShield`, the app's user-facing
  strings): the next prod TestFlight build.
- Android (Phases 8–11): the Windows PC builds its steps, the screens and the API's push (AN11)
  included; cloud sessions its docs; the owner its phones and Google's consoles (`docs/PLAN-ANDROID.md`).
- The owner: the consoles (AWS, Railway, Vercel, Sentry, App Store Connect), Apple, the
  lawyer, the school, and every iPhone check.

**Phase 7, Live lesson:** every build step is done, and the exit checks L9, M10 and W6 passed with
one student (2026-11-08), a class of several, the pilot's own, the full check; L0b, production
backups, is on before the Vanderbilt pilot (the owner, 2026-11-05). Its portal pieces go behind the
lessons switch in LO1 (DECISIONS 2026-11-16). This paragraph as it stood: `docs/PLAN-ARCHIVE.md`.

## Phases

One line each. Phases 3–6's step lists, the push's (N1–N6) and this table in full are in
`docs/PLAN-ARCHIVE.md`; Android's steps, Phases 8–11, are in `docs/PLAN-ANDROID.md`.

| Phase | What | Status |
|---|---|---|
| 0 | iOS enforcement spike | ✅ proven on the owner's iPhone (2026-09-27) |
| 1 | The spine: monorepo, CI, schema, transition engine, auth, taps, sessions, Railway dev | ✅ on `main` |
| 2 | Walking skeleton: race tests, enrollments, sessions, events feed + SSE, portal + live grid, phone simulator | ✅ **complete** (2026-09-22) |
| 3 | iOS student app: BaliCore, outbox + sync, enforcement, sign-in, screens, device test gate | ✅ **complete** (2026-10-03) |
| 4 | Reports + recap, rate limits, the one-address load gate, the OpenAPI check, the authorization matrix | ✅ **complete** (2026-10-05); the sweep's per-row retry left unbounded at this size: bound it if the sweep grows (L3) |
| 5 | Pilot readiness: prod, Sentry, TestFlight, App Store, runbooks | ✅ cloud steps done; **prod live 2026-10-05**; open: the owner's items |
| 6 | Security and compliance; gates Phase 5's student-facing steps | ✅ cloud steps done; open: C2 (⚖️ the lawyer's words), S8 (the owner's decision) |
| 7 | Live lesson: questions and PDF slides in a running session, followed on the phone and the web | building (Phase 7 steps); its portal pieces go behind the lessons switch in LO1 (2026-11-16) |
| 8 | Android: the lock, the candidates measured on the emulators, then (a) on a Pixel and a Samsung (iOS's Phase 0) | building: AN1's part 2 📱 waits for the phones, before launch |
| 9 | Android: the engine, BaliCore's and BaliOutbox's twin, no screens | building: AN2–AN10's, AN11a's and AN13's code ✅ (2026-11-13); AN11b, AN12 next |
| 10 | Android: the screens, from the approved boards | AS0's canvas approved ✅ (2026-11-04); AS1–AS8 build from it |
| 11 | Android: on Play, its testing tracks, device gate and exit check | planned |

### Lock-only portal (LO; one PR each; 👀 = the owner looks at screenshots)

Planned 2026-11-16 (`docs/DECISIONS.md`): the portal as a phone lock only, rebuilt from the approved
canvas [Bali portal, lock only](https://claude.ai/artifact/6edxfannfGQKbSnrZkyXC2) (version 27;
DESIGN.md), questions and slides switched off by LO1 but kept in the code (ARCHITECTURE, Web portal,
decision 8). Tracker #601, and an issue a step naming the files it may touch. Two workers at once,
never more, on steps whose files don't overlap (CLAUDE.md, How to work, step 2): LO0, LO1 and LO2
first, LO10 beside LO1 (and beside LO2, should it run longer); then lane A (LO3, LO8, LO11) beside
lane B (LO4–LO7, LO9), a lane's next step waiting for a free worker. Every line below was written
up front, in LO0: a step's worker changes only its own, adding ✅, its PR and its DECISIONS date in
that PR, and the lines move to `docs/PLAN-ARCHIVE.md` together once the phase is done.

- **LO0** The docs: the decision, the design, these lines and the two-worker rule (#602) — ✅ (#614; DECISIONS 2026-11-16)

- **LO1** The lessons switch, `NEXT_PUBLIC_LESSONS` (#603; after LO0, beside LO10) — ✅ (#615; DECISIONS 2026-11-16); for Now at the phase's end: 27 source-text tests left (`session-report.test.ts` converted)

- **LO2** 👀 The top bar and the new look's shared pieces (#604; after LO1) — ✅ (#617; DECISIONS 2026-11-17); its in-between states on the canvas's BarStates (version 32); until LO3, a teacher with classes reaches New class at /classes by its address only

- **LO3** 👀 Home, one page for your classes (#605; lane A; after LO2) — ✅ (#620, one PR, the conductor's call; DECISIONS 2026-11-17); its in-between states on the canvas's HomeMoments (version 37); Check on's rarer rows the owner's approval (2026-11-17); for the phase's end: 23 source-text tests left (Now), and the conductor's tidy-up: Home's phone title to LO4's `page-title-phone`, the unused `--color-ready`, `portal-bar.tsx`'s "until LO3"

- **LO4** 👀 A class before it starts (#606; lane B; after LO2) — ✅ (#618; DECISIONS 2026-11-17); its in-between states on the canvas's ClassBeforeStates (version 35); left for a step at the phase's end: Try again, and Start while it sends, still v2's button (`TryAgain`, every rebuilt page); for Now at the phase's end: 26 source-text tests left (`join-code.test.ts` converted)

- **LO5** 👀 Live: the count, Check on, the room (#607; lane B; after LO4)

- **LO6** 👀 Live: the session list, the pop-ups, the student panel, the tab title (#608; lane B; after LO5)

- **LO7** 👀 The recap (#609; lane B; after LO6)

- **LO8** 👀 Reports and the CSV (#610; lane A; after LO3)

- **LO9** 👀 Present (#611; lane B; after LO7)

- **LO10** API: remove a lost block, the conductor's call, awaiting the owner's look (#612; after LO0, beside LO1). The first endpoint that frees a block's code for another teacher, so it settles the other-teacher case first: a tap's honest retry after the block moves (ARCHITECTURE, tap step 9; DECISIONS 2026-09-22's recorded follow-up), an engine change with its race tests

- **LO11** 👀 Home: Remove a lost block (#613; lane A; after LO3 and LO10)

### Portal redesign (v2's look) steps (PV; one PR each; 👀 = the owner looks at screenshots)

**Done** (2026-10-16): PV0–PV17, the last PV17c-2 (#425), to the canvas
[Bali portal in v2's look](https://claude.ai/artifact/PxWUcuMvv2CGngMqAtqvq4), approved by the
owner 2026-10-12; the section's intro and its step lines are in `docs/PLAN-ARCHIVE.md`.

### Phase 7 steps (live lesson; one PR each; 👀 = the owner looks at screenshots, 📱 = needs the owner's iPhone, 🔧 = the owner in a console)

Planned 2026-10-05 (`docs/DECISIONS.md`); the design is ARCHITECTURE's "Live lesson (Phase 7)",
and every step builds against it, to its canvas: the
[app screens](https://claude.ai/artifact/CZpFbFuxnRrLcuywtJGfVQ) (L8, M8; approved 2026-10-10) or
[Bali portal in v2's look](https://claude.ai/artifact/PxWUcuMvv2CGngMqAtqvq4) (L7, L7b, L7c, M5, M6,
W3–W5; approved 2026-10-12). **Status:** every build step is done; the exit checks, M0 and L0b are
the owner's; the portal's pieces go behind the lessons switch in LO1 (2026-11-16). The intro as it
stood until LO0: `docs/PLAN-ARCHIVE.md`.

Slice 1 — live questions:
- **L0** The plan (docs) — ✅ (#230; DECISIONS 2026-10-05)
- **L0b** 🔧 **Before the Vanderbilt pilot** ("Before the pilot", item 7; the owner, 2026-11-05): the owner turns production backups on before the pilot's first class, holding back no screen: Railway's Pro plan (runbook 1, step 4), or the nightly `pg_dump` to encrypted S3 that is built ready to enable (Open owner items) — validation: runbook 4's restore drill; its full line, with the rulings before it, in `docs/PLAN-ARCHIVE.md`
- **L1** Database and engine: questions and answers — ✅ (#310; no DECISIONS entry of its own)
- **L2** Privacy plumbing for answers and questions — ✅ (#311; DECISIONS 2026-10-11)
- **L3** Teacher API — ✅ as L3a and L3r
- **L3a** Open and close — ✅ (#312; DECISIONS 2026-10-11)
- **L3r** Results through one guarded count, `questionCounts` (for L3c, L7c) — ✅ (#314, amended by #341; DECISIONS 2026-10-12)
- **L3b** Saved questions — ✅ as L3b1 and L3b2
- **L3b1** Their data, engine and privacy paths — ✅ (#316; DECISIONS 2026-10-11)
- **L3b2** Their routes (for L7b) — ✅ (#318; DECISIONS 2026-10-11)
- **L3c** A session's questions for its report (for L7c) — ✅ (#391; DECISIONS 2026-10-15)
- **L4** Student API — ✅ as L4a and L4b
- **L4a** The poll and the answer — ✅ (#320; DECISIONS 2026-10-11)
- **L4b** The demo's question and the load gate's polling classes — ✅ (#321; DECISIONS 2026-10-11)
- **L5** BaliCore's poll and answer, `LiveLesson` (for L8) — ✅ (#330; DECISIONS 2026-10-12)
- **L6** Portal logic, `lib/live-question.ts` (for L7) — ✅ (#332; DECISIONS 2026-10-12)
- **L7** 👀 Portal UI to v2's canvas: the class page's question and Present's — ✅ as L7-1a (#389), L7-1b (#390), L7-2 (#402) and L7-3, Close and Done on Present, Done in every window of the browser (#405); DECISIONS 2026-10-15
- **L7b** 👀 Portal saved questions to v2's canvas — ✅ as part 1a (#393), part 1b (#394), part 1c (#395) and part 2, the panel's drafts (#411); DECISIONS 2026-10-15, 2026-10-16
- **L7c** 👀 A session's Questions to v2's canvas — ✅ (#412; DECISIONS 2026-10-16)
- **L8** 👀📱 iOS answer card to the app canvas — ✅ as L8a (#443), L8b (#448, #450) and L8c (#451); DECISIONS 2026-10-23; its 📱 device check passed on prod (2026-11-08) but for the battery's half hour (`ios/README.md`'s sitting, Part 2, step 6), not run
- **L9** 📱 Exit check: a real class on prod asks and answers, the recap and the stream show the lifecycle, no screen names an answer — passed with one student on prod (2026-11-08); a class of several, the pilot's own, is the full check

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
- **M5** 👀 The slides page and upload — ✅ as M5a (#396), M5b part 1 (#397) and M5b part 2 (#400); DECISIONS 2026-10-15
- **M6** 👀 Portal presenter to v2's canvas — ✅ as part 1 (#413), 2a (#414), 2b-1 (#415), 2b-2 (#416), 2c (#417) and 2d (#418); DECISIONS 2026-10-16; the panel line back (#457; DECISIONS 2026-10-24)
- **M7** BaliCore's deck download and cache (for M8) — ✅ (#331; DECISIONS 2026-10-12)
- **M8** 👀📱 iOS slide view to the app canvas — ✅ (#452; DECISIONS 2026-10-24); its 📱 device check passed on prod (2026-11-08) but for a tap on a deck's link (no deck had one) and a second iPhone (`ios/README.md`'s sitting, Part 3), not run
- **M8b** 👀📱 The slide on Unlocked, Screen Time off and Home, and the question card on the Screen Time ask — ✅ (#454; DECISIONS 2026-10-24); its 📱 device check passed with M8's (2026-11-08)
- **M9** Load and demo with a deck — ✅ (#335; DECISIONS 2026-10-12)
- **M10** 📱 Exit check: a real class on prod follows a deck — passed with one student on prod (2026-11-08); a class of several, the pilot's own, is the full check

Slice 3 — students on the web (added 2026-10-10; ARCHITECTURE, "Live lesson", decision 13; built web first, each step after the steps it reads):
- **W1** The phone's state in the presentation read — ✅ (#322; DECISIONS 2026-10-11)
- **W2** Portal student logic, `lib/student-web.ts` (for W3, W4) — ✅ (#333; DECISIONS 2026-10-12)
- **W3** 👀 The student's home to v2's canvas — ✅ (#392; DECISIONS 2026-10-15); left for the owner: the privacy policy names the student pages (C2's words, the lawyer's)
- **W4** 👀 The lesson page to v2's canvas — ✅ as part 1a (#406), part 1b (#407) and part 2 (#408); DECISIONS 2026-10-15; left for the owner: the same check with a real iPhone once the app's card (L8) can answer (📱)
- **W4 follow-up** 👀 The home's chip says Bali can't be reached before its lesson's first read answers, an answer that landed after 10 s is in once a read shows it, and the home reads the account every 30 s while in view with no class in session (the owner, 2026-10-16) — ✅ (#409; DECISIONS 2026-10-15, 2026-10-16)
- **W5** 👀 Slides on the student web to v2's canvas — ✅ (#419; DECISIONS 2026-10-16)
- **W6** 📱 Exit check: a real class on prod follows a lesson on laptops and phones at once; each student's chip agrees with the teacher's grid — passed with one student on prod (2026-11-08); a class of several, the pilot's own, is the full check

**The open design questions are settled** (the owner, 2026-10-10, each as recommended;
ARCHITECTURE's "Live lesson", "Settled"): `event_id` refused both ways (L1, L3b), the guard
wherever counts are read (L3, L7c), the portal's `sha256` check (M6, W5), the PDF check in its
own worker (M2), and a load gate of several classes on phones and laptops (L4, M9).

### The audit's fixes (GA; one PR each; 👀 = the owner looks at screenshots)

**Done** (2026-11-02): GA1–GA6 (#474–#478; DECISIONS 2026-11-01, 2026-11-02), the gstack audit's 3
crucial and 7 cheap findings, the rest polish left for later (the owner, 2026-11-01); GA2's known
limit approved by the owner (2026-11-02), GA5's the owner's call (DECISIONS 2026-11-02). The
section's intro and its step lines are in `docs/PLAN-ARCHIVE.md`.

### Still open in earlier phases

One line each; each step's full notes are on its line in `docs/PLAN-ARCHIVE.md`.

- **C2** 👀 ⚖️ The privacy policy and terms (Phase 6, **gate**): the portal's pages and the app's links are built, the pages holding the owner's drafts (C2-text), the one copy of the words (`docs/legal/` keeps the notes for the lawyer), which the lawyer's words replace in place; not needed before the Vanderbilt pilot (the owner, 2026-11-03)
  - **C2-drafts** The owner's drafts, for Apple's external beta review (the owner, 2026-10-24) — ✅ (#460): `docs/legal/privacy-policy.md` and `terms-of-use.md`, from General Legal's CC0 templates, every fact filled; the lawyer's questions at each file's end (DECISIONS 2026-10-24). The lawyer's review is not needed before the Vanderbilt pilot (the owner, 2026-11-03)
  - **C2-text** The drafts' words on `/privacy` and `/terms` — ✅ (#461; DECISIONS 2026-10-24)
- **S8** 🔧 Least-privilege database roles (Phase 6): the owner's decision (Open owner items, 1)
- **C3d** Deleted sign-ins refused on the server — ✅ (#558; DECISIONS 2026-11-11); its case's CI flake fixed (#586; DECISIONS 2026-11-12)
- **C4c** AN9h's iPhone twin: one account's token for Delete account and the 13+ check (the owner, 2026-11-10: "Close it now"), the Mac's; DECISIONS 2026-11-10, "For C4c"; AN9e's two iOS gaps (DECISIONS 2026-11-11)
- **C4d** AN9j's iPhone twin, the Mac's: `409 account_deleted` read as signed out (the owner, 2026-11-12; AN9j's entry in DECISIONS, 2026-11-13, says what to mirror)
- **C4e** AN9k's iPhone twin, the Mac's: a student's notes kept off the phone's storage once a deletion's request went out (the owner, 2026-11-12; AN9k's entry, DECISIONS 2026-11-13)
- **S12** A CI scan that fails any PR with invisible or text-direction characters — ✅ (#596; DECISIONS 2026-11-13)
- **D2k** ⏸ The shield's new look (Phase 3): waits for a design the owner approves in Claude Design
- **The push's app half** — ✅ (#456; DECISIONS 2026-10-24); N6's end-to-end check passed on prod (2026-11-08); left, runbook 7's step 4, dev's `APNS_*` variables, the owner's

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
6. Vercel `bali-portal`: an Ignored Build Step `[ "$VERCEL_GIT_COMMIT_REF" != "main" ]`, so PR previews stop building. They build today (#544's did): the Preview scope holds prod's `NEXT_PUBLIC_*` values (the API, Cognito's domain and client, Sentry, and since 2026-11-07 the redirect URI; seen 2026-11-08), where runbook 3, step 5 allows dev's or none, a preview being unreviewed code. Whether to take them off is the owner's call.

**Phase 6's owner list** (not PRs — the owner, the lawyer and the school):

- ✅ Apple's §3.3.3(P) (ISSUES #3): App Review approved the build, 2026-11-12 (Before the pilot, item 5); this line in full in `docs/PLAN-ARCHIVE.md`
- Confirm the later K-12 pilot's state (likely Los Angeles or New Jersey) and the school's phone policy (ISSUES #4); the first, preliminary pilot is adults at Vanderbilt, on their own phones
- ⚖️ The privacy policy and terms; the school's data agreement (FERPA's school-official terms, the state's law or the SDPC NDPA); a breach plan; opinions on the state's phone-ban and app-store age laws
- Decision: who sees unlock reasons. (How accounts are made: decided 2026-10-04, self sign-up gated to `@vanderbilt.edu`, S11, and `@gmail.com` since 2026-11-07 (Now); MFA Optional with TOTP; the portal on `app.getbali.app` since 2026-11-07)
- 🔧 Cognito for prod: self sign-up gated (S11's Lambda) ✅, a password policy ✅, MFA Optional (TOTP) ✅, MFA on the AWS root ✅; to check: no password-auth clients, unused clients deleted, user-existence errors off; skipped for the pilot: threat protection, CloudTrail — runbook: `docs/RUNBOOKS.md`, 2 (its status list). In dev's pool, the candidate to delete: the old `bali-ios-dev` (`33qr62dl4ee4inigneidmfe2s9`, made with a secret); the clients in use are `bali-ios-dev-public`, `bali-web-dev`, and `bali-ios` (`6qcvcp0ubqmb8gunkt1d6dpkeo`), the demo's password sign-ins, on dev's `AUTH_AUDIENCE` (found 2026-10-14; `docs/DEPLOY.md`)
- 🔧 Railway for prod: the database on the private network only ✅, `CORS_ORIGINS` set exactly ✅, a long `INTERNAL_API_KEY` ✅; 2FA deferred by the owner; **no backups yet, so no restore drill**: backups before the Vanderbilt pilot's first class (L0b; the owner, 2026-10-12, withdrawing the ruling of 2026-10-05), the drill once a backup exists — runbooks: `docs/RUNBOOKS.md`, 1 and 4
- 🔧 GitHub: a ruleset and CODEOWNERS so no PR changes `.github/**`, the `Dockerfile` or `.railway/` without the owner; secret scanning with push protection; private vulnerability reporting; CodeQL ✅ (advanced setup, 2026-11-04: JavaScript/TypeScript, GitHub Actions, Kotlin; Swift not yet; blocks merges on high-or-worse security alerts and errors via `protect-main`'s code-scanning rule since 2026-10-14); 2FA — runbook: `docs/RUNBOOKS.md`, 5
- The school: its phone policy allows Bali, its FERPA notice names vendors as school officials, the agreement is signed, parents are told, students with 504 or IEP plans are accommodated

**Phase 5's owner list:**
Owner-only (not PRs): the Sentry, Vercel, Railway-prod and App Store Connect accounts and keys; Sign in with Apple (needed only if Google sign-in stays, guideline 4.8); writing the NFC tags; iPhone checks. The student-facing steps wait for Phase 6's gate items.

**The rest of the owner's queue:**

- **The lock-only portal (2026-11-16; DECISIONS 2026-11-16):**
  - 🔧 Turn lessons off on Vercel's `bali-portal` when ready: `NEXT_PUBLIC_LESSONS=off`, then
    Redeploy (LO1 ships the switch on). Best before LO2 lands: each teacher page rebuilt from the
    canvas shows no lesson pieces whatever the switch says (DESIGN.md), so with lessons on, the
    portal mixes pages with them and pages without until the phase ends.
  - The App Store screenshot about questions, the third, "Answer without unlocking."
    (`docs/APP-STORE.md`, Screenshots): whether it stays.
  - The website's lesson pictures (`demo3`).
  - Whether the privacy policy and terms drop questions and slides. The switch is the portal's
    alone: the API still takes answers and decks, the apps still show what a teacher sends, and
    what is stored stays until retention, so the policies' lines stay true until that changes.
- 🔧 **Prod's sign-in pages to managed login (2026-11-12):** its two clients wear the style; switch
  its domain, outside class hours, by the one command in `infra/cognito/managed-login/README.md`
  ("The domain's switch, and back", its rollback beside it), then sign in once on prod to confirm.
- 🔧 **Prod's MFA, a mismatch (2026-11-12):** AWS reports prod's pool's `MfaConfiguration` as `OFF`,
  where this file and runbook 2 say MFA Optional (TOTP) ✅. Nothing changed: the owner's to check.
- **Bali Focus Inc. (2026-11-11):** App Store Connect's seller and copyright fields, and the provider's address and phone for the terms' California notice (§ 1789.3).
- **The prod sitting's findings (2026-11-08):**
  - 👀 A student with no name shows as their account id's first 8 characters ("01a11334" on the
    grid, the recap's Didn't join and a session's report): `displayName ?? id.slice(0, 8)`, `nameOf`
    in `apps/web/src/lib/recap.ts`, written again in `live-grid.tsx`, `student-panel.tsx`,
    `unlock-popups.tsx`, `home.tsx` and the class page's roster. Ids are UUIDv7s, so those 8
    characters are when the account was made, shared by accounts made in the same 65-second window:
    this one was made on 2026-10-06, the day before the app's Your name (DECISIONS 2026-10-07). The
    student web never asks for a name. What a nameless student should show is the owner's design call.
  - The student web's tab reads "Bali teacher portal": the root layout's one title
    (`apps/web/src/app/layout.tsx`), on every page but `/privacy`, `/terms` and `/support`. A UI
    step's fix, its words through `no-ai-slop`.
  - 🔧 Vercel's previews carry prod's values: the overnight investigation's item 6, above.
- **The App Store review (approved 2026-11-12; `docs/APP-STORE.md`):**
  - Release: by hand, held until the owner says (2026-11-12).
  - The student review account is a Gmail address the owner made and confirmed in the AWS console,
    whose inbox the owner can't open, so whoever holds that inbox could reset its password. After
    review, disable it in Cognito (`docs/APP-STORE.md` §5.4, step 6) and re-enable it for the next
    review; a forgotten password is reset through AWS.
  - App Review may ask for a tap the reviewer can try (§4's options B and C), about students' names
    on Present (guideline 1.2), or about a teacher's deletion by email (DECISIONS 2026-11-07).
- Android's six still open (the phones, the Play account, the timing, the SDK's Android 11 or 12 image, the help page's iPhone-only lines; 🔧 prod's Cognito client): `docs/PLAN-ANDROID.md`, Open owner items.
- 🔧 Sentry: confirm monitor `api-sweep`'s `production` environment is active and alerting (dev checks in to the same slug, #239's review; runbook 6, step 2).
- #165 the Me page: D2j's redesign was rolled back (2026-10-06), so a better Me waits for a design the owner approves; the issue, closed by #266, is the owner's to reopen.
- #130 App Store readiness.
- #175 Screen Time turned back on in Settings, noticed by Bali itself.
- #176 reading and sending at once when the network comes back (filed 2026-10-03, not now).
- D2, the redesign: the picks are made (2026-10-04); 👀 the owner looks at each screen group's screenshots, D2c first (Phase 3 steps).
- #143's optional "you were removed" message.
- The parked PRs #61 and #49.
- 🔧 Production, still open: check that the next push to `main` deploys `bali-portal` on its own now that `vercel.json` is deleted (runbook 3, step 6); Railway 2FA, threat protection, CloudTrail, the backups (L0b) and the restore drill are on Phase 6's owner list above.
- 👀 After the next deploy of `bali` and `bali prod` (P8's follow-up): the deploy log shows the migrations, then `Server listening`; a later redeploy's log for the old deployment shows `shutting down` with `signal: SIGTERM`.
- Phase 7: **to decide**, #313 (what a teacher's own deletion, and the retention run, do with their words), kept as today for now (the owner's ruling, 2026-10-12); **tracked fixes**, #319 ✅ (#437, saved questions' id case), #326 (a slow upload outliving its deck; M5 aborts it at 25 minutes, and a stuck one once nothing is sent for 30 s, #436), #334 ✅ (#403, a timeout on the portal's polls; #432, on every other read and save but a deck's check and a class's create, which has one since 2026-10-23), #336 measured (#438; DECISIONS 2026-10-22), its fix, a random wait of up to 10 s before the phone's first read after a push, approved by the owner (2026-10-23) and built in the push's app half (#456); and a bell past the gate's 600 phones is over the Starts' 1 s with no push (1,200: 0.9–1.2 s), a later step's before a school that size; L0b is the owner's (Railway, above). The calls confirmed on 2026-10-12: this line in full in `docs/PLAN-ARCHIVE.md`.
- #380: Present after the bell has no Start, so starting the next class from a projected tab shows the last recap's unlock reasons (the owner, 2026-10-14: tracked, not now); PresentEnded's line, "the session ended at 9:55 AM", waits with it (PV12b kept Present's "no session running")
- Left for the owner on finished steps' lines (in full in `docs/PLAN-ARCHIVE.md`): P6's restore drill, its result recorded once a backup exists; S4's CSP check on the deployed portal after each Next upgrade (due now, for 15.5.28, #435); ⚖️ whether C7-server's yes rides Other Data Types; device rounds still marked pending (B5b's round 2, steps 7 and 9; B5c's round 3, steps 1 and 3; round 4, B6a and B6b); smaller calls on F (a refused tap's end-of-day drop or dismiss button; the waiting card's Tap in), B6c-2 (`.keep`/`.retry`), B5b (a rule for a replaced window, a code step to schedule) and D2 (Present's key per class).
- 🔧 Before the pilot's first class: the owner's prod block gets a fresh code (its first reached the repo's history in #228), and a session builds an owner command that retires a block, to retire the old code (`docs/PILOT.md`, setup step 6). The portal's three class-page controls are built (P10, P11).
- **Before the pilot's first class, four steps for sessions** (the owner's workflow review, 2026-10-13; one PR each; after the redesign's PV17c, the owner, 2026-10-14); the event-id check done (the owner's go, 2026-10-23), the other three wait for the owner's word:
  - a column-level privacy test: every column classified personal or not, each personal one placed by the privacy paths that handle it (the account deletion, the disposal, the retention run, the export), so a new column fails until it is placed; FERPA covers university students too;
  - a repeated-`event_id` check on every data-changing route — ✅ as part 1 (#442), part 2 (#447) and part 3 (#449); DECISIONS 2026-10-23;
  - pilot deploy rules: no deploys during class hours, and a documented one-command rollback in `docs/RUNBOOKS.md`;
  - Dependabot PRs can't pass Claude Review (the action rejects bot actors: add `allowed_bots` for dependabot in `claude-review.yml`, bundled with the next edit to that protected file); until then such a PR waits, as #427 (`vite` 8.3.4, dev only) does. #309 (`next` 15.5.27) is superseded by 15.5.28 (#435), and Dependabot closes it itself once main has it.
- 🔧 The Cognito sign-in deleter: runbook 9 (`docs/RUNBOOKS.md`) — per environment an IAM policy
  allowing only `AdminGetUser` and `AdminDeleteUser` on its own pool, a user and its access key,
  the two `COGNITO_DELETER_*` variables on dev's `bali` and prod's `bali prod`; the end-to-end
  check on dev (C3-cognito).
- 🔧 Push: runbook 7's step 4 (`docs/RUNBOOKS.md`), the three `APNS_*` variables on dev; prod's
  steps are done, and its end-to-end check (N6) passed at the sitting (2026-11-08).
- 🔧 Dev's Cognito pool (`us-east-1_YTloqilwT`): turn on email as the attribute to verify, so a sign-up on its hosted page can be confirmed; today it ends on Cognito's error page with the account unconfirmed (found 2026-10-12; `docs/GOTCHAS.md`). The demo accounts sign in as they are.
- 🔧 Delete dev's unused phone client `bali-ios-dev` (`33qr62dl4ee4inigneidmfe2s9`) in the dev pool; keep `bali-ios`, the demo's (2026-10-14).
- 🔧 S4a's Sign out: check dev's web app client lists `http://localhost:3000/login` under Allowed sign-out URLs, and add it if not (`docs/WEB.md`).
- 🔧 Vercel `bali-portal`: `NEXT_PUBLIC_DECK_BUCKET_URL`, prod's deck bucket (runbook 10, step 8), then Redeploy (looks done: prod's portal lists `bali-decks-prod-eshshah` in its CSP's `connect-src`, seen 2026-10-24; the owner to confirm), before Your slides (M5b) is used on prod: without it the browser refuses every upload.

## Go-live features

### In scope for launch (phase noted)

One line each; every row's full notes, as they stood on 2026-10-13, are in `docs/PLAN-ARCHIVE.md`.

| Feature | Phase | Notes |
|---|---|---|
| Core loop: tap→shield offline, armed taps, live grid, unlock always-recorded, refocus, join codes, roster, removal, self-expiry | 1–2 | ✅ built: leaving a class never in session (A19), self-expiry to the minute (A15), the tap over NFC offline (B6a), an unlock before the tap's answer filed under it (B6b) |
| 30s check-in that verifies shields before claiming them | 3 | rule 3 · ✅ (A2, A2c, B3b-2, B5a) |
| Shields survive force-quit; bell frees phone via extension | 3 | ✅ confirmed on the owner's iPhone (B5b's round 2, 2026-09-27) |
| Onboarding: Sign up or sign in → Sign up's 13+ check and intro → sign-up → your name → Screen Time grant → Home | 3 | ✅ built (B4, B5a, C1a–C1c, C7 and C7-server, the approved Sign in & sign up design), no allow-list step; C7's first-launch check passed on build 12 (2026-11-08) |
| Consent preview before joining a class | 3 | ✅ (A6, C2b) |
| Unlock with optional, skippable reason (bathroom/nurse/other) | 3 | replaces full "passes" at launch · ✅ (A1, A9, C5a) |
| Custom shield screen ("Focused with Bali") | 3 | ✅ (B5c, B5c-2): Bali's own shield, no time, nothing read |
| Minimal student personal history + edit own name | 3 | backs the privacy contract · ✅ (A7, A8, C6b) |
| Sign in with Apple (App Review guideline 4.8) | 5 | Cognito IdP |
| End-of-session recap card (portal) | 4 | ✅ (R4) |
| Reports: class focus minutes + unlock list; aggregates only, never rankings | 4 | ✅ (R1–R3, R5); `sessionReport` counts by this row's rules, in its full notes; a silence counted from its `went_silent` to its `came_back` or its stint's end, the pair the server's (#385) |
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

No longer waiting: the **Family Controls distribution entitlement** (Apple) — ✅ granted (owner,
2026-09-24) for all three bundle IDs; the note in full in `docs/PLAN-ARCHIVE.md`.

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
- A phase whose step lines were written up front, two workers at once (Lock-only portal): a worker
  changes only its own line, a step done keeping it with ✅, its PR and its DECISIONS date. Whatever
  else its step changes here (the header line, a count in Now such as the source-text tests left)
  waits for the phase's end, noted on the step's own line meanwhile; the phase's lines move to the
  archive together then.
- An Android step updates `docs/PLAN-ANDROID.md` by these same rules, and here Android's lines
  (Now, its phase rows, its owner items): its Now line at least when it changes source, as CLAUDE.md
  asks of every source change.
- Made a real decision? It goes at the top of `docs/DECISIONS.md`, not here.
- Built a new feature? Add a row under Go-live features with a one-line
  architecture note; if a design decision changed, ARCHITECTURE.md is updated
  too.
- Keep it scannable — statuses and one-liners, not essays. History belongs in
  git; this file is the current truth.
- Past 8,000 words the "Plan doc updated" check fails: move finished detail to the archive, word
  for word, and the why to `docs/DECISIONS.md`.
