# Bali v3 — decision log

Why things are the way they are, newest first. Moved out of `docs/PLAN.md` on
2026-09-23 so the status doc stays short enough for every session to read.

**Using it:** don't read it front to back — search it for the area you're
touching before changing how something works. A pointer of the form
"docs/PLAN.md decision log, <date>" means the entry with that date here. Made
a real decision? Add a dated entry at the top: what was decided and why.

- **2026-09-25** — **B4b: the student's sign-in, in BaliCore — Cognito's hosted UI with PKCE,
  the tokens in the Keychain, and one sign-out.** `SignIn` (`ios/BaliCore`), an actor, is B1c's
  `TokenProvider` and the sync engine's `refresh`. It signs the student in through Cognito's
  hosted UI with the authorization-code grant, PKCE (S256, a fresh 32-byte verifier) and a state
  value binding the answer to its attempt, over the phone's own public client (`docs/DEPLOY.md`,
  "The phone's sign-in"): no client secret anywhere, and no token in any URL — the code is
  exchanged at `/oauth2/token` in a form body. The tokens live behind `TokenStore`:
  `KeychainTokenStore` on the phone, memory in the tests, so every rule runs on Linux too
  (SHA-256 from CryptoKit, or swift-crypto where there is none — 4.5.2, exact, since 5.x's
  manifest needs Swift 6.2, above GRDB's 6.1). **The browser is the app's, and ephemeral.**
  `signIn(through:)` takes it as a closure — the app's `WebAuthenticationSession` (B4c's
  trigger, then C1's screen) — so BaliCore stays free of UI. Ephemeral, because it then shares
  no cookies with Safari: Cognito's hosted-UI session never outlives the sign-in, so signing out
  of Bali is signing out and nobody is signed in as the phone's last student by a cookie;
  nothing about a minor's sign-in stays in Safari; and iOS asks no "wants to use … to sign in"
  first. It costs single sign-on with Safari — nothing here, where a student signs in roughly
  once, ever (auth decision 2). The redirect, `bali://auth/callback`, is caught by that session
  itself and is no URL type of the app's, so no other app or page can hand the app an answer —
  and a code taken anyway is useless without the verifier. **The Keychain,
  `WhenUnlockedThisDeviceOnly`, no shared group.** The tightest class that works today: the
  engine sends only while the app is in the foreground (its check-in is foreground-only, and
  the extensions record to the outbox but never send), so a token is needed only while the
  phone is unlocked; `ThisDeviceOnly` keeps the tokens out of iCloud Keychain and out of a
  backup restored to another phone. A Keychain that cannot be read right now (the phone locked,
  a prewarmed launch) is read again at the next ask — never a sign-out. **B5 revisits it** if
  work in the background — a queued unlock sent behind a locked phone — needs a token: that is
  `AfterFirstUnlockThisDeviceOnly`, and since `save` sets the class only when it adds the item,
  the move must update the stored item's class too. **The token's own clock, never the
  phone's.** An access token is given until its own lifetime, `exp` − `iat` — both the server's
  clock — has passed since it arrived, less 60 s so one sent still arrives in time. Comparing
  `exp` with the phone's clock would have a phone set wrong send expired tokens, or renew before
  every request (rule 1: the server owns the clock). A clock changed after a token arrived moves
  only that token's end: set ahead, it renews early; set back, the API's `401` renews it
  (`refresh`). A token whose lifetime cannot be read is given until the API refuses it.
  **Only `invalid_grant` signs anyone out.** Auth's "Only a real 'no' signs anyone out": on the
  phone that no is Cognito's token endpoint refusing the refresh token (`400 invalid_grant` —
  revoked, expired, the account disabled or gone). Nothing else is one. The API's own `401`
  renews the token and never signs out — an `AUTH_AUDIENCE` missing the phone's client rejects
  every token, and must not sign a school out. A timeout, no network, a 5xx, a 429, a redirect,
  and `invalid_client` or `unauthorized_client` (a misconfigured client: ours to fix, not the
  student's) keep the tokens, and the next ask tries again. A sign-out forgets the tokens only,
  never a queued record, which waits for the next sign-in ("A saved emergency unlock outlives an
  expired token"). **Rotation-safe renewal.** One renewal at a time, shared by every caller —
  the check-in, the drain, the engine's `refresh` — so a refresh token is never spent twice:
  were the client to rotate refresh tokens, the second spend would be refused `invalid_grant`,
  a sign-out we caused. A rotated refresh token replaces the one kept, and one the Keychain
  cannot take right then (the phone locked mid-renewal) is saved again at the next ask, since
  the old one stops working and the new one is nowhere else — lost only if iOS ends the app
  before that ask, and then the next launch's renewal is refused: a sign-out, the one case a
  rotating client would add. An answer about a refresh token the phone let go while it ran
  (signed out, or in again) is dropped, so a stale no never signs a new sign-in out. The dev
  client does not rotate — so turning rotation on (Phase 5's production client, say) should
  weigh that case. **B4's contract with the engine, kept:** `accessToken()` never gives a
  token it knows has expired; `refresh()` takes the token held out of use and never waits on
  the student — false at once when nobody is signed in — and is true once a fresh token is
  ready; and every token but `refresh`'s (a sign-in, a renewal of its own) runs
  `whenTokenArrives`, which B4c points at the engine's `retryNow()`. `cognito` is
  `nonisolated`, so the app reads the redirect's scheme for its browser session without a hop
  (an actor's `let` is isolated outside its module) — B4c's change, made here with BaliCore's
  API. **Tests** (`SignInTests.swift`, Linux and the iOS
  Simulator): the S256 challenge against RFC 7636's own example; fresh verifiers and states;
  the authorize URL, never the verifier; the answer's code taken only at the redirect URI, for
  its attempt; the code exchange (no secret, the verifier whose challenge opened the page);
  sign-ins that do not finish, or whose tokens the Keychain refuses, keeping nothing; the token
  given until the margin whatever the phone's clock; renewal, the engine told; rotation, and a
  rotated token saved after a locked Keychain; `invalid_grant` signing out, and eight other
  answers keeping the tokens; the engine's `refresh`; one renewal shared, whoever starts it; a
  locked Keychain never a sign-out; signing out; a sign-out, and a sign-in, while a renewal
  runs; an unreadable lifetime; and `cognito` read from another module. Of 42 mutations of
  `SignIn` tried in review (listed in its PR), 41 turn a test red; the last — `refresh()`
  without its early return when nobody is signed in — changes nothing a caller can see, since
  a renewal with no refresh token sends nothing. Not in them:
  `KeychainTokenStore` itself. A package's test process carries no entitlement, and the
  Keychain refuses it (`errSecMissingEntitlement`, -34018), so its first run is the app's (B4c).
- **2026-09-24** — **B4a: the API accepts a list of app client ids, and B4 ships in three.**
  **The list:** `AUTH_AUDIENCE` is comma-separated, each id an app client whose tokens the
  API accepts, matched as the one id always was (an access token's `client_id`, an id
  token's `aud`). **Why:** the phone signs in through its own public app client (B4), in
  the pool the portal's web client is in, and WEB.md keeps the two apart — their callback
  URLs and grant settings differ — so one issuer now has two clients whose tokens are the
  API's. One variable made a list rather than a second variable, because a single id then
  reads exactly as before: no environment has to change to take this. Spaces around an id
  are dropped; an empty entry (`a,,b`, a trailing comma, a blank value) fails the boot, as
  a missing variable does — the empty slot is where an id was meant to be. The verifier
  takes the list (`createVerifier({ clientIds })`); nothing else about a token's check
  changed. **The order on dev:** the phone's id is appended to dev's `AUTH_AUDIENCE` only
  once this is deployed — the code before it compares the whole value with the token's
  client id, so a list set first would refuse every token. The owner's side is
  `docs/DEPLOY.md`, "The phone's sign-in": the pool's hosted-UI domain, the phone's
  client, and its refresh-token expiration raised above Cognito's 30-day default — Cognito
  refusing the refresh token is the app's one sign-out, and auth decision 2 has a student
  sign in roughly once, ever. **The rider (#78's review):** `returnedSince` reads the
  student's returns within `[started_at, ends_at]`, which holds every return only because
  a window never shrinks — `extendSession`, the one writer of `ends_at` once a session
  starts, adds to the later of now and the end it had — so the read says so, and a PGlite
  test pins it: a re-tap near the end, an extension pressed early, then a late unlock is
  still `superseded`. **Split for size:** B4 came to 612 counted lines, over the ~400-line
  bound, so it ships as three PRs in order: B4a (this, the API), B4b (BaliCore's `SignIn`
  and `TokenStore`) and B4c (the app's wiring and build settings, where B4's contract with
  the engine is kept).
- **2026-09-24** — **A12: the phone's own order, not its clock, decides whether a student's
  unlock came after their own refocus or tap (owner ruling).** The ruling, verbatim: "The
  phone numbers its own actions with a counter, not the clock, and the server orders a
  student's own unlock and refocus by that counter. A tampered clock can then never undo a
  real unlock. It adds one optional field, done as its own small step before B6." **Why:**
  A10 judged "after" by the clamped device times, each return capped at `recorded_at`, so a
  clock turned back between the student's return and a real Emergency Unlock made that
  unlock read as late — recorded, `superseded`, not applied, the phone shielded again — and
  it did not take until the clock was right. **The counter was already there:** the outbox's
  `seq INTEGER PRIMARY KEY AUTOINCREMENT`, which SQLite never reuses or lowers in the file's
  life, and whose order the records drain in — the order the phone acted in. It is per file,
  and one file serves the app and its extensions (B3b-2), so a reinstall (a new app-group
  container) starts again at 1: the field carries the file's identity. **The field:** one
  optional object, `order: { install, seq }` (`ActionOrder` in `@bali/shared` and BaliCore):
  `install` a UUID minted once per outbox file (BaliOutbox's migration `v2`, a lower-case
  UUID in `outboxState`), `seq` the record's own. On every record the outbox sends: the tap,
  the unlock under a session and A11's under a tap (one body), the refocus — and protection
  off, the uniform choice, since its body and engine path are the refocus's
  (`StateChangeBody`, `changeState`): stored there, read by nothing yet. Not the check-in, a
  join or a rename: no outbox record, nothing ordered. A retried record sends the same (its
  request is built from what was stored). **Stored:** two nullable columns on `events`,
  `order_install uuid` and `order_seq bigint`, both or neither (`events_order_whole`,
  migration `0008`) — columns, not the payload, because the teacher's live feed ships the
  payload whole and has no use for a phone's install id. Written only by the engine
  (`orderColumns`), and only an order `knownOrder` can compare, as `knownReason` does for
  the reason. **An armed tap keeps its order** in the same two columns on `armed_taps` (a
  stale row taken over takes the new tap's), and the Start records its `tap_in` with it:
  kept none, a tap armed on a clock running fast and an unlock made after the clock went
  back past the Start would be ordered by the times, and the real unlock read as late
  (santa's review). **The
  judgement** (`returnedSince`): a return of the student's own in that session — `tap_in` or
  `refocus` — from the unlock's install is after it exactly when its seq is greater. Every
  other pair keeps A10's time rule, unchanged: no order on either side (the A10 tests pass as
  they were), on one side only (an old build's), or another install's (a reinstall, another
  phone). Any return after it and the unlock is `superseded`.
  Protection off still comes first, and the ended row (#76's rider) is judged the same way:
  late by the order once the student has left, and not late by the clock alone — the unlock
  they left on keeps its `after_session_end` / `no_live_participation`. Occurred times never
  change (rule 1's clamp stands): the order decides only which of the student's own two
  actions came last. The read now covers the student's events in the whole window
  (`events_user_occurred_idx`, still), since by the order a return timed before the unlock
  can come after it. **A11's paths:** `unlockUnderTap` hands the order to `unlockIn`; a
  record kept `unknown_tap` keeps its order, and `tapIn`'s filing loop files it with that
  order — made while its tap was unanswered, it is numbered after it, so the tap just
  recorded is never a return after it; a later re-tap of the phone's is. Lock order
  unchanged: `lockTap`, then the session. **Trust boundary:** validated at the route (`Order`, over the
  shared `isActionOrder`: a UUID install and a positive safe integer seq) and again in the
  engine. A malformed order is taken as none **on every endpoint**, never a `400`: on an
  unlock a `400` keeps the record out forever (B3a keeps a refused unlock stuck and resends
  the identical body — the reason's rule), and on a refocus it is dropped for good and a tap
  left stuck, all over a field whose absence already has an answer; one rule everywhere, so a
  phone never needs to know which endpoint is strict. **A forged order is harmless:** it is
  the student's own claim about their own two actions, compared only among the caller's own
  events. The worst it does is apply a stuck unlock the student could have made anew
  (Emergency Unlock is always allowed), or make their own unlock read late — recorded either
  way, in the session's feed and their history, and answered with the state the phone then
  shields to, so the grid is never green over an unshielded phone. **Not covered,
  disclosed:** (1) a refocus the phone made before its unlock that reaches the server after
  it still applies — only one in flight when the unlock was recorded can (the outbox deletes
  a queued refocus), its request outliving the phone's timeout: arrival order, not a clock,
  and the ruling orders the unlock's judgement; (2) a backup of the outbox file restored onto
  a second phone still in use shares its install, so the two phones' orders compare as one's
  — at worst a forged order's effect. **Elsewhere the phone's clock still orders a student's
  own actions** (out of this ruling, listed not fixed): the history (`getHistoryPage`, newest
  first by clamped `occurred_at`) lists an unlock the order applied — timed before the
  refocus it followed — under that refocus; and Phase 4's reports must not compute focus
  time from the times alone where the order decided (PLAN's reports row). Nothing else in
  the engine compares a student's own device times. **Riders (#77's review):** an engine test
  pins that an unlock kept `unknown_tap` whose tap then arms is never filed — the Start joins
  the student focused, the record in no class; and the chip turn's comment says its
  unlock-only scope is deliberate, not defensive. **Tests:** the engine on PGlite (a clock
  turned back: applied; a stuck unlock older by the order: late, its clock reading later;
  another install's and one-sided pairs: the time rule, both ways; the ended row; protection
  off first; A11's tap-bound unlock in both arrival orders; a late tap's filing; an armed
  tap's order through its Start, a stale row's taken over; replay; what is stored, and a
  malformed order as none), a real-Postgres race (the late unlock against
  the return that went ahead of it, on a clock turned back), the API (each endpoint takes and
  keeps it, an armed tap until its Start; the clock case end to end with its replay; a
  malformed order never refused, on every endpoint), the route's schema table, five fixtures (`*-ordered`), BaliCore (the
  wire, both ways) and BaliOutbox (the install minted once per file, a v1 file given one, each
  record's own seq — never reused, the same on every retry). Seven mutations of the rule and
  what it stores each turn a test red — the first on the real-Postgres race too.

- **2026-09-24** — **A11: an unlock made before the phone's own tap is answered is filed
  under that tap (owner decision 11).** **The endpoint:** `POST /v1/taps/{eventId}/unlock`,
  additive — the tap's id in the path, the session unlock's body (`eventId`, `deviceTime`,
  optional `reason`) and answer (`UnlockResponse`), so `unlockDisposition` deletes the record
  exactly when it is durably recorded, as for any unlock; BaliCore's `unlock(tap:_:)`. In the
  unlock family, not a new shape: the phone's outbox already knows the answer. **Filed:**
  `unlockUnderTap` looks the tap up among the caller's own `tap_in` events and files the
  unlock in that one's session by `unlock`'s rules — the body moved into `unlockIn`, which
  both share, so the notes, A10's `superseded` and the clamp to that session's window (rule
  1) are one code path — its payload naming the tap (`tap_event_id`). **Kept:** no session
  to file it in, it is kept as an unknown session's is (no session or class, the claim and
  the device's time in the payload, the server's time on the row), with two additive notes:
  `tap_armed` (the caller's tap waits for Start) and `unknown_tap` (no tap of the caller's
  has that id). Another student's tap id is `unknown_tap` — looked up among the caller's
  own only, so it never files anything into their session, and says nothing of their tap —
  and so is a teacher's; never a `403`: an unlock is never refused. **Armed:** the unlock
  came before any session did, so the Start that converts the tap files nothing — it joins
  the student, as the tap asked (the owner's "kept as an unattached record"); one reaching
  the server after that Start finds the tap landed and is filed there, like any. A note
  says what the server knew when the unlock arrived: an `unknown_tap` whose tap then arms
  stays so, kept in no class, and no Start files it. **Decided
  here — the tap arriving after its unlock:** the phone sends in order, but a tap stuck at
  its retry bound (B3a: refused, or 8 unsettled answers, say through a deploy) steps aside
  for the unlock behind it. Kept unattached and never filed, that order would end with the
  tap joining the student focused: the grid green over a phone its student unlocked, the
  unlock in no teacher's view, and the phone re-shielded by its tap's answer — the same two
  records giving a different truth by network timing. So a tap landing in a running session
  (`tapIn`) files every `unknown_tap` record of its own student under its id, by the same
  rules, under a fresh id naming the kept record (`unattached_event_id`: history is
  append-only, the kept row stays as it was), and answers the state that leaves — `joined`,
  `unlocked` (`apply_session`, no shield). Either order then ends alike. Not `tap_armed`
  ones, for the reason above. **The race:** neither side sees the other's uncommitted row,
  so arriving together each could miss the other; both take `lockTap` first — a transaction
  advisory lock on a hash of the tap's id, before the session's lock, one order everywhere —
  so one always commits before the other looks. Staged on the real-Postgres lane (a holder
  parks the unlock on its own id's index right after its look; with the lock the tap waits
  and files it, without it the tap commits focused), and raced freely in both orders.
  **Cost:** every tap takes the lock and looks for kept unlocks, one probe of a partial
  index holding only unlocks with no session (`events_unattached_tap_idx`, pinned by an
  EXPLAIN test): ~0.6 ms a tap for both on the real lane, the look alone inside the
  session's window. **Idempotency:** the unlock's own id is looked up first, so a retry is
  answered where it was recorded — a kept one stays kept (`replay`, no session: the phone
  re-reads) even after its tap filed it — and an id another event holds is `409`, as
  `unlock` refuses one. **Not handled, disclosed:** an armed tap converted under a fresh id
  because its own collided (`convertArmedTaps`, which no honest phone reaches) is known here
  only as armed. **Riders (#76's review):** (1) `superseded` now comes before "no live
  participation": an unlock the student's own refocus or tap in that session went ahead of
  is late whether or not they are still in it. After the bell or a removal it was noted
  `after_session_end` / `no_live_participation`, which the grid paints "Left · unlocked"
  over a phone that was shielded when it left — a false alarm on ISSUES #2's own signal.
  Answered `recorded` with no state (nothing is live), which the phone re-reads; with no
  return after it the old notes stand. (2) The snapshot's chip turn looked past
  `recorded_as: superseded` on every turn; scoped to unlocks, so a return is never skipped
  for a note it cannot carry. **Tests:** the engine on PGlite (filed, filed where a switch
  went, the rules, armed and the Start, unknown and another's, both orders, a late tap
  filed late, only its own student's, a retry, a conflict, the index plan), the two races,
  the API (the answer, armed and unknown, the late tap, a stranger and a teacher, `400`,
  `409`, `401`), five fixtures, BaliCore; the riders' in the engine, the history, the
  snapshot and the grid. Eleven mutations each turn a test red.
- **2026-09-24** — **Owner rulings: a late unlock is recorded, not flipped (A10);
  ARCHITECTURE gains two clauses; decision 11 stands.** (1) **"Record it, don't flip."**
  The case #73's Claude Review and B3a's entry left open: an unlock stuck on the phone
  (B3a's bound — refused, or 8 unsettled answers), the student's own later refocus or tap
  passing it, and the old unlock landing last. The engine flipped a focused row to
  `unlocked` on any late unlock, whatever its time, so the grid read "Unlocked" and the
  phone, applying its answer, dropped the shields over a student back in focus. The
  owner chose: still recorded — never lost, the unlock contract — but when the student's
  own refocus or tap in that session came after it, the live state is left alone. A10
  builds it (next entry). (2) **ARCHITECTURE clause 1, "yes, add it":** the rule that a
  read never overrides a newer state change of the phone's gets B3a's and B3b's
  exception — a record stuck after repeated failures stops holding reads back, so the
  phone can reconcile again, while an unrecorded unlock still keeps any read from turning
  its own session's shields back on, unless the student has refocused or re-tapped there
  since (B3b-2's narrowing). (3) **ARCHITECTURE clause 2, "yes, add it":** data-model
  decision 3's "screens simply skip rows where `removed_at` is set" now names the
  exception A9 made — a session's live grid keeps a student removed mid-session who was
  in it (a participation or an unlock there), so their unlock stays visible. (4)
  **Decision 11** stands as its entry below records it — an unlock made while the phone's
  own tap is unanswered is filed under that tap (A11's `POST /v1/taps/{eventId}/unlock`;
  B6 and C5 use it) — checked against PLAN's decision 11: the two agree. When A11 builds
  that endpoint, the unlock it records goes through the same rules, A10's included.
- **2026-09-24** — **A10: a late unlock is recorded, never applied.** **The rule:**
  `unlock` notes an unlock `superseded` (`UNLOCK_RECORDED_AS`, additive) and flips nothing
  when the participation is live, not protection off (that note still comes first), and
  the student's own `refocus` or `tap_in` in that session came after it
  (`returnedSince`) — in any stint of that session, so a return after a switch away
  counts, and only the student's own: a classmate's return, a return in another class
  or the student's own later unlock is none. **How "after" is judged** (rule 1: the
  server owns the clock, and the clamp orders events): the unlock's clamped `occurred_at`
  against each return's clamped `occurred_at`, capped at its `recorded_at` — a claim is
  never later than when the server recorded it — and strictly: a tie is not after. The
  cap keeps a clock that ran fast at the return (a tap clamped to the bell, the phone's
  time corrected after) from outranking every real unlock after it, which would have
  held Emergency Unlock off for the rest of the lesson. The tie keeps rule 1's v2 bug
  out: a clock running behind all lesson clamps the tap, the refocus and every unlock to
  the window's start, and each unlock still flips. So a doubt goes toward flipping —
  the behaviour before — never toward hiding: a stuck unlock and a return that tie, or a
  clock fast at the return by more than the unlock was stuck, still flip as they did.
  **The answer** mirrors A2's `protection_off` note: `recorded`, the note, the session,
  the participation and the state left alone (`focused`, or `unlocked` when a newer
  unlock landed since); contact moves `last_seen_at` and closes an open silence episode.
  `recorded` means delete (`unlockDisposition` and `contracts/outbox/` unchanged), and the
  phone applies the session and state named, as B3b-2 applies any unlock's answer — a
  phone that came back to focus stays there. **Judged under the session lock:** a
  refocus and a tap lock the session too, so whichever lands first decides — the unlock
  first flips and the return then takes over; the return first, and the unlock is
  recorded as superseded. Either way it ends in the return, pinned by a real-Postgres
  race. **Cost:** one read per unlock that finds a live participation, over the
  student's own events after its time (`events_user_occurred_idx`); `recorded_at` is the
  return's transaction start, a little before it landed, so the cap errs only toward
  flipping (santa's review). **A backdated clock:** the server cannot tell a stuck unlock from one made now on
  a clock turned back after the student's return — both arrive after the return,
  claiming an earlier time — and nothing on the wire carries the phone's own order (its
  event ids take the same clock). What that clock gets: the unlock is recorded, reason
  and note, never erased (v2's bug was erasure); its answer names the session and
  `focused`, which the phone applies to its shields at once, so the grid's green is
  never over an unshielded phone (rule 3's v2 bug) — the student gains nothing. What it
  costs: that student's own unlock does not take until the clock is right, and C5 says
  why. Only a clock moved backwards between the return and the unlock reaches it: the
  cap handles a fast clock corrected after the return, and a clock steadily fast or slow
  keeps the order. Closing even that needs the phone to send the order it acted in with
  the unlock (additive) — not built; the owner's call. **Readers:** the grid's
  `applyUnlock` leaves the chip alone for a `superseded` note, from the stream and the
  snapshot alike, and the snapshot's chip turn looks past such an unlock to the one
  before it, so a newer unlock keeps its reason on the chip; the history (A7) shows it
  at its own time — under the return that went ahead of it — with its `recordedAs`;
  reports (Phase 4) must not end focus time at it (PLAN's reports row). **Rode along:**
  `timestamps.test.ts` stamped its unlock 3 s before the student's own tap, a late
  unlock now; its tap is stamped 10 s back. **Tests:** the engine on PGlite — after a
  refocus and after a re-tap, a newer unlock kept, each arrival order, a later and a
  tied unlock flipping, whose return and where, a later stint, protection off first,
  contact, and a clock behind all lesson, fast at the return, and turned back; a
  real-Postgres race of the late unlock against the refocus or re-tap that went ahead of
  it; the API (the answer, its disposition and replay, the snapshot, the history); the
  grid; BaliCore's vocabulary and a fixture (`unlock/recorded-superseded`); and
  BaliOutbox's reconcile — a late unlock landing after a re-tap leaves the phone in
  focus, and one answered late with no return since puts the shields back. Ten
  mutations of the rule and its readers each turn a test red.
- **2026-09-24** — **Owner ruling: decision 11 — an emergency unlock made while the
  phone's own tap is unanswered is filed under its tap.** The phone sends it with the
  tap's `event_id`, and the server records it in whatever session that tap landed in —
  late or noted, as today — or as an unattached record with a note when the tap was only
  armed or never arrived: never lost, and never in the session the phone was in before a
  tap that switched it (a read would then re-shield the new session over it). A11 builds
  the endpoint (`POST /v1/taps/{eventId}/unlock`, additive); B6 and C5 use it. Until
  then `SyncEngine.record` needs a session, so nothing sends one.
- **2026-09-24** — **B3b-2: the check-in, the reconcile, and one file for the app and its
  extensions.** **The phone's truth** is `SyncState.standing` — out, waiting (armed), or
  in a session in a state: shielded only while `focused`, and a state this build does not
  know never is — with `pendingTap`, a tap not yet answered, which enforcement shields for
  at once to decision 7's cap (not a stuck one: a refused tap's shield must not outlive
  the refusal). Screens and enforcement read it from `updates()`. **The phone's own
  changes stand at once** (`record`: an unlock, a refocus, protection off of the session
  it is in). **A change's own answer** is the truth as of that change: applied when it
  names a live session — a session and a state — unless a later change of the phone's
  still waits for its own answer (`awaiting()`), which then stands over it. Armed waits
  for the Start but never ends a session the phone is in (arming joins nothing). An
  answer naming no live session — a tap recorded but no longer current, or refused; an
  unlock recorded with a note, which may name the session it ended but no state; a state
  change recorded after the end, or dropped — re-reads the truth (`GET /v1/me`). **Reads**
  — the check-in, and `GET /v1/me` on coming to the foreground and whenever an answer says
  to (one with no answer is tried again at the next wake, never at once) — are stamped
  when sent (`ReconcileStamp`: `changes`, each change the phone makes and each answer to
  one but retry and reauth; B3a's `awaiting`) and applied only when `readMayReconcile`
  says no change can be newer. **The unlock guard, exactly:** no read turns a session's
  shields back on over an unrecorded unlock (`holdsUnlock`) — a read saying `focused`
  there applies its window, as `unlocked` — unless the phone is focused there already, by
  a refocus or a tap made since: the guard stops a read undoing the student's unlock,
  never the student's own return to focus (B3a's guard as worded would have held a
  re-tapped phone unlocked against its own tap). The end of the session, or another
  session, always applies. **The check-in** every 30 s in the foreground only (iOS won't
  run the timer behind the app: best-effort, decision 4), for the session the phone is
  in; `gone` or a `404` re-reads the truth. No poll while armed or out of a session: how
  an armed phone learns of the Start is open decision 6. **One step, one change of
  state:** each step publishes at once, so enforcement never sees half of one — a tap's
  answer published as "no tap pending" before "in the session" would unshield, then
  shield. **One file** (B5 needs it), as GRDB's "Sharing a Database" says: a 5-second busy
  timeout, so a write waits out an extension's instead of failing `SQLITE_BUSY`;
  suspension — the app posts `Outbox.suspend()` as it enters the background and
  `resume()` as it leaves it (`BaliApp`'s scene phase), so no outbox takes a lock while
  the app is suspended (iOS kills a process that does, 0xdead10cc); a write refused then
  (`isSuspension`) is no failure to show, and the engine waits for the app to come back —
  an answer lost to it is not lost: the record goes again and is answered as a replay;
  persistent WAL, so a process that only reads (the shield extension) can open the file
  after the last writer closed it — tested on the connection's own flag, since GRDB
  closes a pool's readers last and would keep the files anyway; the open and the
  migration coordinated by `NSFileCoordinator` (Darwin), so two processes never migrate at
  once; and a file a newer build has migrated is refused (`TooNew`), never written through
  a schema this build does not know. An extension gets no notice before iOS suspends it,
  so B5's open the file, act and close it. **Rode along (#74's review):** a cancelled
  `run()` runs again (nothing reset `running`, so a torn-down task stranded the queue);
  a refused change is shown until the phone's next change, the student acting again (it
  was never cleared); `Sent` carries its 2xx answer's session and state — the record is
  gone once settled, and the reconcile applies them; two 401s at once, the drain's and a
  read's, share one refresh — reachable only now there are two senders; and a failed read
  of the outbox is shown anywhere the engine reads it, never skipped. **B4's contract**
  (the second-401 seam, made explicit): `refresh` is asked once per rejection, so a
  fresh token rejected too is not refreshed again until an answer that is not a 401, or
  `retryNow()` — refreshing at every 401 would have a school's phones hammer Cognito
  through an outage of the API's token check. From there recovery is B4's:
  `accessToken()` never gives a token it knows has expired, and every token B4 gets but
  through `refresh` is followed by `retryNow()`. **Tests** (Swift Testing, Linux and the iOS
  Simulator): the tap's outcomes, the phone's own changes at once, a later change standing
  over an older answer, the notes that re-read, the check-in's cadence (foreground only),
  its answers, a re-read with no answer, `GET /v1/me`'s states, an armed phone left
  waiting, #56's race and a read sent while a change awaited, the unlock guard (the window
  and the end apply; a refocus since stands); and two connections on one file (each sees
  the other's records, a write waits out the other's), persistent WAL, suspension (a write
  refused, a read allowed; the engine waits and sends again) and a newer schema refused;
  and the review's — a run again after a cancelled one, a refusal cleared by the next
  change, one refresh shared by two 401s, `retryNow` ending a rejection, an outbox the
  check-in cannot read shown. A waiting test fails in thirty seconds rather than hanging
  a CI job. Twenty-three
  mutations of the rules, B3b-1's with them, each turn a test red.
- **2026-09-24** — **B3b-1: the sync engine's drain — one client, retry-now, and the
  waits on sign-in; a record's answer is read only by its own kind's table.**
  `SyncEngine` (`ios/BaliOutbox/SyncEngine.swift`), an actor, is the one owner of the
  phone's server communication (ARCHITECTURE, iOS decision 4). **One client:** it holds
  the app's one `APIClient`, so one URLSession for the app's life (#71's review), and
  hands it out (`engine.client`) for the screens' own calls. **The drain** (`run()`)
  takes `nextDue(now:)`, sends the record (`OutboxRecord.send(through:)`), `settle`s the
  answer, and goes on — or waits for the next due record, or a ring: a change recorded
  (`record`, the only way the app queues one), a retry. Each pass answers every ring
  made before it. **No token** (`NoAnswer.noToken`): nothing was sent, so nothing is
  settled — no attempt counted, no backoff grown, the last real answer kept for the
  screen — and the drain waits on sign-in: a ring (B4's `retryNow` once a sign-in gives
  the provider a token) or, unrung, a minute. Never a sign-out, never a dropped record.
  **No answer** (`.unreachable`) is settled as B3a backs it off. **A 401** settles as
  `reauth` (kept, backed off), the state says sign-in, and the engine asks B4's seam —
  `refresh: () async -> Bool`, true once a fresh token is ready — then sends everything
  again at once. Once per rejection: a fresh token rejected too waits out the backoff (or
  B4's `retryNow`), so a server that rejects every token never makes the phone spin;
  refreshing again takes an answer that is not a 401 in between, while a refresh that
  gave no token is asked again at the next 401, a backoff later. `refresh` must return
  at once — false when only the student can give a token, whose sign-in then calls
  `retryNow` — since the drain waits on it (santa's review). A 401 heard while a refresh
  runs shares it: none can be yet, the drain being the only sender, and B3b-2's check-in
  will be a second. **Retry-now** (`Outbox.retryNow(now:)`, moved here from B3a): every
  queued record due now — the student's retry (rule 5), and the one after a reauth;
  stuck stays stuck, and the order holds. **What the screens see** (`updates()`: the
  state now, then at each change, newest only): the queue (a stuck record shown with its
  last answer), the link (`reached`, `unreachable`, `signIn`, `storageFailed`), when the
  server last answered, when the outbox sends next, and the last state change the server
  refused — a state change's table drops a refusal for good, so the engine keeps it to
  show (rule 5). A storage failure is shown and tried again within a minute — a failed
  read of the queue for the screens too, which keeps the one last read. **The rider
  (#73's review):** `settle` took an `APIResponse` of any answer type and cast it to the
  record's, so a mismatched pairing compiled and read as `retry`. Now it takes a `Sent`,
  which only `send(through:)` makes: that calls the record's own endpoint and reads the
  answer by its own kind's table, and `Sent`'s initializer is private to the file — a
  mismatch cannot happen. **Split from B3b** (over the ~400-line bound): the check-in,
  the reconcile and GRDB's multi-process setup are B3b-2. **Not decided — open decision
  11:** an emergency unlock made while the phone's own tap is unanswered has no session
  to name yet, and the unlock contract cannot say which history it belongs in when the
  tap's answer names none (armed, no longer current, refused); `record` needs a session,
  so nothing sends one until the owner decides (before B6). **Tests** (Swift Testing,
  Linux and the iOS Simulator): the drain against a hand-answered transport and a clock
  the test moves — sent at once with its id and device time, the backoff honoured to the
  second, the order, a ring made while a send is in flight, no token (nothing sent or
  counted; a sign-in's retry sends it at once), a 401 (one refresh per rejection, none
  while it lasts, again after another answer), a refresh that fails (asked again at the
  next 401), an outbox that cannot be read (shown, read again within a minute, the record
  sent once it can be), a stuck record's retry-now, and a drop shown.
- **2026-09-24** — **B3a: the phone's outbox store, and the retry bound.**
  **The bound (#59's and #70's reviews).** A record is **stuck** at once when
  refused — `retry_and_surface`, a tap's or an unlock's 4xx but 401, 408 and
  429 — or after **8** server answers that left it unsettled: every status
  but 401 (sign-in's; B4 refreshes), 408 and 429 (the network's, the load's),
  so a 5xx, a 3xx, and a 2xx this build cannot read (an outcome a newer server
  added, a body that does not decode). No answer never counts: offline is not
  the record's fault. Eight answers are three to six minutes of backoff — past
  a deploy's blip, well inside a class. **Stuck is never a deletion:** an
  unlock leaves only once recorded (ISSUES #2), a tap only on a 2xx
  (ARCHITECTURE), a state change is dropped only on its table's refusal, never
  at the bound (one the server never decided on is never dropped). It is
  retried forever at the capped backoff and shown — its last status, reason
  and message are kept for a screen (rule 5) — and stays stuck. **What
  changes: it holds nothing.** Not the records behind it — a kept record never
  blocks them (A3), or one client bug, or one outcome a newer server added,
  would wedge every later tap and unlock — and not the phone's reads: it stops
  counting in `ReconcileStamp.awaiting` (`Outbox.awaiting()`), so a check-in
  or `GET /v1/me` reconciles again, and an early end, a removal, an extension
  or a later session's truth reaches the phone. A tap stopped awaiting at its
  first answer already; for an unlock and a state change this is new.
  **Exactly how an unlock stops blocking reconciles:** stuck, it leaves
  `awaiting`, but an unrecorded unlock still guards its own session — while one
  is queued (`holdsUnlock(session:)`), no read may put that session's shields
  back on (a read there that says `focused` is not applied as focus; its end or
  window still is). The emergency unlock stands on the phone until the server
  has it, and blocks nothing else. The refocus returning from it waits unsent
  and does not await either: the server has seen neither. Why eight and not at
  once for a `retry` answer: a 5xx or an unreadable 2xx may be the whole server
  (a deploy, a captive portal), and stepping aside then reorders records when
  it comes back; eight keep a blip in order and still unwedge a failure of one
  record within minutes. The accepted cost: records stuck through a long
  outage retry in jittered order when it ends, so two taps, or a report and a
  tap, can land out of order — the refocus hold covers the pair whose order
  changes the truth, and an unlock always records. `ReconcileStamp.awaiting`'s
  comment says so, in the TypeScript and in BaliCore. **The store:**
  `ios/BaliOutbox`, a Swift package on BaliCore and GRDB 7.11.1 (pinned
  exactly; its manifest needs Xcode 16.3), student-only, linked by the app.
  The database is `outbox.sqlite` in the app group's container
  (`Outbox.appGroupURL`, `group.com.bali.shared`), a WAL `DatabasePool`,
  opened by the app alone so far; tests inject a temporary file. **Schema
  v1:** `outbox`, one row per record — `seq` (the order the phone acted),
  `eventId` (a UUIDv7 minted when it acted, rule 4), `kind` (tap, unlock,
  refocus, protection_off), its payload as columns (`tagId`, `sessionId`,
  `reason`; checks tie each to its kind), `recordedAt` (sent as `deviceTime`),
  `attempts`, `answers` (what the bound counts), `nextAttemptAt`, `stuck`,
  the last answer (`lastStatus`, `lastReason`, `lastMessage`) and `follows`;
  and `outboxState`, the rules' own: the session protection off was last
  reported for, and the latest unlock's id. Every attempt builds the same
  request from the stored columns. **The rules, applied (BaliCore's tables
  decide, never this store):** a disposition that ends a record deletes it,
  any other keeps it. **Supersession:** a tap or an unlock deletes every
  queued refocus, unsent; one in flight settles to nothing (`settle` answers
  nil), and its answer, older than the phone's truth, is not applied. Nothing
  supersedes an unlock, a tap or a protection-off report. **Protection off is
  reported once per revocation:** again after a tap (it returns the row to
  focused), after `protectionRestored()`, or in another session — an armed tap
  converted at Start is one; the flag survives a relaunch. **Order:** in the
  order the phone acted. A pending record holds every record behind it, its
  backoff included, so an unlock always goes ahead of a later refocus; a stuck
  one steps aside, retried on its own backoff among them. A refocus waits for
  the unlock it returns from — the latest, still queued, in its session — to
  be recorded, even stuck: an unlock landing after its refocus leaves the
  server at `unlocked`, the grid showing an unlock the student came back from
  and the next read unshielding them. It waits on its own unlock only, never
  an older stuck one: stuck while a newer unlock landed, that one is failing on
  its own and may never land, and waiting would hold the refocus forever, the
  server at `unlocked` while the student is back in focus. The cost if it does
  land later: the engine flips a live focused row on any new unlock, whatever
  its device time, so the row reads `unlocked` again until the next change —
  recording an unlock older than the row's last refocus without flipping it is
  a server question, left for the owner. **Backoff:** 2 s, 4 s, 8 s, 16 s, 32 s, then 60 s (the
  cap), each plus a uniform extra of up to as much again, so 600 phones never
  retry in unison; every send that leaves the record counts, no answer and a
  401 included, so an offline phone never spins; the random source is clamped
  (NaN reads as none), so the bounds hold whatever it returns. **Not here
  (B3b):** the loop that drains `nextDue`, the 30-second check-in, applying
  answers (reconcile; stamping reads with `awaiting()`; `holdsUnlock`'s
  guard), one shared `APIClient`, a retry-now for the student's retry and
  after a reauth, and GRDB's multi-process setup (a busy timeout, suspension
  in the background, iOS's 0xdead10cc) once an extension opens the database
  (B5). An unlock made while the phone's own tap is unanswered has no session
  to name yet: B6 decides what it is sent to. **Also:** ESLint ignores
  `**/.build/` — GRDB's checkout carries JavaScript, so `npm run lint` failed
  after any local `swift test`. CI's Linux Swift job installs
  `libsqlite3-dev` (three tries: a mirror mid-sync failed it once) and runs
  BaliOutbox's tests; the macOS job runs them on the iOS Simulator, on iOS's
  own SQLite. **Tests** (Swift Testing): every case in `contracts/outbox/` —
  the TypeScript's own answers, 25 results × 37 bodies per table — settles as
  its disposition and deletes exactly when that ends the record (an unlock
  only when recorded, a refusal stuck at once); each real fixture of the four
  endpoints, its answer kept; the backoff and the jitter's bounds; the bound
  per answer kind; the order; supersession; protection off; `awaiting` and
  `holdsUnlock`; migration from an empty file, and a reopened one; and a
  seeded random walk in which nothing deletes an unlock but a `recorded`.
  Twenty-one mutations of the rules each turn a test red.
- **2026-09-24** — **B2: the iOS app skeleton, generated by XcodeGen, and the
  macOS job that builds it; BaliCore follows no redirect.** **The project is
  generated, never committed.** `ios/project.yml` is the project: the app
  (`com.bali.Bali`) and its two extensions (`com.bali.Bali.BaliMonitor`, the
  DeviceActivity monitor; `com.bali.Bali.BaliShield`, the shield
  configuration), with `BaliCore` as a local package. `xcodegen generate`
  writes `Bali.xcodeproj`, which git ignores: a `.pbxproj` is machine-written,
  unreadable in review and a merge-conflict magnet, and a committed one drifts
  from the spec the moment someone edits it in Xcode. Each target's
  `Info.plist` and `.entitlements` are hand-written files the spec names (not
  XcodeGen's `info:`/`entitlements:`, which write them at generation), so what
  the Family Controls request is about reads in the repo; Xcode generates the
  bundle keys (`GENERATE_INFOPLIST_FILE`), as its own templates do, so each
  `Info.plist` holds only what no build setting says. **What they carry:**
  v2's identifiers (the owner's ruling) and v2's entitlements — Family
  Controls and the app group `group.com.bali.shared` on all three, and on the
  app NFC tag reading with v2's formats, NDEF and TAG (the app reads NDEF,
  B6) and v2's usage string, reworded for the block; team `H535678UF8` with
  automatic signing; iOS 17, BaliCore's floor; iPhone only and portrait, as
  v2 had them — each target sets `TARGETED_DEVICE_FAMILY` itself, since
  XcodeGen's iOS preset sets iPhone and iPad per target over anything the
  project sets. Swift 6 language mode, as BaliCore. The app's screen is a
  placeholder that shows `BaliCore.APIClient`, named by the package's own
  type, and the build; the extensions' principal classes (`SessionMonitor`,
  v2's name, and `ShieldConfigurationExtension`) are empty, each `// B5:`
  note saying what it will do. **The macOS job** ("iOS app + BaliCore tests
  (iOS Simulator)", workflow `iOS`, `.github/workflows/ios.yml`) generates the
  project with XcodeGen 2.46.0 (pinned, checksummed), builds the app for an
  iOS Simulator with `CODE_SIGNING_ALLOWED=NO`, and runs BaliCore's tests on
  it — Apple's Foundation rather than the Linux one, which parse ISO 8601
  differently.
  **Xcode 26.6 on `macos-26`:** swift-tools-version 6.0 needs Xcode 16 or
  later, and 26.6 is the newest release on GitHub's newest image, so CI builds
  against a current iOS SDK (26.5); it is selected by `DEVELOPER_DIR` (what
  `xcode-select -s` sets, without the sudo that would stop a self-hosted Mac
  for a password) and only on GitHub's image, where several Xcodes sit side by
  side; the simulator is the first iPhone of the selected Xcode's own iOS. So
  moving the job to the owner's Mac (decision 9, once the repo is private) is
  its one `runs-on` line. **The trigger:** every PR runs the workflow, and a
  small Linux job decides with `git diff --name-only` whether `ios/` or the
  workflow changed (a diff that fails fails the job, never reading as no
  change); the macOS job runs only then (decision 9), with no third-party
  action. Not a `paths` filter on the workflow: a workflow
  filtered out never reports, so a required check would wait forever, while a
  job skipped by its `if` reports success — so it can be made required, which
  is the owner's ruleset call. Not on pushes to `main`. **Redirects refused
  (#71's Claude Review, security).** `URLSessionTransport` followed redirects
  silently: a `301` or `302` resent a POST as a GET with no body, and every
  redirect carried the bearer token to whichever host its `Location` named — a
  Linux test over the local-socket harness proved both before the fix, the
  second server receiving `Authorization: Bearer …`. Now a task delegate
  declines every redirect, so the 3xx comes back as its status, which every
  outbox table reads as `retry`: the record kept, nothing deleted on a stranger's
  answer. The API never redirects, so a 3xx is something else answering in its
  place. FoundationNetworking consults only the session's delegate about a
  redirect, ignoring the one passed with `data(for:delegate:)`, so on Linux
  the default session carries the delegate too; Apple's URLSession honours the
  task's, which also covers a session passed in. The test (301, 302, 303, 307,
  308) runs on Linux in `ci.yml` and on the iOS Simulator in the macOS job.
  **Also:** #71's socket timeout test bounded its wait at ten seconds against
  the default session's fifteen, and on GitHub's macOS runner the iOS
  Simulator stalls for seven to thirteen seconds at a time — every test's
  time jumps by it, the timeout's own timer included — once past that bound.
  It now runs against a session of its own that would wait four minutes,
  bounded at two, so the request's own second must still end the wait long
  before the session would — putting #71's Linux bug back makes it wait the
  session out and fail.
- **2026-09-24** — **B1c: BaliCore's API client — a send's answer is a value
  the outbox tables take whole.** `APIClient` (`APIClient.swift`) has one
  method per student endpoint, typed request in, `APIResponse<Answer>` out,
  and no method throws. **The result shape:** `result` is B1b's `SendResult`
  (the status, or `.networkError` when no answer came), `answer` the body
  decoded as the endpoint's type the way the app decodes — only on a 2xx, nil
  when it does not decode — and `error` the body as `ApiErrorBody`, only on
  any other status, nil when it does not decode (a proxy's page). So the
  hand-off is `tapDisposition(response.result, response.answer)`, and a
  refusal is a value like any answer: nothing is lost in a `catch` on the way
  to the table. `noAnswer` says why there was none. The client sends each
  request once and judges nothing — no retry, refresh or deletion; the sync
  engine (B3) does, with the tables. Even a failure that cannot happen (a URL
  or body that does not build) sends nothing and keeps the record, never a
  request without its body, which a state change's table would drop as a
  400. **The token-provider contract:** `TokenProvider.accessToken() async ->
  String?`, asked before every request and never cached, so a refreshed token
  goes on the next one; B4 plugs Cognito in. Nil (or empty) is "none right
  now" — offline with an expired token, a refresh under way, not signed in:
  the client sends nothing and answers `.networkError` with `NoAnswer.noToken`.
  Every table reads that as `retry`, so the record is kept and nothing reads it
  as a sign-out (auth: "Only a real 'no' signs anyone out", "A saved emergency
  unlock outlives an expired token"). It is never sent without the token: the
  server would answer `401`, a "no" nobody said, and the caller's reauth path
  would act on it — for the same reason it is not reported as a 401 either.
  It has its own case, not `.unreachable`, so a screen can say which (rule 5).
  A real `401` comes back as a value (`reauth`), and the refresh is B4's.
  **Timeouts:** 15 s without a byte per request (`APIClient.requestTimeout`)
  and 30 s for a whole exchange (the default session's resource timeout) —
  inside the 30-second check-in, and a timeout is `.networkError`, `retry`,
  which is safe because every write is idempotent on its event id. The
  timeout is set on the request as a property: FoundationNetworking ignores
  one passed to `URLRequest`'s initializer and waits the session's instead —
  a real-socket test caught it. **The transport** is a protocol, `send(URLRequest)
  → (Data, HTTPURLResponse)`, throwing only when no HTTP answer came; the
  default is a URLSession that is ephemeral with no URL cache, so a read of
  the truth is never answered from a cache and nothing about a student is
  kept on disk. **On the wire:** the bearer token on every request; a JSON
  content type only with a body, because Fastify refuses one on an empty body
  — a `DELETE`'s — with a 400, which would make leaving a class fail; each
  path parameter and query value percent-encoded byte by byte but ASCII
  letters, digits, `-`, `_` and `~`, so a typed join code cannot reshape the
  URL (it goes as typed: the server reads case and whitespace as noise); a
  base URL may carry a path. **Tests:** every fixture is sent through the
  client over a transport double and must go out as it was sent — the
  endpoint's method, its path, its body as JSON, plus the bearer, the content
  type exactly when there is a body, and the timeout — and its answer, fed
  back, must come out as the status and body that land on its recorded
  `disposition`; a call must exist for every endpoint the fixtures hold. Beside
  them: no answer (five `URLError`s × the four outbox records), bodies that do
  not decode, a body read only as its status's, a 401 (sent once, the token
  asked once), no token (nothing sent), a fresh token per request, escaping,
  a base path; and two over a real local socket — a real answer through
  URLSession with the bearer on the wire, and a server that never answers,
  timed out at the request's own second. **Rode along (#70's review):**
  `stateChangeDisposition` is one entry point over `(any StateChangeAnswer)?`,
  a protocol refocus's and protection off's answers conform to, instead of an
  overload per answer type — a literal `nil` was ambiguous between the two,
  and now compiles; the TypeScript's is one function over the union too.
- **2026-09-24** — **B1b: the outbox tables in BaliCore, proven equal to the
  TypeScript's.** **The port** keeps the TS names — `unlockDisposition`,
  `tapDisposition`, `stateChangeDisposition`, `readMayReconcile` — and each
  rule's comment (`UnlockContract.swift`, `OutboxContract.swift`). A send's
  result is a `SendResult`, a status or `.networkError`. The body is the
  answer decoded as its endpoint's type, the way the app decodes it (a
  vocabulary value it does not know is `.unknown`): nil when there is none or
  it does not decode, which is no known outcome — `retry`, the record kept.
  The TS tables read the raw body, so on one the API never sends (a `session`
  that is not a session) the TS may delete where the port keeps: the port only
  ever errs toward keeping. Refocus and protection off each get an overload of
  `stateChangeDisposition` over one table keyed on `StateChangeOutcome`, read
  from the outcome's raw value, because the TS reads both endpoints through one
  table — a refocus answered `recorded` re-reads in both. Each TS
  `Record<Outcome, …>` table is an exhaustive switch over the known outcome,
  which keeps its guarantee: an outcome added to the enum does not compile
  until it is placed. **Parity is proven by generated cases, not
  hand-copied ones.** The fixtures carry each table's answer to the API's
  real answers (A5), and BaliCore's port must give each one (a disposition on
  an endpoint with no port fails, and every port must meet a fixture). What
  the server does not send today lives in `contracts/outbox/`, written by a
  golden test in `@bali/shared` (`src/outbox-cases.test.ts`) that computes
  every answer from the TS functions themselves: per table, for each body,
  the results each disposition answers — 25 results (no answer, the edges of
  each status class, the ones the tables name, the API's) × 37 bodies (none;
  every outcome any table knows, each unknown to some other table, and five
  none knows; each with a session, a null one, none) — and 81 pairs of stamps
  for `readMayReconcile`. In `@bali/shared` because the tables are pure
  functions there and need no API; beside the fixtures because BaliCore reads
  them in place, as it does the fixtures (SwiftPM bundles nothing from outside
  its package); generated because a copied expectation drifts silently, while
  these fail `npm test` on drift, `npm run fixtures` now runs every
  workspace's generator (`-ws --if-present`), and CI's regenerate-and-diff
  step covers all of `contracts/`. The TS test also requires the cases to
  reach every value of each disposition union (a typed `Record<…, true>`),
  and the Swift test requires each disposition enum to be exactly the values
  reached — so a Swift case the TS never gives (a discard, say) fails too. A
  change to a table turns the Swift job red until the port follows (checked
  by breaking each side). **Rode along (#69's review):** the inline unions
  BaliCore mirrors are `as const` lists in `api.ts`, their types derived from
  them (additive), read by the vocabulary test — `ProtectionOffResponse`'s
  too, so its Swift enum mirrors its own list rather than
  `STATE_CHANGE_OUTCOMES`, which a refocus-only outcome would have widened —
  and the fixture schemas and coverage test use them, so an outcome added to
  a list demands a fixture. And the round trip compared null fields on
  neither side, so an optional null in every fixture was checked by nothing:
  each null field is now sent a probe, `["probe"]`, in its place. A field
  BaliCore reads either refuses it — the decode fails — or, typed as any
  JSON, brings it back; one that does neither is a field it never reads, and
  fails. Decode-side, so it holds whatever coding keys a type declares.
- **2026-09-24** — **B1a: BaliCore, the iOS apps' Swift package — its wire
  types, checked against the contract fixtures.** `ios/BaliCore` is a SwiftPM
  package (Swift 6 language mode; iOS 17, macOS 14) that uses Foundation only,
  so its tests run on Linux: the apps' UIKit, SwiftUI and FamilyControls code
  never enters it. It holds every student endpoint's request and response and
  the vocabularies they use, mirroring `@bali/shared`; the teacher endpoints
  wait for the teacher app. **A value this build does not know never fails a
  decode.** `/v1` is additive-only and old apps call forever, so each closed
  vocabulary is a plain Swift enum of the known values, carried as
  `OrUnknown<Known>` — `.known(value)` or `.unknown(raw)`, encoding back what
  it read — rather than each enum growing its own `unknown` case: one generic
  implementation instead of a hand-written raw-value mapping per vocabulary,
  and a switch over `.known(.joined)`… is still checked exhaustive, so a case
  BaliCore adds reaches every switch. An error's `reason` BaliCore does not
  know reads as none (A5), so a client keys on the reasons it knows and falls
  back on the status. The contract tests decode in a strict mode instead — a
  decoder `userInfo` flag, internal to the package — where an unknown value
  throws, so a value the API starts sending turns them red until BaliCore has
  it; the app never decodes strictly. **Times:** the API writes
  `toISOString()`'s `2000-01-01T00:01:00.000Z`. `JSONDecoder`'s `.iso8601`
  refuses those milliseconds on iOS 17 (the newer Foundation on Linux takes
  them), so `BaliJSON`'s decoder tries ISO 8601 with fractional seconds, then
  without — which style accepts the other's form differs by platform, and
  trying both is right on each — and its encoder writes milliseconds, as JS
  does, so a request carries a time the way the fixtures show the API
  receiving one. **Ids stay strings,** as the TS types have them: Foundation's
  `UUID` encodes upper-case and mints v4, where the API's ids are lower-case
  v7s that the phone must mint itself (B3). **The contract test** reads
  `contracts/fixtures/` in place, found from the test file's `#filePath` —
  SwiftPM cannot bundle files from outside its package, and a copy could
  drift. Every `.json` under it is its own test case, found by walking the
  directory, never listed: its body decodes strictly as the type it names and
  encodes back to the same JSON, null fields aside — the round trip is what
  catches an optional field misnamed in Swift, which would otherwise decode
  as nil forever without an error — and its request body, decoded as the
  phone's request type, encodes back exactly as sent. A fixture of a type
  BaliCore does not map fails, and another test requires the fixtures' types
  and request endpoints to be exactly BaliCore's two maps, so a moved or
  empty directory cannot pass by checking nothing. The vocabularies are also
  read from the TypeScript itself (`packages/shared/src`, each `as const`
  list, and `DisplayState`) and must match BaliCore's value for value, in
  order: a value no fixture carries yet (`invalid_extension`, `rate_limited`)
  is caught too. **CI:** a `swift` job in `ci.yml`, "BaliCore Swift tests
  (Linux)", runs `swift test` in Swift's official `swift:6.4-noble` image
  with SwiftPM's `.build` cached, on every PR and every push to `main`. Not
  path-filtered: the contract spans `apps/api` (which writes the fixtures),
  `packages/shared`, `contracts/` and `ios/`, which is most PRs anyway, and a
  path-filtered check never reports on the PRs it skips, so it could never be
  made required without leaving those PRs waiting. Making it required is the
  owner's ruleset call. Not here, on purpose: the outbox tables and each
  fixture's `disposition` (B1b), and the API client (B1c).
- **2026-09-24** — **A9: the live grid tells the truth about unlocks and late
  records.** **The reason:** the chip shows an unlock's reason (A1) after its
  label — "Unlocked · bathroom", "Left · unlocked · nurse" — as the privacy
  contract promises. **An unlock recorded against protection off** (A2) left
  the chip unchanged, so it showed nowhere; it now rides on that chip as a
  detail — "Protection off · unlocked · nurse" — red, labelled protection off
  first, never the orange unlock chip and never green (rule 2 and the iOS
  rules). The unlock a chip carries is the student's latest since they last
  tapped in or refocused: a tap or a refocus clears it, protection off does
  not (an unlock before protection went off stays on its chip — the student
  has not been back in focus since). One definition, so the stream and the
  snapshot compute the same thing. **Late records survive the refresh —
  decided: the snapshot carries them, not the grid's merge.** A late unlock
  or protection off (`after_session_end`) leaves the ended row alone (A2c,
  unchanged: the engine is not touched), so the 15 s refresh read a plain
  ended row and the chip reverted to "Left". A merge that remembered what the
  stream painted would only know what this tab saw: a tab opened after the
  overlap window would show a different chip for the same student, and an
  unlock's reason older than that window would reach a fresh tab nowhere.
  So `GET /v1/sessions/{id}` gains two additive fields per student (a teacher
  shape; the fixtures cover student endpoints only): `unlock` (that latest
  unlock — `reason`, `recordedAs`, `occurredAt` — or null) and
  `protectionOffAfterEnd`, read with the row in one statement (a lateral
  subquery), so the row and its records are one instant. The grid reads the
  snapshot's unlock and the streamed event through one function, so the two
  cannot differ: noted `protection_off`, the chip reads protection off
  whatever the tab had (an out-of-order report, or a student it never had —
  which read "Unlocked"); noted as finding nothing live (`no_live_participation`,
  `after_session_end`), the chip is ended — which fixes the pre-existing case
  of a student the tab never saw leave, whose later unlock read a live
  "Unlocked" instead of "Left · unlocked". **Who the snapshot carries:** every
  student the session's feed can name — the class's active roster, plus
  anyone with a participation or an unlock in this session who has since left
  the class (one row each, on their live enrollment or else their last).
  Before, a removed student's chip lived only in the tab that saw the removal:
  the merge kept it, but nothing refreshed its name again (a rename after the
  removal stayed stale for the tab's life), and a tab opened later showed them
  not at all, or as a UUID prefix when an event surfaced them. Now every tab
  shows the same chip, and every chip's name comes back with every snapshot;
  an absent student the snapshot no longer carries (left the class with
  nothing on record here) is dropped rather than kept with a stale name. The
  exit demo checks both ends: removed Cal stays on the snapshot, ended, with
  his unlock, and Dana's protection off, reported after the bell, is still on
  it. **Names:** a rename (`display_name_changed`, no session, so
  no stream) reaches an open grid at its next 15 s snapshot, for every chip on
  it; the class page's roster list under the grid is read when the page loads,
  so a rename shows there on reload — noted, not changed. **Rode along, from
  #67's review:** `renameStudent` runs in `withDeadlockRetry` like every other
  engine mutation — no cycle is known (its caller's row, then their classes in
  id order; a join or a Start holds nothing when it takes its class lock), so
  it is defence in depth, and as no race can stage a deadlock nothing reaches,
  a test aborts the first attempt with an injected 40P01 to pin the retry; and one
  blank class for a stored name and the comparison (`tidyDisplayName` in
  `@bali/shared`: whitespace, the blank braille cell and the null notehead) —
  the route trimmed only `\s`, so `"⠀Bea"` was stored with its leading blank.
  Pinned by grid tests for each state and reason, the protection-off unlock,
  the no-live note, each late record across a refresh and the replayed
  overlap converging on the snapshot; API tests for the snapshot's records,
  its membership (removed, re-enrolled, left with nothing) and order, its
  scoping to one session and a removed student's rename; and the tidy — each
  red without its fix. Not done, on purpose: no index for the per-student
  reads — each walks one session's events, bounded by the lesson; Phase 4's
  load gate sizes it.
- **2026-09-24** — **A8: a student edits their own display name, `PATCH /v1/me`.**
  D1's Me screen shows the name under "Your teachers see this name." with an
  edit button, and owner decision 8 polices it: unique within each class,
  ignoring case. **Shape:** `PATCH /v1/me` with `{ displayName, eventId }`,
  answering `{ outcome: 'applied' | 'replay', user }` (`UpdateMeRequest`,
  `UpdateMeResponse`); `user` is the boot call's own (`MeUser`, now named),
  so one decode serves both. A PATCH of the boot call's resource rather than a
  new path: the name is a field of "me", and a later field would join it
  additively. **Recorded, and idempotent on `eventId`** (CLAUDE.md): the engine
  (`renameStudent`) writes `users.display_name` and a `display_name_changed`
  event (new in `EVENT_TYPES`; payload: the name and the one it replaced) in
  one transaction. The event is where the idempotency key lives — the events
  unique constraint, as for every other mutation; a column holding only the
  last id would apply the retry of an older rename over a newer one — and it
  keeps the name history, since the grid and every report print a student's
  current name beside records made under an older one. A replay (the id
  already recorded as this student's rename) applies nothing and answers the
  name now, not the retry's, and is checked before anything else, so it is
  never refused — not even when a classmate has since taken the name; an id
  another event holds is `409 event_id_conflict`. A refused rename records
  nothing, so its id stays free. The event names no session or class: no feed
  or stream carries it and the history (A7) does not show it. **The teacher's
  grid** reads names from the snapshot (`GET /v1/sessions/{id}`, a join on
  `users`), which the portal re-reads every 15 s, and the roster reads them the
  same way, so a rename reaches the grid within one refresh — a label, not a
  state, so the lag claims nothing false (tested through the snapshot and the
  roster). Not an outbox record: the Me screen sends it while open and shows a
  failure with a retry (rule 5). **Uniqueness:** names are compared as a reader
  sees them — without the characters that draw nothing (a joiner, a variation
  selector, a Hangul filler: a name may carry them, but adding one cannot make
  a classmate's name another — santa's review caught that the first key let
  `Bea\u200d Ortiz` past `Bea Ortiz`), in Unicode compatibility form (NFKC: a
  decomposed accent, a full-width letter), each run of blank space made one
  (whitespace and the blank-looking symbols), trimmed, and case-folded (upper
  then lower, so `ß` meets `SS`) — against every other
  student actively enrolled in any live class the caller is actively in, and a
  match is `409 display_name_taken`, never a silent rename. The student's own
  name in another case is theirs to take. **Serialised by locks, not a
  constraint:** names live on `users` and classes are many-to-many, so no
  unique index can say "within each class", and a constraint would refuse the
  joins decision 8 does not cover. `renameStudent` locks the caller's `users`
  row, then every live class they are in, in id order, both `FOR NO KEY
  UPDATE`: two classmates renaming at once meet on a class they share, and the
  second checks only once the first has committed; the caller's row first
  serialises a retry racing its original even when they are in no class, so
  it is answered as its replay. One order for the classes, so renames cannot
  deadlock one another; NO KEY UPDATE conflicts with a join's and a Start's
  `FOR UPDATE` on the class (both their first lock, so neither holds anything
  while it waits) but not with the key-share lock every event insert takes on
  its class and user, so a lesson's taps never wait on a rename. Real-Postgres
  tests: two classmates at once (without the class lock both win, round 0,
  three runs of three), the lock order held (a NOWAIT probe; a random order
  fails within three rounds), three classes shared in a ring (staged, no
  deadlock), a retry racing its original (without the row lock both answer
  `applied`), and a sign-in's fill racing a rename. **What it does not cover,
  decided conservatively:** a join is never refused over a name — decision 8
  is about editing, and a join refused over a classmate's choice would keep a
  student out of their class; a name filled from sign-in claims (2026-09-22)
  is not policed — the student did not choose it; a collision a later join or
  fill creates is left as it is — the teacher sees both names, and either
  student can rename; names that only look alike across scripts (a Cyrillic
  `а` for a Latin `a`) are different names — that takes a confusables table; a
  classmate who has left, or a class archived, no longer counts; the teacher's
  own name is not a classmate's. **Validation at the route:** the name is
  trimmed and each run of whitespace made one space — stored so, and the answer
  returns what was stored — then refused as `400 display_name_invalid` when it
  is blank or has nothing visible, is longer than `DISPLAY_NAME_MAX_LENGTH` (64
  code points: the token fill's clamp, now one constant in `@bali/shared` so the
  phone's field holds to it), or carries a control or format character (bar
  the joiners names need), a lone surrogate half or a line or paragraph
  separator — the token fill's own strip list (`display-name.ts`, shared by
  both), refused rather than stripped because a student typing a name must see
  what is stored; checked on the name as sent, so a tab or newline is refused,
  not made a space. A malformed body is `400 invalid_request`. The fill still
  only fills a NULL, so it never overwrites a name the student set (tested,
  and raced). **Who:** signed in, or `401`; a caller with no row yet gets one,
  as a join does; a teacher is `403` — decision 8 rules on students' names
  within classes, and a teacher's name (what students read on the consent
  screen) waits for a portal screen and a ruling of its own. **Rode along, from
  #66's review:** `JOIN_CODE_LENGTH` moved to `@bali/shared` (`@bali/db`
  re-exports it), a client-facing input limit like `HISTORY_PAGE_LIMIT`; and
  the history's `400` was two refusals told apart only by `details` — a
  malformed `limit` or `before` is now `invalid_request` (a client bug), a
  cursor the history does not hold `unknown_cursor` (reload from the top).
  `invalid_request` is the reason for a request that fails validation on an
  endpoint where a `400` can also mean something else — the history and
  `PATCH /v1/me`; elsewhere a malformed body still carries none, per A5.
- **2026-09-24** — **A7: the student's own history, `GET /v1/me/history`.**
  D1's History screen ("The same moments your teachers see — nothing more")
  shows days of class cards — the class, its teacher, and each moment with its
  time: tapped in, unlocked with a reason, back to focus, class ended, and a
  tap "not used — it already counted in Period 5". **What it shows** is what
  the consent screen says a teacher sees, from the caller's own events in
  every class they have been in, left ones too: `tap_in`, `refocus`, `unlock`
  (its `reason`), `protection_off`, `left_for_other_session`,
  `enrollment_left`, `enrollment_removed`, `armed_tap_skipped`, and the class
  ending while they were in it (`session_ended` / `session_expired`) —
  `HISTORY_EVENT_TYPES` in `@bali/shared`, additive-only, and a phone skips a
  value it does not know. **Not shown:** `went_silent` / `came_back` (the
  grid's liveness, not a moment the consent screen lists, and D1 draws none),
  `enrollment_joined`, the teacher's own session events, and an unlock kept
  with no class (`unknown_session` / `not_enrolled`: an orphan no teacher
  sees). Adding one later is additive. **Reads:** a declined tap names the
  class it already counted in (`countedIn`: the class of the student's own
  `tap_in` its payload names) and is never a join; a late unlock or
  protection off carries `recordedAs: after_session_end`, so it never reads as
  a change made in class. **The class ending** is the session's event, which
  carries no student id, so it is found through the student's participation
  the end itself closed: a student who switched away, left or was removed
  before the bell sees their own leave instead, never the end. It is stamped
  with that participation's `ended_at`, which the end writes with the
  session's. **Order**, the tiebreak the note on the index owed: `seq` inverts
  a switch (the `tap_in` is minted before the `left_for_other_session` it
  causes, so a skipped tap never ends a participation — for a converted tap
  and a direct switch alike) and `occurred_at` ties the pair, so the order is
  `occurred_at`, then a `left_for_other_session` before anything else at that
  instant, then `seq`. `seq` rather than a wider rank for every other tie,
  because it is the order things were recorded: an unlock in class sorts
  before the end it shares a clamped instant with, a late one after it.
  Newest first, and a phone shows a day oldest first by reversing the page,
  never re-sorting on `occurredAt`. **Paging:** at most `HISTORY_PAGE_LIMIT`
  (50) a page, `limit` asks for fewer; `nextBefore` is the last moment's event
  id, null at the end, passed back as `before`. A cursor that names a row, not
  an offset or a time, survives new moments: a newer one waits for a reload
  from the top, an older one (a late unlock is clamped into its class's
  window) is read in its place; and it carries no internal `seq`. A `before`
  the history does not hold — another student's event, one of the caller's
  it does not show — is `400`, and the phone reloads from the top. Keys are
  compared as microsecond UTC text from Postgres, because a JS `Date` keeps
  milliseconds and would tie two rows Postgres orders. **Who:** signed in, or
  `401`; only the caller's own rows, a classmate's never (the class's end is
  the one shared row, shown to each student who was in it); a teacher is
  `403` — a timeline is a student's, and an empty `200` would hide a portal
  bug. A read: no row yet is an empty history, and nothing is created. **Cost:**
  a page reads each source newest first through its own index and merges
  them, so it costs its own size however long the history grows.
  `events_user_seq_idx` (user_id, seq), built for this read and used by none,
  became `events_user_occurred_idx` (user_id, occurred_at) — the order's first
  key, so the sort takes only the tie — and `participations_student_ended_idx`
  (student_id, ended_at) serves the class-ended moments; a test EXPLAINs both
  reads with sequential scans priced out, on both lanes. **Rode along, from
  #65's review:** `JoinCode` had no maximum. It now refuses a code longer than
  `JOIN_CODE_LENGTH` once trimmed — every minted code is that long — as a
  `400` before any lookup, for the join and the preview; the minimum still
  runs on the code as sent, so a blank code stays the join's `404`. Codes
  longer than six used to be `404 class_not_found` and are now `400
  bad_input` — the size check API decision 4 asks of every endpoint before it
  touches the database, which the join had lacked since Phase 2, rather than
  a new behaviour. No phone sends one (the join screen takes six, and no
  student app has shipped), and a test seed was the only other source —
  seeds now mint six symbols of the real alphabet, stably per tag. And nothing held
  a stored code to upper case, which the routes need, since they upper-case
  what they are sent and match exactly: `generateJoinCode` is the only writer
  and its alphabet is upper-case, now pinned by a test on the whole alphabet
  and one that the route schema leaves every minted code as it is. A CHECK
  constraint would need a migration, and this step was scoped without one: a
  test is the cheap pin, and it fails before a lower-case symbol can ship.
- **2026-09-24** — **A6: the join-code preview, `GET /v1/join-codes/{code}`.**
  D1's consent screen names the class and its teacher ("with Ms. Rivera",
  "What Ms. Rivera sees") before the student commits, with "Not my class" as
  the way back, so before joining the phone needs what only the server knows.
  **Shape:** a `GET` on the code, a read like `/v1/me`, answering `{ class: {
  id, name }, teacher: { displayName }, alreadyEnrolled }`
  (`JoinCodePreviewResponse`). `class` is the join's own `MeClass`, so one
  decode serves both answers. `displayName` is null when the teacher's account
  carries none (a pool that signs in by email — 2026-09-22's display-name
  entry), and the screen then says "your teacher". The "sees / never sees"
  list is fixed product copy, the same for every class, so it is not served.
  **Who:** signed in, or `401`. A teacher gets the join's `403`, since a
  teacher cannot join. A caller with no row yet is answered as the student a
  join would make them, in no class: the preview looks the row up and never
  creates one, so it writes nothing at all — no user, no enrollment, no event,
  and no `event_id` to carry. **Already in the class** is `200` with
  `alreadyEnrolled: true`, previewing the join's `already_enrolled` no-op
  rather than refusing; a student who has left is not in it (a re-join adds a
  fresh enrollment). **One code, one answer.** The join did not normalise: it
  matched the code exactly as sent, so `kwx49q` was a `404` for class
  `KWX49Q`. One zod schema (`JoinCode`) now serves the join's body and the
  preview's path, trimming and upper-casing the code. Codes are minted
  upper-case from an alphabet with no look-alikes, so case and surrounding
  whitespace carry no meaning. The preview finds the class by the join's own
  condition (`liveClassWithCode`: that code, on a live class), so the two
  cannot name different classes. For the join this is a correction under API decision 2, and for
  every code the server mints only a widening: the length check still runs on
  the code as sent, so every input it refused, it refuses with the same
  status, and a code typed in lower case or with a stray space now joins. (A
  code stored in lower case could no longer be joined, and only a test seed
  was: the seeds now mint upper-case codes, like the real generator.) An
  unknown code, an archived class's code and a regenerated class's old code
  are the join's own `404 class_not_found` (A5's reason); an empty code is
  `400`. **Enumeration:** a preview reveals the class and its teacher's name —
  what a join to the same code returns, plus the name the screen shows. Unlike
  a join it leaves no enrollment on a roster, so guessing codes is quieter
  than joining. Today only the code space (31⁶ ≈ 887M) bounds it; per-account
  budgets are ISSUES #1, landing in Phase 4 with the rest of rate limiting, and
  none is built here. The code rides the path, so it lands in request logs
  like any URL — it is the code the classroom board shows, and a teacher
  regenerates one that leaks. **Rode along, from #64's review:** `npm run
  fixtures` removed the whole `contracts/fixtures/` directory while the drift
  check reconciles only `*.json`, so a README kept there for BaliCore's authors
  would have been deleted silently. It now clears only the `*.json`, pinned by
  a test. And `DELETE /v1/enrollments/{id}`'s two `403 forbidden` refusals
  (the caller has no account here yet; the enrollment is neither theirs nor in
  a class they teach) were told apart only by message. They now carry
  `unknown_user` and `enrollment_not_yours`, with `code`, status and message
  unchanged. `API_ERROR_REASONS` was one value per engine refusal; it is now
  also one per refusal a route makes itself where one status covers several
  on an endpoint, and a test names those so no reason sits in the vocabulary
  unused. The fixture `enrollments/403-forbidden` is now
  `403-enrollment-not-yours`, beside `403-unknown-user`.
- **2026-09-24** — **A5: the contract fixtures, and a machine-readable
  `reason` on errors.** **Errors get a reason.** C5 must tell `PROTECTION_OFF`
  ("tap the block to rejoin") from `NOT_PARTICIPATING` ("you're not in this
  session") and `SESSION_NOT_RUNNING`, and all three reach a phone as `409
  conflict`, told apart only by the human message — which is not a contract:
  a phone matching it breaks on the first rewording. So `ApiErrorBody.error`
  gains an optional `reason` from a closed vocabulary in `@bali/shared`
  (`API_ERROR_REASONS`), one value per engine refusal. Exhaustive: the route
  mapping is typed over every `TransitionErrorCode`, and a test walks the
  engine's `TRANSITION_ERROR_CODES` and must get back exactly the vocabulary —
  none missing, none shared. A sibling field rather than `details`, which is
  `unknown` and already carries validation issues (an array): a code there
  would give `details` a shape that depends on the status, to be sniffed
  rather than decoded, where a typed optional field decodes as an optional
  enum. Additive only: `code`, every status and every message are unchanged,
  and an error with no finer meaning than its status (a 401, a 403, a
  malformed body's 400, an unknown block's 404) carries none. A route that
  finds an engine-named condition itself answers with the engine's refusal
  (`refusal()`), so one condition never reaches a client in two shapes:
  `DELETE /v1/enrollments/{id}`'s own 404 and a session owner's 404 now carry
  `enrollment_not_found` and `session_not_found`. A client reads a reason it
  does not know as none — a newer server may send one — so BaliCore decodes it
  leniently. **The fixtures** live in a top-level `contracts/fixtures/`, not
  in `packages/shared`: they are the wire contract between the API and every
  client, owned by neither and not an npm workspace's files; BaliCore reads
  them by path from `ios/` (SwiftPM cannot bundle resources from outside its
  package anyway); and the drift check diffs one directory, prettier-ignored
  as generated. 42 of them — every student endpoint and outcome, A2c's and
  A4's null-session answers, every unlock `recordedAs`, each 409 kind — are
  captured by a golden-file test (`apps/api/test/contract-fixtures.test.ts`)
  that drives the real app on the API tests' harness. Each answer must be
  valid for its `@bali/shared` type — strict schemas the compiler holds to the
  type's exact keys, optional ones included, and to its values both ways — and
  be the outcome its scenario names, or nothing is written. Ids and times
  become stand-ins numbered by first appearance, still valid UUIDs and ISO
  times, so a client decodes them with its real types and a fixture changes
  only when the contract does (PGlite and real Postgres give the same bytes).
  Each file carries its request, status, type and the disposition the TS
  outbox table gives it, so B1's ports are checked against the same answers.
  A test rather than a script, so `npm test` catches drift locally and on
  both CI lanes; `npm run fixtures` rewrites them, and a CI step runs that and
  fails on any diff (mirroring `db:generate`), so the committed tree is
  exactly what the generator writes. A known cost: a dependency bump that
  rewords a validation message changes `taps/400-bad-input` — regenerate.
  **Also:** `unlockDisposition` read a `408` as `retry_and_surface`, where the
  tap and state-change tables (A3) read it as the transport's: a timeout is
  never a refusal, and the record was kept either way, so it is now `retry`
  there too — surfacing it called a timeout a bug. And #62's review: the two
  "recorded, but no longer current" replays named no participation for a tap
  but the ended row for a refocus (engine-only, never on the wire). The rule
  now: **an engine answer that names no session names no participation** —
  `participationId` is null wherever `session` is, A2c's late protection-off
  and its replay included. Null rather than the ended row's id, because
  `state` and `session` are null precisely since the student is no longer in
  that participation, and the id would be the one field still pointing at it.
  `tapIn`'s same-session disjunct is commented as the fast path it is.
- **2026-09-24** — **Owner rulings: no student allow-list, and D1 approved.**
  **No allow-list** (owner: "remove the allowed during class thing as an
  option. literally just dont give them an option and use apples default
  list"). The shield blocks every app a third-party app can block —
  ManagedSettings `shield.applicationCategories = .all()` and
  `shield.webDomainCategories = .all()` — and the student never picks apps: no
  `FamilyActivityPicker` step, in onboarding or anywhere else. iOS itself
  keeps calls, FaceTime, Messages and Emergency SOS working; a third party
  cannot block them. Why: the owner wants no option at all, and beyond the
  one-time Screen Time grant the picker was the only setup the shield asked of
  a student (v2's `docs/ZERO_SETUP_ANALYSIS.md` §4). v2 ran this shield on the
  owner's iPhone: it shipped `.all()` with an optional once-ever exception
  picker, which with nothing picked is exactly this (`v2-archive`:
  `docs/HANDOFF.md` session 8, `ios/Bali/Bali/Core/ScreenTime.swift`); its
  `docs/FULL_FOCUS_PLAN.md` §6 names the floor iOS keeps and the gap.
  **The gap:** an app a student medically needs — a glucose monitor, an
  assistive-communication app — is blocked too. At launch the exit is
  Emergency Unlock, always allowed and always recorded; any carve-out is a
  later product decision for the owner, not made here (parked in
  ARCHITECTURE's iOS "Decided later"). **D1 approved**
  ([Bali student app screens](https://claude.ai/artifact/DdfRPhHu4whXLxe58hBAie)).
  After the owner's feedback the canvas was regenerated with the Bali Design
  System: a light theme like the owner's teacher app; the ring mark drawn
  without its stone-50 tile (the owner overrode the design system's "the tile
  is part of the mark" rule for the student app); the allowed-apps screen
  removed (the Focus, shield and Me screens say every app is paused and that
  calls, FaceTime, Messages and Emergency SOS always work); and a Focus
  screen in three states — normal, final two minutes, offline — with an arc
  countdown and "Hold to unlock — your teacher will see it" always visible.
  The teacher sees an unlock live on the grid; there are no push
  notifications at launch. The owner: "yes good. go ahead" — A6, A7 and A8
  no longer wait on D1.
- **2026-09-24** — **A4: a retry recorded but no longer current is answered
  `200 replay` naming no session — a tap's and a refocus's.** A `/v1`
  correction under API decision 2, of answers that told a phone something
  false or kept a record it could never clear. **Taps.** #28 bounded the tap
  replay to what is still true (the participation live, its session running)
  and refused the rest with `409` — `EVENT_ID_CONFLICT` when the retry
  re-resolved to another running session, `NOT_PARTICIPATING` when it came back
  to its own with the student's row ended, `SESSION_NOT_RUNNING` when the
  session it resolved to ended in the gap — because `TapResponse` could not
  say "recorded, but no longer current" and the tap outbox had no table. A3
  gave it one, in which the session an answer names decides the window: a
  `replay` with no session is `reread` (delete, shield to nothing, re-read
  `GET /v1/me`), while those 409s were `retry_and_surface` — a record the
  server did keep, retried and shown forever. Each is now `200 { outcome:
  'replay', session: null, state: null }`, the answer the arm path already gave
  the same retry with nothing running, and rule 4's guarantee is unchanged:
  the replay names its session only while both still hold, read under the
  resolved session's lock. Decided with it, each conservatively: (1) **only
  under the teacher it was recorded with.** A retry of one physical tap always
  resolves to the tapped block's teacher, so a tap of this student's recorded
  under another teacher and no longer current is a spent id reused at another
  block (or a moved block, which nothing ships): it stays `409
  EVENT_ID_CONFLICT`, as the arm path's teacher scope (2026-09-22, item 5)
  already refuses it — a `200` would drop a physical tap at that block. While
  it is still current it is replayed naming its session, the split #28
  recorded; unchanged. The cost, the one the replay already carried while
  current: the server cannot tell a retry from a reuse, so a spent id reused
  for a new physical tap at the SAME teacher's block, once no longer current,
  is answered `replay` with no session — as `armTap` answers it — and that
  join is dropped, though not silently: the phone re-reads the truth, which
  shows it in no session. An honest client mints one id per physical tap.
  (2) **What still 409s:** an id held by a different
  event — another student's, another kind, this student's tap under another
  teacher — and a fresh tap that raced its session's end, whose retry resolves
  afresh. `NOT_PARTICIPATING` no longer reaches a tap: the `!isNew` branch
  after `insertEvent` that threw it is unreachable now (a session's `tap_in` is
  written only under its lock or by the Start that created it, so the lookup
  always sees it) and answers the same no-session replay, which is always safe
  because the phone re-reads the truth — a disclosed survivor. (3) **The
  retry of a still-armed tap answers `already_armed`** (#59's review). It
  answered `replay` with no session: deleting was right, since the waiting row
  stands, but `reread` re-reads `GET /v1/me`, which cannot say "armed", so the
  phone could not show "waiting for your teacher" for a tap that will join at
  Start. `already_armed` already means "a waiting tap of this student's for
  this teacher stands and covers this one" (`wait_for_start`), so this is a
  correction within the shipped vocabulary, not a new promise. Only a row a
  Start will still convert answers it — unconsumed, and not stale by
  `rowIsStale`, the test the standing-row branches use (unexpired, its id not
  on record, which the Start would skip); any other stays `replay`, since no
  Start will honour it. Every door gives it: the `exact` read and both 23505
  recoveries (`answerOwnArmedTap`). #62's review found the first version
  checked only consumed and expired; its sequential case — an armed id that
  later lands as a `tap_in` — was already answered `replay` by `armTap`'s
  `events` lookup, which runs first (pinned now by an engine and an API
  test), so `rowIsStale` guards only an id recorded between the two reads, a
  race nothing can stage. **Refocus.** A refocus
  replayed after its participation ended while the session runs (removed,
  left the class, switched away) answered that row's last state WITH the
  session — `apply_session`, shields back on for a session the student is no
  longer in (A2's entry). A3's superseded-refocus rule keeps an honest client
  from sending it after a switch, but not after a removal, nor one already in
  flight. It now answers `replay` with `session` and `state` null, which
  `stateChangeDisposition` already read as `reread` — A2c's shape
  (`RefocusResponse.state` and `session` nullable, on this answer only; no
  phone has shipped). A `200` rather than protection-off's `409`, because the
  refocus is on record: the true answer is "recorded, and you are no longer in
  it". Left as they are, on purpose: a refocus after the end stays `409
  session has ended` (A2), and protection-off's replay after its participation
  ended stays `409 not in this session` (A2) — both are already dropped and
  re-read, and neither can shield. Pinned by engine tests (each stale shape —
  left, removed, left the class, session over, resolved session ended in the
  gap — replays with no session, red without the change; the cross-teacher
  `409` goes red without the teacher check; the armed retry, and an expired
  one that stays `replay`; the refocus replay after a removal, leaving and a
  switch), API tests of the wire answers and their dispositions (a genuine
  conflict still `409`s on the join path; refocus replay, validation, auth),
  and a real-Postgres race of a retry against its session's end, the sweep and
  a removal: never a `409` or a `500`, and a session named only as read
  running. Also from #59's review: `outbox-contract.test.ts` could start two
  sessions of one teacher in the same millisecond, leaving which one a tap
  resolves to (the newest by `started_at`) to chance — each start is now a
  millisecond later than the last; and PLAN's B3 line now asks for a bound on
  `retry_and_surface` before the outbox is built.
- **2026-09-24** — **The no-attribution rule gets a CI check** (owner: "remove
  the generated by claude code thing. keep it out"). CLAUDE.md already banned
  Claude attribution, but the written rule did not hold: the GitHub MCP
  `create_pull_request` tool appends a "Generated by Claude Code" footer,
  linking the Claude Code session, to the descriptions it writes, and 33 PR
  descriptions carried it. Per the recurring-issue rule (a test, then a CI
  check, then a rule), `.github/workflows/attribution.yml` (job "No Claude
  attribution") now fails a PR whose description carries the footer in its
  markdown link form, a session link, Claude Code's product link, a
  `Co-Authored-By:` line naming Claude or a `Claude-Session:` line — or with
  any commit (base..head) carrying those lines or authored or committed by
  Claude (`Claude`, `claude[bot]`, `noreply@anthropic.com`), because a squash
  merge turns each commit author other than the merger into a co-author line
  on `main` — so a commit the `@claude` assistant (`claude.yml`) pushes to a
  PR turns it red until the branch is rewritten under the owner's identity.
  It matches attribution forms, never the word: descriptions here
  rightly say "Claude Review" and "Claude Opus", and prose may describe the
  footer. It re-runs on `edited`, so stripping the footer turns it green with
  no push; a self-test of the patterns (`attribution.test.sh`) runs first, so
  a pattern that stops matching fails the check instead of passing every PR.
  It blocks once the owner adds it to `protect-main`'s required checks. Not
  here: the footer the Claude Review workflow appends to its own comment
  lives in `claude-review.yml`, which a session cannot edit without tripping
  the action's tamper guard (GOTCHAS); the owner is handling that one.
- **2026-09-24** — **A3: the tap and state-change outbox tables.**
  `tapDisposition` and `stateChangeDisposition` (`@bali/shared`,
  `outbox-contract.ts`, beside the unlock's) are pure functions of the status —
  or `'network_error'` — and the body, like `unlockDisposition`, each over a
  table typed on its whole outcome union, so a new outcome does not compile
  until it is placed; an API test binds both to the server's real answers.
  Decided here: (1) **The session an answer names decides the window, not the
  outcome's name.** A recorded tap naming a session reconciles to it (shielded
  only while `state` is `focused` — a replay answers the current state); one
  naming none is `reread` — delete it, shield to nothing, re-read
  `GET /v1/me` — which is what A4's `200 replay` with no session will mean,
  with nothing to change here. `armed` / `already_armed` wait for Start and
  protection off's `recorded` re-reads, whatever session an answer carried.
  (2) **A refused tap is kept, retried and shown** (`retry_and_surface`: a
  `4xx` but `401`, `408`, `429`), the 409 that can never land included — an id
  held by a different event. Tap steps 9–10 settle "kept": only a 200 lets
  the phone delete a tap, and a 409 means the server never kept it or it is
  no longer current. Rule 5 settles "shown", replacing 2026-09-22's "retried
  but not surfaced", which was only for want of this table. Conservative:
  nothing the server may not hold is deleted, and an id that is spent or
  held can never land as a new join. The phone also re-reads the truth, since
  the answer carries no window and the tap's own shield must not outlive it;
  a kept record must not hold up the records behind it, or one client bug
  would wedge every later tap and unlock; and the student's way to retry is a
  new tap, under a new id. After A4 the 409s left are that conflict and a
  fresh tap that raced its session's end, whose retry resolves afresh, as a
  404 (a tag that is not a registered block) does once the block is
  registered. (3) **A refused refocus or protection-off report is dropped**,
  as A2's entry decided: delete it, never resend its id, re-read the truth
  and show the refusal. **408 and 429 are the transport's, never a refusal,**
  in both new tables, because a drop is irreversible and a change the server
  never decided on must not be lost. (4) **The reconcile rule is a helper,
  `readMayReconcile`.** The phone counts its state changes, bumping the count
  when one is made and when one is answered, and stamps each read — a
  check-in or `GET /v1/me` — with that count and how many still await an
  answer; the read applies only if none awaited when it was sent and the
  count has not moved. That covers #56's race — a check-in that read before a
  refocus committed and answered after it — and a read that is merely late.
  An unlock awaits until `recorded`, so no read puts shields back over an
  emergency unlock the server has not recorded. The superseded-refocus and
  protection-off re-report rules are stated on `stateChangeDisposition`:
  outbox mechanics no status-and-body table can express. Two findings went
  onto A4's line: the refocus replay A2's entry recorded is only partly
  covered by the superseded rule — a switch is a later tap, a removal or
  leaving the class is not — so the server fix stays A4's before a phone
  ships; and the retry of a still-armed tap answers `replay` with no session,
  the shape of a tap recorded in a session since over, so the phone deletes
  it rightly but cannot show "waiting for your teacher".
- **2026-09-24** — **A2c: a protection-off that first reaches the server after
  the bell is recorded with a note (owner decision 10).** The owner chose
  "record it with a note": saved like a late unlock, so the history says why
  the phone went quiet — before, it was refused and never recorded, and the
  grid showed that phone green until 90 s after its last contact, then silent.
  Today's `409 session has ended` becomes a `200` (`outcome: 'recorded'`,
  `recordedAs: 'after_session_end'`), a correction API decision 2 allows. The
  event carries `payload.recorded_as: 'after_session_end'` — the key and value
  a late unlock carries, from its own additive list
  (`PROTECTION_OFF_RECORDED_AS`) — and, like a late unlock, marks nothing: the
  ended row stays as the end left it. The answer carries **no session and no
  state** (both null only on this outcome and its replay; every answer that
  was already a `200` keeps its shape). That is what answers the A2 entry's
  reason for the `409` — after an EARLY end `endsAt` is still ahead, and a
  `200` must not hand a phone that already heard "gone" a window to shield to —
  by carrying no window rather than by refusing. Edge cases, each decided
  conservatively: the ruling covers a student who was in the session when it
  ended, and everything else keeps today's `409 session has ended`.
  (1) The bell and a teacher's early end are one case, as they are for a late
  unlock (this log's "after the bell" already meant both), and the missing
  window is what makes the early end safe. (2) A caller whose participation
  ended before the end (removed, left the class, switched away) or who has
  none (never tapped in, an outsider, the teacher) is still refused — "never
  refuse" is not "never check": nothing is written into a session the caller
  was not in at its end. (3) A report that landed while the session ran,
  retried after the end, is still refused: it is on record, the phone drops a
  refused change (A3), and the ruling is about a report FIRST reaching the
  server after the bell. The retry of one recorded after the end replays
  (`200`, still no session), told apart by the stored note. (4) An id already
  spent on another event is refused `EVENT_ID_CONFLICT` (a `409` as before,
  with a truer message), never swallowed as a replay. (5) Refocus is
  untouched: refused after the end, fresh or retried. The engine does it with
  one optional hook where `changeState` refused (`afterEnd`, passed only by
  protection off), inside the same session-locked transaction. The live grid
  shows the new event as "Left · protection off", and the note marks the chip
  ended even for a tab that never saw the end — a student the roster no
  longer carries would otherwise read a live "Protection off". Known
  limitation, shared with a late unlock and left to A9: the next 15 s snapshot
  refresh reads the ended row, which a late record leaves alone, so that chip
  reverts to "Left"; the event log keeps the record. Pinned by engine tests
  (the recorded path goes red without the hook, and removing the standing
  check, the note check, the missing session, the untouched row or the note
  each turns one red), API tests (a `200 recorded` and its replay, validation,
  and the `409`s that remain for an outsider, the teacher, a student who never
  tapped in and one removed before the end), a grid test, and a real-Postgres
  race of the report against `endSession` and against the expiry sweep: in
  either order exactly one `protection_off` is recorded — applied, or noted —
  never a refusal or a 500 (red without the hook).
- **2026-09-24** — **Owner rulings: decisions 7, 8 and 9, D1, and the iOS
  identifiers.** **7:** a tap made with no signal shields at once; if the phone
  never reaches the server, the shields come off on their own after 50 minutes
  (the owner's length; iOS can't schedule under 15 minutes). The real end time
  replaces the cap as soon as the phone reaches the server, and Emergency
  Unlock works throughout. **8:** an edited display name must be unique within
  each class — refuse a name a classmate in any shared class already uses,
  ignoring case. A8 implements it, after its screen design. **9:** the iOS
  build's CI runs on GitHub-hosted macOS runners, only on PRs that touch
  `ios/` — free while the repo is public. The owner plans to make the repo
  private once the build is done; revisit then: Actions minutes start counting
  (macOS at 10×), so the iOS job moves to the owner's Mac as a self-hosted
  runner (safe only once the repo is private — on a public repo a fork PR
  could run code on it), and on a personal account branch rulesets need
  GitHub Pro to keep being enforced on a private repo. **D1:** the owner
  approved the first pass of the student screens with changes; their comments
  are coming on the artifact, and A6, A7 and A8 wait for them. **iOS
  identifiers (B2):** v2's, as the Family Controls entitlement request used
  them — Apple team `H535678UF8`; student app `com.bali.Bali`; extensions
  `com.bali.Bali.BaliShield` (shield UI) and `com.bali.Bali.BaliMonitor`
  (DeviceActivity monitor); app group `group.com.bali.shared`. Also recorded,
  from #56's Claude Review (a WARN, not fixed there): the sweep's per-row
  deadlock retry runs inside a serial loop, so its worst case is candidates ×
  4 backoff sleeps; if the sweep grows, bound it (a shared retry budget per
  run, or batching) — noted on PLAN's Phase 4 load-gate row.
- **2026-09-23** — **A2b: no deadlock reaches a phone as a 500.** Unlock,
  refocus and protection-off lock the session and then the participation row;
  the silence sweep, a tap switching the student into another session, and an
  armed tap converting at another class's Start take the row first and then
  this session's key-share lock (their event's foreign key). Opposite orders,
  so Postgres aborted one side with 40P01: pre-existing for unlock, reachable
  through protection-off once A2 wired it. A state change or unlock that lost
  was answered with a 500, which the outbox retries, so nothing was lost, only
  late; a sweep that lost failed its minute's cron run, leaving the phones
  after it for the next minute. The switching side (`tapIn`,
  `startSession`) already retried; `changeState`, `unlock` and the sweep's
  per-phone transaction now run in `withDeadlockRetry` too, safe because each
  is one transaction, idempotent on its event id. Two real-Postgres race tests
  pin it — each state change against a sweep due to mark the phone silent
  (both settle, every `went_silent` keeps its `came_back`), and unlock or
  protection-off against a switching tap or an armed-tap conversion (both
  settle; protection-off may be refused only as `NOT_PARTICIPATING`, when the
  leave landed first). Both went red on the old code with a raw 40P01, and
  removing any one retry turns one red (`changeState`: both; the sweep: the
  sweep race; `unlock`: the switch race — against the sweep it lost none in
  these runs, the sweep's side lost instead). **Found while finishing it: a
  check-in closing a silence episode** takes the row first too (its guarded
  UPDATE, then the `came_back`'s key-share), and against a state change sent
  as the phone comes back it was nearly always the side Postgres aborted (15,
  20 and 16 of 20 for unlock, refocus and protection-off) — a 500 on the
  heartbeat. Its closing transaction retries as well (a re-run is safe: the
  guarded UPDATE closes the episode only if nothing closed it meanwhile), and a
  third race test pins it: red with a raw 40P01 without that retry.
- **2026-09-23** — **Review workflow: one fresh worker per PR; only proven
  problems block.** Santa loops were taking up to an hour on big PRs (#49 ran
  santa three times — six fix rounds — and merged `main` in three times), and
  review notes spawned follow-up PR chains (#36 → #37 → #38). Now `/plan`
  hands each step to a fresh worker sub-agent, one at a time, so no PR
  inherits another's context, and a worker never plans or starts workers of
  its own; a PR is one change under ~400 changed lines, tests excluded (that
  line would have split #29 at 641 and #49 at 780, and passed #28, #53 and
  #54), and a worker whose step runs over hands it back to the conductor to
  split. `/santa-loop`: docs-only changes skip it, except changes to the
  rules themselves; code gets up to 2 rounds and round 2 checks only the
  fixes and any dismissals; a finding blocks
  only if it fits the BLOCKER rules in `claude-review.yml` — the one
  definition all three reviewers use — and survives a check (a failing test
  for logic bugs); easy WARNs are fixed in the same PR without another round,
  never in a follow-up PR; an unsettled step is parked as a draft PR while
  the run goes on. The decision log itself moved here from PLAN.md, which
  every session reads in full.
- **2026-09-23** — **A2: protection off, end to end on the server.**
  `POST /v1/sessions/{id}/protection-off` wires the engine's existing
  `protectionOff` (strict like refocus: a live participation or `409`). Two
  rules make ARCHITECTURE's "never green, never an unlock" hold in code rather
  than only in the grid's colours: **refocus is refused out of protection off**
  (`PROTECTION_OFF` → `409`, "tap the block to rejoin"; the refusal rolls the
  event back, and a replay of a refocus recorded earlier still answers the
  current truth), because iOS dropped every shield and only a re-tap
  re-shields; and **an unlock never softens it** — still recorded, never
  refused, noted `recorded_as: 'protection_off'` (additive vocab), state left
  alone — because otherwise a student who switched Screen Time off could turn
  their red chip orange with one request. The live grid mirrors the second
  rule (rule 2). Nothing reached protection off before this (no route called
  `protectionOff`), so neither rule changed a shipped answer. Each is pinned by
  a test that goes red when it is removed, and by a real-Postgres race (either
  order ends in protection off). **A change retried after the bell stays a
  `409 session has ended`, on purpose** — pinned now, because round 1 of the
  review suggested replaying it and round 2 showed why not: after an EARLY end
  the session's `endsAt` is still ahead, so a replay would hand a phone that
  already heard "gone" a window to shield to (a refocus answer turns shields
  back on) — rule 4's forbidden 200. The 409 costs nothing: A3's state-change
  table drops a refused change and re-reads the truth. Recorded rather than
  changed, since it is a shipped answer: a refocus REPLAYED in a running
  session whose participation has since ended answers that row's last state
  (pre-existing); A3's "never send a superseded refocus" keeps honest clients
  off it, and bounding it like `tapIn` would be a `/v1` 200 → 409 for the
  owner; A4 settles it. The new protection-off endpoint does not inherit it: a
  report replayed after its participation ended while the session runs is a
  `409 not in this session` (the phone drops it and re-reads the truth),
  because a report is retried until answered and nothing shipped depends on
  the other answer. The live grid gives a protection-off student whose participation
  ends (bell, removal, switch) its own loud chip, "Left · protection off" —
  it read "Left · unlocked", which protection off never is — and an unlock
  never relabels a protection-off row, live or ended, as the engine never
  changes one. From the santa-loop review, which also moved the unlock
  contract's docs (ARCHITECTURE, ISSUES #2, `@bali/shared`) to say a live
  participation can be recorded without being flipped, and made the endpoint's
  authorization test able to fail (a live student an outsider or the teacher
  could otherwise mark). The client half belongs to A3's outbox contract: a
  refused refocus or protection-off is final for its id (a late retry of a
  refused refocus, after a re-tap and a fresh unlock, would otherwise turn an
  unlocked phone green), a refocus a later tap or unlock superseded is never
  sent, and protection off is reported once per revocation — and again after
  any tap or join made while it is still revoked, since each returns the row
  to focused (each report writes an event).
- **2026-09-23** — **Phase 3 started, API and contracts first** (step list
  under Phases). A1: the unlock takes an optional reason (`UNLOCK_REASONS` —
  bathroom, nurse, other — additive vocab), stored as `payload.reason` beside
  any `recorded_as` note, orphans included; an unlock without one writes
  exactly the payload it did before. The route parses it **leniently** — any
  JSON value that is not a known reason is recorded as no reason, never a 400
  (the only refusals left are Fastify's whole-body guards, the 1 MiB limit and
  prototype-poisoning keys, which predate this and no honest client trips) —
  because the unlock body's standing rule (2026-09-20) is that validation is
  never why an unlock goes unrecorded. The engine keeps only a known reason
  whatever its caller passes, since it is the one writer of `events`. The response's `reason` says what
  landed, so a phone can tell when its reason did not; a replay answers with
  the stored reason, not the retry's (rule 4). Pinned both ways: a strict
  parse, the reason not passed or not echoed, dropped from either payload, or
  a replay not reading its own event — each turns a test red. Two
  independent reviews passed it.
- **2026-09-23** — `docs/GOTCHAS.md` added to the read order: live
  environment/process traps only, one entry each, deleted when fixed. The
  routing rule (CLAUDE.md working rules): a critical or recurring finding
  becomes a regression test, a CI check, or a rule first — a GOTCHAS entry
  only when it is none of those.
- **2026-09-23** — Tooling adopted with review-set boundaries (#36 + follow-up):
  graphify is **optional local tooling** — vendored skill fires only on an
  explicit `/graphify`, never installs unattended, and its enforcement hooks
  live in untracked `.claude/settings.local.json`, never shared config;
  ARCHITECTURE.md and PLAN.md are always read from source, never answered
  from the graph. Ponytail (account-wide minimalism plugin) governs
  implementation, never the gates (CLAUDE.md working rule).
- **2026-09-22** — Display names come from the token's own claims — a real name
  first (`name`, `preferred_username`), then the pool's identifier
  (`cognito:username`, `username`) but only when it is readable — and are
  **filled, never synced**. The value is stripped of control and format
  characters (bar the ZWJ/ZWNJ joiners names need), line and paragraph
  separators, and lone surrogate halves (which Postgres would store as U+FFFD
  for good), trimmed, and clamped to 64 code points; a name with nothing
  visible left in it — only joiners, a Hangul filler, a blank braille cell, a
  musical null notehead — counts as no name. Invisible letters INSIDE a
  visible name are kept. All of this because `name` is an attribute the
  student can set on themselves and it lands in a teacher's grid. A
  machine-made identifier is
  **not** stored, since it would print worse than the grid's own
  eight-character fallback and the fill would make it permanent: a dashed UUID
  (what a pool signing in by email gives every user), or a federated username —
  one of Cognito's built-in provider names (`Google`, `Facebook`,
  `LoginWithAmazon`, `SignInWithApple`, any case), an underscore, and that
  provider's subject shape (ten or more digits for Google and Facebook, so
  `google_20290101` is a name). It is anchored on the provider because a rule that
  read any long tail with a digit as a subject would throw away
  `ana_rodriguez2029` and `p_kowalski1987`. A custom SAML/OIDC provider's names are the pool
  owner's choice, cannot be recognised by shape, and are stored as the pool
  spells them. Where the identifier IS readable the teacher sees it — an
  email, in a pool whose usernames are emails — which is accepted: it is the
  student's own teacher.
  Consequence to know: a fallback, once stored, is not replaced by a better name
  arriving later, because nothing records where the stored value came from. The
  designed remedy is "edit own name" (phase 3), not a Cognito-side change — a
  pre-token-generation Lambda emitting `name` would fill only rows still NULL,
  not ones that already hold a fallback. A new
  trust boundary comes with this and is worth stating rather than discovering:
  `name` and `preferred_username` are attributes a student can set on
  themselves, so a student now chooses the string their teacher reads in the
  grid and beside unlock records, and nothing stops them choosing a classmate's
  name. The field was always NULL before, so this is new surface, not a
  regression; "edit own name" should decide what, if anything, polices it.
- **2026-09-22** — **The owner ruled on the audit's held `/v1` questions: yes
  to all five** ([the ask](https://github.com/eshan06/bali/pull/29#issuecomment-5774512834)).
  One principle covers the `/v1` items, and it is written into ARCHITECTURE
  API decision 2 now: correcting a response that told a client something
  false is not a behaviour change, so it may change a status in place, `200`
  to `409` included, and each correction is listed here. Where each landed:
  - **Items 3 and 5, #29.** `POST /v1/taps` answers `409` for an `event_id`
    that is not this caller's tap — another student's or another event
    type's, and (item 5) one recorded as this student's `tap_in` under
    ANOTHER teacher. `armTap`'s `events` lookup reaches `classes.teacher_id`
    through a LEFT join on `class_id`, which is nullable: an orphan unlock
    records with no class, and an inner join reads its id as unused and arms
    it — "refuses an id recorded with no class at all" goes red under
    `innerJoin`, measured. The same-teacher residual stays as the armed-tap
    entry below writes it up: an id spent in an earlier session of the same
    teacher still answers `replay`, because that is also exactly what the
    honest retry of a lost 200 looks like. Tap step 9 now says what happens
    to an id on record for a different event.
    The TYPE axis — a phone's own `unlock` id sent again as a tap — is not
    literally one of the five items, so it is named here for the owner to
    see: on `main` the arm path accepted it (`200 armed`, then converted
    under a fresh id at Start) while the join path already refused it with
    `409`, under 2026-09-20's "an `event_id` identifies one event". #29
    applies that existing decision to the arm path.
  - **Item 4, #29.** ARCHITECTURE decision 5 carries its one exception: a
    waiting tap whose id is already this student's own `tap_in` was honoured
    elsewhere, so it is consumed without joining — and RECORDED, the honesty
    half of the same decision: an `armed_tap_skipped` event (additive vocab)
    in the session whose Start declined it, under a fresh id, payload
    `{ armed_tap_event_id }`, stamped with the Start's clock. The grid
    ignores it, pinned — it is history, not a join, and painting a chip from
    it would put a student in a session they are not in. Phase 4's reports
    must not count it as a join either. Pinned both ways: the skip's
    history row (session, class, payload, and the Start's stamp rather than
    a fast phone clock's claim that the clamp would keep) — including a skip
    declined by another teacher's Start, which leaves the student live where
    they are — and its absence on each shape of conversion: a plain join, a
    decision-4 switch, and a fresh-id conversion. Exactly once under two
    racing Starts, on the real-Postgres lane: with `FOR UPDATE` removed, five
    runs of five record two skips for one tap. The `409` is pinned on the
    wire as well as in the engine, and `tapIn` refuses the same reuse
    (asserted with the first session over).
  - **Item 2, #28** — rule 4 and tap steps 9–10 amended there: a retry is
    replayed while what it recorded is still true, and refused with `409`
    rather than a `200` naming a session that is over. One split is left and
    recorded in #28's entry: a spent id reused at ANOTHER teacher's block
    while the first participation is still live is replayed on the join path
    (the replay is keyed on student and type) and refused on the arm path
    (item 5's teacher scope). It needs id reuse across physical taps or a
    moved block; neither answer shields a student anywhere new.
  - **Item 1** — `POST /v1/blocks` hands a teacher their own block back
    instead of `409`; split out of #23 before it merged, landed as its own PR
    after #29. `createBlock` re-reads the tag's live holder after its
    `ON CONFLICT DO NOTHING`: the caller's own block comes back as
    `already_registered` (the retry of a lost response), another teacher's
    is still `tag_taken`. Pinned in the engine, on the wire, and on the
    real-Postgres lane for a request racing its own retry. One window is
    disclosed rather than looped over: a holder soft-removed between the
    insert and the re-read answers `tag_taken` for a tag that is briefly
    free — unreachable, since nothing outside tests writes
    `blocks.removed_at`, and settled with the block-removal endpoint.
  Not changed by the ruling, and still Phase 3: a tap `409` is kept and
  retried but not surfaced, because no tap-side outbox disposition exists
  yet. That is also where a "recorded, but no longer current" answer
  belongs.

- **2026-09-22** — Review follow-ups on the armed-tap work, from #23's and
  #26's own reviews. #23's found both halves of its fix incomplete,
  and one of them was a test that could pass with the bug present.
  The `ON CONFLICT` that #23 added names the waiting partial index, but
  `armed_taps` has a SECOND unique index — `event_id` — and it is reachable:
  the `exact` select at the top of `armTap` can miss a concurrent delivery of
  the same tap that has not committed yet, and by the time the insert runs
  that row can be committed AND consumed by a Start, so it sits outside the
  waiting index, the arbiter does not match, and the insert lands on
  `armed_taps_event_id_unique`. Measured: a raw 23505 from a statement built
  exactly like `armTap`'s — the same 500 on a pre-bell tap that #23 existed to
  remove, reached by the other index. The insert now runs in a SAVEPOINT
  (verified on both lanes: a caught 23505 inside `tx.transaction` leaves the
  outer transaction usable) and a 23505 is answered as what it is — another
  delivery of this tap won the id, so `replay`. Reasoned, not pinned: the
  recovery is only reachable through an interleaving nothing here stages.
  A shared `hasSqlState` walks the cause chain for both codes now, because
  drizzle wraps the driver error and a plain `err.code` check silently never
  matches — measured while getting this wrong once. That recovery is no longer
  unpinned either: a held transaction inserts the rival row and sits on it, so
  `armTap`'s `exact` select misses it and the insert parks on the event-id
  index; releasing the holder lets it resume into the conflict. Rethrowing
  instead of recovering, or dropping the savepoint, each turns it red.
  Both of `armTap`'s event-id lookups are scoped to the CALLER now, not just
  the id: the `armed_taps` one to the student and the teacher, the `events`
  one to the student and the event type — not the teacher, which is the
  asymmetry recorded below, left as it is pending the ruling rather than
  chosen. (**Ruled 2026-09-22: scoped to the teacher too** — see the entry
  above.) Answering `replay` for a stranger's id
  handed back their row and told this phone's outbox the tap was durably
  recorded, so it dropped a tap that was never armed and never converts —
  silently absent from the grid at Start. `insertEvent` refuses the same
  class of reuse for the same reason;
  arming holds the same line and raises `EVENT_ID_CONFLICT`. **Behaviour
  change on a path that previously answered `replay`**, but only for an id
  that is not the caller's, which no honest client sends. Open for Phase 3:
  unlike the unlock path there is no typed disposition telling a TAP outbox
  what a permanent 409 means, so a client that hits one retries forever
  without surfacing — the same contract gap already recorded above.
  Known and accepted at the time: a skipped spent tap was consumed with no
  event and no contribution to `armedConverted`, so nothing in the feed
  recorded that a waiting tap was dropped; naming it in the permanent log
  meant new event vocabulary, worth doing with the contract decision rather
  than ahead of it. **Done with the ruling:** the skip is recorded as
  `armed_tap_skipped` — see the entry above. It still adds nothing to
  `armedConverted`.
  The conversion-gap race test staged with a bare 12 ms sleep and asserted
  only the invariant — nothing checked that the interleaving happened. Worth
  being exact about what that is: on an idle box it does still catch the
  mutation (`FOR UPDATE` removed, test red in 425 ms, measured), so it was not
  unconditionally vacuous. What it lacked was anything KEEPING the window hit,
  so under load the refresh lands after the conversion has committed, the
  plain-insert path is taken, every consumed row still names its original id,
  and it degrades to a pass with nothing going red. It now fails loudly when
  nothing contended at all, which is how it degraded. Its reach is narrower
  than "by construction", and the test says so: the gate observes that a
  backend parked on a lock, not WHICH lock, and with `FOR UPDATE` removed the
  refresh can still block on the row lock the conversion takes writing
  `consumed_at`. Better, not proof. The order-dependent assertion is
  conditional now — whether the conversion or the refresh reaches the row
  first is itself a race and both orders are correct, so asserting one
  unconditionally would redden a sound engine on a slow runner.
  **Review round: one blocker, and it was an engine fix that never reached the
  client.** `armTap` throws `EVENT_ID_CONFLICT` as of this PR, but the
  `armTap` call in `POST /v1/taps` was not wrapped in `mapTransitionError` —
  unlike the `tapIn` call fifteen lines above it. A `TransitionError` carries
  no numeric `statusCode`, so it fell through every branch of the error
  handler to the catch-all and shipped as `500 internal` where `routes/errors`
  already defines a 409 for that code. That is rule 5 inverted: a 500 reads to
  any outbox as a transient server fault, so the phone retries the poisoned id
  forever and nothing ever surfaces, while the permanent 409 retries AND
  shows. (**Corrected later:** a tap 409 is retried but not shown —
  `retry_and_surface` is the unlock contract's, and the tap-side disposition
  is Phase 3.) Harmless on `main` (nothing in `armTap` threw a `TransitionError`
  before), which is why it slipped. An engine test cannot catch this — the
  throw is right and only the status is wrong — so the pin is an API test that
  asserts the 409 a phone actually sees.
  The race test's 12 ms sleep is gone too, for the reason the review gave: it
  is a guess about how long `startSession`'s preamble takes on the runner of
  the day, and guessing long means the conversion has already committed, so
  the gate fails a sound engine — a red real-Postgres lane with no bug under
  it. The refresh is aimed by watching `pg_stat_activity` for the conversion
  actually reaching `armed_taps` instead. Measured after the change: green 3
  runs out of 3 on sound code, red 2 out of 3 with `FOR UPDATE` removed. That
  second number is written down on purpose — the aim makes it tempting to call
  the gate a mutation kill, and it is not one; the third run parked on the row
  lock the conversion takes writing `consumed_at`, exactly the reach the test
  already admits to. The gate's job is that a run with no contention cannot
  read as a pass, and that it now reports under its own name rather than as a
  vitest timeout.
  Last, `armTap`'s exhausted-attempts throw keeps the driver's error as
  `cause`. A 23505 in that loop is read as `event_id` because it is the only
  unique index the arbiter does not cover; if a third is ever added, the owner
  lookup finds nothing, the attempts burn, and the constraint name that says
  what really happened would otherwise be discarded at the throw.
  **Second review round, and the useful find was the door this PR had just
  closed on one write while widening the other.** `armTap` puts
  `input.eventId` into `armed_taps` two ways — the insert, and the refresh
  that recycles a stale standing row — and both write a column carrying its
  own unique index after the same non-locking `exact` read. Only the insert
  got the savepoint. Meanwhile the stale check above widened the refresh from
  "expired rows only" to every standing row whose id is spent, so it is taken
  far more often than before: an uncommitted rival holding that id turns the
  refresh's 23505 into an aborted transaction and a 500 on a pre-bell tap,
  which is precisely what the insert's savepoint exists to prevent. Both
  writes are savepointed now and answer through one `ownerOfEventId` — replay
  when the id is the caller's, `EVENT_ID_CONFLICT` when it is a stranger's —
  so the two paths cannot drift again. Pinned on the real lane by a sibling of
  the insert test: without the savepoint it fails with `25P02 current
  transaction is aborted`; recovering replaced by a rethrow, with the raw
  23505.
  Also corrected: the comment above that recovery still said "Reasoned, not
  pinned … nothing goes red if it is removed", in the very commit that added
  the test which does. Left standing it is an invitation to delete the
  savepoint as dead weight.
  **Two of that round's findings are the owner's, not mine, and both are
  recorded rather than acted on.** (a) Skipping a spent waiting tap narrows
  ARCHITECTURE decision 5's unqualified "every waiting tap becomes a
  participation", and ARCHITECTURE.md is law — narrowing a decision is a
  conversation, not a doc edit I make on my own. (b) `POST /v1/taps` now
  answers 409 where it answered 200 for an id that is not the caller's, and
  the sibling `/v1` change (block re-registration) is already held for exactly
  that reason. My reading is that these are not the same case — the 200 being
  removed handed back a stranger's row and told this phone's outbox a tap was
  durably recorded when it was not, so no honest client loses anything — but
  that reading is the owner's to confirm, and it is a revert of one call site
  if they rule the other way. (c) **A recommendation, not a blocker**, added
  after the fact: `armTap`'s `events` lookup is not scoped to the teacher, so
  an id spent under one teacher answers `replay` on another's block and arms
  nothing — a rule 5 silent drop. Scoping it is one `leftJoin` and rides the
  same 200 → 409 decision as (b); it narrows the gap without closing it, and
  the residual is written up below. (a) and (b) are now **BLOCKERs on the
  PR**, so it waits on the ruling rather than merging ahead of it; (c) needs
  no separate ruling if (b) goes against the 409. **Ruled 2026-09-22: yes to
  all three** — ARCHITECTURE decision 5 and API decision 2 are amended, and
  (c) is done; see the entry above.
  **Third round found the half of the skip that needed no race at all.** The
  spent-id check went on the STANDING row but not on the incoming id, so the
  plain retry of a lost 200 — tap at 09:01, bell, outbox retries at 09:30 with
  nothing running — still armed a row the 10:00 Start was guaranteed to throw
  away, after telling the phone `armed`. `armTap` now reads `events` for the
  incoming id first and answers `replay` with no waiting row, because the tap
  genuinely landed; an id on record for a DIFFERENT student is the same
  `EVENT_ID_CONFLICT` the armed-tap lookup already raises. `armedTapId` is
  optional for that one answer — it is the only `replay` with no row behind
  it. The ARMED-TAP lookup is scoped to the teacher as well as the student
  now: a row of this student's for teacher X was being handed back as the
  answer to a tap on teacher Y's block, arming nothing for Y while telling the
  outbox it was recorded — the same failure the student scoping closed, one
  axis over. **The `events` lookup is not, and an earlier version of this
  entry claimed both were** — found by review: another claim that was true of
  the writing and not of the code. An id already
  recorded as this student's `tap_in` under teacher X answers `replay` on
  teacher Y's block too, so Y arms nothing and Y's Start converts nobody: the
  same shape, one table over. Pinned by a test at the time rather than only
  described; since the ruling that test asserts the `409` instead.
  That lookup is LOOSER than `insertEvent`'s own replay key (type + session +
  user), so the same reuse is already answered two ways on nothing the client
  controls — 409 when Y has a session running and the tap routes to `tapIn`,
  a silent 200 `replay` when Y has nothing running and it routes to `armTap`.
  The quiet answer is a rule 5 silent drop, so scoping this lookup to the
  teacher is the better behaviour — **recommended, and added to the owner's
  ask** rather than done here, since it is another shipped `/v1` 200 → 409,
  the category already with them, and a held PR is not the place to widen it.
  (**Done once the owner ruled** — see the entry at the top of this log.)
  Mechanically one `leftJoin`: `events` has no teacher column, but every
  `tap_in` carries `classId`, so `classes.teacherId` is one hop — left, not
  inner, because `class_id` is nullable and an inner join would drop those
  rows into "id unused".
  **Recorded follow-up, tied to an endpoint that does not exist yet:** the
  teacher scope on the `armed_taps` lookup also refuses a legitimate retry
  across a block REASSIGNMENT — same student, same id, same physical tap, but
  `resolveTapTarget` now resolves the tag to a different teacher, so the retry
  gets a permanent 409 nothing surfaces. Unreachable today (nothing outside
  tests writes `blocks.removed_at`), and deliberately not patched here: taking
  the row over for the new teacher collides with the
  `(student, teacher) WHERE consumed_at IS NULL` index as soon as the student
  has tapped the moved block for real, and `ownerOfEventId` reads that as a
  conflict — the same 409, in a case that IS reachable. The fix consumes the
  stale row and answers about the new one; it must land WITH the block-removal
  or reassignment endpoint, not before it. **Since the ruling, the `events`
  lookup carries the same cost**: scoped to the teacher, it answers the
  honest retry of a tap that DID land with `409` once the block has moved,
  where it answered `replay` before. That endpoint must settle both lookups
  — the consume-and-answer fix above does nothing for this one.
  **It closes the cross-teacher split and no more.** The SAME teacher, an id
  spent in an earlier session of theirs, still answers 200 through `armTap`
  and 409 through `tapIn`, because the teacher matches. That residual is not
  a tidiness point but the same rule 5 silent drop: a real second physical
  tap at that teacher's own block, with nothing running, dropped without a
  trace, and their next Start converting nobody. So the join narrows the gap;
  it does not close rule 5 on this path. Closing that needs a session scope,
  and `armTap` has none to scope to. Named here because the ruling should not be made on half
  the shape. Two earlier drafts of this entry got it wrong in the other
  direction: the first argued tightening would SPLIT `armTap` from `tapIn`,
  which had it backwards, and the second claimed it would unify them
  outright, which is true only of the axis the join covers.
  That obsoleted the staging of "a spent event id never wedges the next
  Start": it armed the spent id through `armTap`, which now refuses. The row
  is written directly instead, which is the honest framing anyway — the
  conversion's skip is defence in depth for rows that ALREADY exist, armed
  before this refusal shipped or by an older deploy against the same database.
  **And it obsoleted a second staging I did not think to check** — found by
  the PR's own review, after two independent reviewers had passed over it. "A
  fresh tap takes over a standing row whose id is already spent" staged that
  standing row the same way, so the guard answered `replay`, wrote no row, and
  the retap took the ordinary empty-slot path: every assertion passed with
  `rowIsStale`'s spent branch DELETED. Measured — under that mutation the whole
  PGlite suite stayed green, so the rule this branch exists for had no cover on
  the lane that always runs; only a REAL_PG-only race caught it, and that one
  exercises the other branch. Re-staged with a direct insert like its sibling,
  and it kills the mutation now. Third time in this audit a test would have
  passed with its own bug present, and the first that two reviewers and I all
  missed together.
  Also recorded rather than changed: the `tap_in` moved ahead of
  `endParticipationsElsewhere` (a skipped tap must never end a
  participation), so
  within one Start a converted tap's `tap_in` now carries a lower `seq` than
  the `left_for_other_session` it causes. Same `occurred_at`, different
  sessions' feeds, no consumer today reads them in one stream — noted in the
  code so the next report that orders cross-session history by `seq` knows.
  And the review's warning about the conversion-gap gate came true in the same
  round, which is the cleanest lesson here. Adding that `events` lookup to the
  front of `armTap` gave the refresh one more round-trip to make before its
  UPDATE, the conversion committed first, nothing blocked, and the gate failed
  a sound engine — the exact false red the reviewer named. A missed window is
  not a bug, so the round is RETRIED now (up to three, fresh cohort each
  time) and the gate reports rather than asserts; the invariant is asserted on
  every round regardless, so a real regression is caught by a round that ran.
  One more thing had to go with it, and only a full-suite loop found it: the
  aim helper THREW when it never saw the conversion, and it runs inside the
  racing call — so a missed aim rejected the refresh and the test went red
  with `expected 'rejected' to be 'fulfilled'`, naming nothing. About 1 run in
  8 under the full real-PG suite, invisible when the test ran alone. It
  returns now, and a missed aim is simply a round to retry.
  Measured after both: **green 10 runs out of 10** on the full real-Postgres
  suite, and with `FOR UPDATE` removed **red 6 out of 6** — every time through
  the invariant itself ("names event … which no tap_in recorded") rather than
  through a gate timing out, which is a far better failure to read. Three
  versions of one staging check: a bare sleep that passed for the wrong
  reason, a gate that failed for the wrong reason, and a retry that does
  neither.
  **Fourth round, PASS, and one finding worth having.** The new `events` guard
  matched on the caller but not the TYPE, which is half of `insertEvent`'s
  standard — the standard its own comment invokes. On the student alone, a
  phone reusing one of its OWN ids across actions (an `unlock` id sent again
  as a tap) reads as this tap's replay: no armed row, no `tap_in`, and an
  outbox told the tap is durably recorded, so it deletes it. The same silent
  lost tap the guard exists to stop, through the other door. Matched on type
  and caller now, pinned by "will not launder an unlock id into an arming
  replay".
  A later round found one more, and it is the subtle kind: the conversion-gap
  test's invariant asserted that every consumed armed tap names an event
  recorded as a `tap_in`, which this branch quietly stopped guaranteeing — a
  SKIPPED tap is consumed and mints nothing under its own id (its skip is
  recorded under a fresh one, since the ruling), so the event under that id is
  whatever recorded it first. No tap in that cohort carries a spent id today,
  so it still passed; it would simply have reddened one day for a reason that
  is not a bug, with a message naming the wrong one. It asserts that the event
  EXISTS now, which is the invariant the engine actually keeps, and the orphan
  it exists for is untouched — a refresh that slipped inside the conversion
  leaves an id in no event at all.
  **And the fallback door into the same failure**, found a round later: the
  insert loop's `standing` re-read answered `already_armed` about whatever
  waiting row it found, without the staleness test the standing-row branch had
  just been given. Reachable only against a row this build would not write — a
  rival delivery from an older deploy holding an uncommitted waiting row under
  a spent id, which `armTap`'s own read misses and the ON CONFLICT then loses
  the slot to — but the outcome is identical: the fresh physical tap dropped,
  the row skipped at Start, joined never. Both doors apply one `rowIsStale`
  and one `takeOverStaleRow` now, which also removes the duplication that let
  them drift; staged on the real lane with the held-transaction technique the
  sibling races use, red 3 of 3 against the old behaviour.
  Two more recorded rather than argued with: `armTap`'s JSDoc had been
  orphaned by a helper inserted between it and the function (moved back), and
  the `seq` note now names the read that will actually see the reordering —
  `events_user_seq_idx` on `(user_id, seq)` exists for the student's own
  timeline, which is cross-session and seq-ordered by construction, so it
  would show them joining period 2 before leaving period 1. **Corrected later:**
  this said to order that one by `occurred_at`, which does not order it — the
  engine stamps one value on the pair, so they tie, and the obvious tiebreak
  for a tie is `seq`, which is the inversion again. Neither column works
  alone; the read needs an explicit deterministic tiebreak (leaves before
  joins at equal `occurred_at`), decided when it is built. **And the shape is
  pinned now rather than only written down** — review's point was that four
  notes described an ordering no test held, so it could drift back before the
  read exists and leave every note describing the wrong shape. A test asserts
  both halves: the converted `tap_in` carries a lower `seq` than the leave it
  causes, and the pair shares one `occurred_at`. Restoring the old order
  reddens the first (`expected 5 to be less than 4`), stamping the leave
  separately reddens the second. Carried into the
  go-live row for student history as well, so the warning reaches the phase
  that builds it and not only the reader of the schema.
  `TapResponse.session`'s doc said it is null only for an armed tap, which
  this branch makes false on the common path: every lost-200 retry after a
  session ends now answers `replay` with no session. Corrected, and pointed at
  the contract question, since "recorded, but no longer current" is what would
  actually give that phone something to reconcile against.
  Caught on the way: CI's `format:check` failed a push that `typecheck` and
  `lint` both passed — a double-quoted test name. `format:check` belongs in
  the pre-push routine next to the other two.
  **Fifth round.** The `events_user_seq_idx` warning now sits on the index
  whose own comment promised "in stream order", not only at the call site that
  broke that promise — the trap was set where the next reader would look.
  `conversionGapRound` settled both sides of its race and rethrew only the
  refresh's rejection, so a Start that threw surfaced as
  `expected 0 to be greater than 0`, which names nothing; both are named now.
  And the refresh's give-up throw is labelled a DISCLOSED SURVIVOR, the
  convention #28 established: nothing goes red if it is deleted, staging it
  needs a rival to commit and then be deleted before the owner lookup reads it
  three times running, and a test that pretended to cover that would be worse
  than the sentence saying it does not. The 500 it produces is also the right
  answer, and the comment now says why: what was lost is a race against a
  rival that keeps appearing and vanishing, which is transient by
  construction, so "retry" is exactly what the outbox should do.

- **2026-09-22** — Two engine idempotency holes, both from the same habit of
  deciding something outside the transaction that only holds inside it.
  **Ruled in by the owner (2026-09-22)** and landed after #29; ARCHITECTURE
  rule 4 and tap steps 9–10 now say what the bounded replay answers. Merging
  #29 left one split between the two tap paths: a spent id reused at another
  teacher's block while the first participation is still live is replayed by
  `tapIn` (keyed on student and type, naming the first session) and refused
  by `armTap` (teacher-scoped). Once the first session is over both refuse,
  and "refuses an id spent under another teacher, as tapIn does" pins that.
  A retried tap was answered with `EVENT_ID_CONFLICT` whenever the server
  re-resolved it elsewhere. The phone mints one id per physical tap and retries
  until answered, but `resolveTapTarget` picks the newest running session **of
  the tapped block's teacher** that the student is enrolled in — so a retry
  after that teacher started a second session the student is also in resolved
  somewhere new, `insertEvent` saw the id against a different session, and
  refused. Backwards: the tap landed, so rule 4 says re-read and return what
  was recorded. `tapIn` now does. The conflict check is untouched for an id
  reused for a genuinely different event, which is what the unlock path
  depends on (ISSUES #2) and which keeps its own test — but on the tap path
  something IS given up, because the server cannot tell a retry from a
  deliberate reuse: an app resending a spent id for a second physical tap into
  another session is now answered as a replay and that join is suppressed. No
  privilege comes with it (the same student can simply not tap, and the grid
  shows them absent either way).
  The replay is **bounded to what is still true** — the recorded participation
  is still live, in a session still running — and that bound is the whole
  safety of it, because `TapResponse` cannot say "that one is over" or "you
  have left it", so a stale answer here is a shield rather than a small
  inaccuracy. Replaying an **ended** session points the phone at a window that
  has not closed (a teacher who ends early leaves the original `endsAt`
  behind): a foregrounded app heals inside one ~30s check-in, but enforcement
  deliberately does not need the network, so a backgrounded phone stays locked
  to a bell that already rang, in a grid no teacher is watching and no unlock
  can reach.
  Replaying a participation the student **left** — they tapped into the
  teacher's other session for real — would point the phone at the session it
  left while the grid shows them in the one they are in; its next check-in
  there answers `gone` and unshields. Both are worse than the 409 they
  replaced, and both now decline. A retry that resolves back to the session
  that recorded it, with the student's row since ended, declines through the
  `!isNew` path below the branch as `NOT_PARTICIPATING` — not a conflict, the
  id names this very tap; what stopped being true is the participation.
  The lookup itself sits **ahead** of the ended-session guard, the placement
  `extendSession` uses: `resolveTapTarget` filters on `ended_at IS NULL`
  outside the transaction, so the session it picks can end before the engine's
  locked read, and a tap that did land must still replay against the running
  session that recorded it rather than 409.
  The branch's read of the OTHER session stays unlocked, and that is measured
  rather than assumed: with `for update` on it, two taps crossing in opposite
  directions order locks B-then-A against A-then-B and deadlock for real
  (40P01 at Postgres's one-second `deadlock_timeout`), which
  `withDeadlockRetry` would paper over rather than fix. The residual window —
  the recorded session, or the student's row in it, ending just after both
  reads — is narrow and heals on the next check-in.
  `extendSession` now takes minutes instead of an absolute end. The route read
  the session, did the arithmetic and handed over a fixed time, so two
  simultaneous "add time" presses computed the same target from the same
  starting point: the loser's value was no longer later than the winner's, the
  engine refused it as `INVALID_EXTENSION`, and the teacher's second press
  bought no time — a 400 saying the new end was not later than the current one,
  true of the value the route computed and useless to a teacher who had just
  pressed "add 10 minutes".
  The arithmetic moved inside the locked read, so each press adds to whatever
  it finds. Nothing calls the endpoint yet (no
  extend control in the portal), so this was caught before it could bite. `INVALID_EXTENSION` is kept and still
  refuses a non-positive, non-finite, or out-of-Date-range duration — the
  engine does not trust its caller. 1e15 minutes used to overflow into an
  Invalid Date and a bare `RangeError`; the route's zod cap
  (`int().positive().max(480)`) means no `/v1` caller could reach it, so this
  is defence-in-depth for a direct engine caller rather than a live 500. Its
  client-facing message no longer claims the end time was not moved forward,
  which the duration rewrite made false. The real-Postgres lane now covers two
  concurrent extends both landing.
  **Review round, and the sharpest finding was a guard that guarded nothing
  useful.** Refusing only what overflows the `Date` range is a bound at the
  year 275760: `1e6` minutes is finite, positive, and ends the lesson in 2028,
  and only the route's zod cap kept `/v1` honest. If the engine is going to
  distrust its caller — and it should, since `/v1` is not the only possible
  one — the bound has to mean something. `MAX_SESSION_MINUTES` is in
  `packages/shared` now and both the route's cap and the engine's refusal are
  that same number. The range check stays: `base` comes from the stored
  session, so a row already near the `Date` boundary can still overflow on an
  ordinary extension.
  **And the half this PR CHANGES for `/v1` had no wire test** — only an engine
  assertion that `NOT_PARTICIPATING` is thrown. What a phone branches on is
  the status and body `routes/errors.ts` maps that to, and the response the
  whole hold turns on was unpinned; the same shape of gap that let `armTap`'s
  refusals ship as 500s in #29. There is a 409 case next to the 200 one now,
  asserting the body as well as the status.
  Both blockers are the ones already with the owner: landing order behind #29
  (which this PR's own bullet now states), and ARCHITECTURE rule 4 / tap step
  10 promising the unconditional 200 that this changes.
  **Next round found a race test that went red for the wrong reason**, which
  is the third time this audit has turned one of those up. "Two taps crossing
  in opposite directions never deadlock" asserts on a rejected promise's
  `cause.code` — but `tapIn` wraps its whole transaction in
  `withDeadlockRetry`, so a reintroduced deadlock is caught, retried, and
  usually wins the retry; no rejection ever reaches that check. Measured with
  `for update` added back to the cross-session read: **7 deadlocks in 8
  rounds, every one swallowed**, and the test died on the vitest budget with
  "Test timed out", naming nothing. It asserts on Postgres's own
  `pg_stat_database.deadlocks` now — which counts a deadlock whether or not the
  error escaped — and `makeTestDb` gives each suite a freshly created
  throwaway database, so the counter starts at 0 and nothing else can
  contribute. Red 3 of 3, naming the cause. The per-result check stays as the
  faster signal for a deadlock that does escape.
  **And adding that bound made another guard unreachable by its own test** —
  caught by the next round, and it is the same shape as everything else this
  audit has turned up. `1e15` minutes used to reach the `Date`-range check;
  the new `MAX_SESSION_MINUTES` rejects it two lines earlier, so the check had
  no coverage while its comment read as though it did. It still has a
  reachable case, which is the one it was always for: `base` is
  `max(at, endsAt)` and `endsAt` comes from the STORED session, so a row near
  the JS `Date` boundary overflows on a legal ten-minute press. Pinned on both
  lanes now; deleting the guard produces exactly the bare `RangeError` the
  comment warns about.
  Worth recording because it cost a probe to find: that stored end has to be
  written through raw SQL. A JS `Date` past year 9999 serialises as
  `+275760-09-12T23:59:00.000Z` and Postgres rejects the `+`-prefixed extended
  year (22009, DateTimeParseError) — so the driver can READ such an instant
  back as a valid `Date` but cannot write one.
  **A later round asked for a number instead of an adjective, and was right
  to.** The file header budgeted `tapIn`'s `events`-by-event_id read as "a few
  hundred extra indexed reads spread over a minute" — a total, when the read
  sits inside the session's `FOR UPDATE` window and taps into one session
  serialise behind it. What matters is what it adds to the HELD LOCK per tap,
  because that is what a queue at a bell waits on. Measured on the real lane,
  29 sequential taps into one session: ~5.0 ms per tap with the read, ~4.8 ms
  without — about 0.2 ms, roughly 4% of the window. Fine at a school's scale,
  and now a measurement rather than a guess.
  The `NOT_PARTICIPATING` message also claimed more than its branch knows: it
  read "the participation has ended", which is also the message when
  `loadParticipation` finds no row at all. Nothing deletes a participation
  (decision 3) so that is unreachable today, but it would have misdirected
  whoever first hit it. It says "you are no longer in this session" now, which
  is true of both.
  **And the deadlock-counter test I had just added was resting on a false
  claim about its own fixture.** Its comment said `makeTestDb` gives the suite
  a fresh database so "nothing else can contribute to" the counter. Not true:
  `makeTestDb` is called once in a file-scope `beforeAll` and the database is
  shared by all three describes in `races.test.ts` — including "a removal
  racing a cross-class switch-tap", which provokes 40P01 deliberately and says
  so in its own comment. The before/after delta covers most of that but not
  all: `pg_stat_clear_snapshot()` drops only the READING backend's cached
  snapshot, and other backends flush pending stats on their own schedule, so a
  deadlock from the earlier test arriving mid-window lands in the delta and
  reddens CI over correct code. The crossing-taps test runs on a database of
  its own now, which makes the claim true and lets the assertion be absolute
  rather than a delta; green 3 of 3 on sound code, red 3 of 3 with the lock
  reintroduced.
  **Two more from the next round, and one of them was another overclaim of
  mine.** The comment on `tapIn`'s replay reads said the session-before-
  participation order was "staged and confirmed". It is not: swapping the two
  reads leaves both lanes green, 122/122 on real Postgres, checked. It is a
  DISCLOSED SURVIVOR now, with the reason it cannot be staged — pausing
  between the two reads would need a seam, and neither read takes a lock
  another connection could hold, so nothing can be timed to land between them.
  The order costs nothing and is kept for the reasoning; the residual window
  after both reads is reachable by no test here, only by the next check-in.
  The other was a real coverage gap in something deliberate: the replay keys
  on `(event_id, type, user_id)` and not on the session, so a phone reusing
  its own spent id while the student physically taps ANOTHER teacher's block
  is answered `200 replay` naming the first teacher's session — that join
  suppressed, teacher B's grid empty while the student stands in the room.
  Documented in two places and pinned in none. It has a test now, because it
  is one of the things the owner is ruling on and a decision nothing tests is
  a decision that can change by accident; if the ruling adds a "recorded, but
  no longer current" answer, that test is the one that should change.
  **The mapped `INVALID_EXTENSION` message had no test that reached it**, and
  it took three rounds to see why. Every route that can raise it caps
  `durationMinutes` with zod first, so a wire test sending `0` is rejected
  before the mapper runs and asserts against zod's message instead — each
  round I made the test's NAME more honest about that without ever making it
  reach the thing it was supposed to cover. The answer was to stop going
  through the wire: `apps/api/test/transition-errors.test.ts` exercises
  `mapTransitionError` directly, over a `Record<TransitionErrorCode, …>` so a
  new engine code without an expectation fails typecheck rather than slipping
  through. Reverting the message, or mapping it to `conflict`, each turns it
  red; the wire test stays green for both, which is the point.
  **And the bound is only half-enforced, which the comment did not say.**
  `extendSession` refuses a duration above `MAX_SESSION_MINUTES` in the
  engine; `startSession` takes absolute `startedAt`/`endsAt` and applies no
  bound at all, so the route's zod cap is the only thing holding for starts. A
  non-`/v1` caller could open a session ending in 2028 while the same caller's
  481-minute extend is refused — which is exactly the reasoning the extend
  bound was added on ("`/v1` is not the only possible caller"), applied
  inconsistently. Nothing unbounded reaches `startSession` today (the route is
  its only caller), and closing it needs a refusal code that function does not
  have, so **the comment is corrected now and the symmetry is a follow-up**
  rather than another widening of a PR already held. Worth doing with the
  ruling, since it is the same "the engine distrusts its caller" question.
  Also from that round: `MAX_SESSION_MINUTES` said "the longest a session may
  run or be extended by" when it bounds ONE operation — N presses still move a
  session arbitrarily far, which is the intended design, and that comment is
  what an iOS client mirrors. And the silent suppression of a genuine second
  tap is recorded with the ruling (the "Item 2, #28" line and the split in
  the entry at the top of this log), because the same missing field answers
  both.

- **2026-09-22** — #31's review landed after it merged, and the best finding
  in it was that the staleness banner **could not fire in production**, for
  the exact scenario it was built for.
  One clock was the bug. `lastActivity` was stamped by events, by heartbeats,
  AND by the 15 s snapshot refresh — against a 60 s threshold. So a wedged
  proxy or a hub that died without closing the socket, stream still `open` and
  the API answering fine, reset that counter four times per threshold and the
  teacher saw nothing at all. There are two clocks now: the stream's own (it
  decides WHETHER to warn) and the grid's (it decides what "last updated"
  says, and on a dead stream with a live poll it is the smaller, truer
  number). Pinned by a test asserting both halves at once — warns, and reports
  5s rather than 180s — plus its mirror, so the two cannot be quietly swapped.
  Four more from the same review, all fair:
  **The backoff-reset test pinned nothing.** It exercised only the first
  connection, where `attempt` is already 0, so the reset was a no-op for it —
  deleting the line outright left the whole file green, which I checked before
  believing it. The replacement drives `attempt` to 4 with instant drops first
  and then asserts the gap after one healthy stream: ~20-40 ms if the reset
  fired, ~320-640 ms if it did not, a separation no jitter can close. Red 3 of
  3 against the mutation.
  **`STREAM_HEARTBEAT_MS` was hand-copied into the portal** with a comment
  claiming the two sides could not drift. It is in `packages/shared` now, like
  `EVENT_RESUME_OVERLAP`, and both sides import it — move the server to 30 s
  with a copy on the client and the banner flaps on healthy classes, move it
  to 60 s and it never fires, with nothing going red either way.
  **An off-by-one between a constant and its own name:**
  `STALE_AFTER_MISSED_HEARTBEATS = 2` multiplied by `n + 1`, i.e. three missed
  heartbeats. Behaviour was the conservative one and is unchanged at 60 s; the
  constant says 3 and is multiplied by exactly itself now.
  **A reconnect that succeeded reported the old silence.** `onStatus('open')`
  stamped nothing, so after a three-minute outage the banner read "gone quiet,
  last updated 180s ago" over a connection working perfectly, until the
  server's first heartbeat up to 20 s later. The client reports the open
  through `onActivity` now — an open connection is a sign of life — which put
  the fact where the connection is known and made it testable, instead of in
  the component where it would not have been.


- **2026-09-22** — Last of the audit's ten, and the smallest one only because
  the thing it removes is invisible. Two files had independently grown the
  same cause-chain walk — the engine's 40P01 deadlock retry and management's
  23505 join-code retry — and both had to learn the same non-obvious thing to
  get there: drizzle wraps the driver error, so the SQLSTATE sits on a nested
  `cause` and a plain `err.code` check silently never matches. Silently is
  what makes it worth a module rather than a tidy-up. Nothing throws and
  nothing logs; the retry just stops retrying, and the failure it existed to
  absorb surfaces as a 500 at a bell.
  `packages/db/src/sql-errors.ts` owns `hasSqlState` plus `isDeadlock` and
  `isUniqueViolation` now. `isJoinCodeCollision` stays as a named wrapper at
  its call site: the reasoning that a 23505 out of THAT update is always a
  code collision is about the unique indexes on `classes`, not about 23505,
  and it belongs where the loop that depends on it is.
  Pinned directly rather than left to the integration tests, and checked both
  ways: replacing the walk with a plain `err.code` check turns the new unit
  tests AND "regenerate retries past a taken join code" red on both lanes, and
  `isDeadlock` answering true for a 23505 turns one red — the inverted half,
  which matters because a deadlock retry that loops on a unique violation can
  never resolve it.

- **2026-09-22** — CI was failing the real-Postgres lane with every test green,
  and the cause was the stream hub's own shutdown. `ensureListening()` fires
  `client.listen('bali_events', …)` without awaiting it, and `unlisten` is only
  assigned once that RESOLVES — so `hub.close()` on a hub whose LISTEN was
  still being established awaited nothing and returned, and whatever tore the
  pool down next (a test's `closeDb`, the server exiting after `app.close()`)
  did so with the query in flight. postgres.js reported `write
  CONNECTION_ENDED` as an unhandled rejection: 5 runs out of 5 on `main`, in
  isolation, so not a flake. It was not #29's failure — that diff is db-only —
  and it had been read as one twice.
  `close()` now awaits the setup promise, and the `.then` that unlistens a
  LISTEN landing after close awaits its `stop()` instead of voiding it.
  Isolating the two halves says plainly which does what, because the first
  regression test I wrote for this passed with the bug present and I nearly
  shipped it: the awaited `stop()` is what stops the rejection going unhandled
  (voided, it has no handler; awaited, it lands in the `.catch` already there),
  and the awaited setup is what makes `close()` mean "the LISTEN is settled and
  unlistened" — the promise the `onClose` shutdown hook is built on. The
  end-to-end symptom reproduced 1 run in 3 against the first half alone, so it
  is not what the test asserts: `hub-close.test.ts` drives `listen` by hand and
  pins the contract, red with a different message for each half removed, on
  both lanes — where the real-pool version could not run on PGlite at all.

- **2026-09-22** — The portal's two audit findings, and both were subtler than
  "missing": the reconnect backoff and the staleness banner already existed,
  and both were wrong in the case that matters.
  **The backoff reset on the 200, not on the connection lasting.** A server
  that accepts and immediately drops — a session that has ended, a hub
  draining on deploy — answers 200 every time, so every retry went back to the
  base delay. Measured: 16 attempts in 600 ms with a 50 ms base and no growth
  at all, which at the shipped 500 ms default is a browser knocking twice a
  second, per open tab, indefinitely. It resets only once a connection has
  lasted `stableAfterMs` (5 s) now; the same measurement gives 5 attempts,
  doubling. A genuine blip after a healthy stream still reconnects at the base
  delay, which has its own test.
  **The banner only appeared when the client already knew it was
  disconnected** — the one case it can see. The dangerous shape showed
  nothing: a stream that stays open and stops delivering (a wedged proxy, a
  hub that died without closing the socket) left a fully green grid ageing
  silently, every chip claiming a freshness nothing had checked, which is rule
  3 exactly. The decision is a pure `staleness()` in `grid-state.ts` — the
  shape `gridDisplay` already uses, so it is unit-testable without pulling a
  DOM harness into `apps/web` — and it now also fires on an open-but-silent
  stream, worded differently so the two are not confused.
  Liveness had to come from the SERVER's heartbeat, not from events: a quiet
  class emits none for minutes (decision 7), so event traffic would have
  marked a healthy stream stale. The SSE client reports every frame through
  `onActivity`, comments included, and a heartbeat counts as freshness rather
  than mere liveness — nothing arriving means nothing changed. The 15 s
  snapshot refresh feeds it too, so a reload that worked stops the counter.
  Caught in my own mutation pass before pushing: `onActivity` was load-bearing
  and unpinned — deleting it left the suite green while a quiet class would
  have shown the stale banner after a minute. It has its own test now.

- **2026-09-22** — Fourth pass on the same decision, and the third time I
  closed half a hole. #27 added a test that the stream route's log dispatch
  really writes `debug` for the teardown race — and asserted only that
  direction. Measured: hardcode `request.log[level]` to `.debug` and all six
  tests stay green, while every code the listener has never seen is logged at
  `debug` and swallowed by `LOG_LEVEL`'s `info` default. That is the MORE
  dangerous half — the `warn` branch exists precisely so an unheard-of code is
  not discarded — and it was the one left unpinned. Both directions are
  asserted now: hardcoding either way turns one case red, and inverting the
  helper turns five.
  The rest of #27's review, all of it fair: the new test performs a deliberate
  write-after-end without the `uncaughtException` net its sibling documents, so
  a regression in the route's own listener would have taken the worker down
  instead of reporting a failure; `logStream` was spread on top of `transport`,
  which pino refuses outright, so the injected stream wins explicitly now
  rather than leaving a trap for the next caller; and the `'request'` listener
  that #27 moved into `afterEach` outlived the request it captured, so
  anything else reaching the app could reassign it — first match only now, in
  both files, with the `cleanups` convention #27 established applied to the
  new file too.
  That precedence fix then shipped with nothing pinning it, which is the PR's
  own thesis one more time: every test builds with `NODE_ENV: 'test'`, so the
  transport branch was never taken and flipping the ternary back left the
  suite green. There is a test now that builds in development WITH an injected
  stream and reads the raw JSON line off it — both wrong shapes turn it red.
  And the first version of that test failed on the real-Postgres lane with
  every assertion green: it waited on `headersSent`, which fires at
  `writeHead` and therefore BEFORE `hub.subscribe()`, so it ended the response
  while the subscription's first `getEventsSince` was still in flight and the
  pool closed under it — `write CONNECTION_ENDED`, an unhandled rejection that
  fails the run without failing a test. It waits for the opening frame to
  reach the client now, which is the proof that read finished. Causation
  measured, not guessed: the old shape reproduces it 2/2 locally, the new one
  is clean.

- **2026-09-22** — The stream route's log decision took three passes to
  actually pin, and the last hole was one level below the last fix. #24 folded
  the level and the line into one tested helper so the listener had no branch
  left — but the line that CONSUMES it, `request.log[level]({ err }, msg)`, is
  ordinary code: hardcode it to `.warn` and every tab-close goes to `warn` in
  production while all five helper cases stay green. `buildApp` now takes an
  optional `logStream` (tests only; production keeps pino's own destination)
  and an integration test reads the level the route actually wrote. Hardcoding
  the dispatch turns it red; the helper's table test does not notice.
  Also measured, from the same review: the rewritten stall loop treated ONE
  quiet round as proof the socket was full. Draining happens on the event
  loop, so a round where the loop is busy for the whole sleep — this suite
  runs with `repollMs: 5` — looks identical to a full socket. On this box the
  kernel accepts about 3 MiB before it stops, so a false stall on round one
  leaves ~1 MiB queued, `end()` flushes it, `'finish'` fires, and the test
  goes red for a busy machine rather than a regression. It now takes two
  consecutive quiet rounds; a genuinely full socket never drains again.
  And the `'request'` listeners come off in `afterEach` rather than after the
  `waitFor` that may throw first.

- **2026-09-22** — The worst thing the audit turned up was not on its list: a
  lost tap response could stop a teacher starting any lesson for the rest of
  the day, and it needed no race to reach. A tap lands in a session, its
  response is lost, the bell ends the session, and the phone's outbox retries.
  Nothing of that teacher's is running, so the route arms the retry —
  `armTap` de-duped against `armed_taps.event_id` and never against `events`
  (it refuses such an id at arming now), so a SPENT id was
  accepted. The next Start converts it, `insertEvent` sees
  the id against a different session and refuses, and because conversion runs
  inside `startSession`'s transaction the whole Start rolls back with the tap
  still unconsumed. Waiting taps are selected by TEACHER, not by class, so
  every class that student is in is blocked, every period, until the tap
  expires at end of day.
  The waiting tap is consumed and SKIPPED instead — and the skip needs its
  other half, which the first version of this fix did not have. `armTap`'s
  standing-row branch answered `already_armed` for any unexpired row without
  touching its id, so a student whose spent id was armed between periods, and
  who then physically tapped again, had that fresh tap dropped on the floor
  and was skipped at Start: told "armed" twice, joined never, absent from the
  grid with nothing in `events` to say why (at the time; since the ruling the
  skip is recorded, but the dropped fresh tap would still be recorded
  nowhere). Reproduced. A standing row whose
  id is already on record is stale, so the fresh tap takes the slot. For an
  id that is this student's own `tap_in` that is the same reason an expired
  row is stale — the conversion will not honour it. The check is broader than
  the skip (an id held by any other event would convert under a fresh id),
  and taking such a row over is harmless: the student is joined either way. The phone mints one id per
  physical tap, so a spent id can only be a retry of one that already landed:
  the tap was honoured, in the session that recorded it, and the waiting row
  is a stale retry rather than a tap owed anything. Decision 5's "a tap is a
  tap" is about a tap not yet honoured.
  (#26 shipped this differently, twice over, and both were wrong. First as a
  pre-read of `events` — but a read is not a lock, so an id can become spent
  between the read and the insert and roll the Start back anyway, through a
  narrower door; the refusal has no such window, so it is caught instead.
  Then as a conversion under a FRESH id, which survives the Start but joins
  and SHIELDS the student in a class they never tapped into, possibly hours
  later: reproduced, a 09:00 tap whose response was lost puts them in period 5
  at 13:00, because waiting taps are selected by teacher. Skipping is the only
  shape that is wrong in neither direction.) **Skipped only when the id is on
  record as this student's own `tap_in`** — a later review caught the skip
  firing on any `EVENT_ID_CONFLICT`, which `insertEvent` also raises for an id
  held by another type or another user (the phone's own `unlock` id, a
  stranger's tap). Neither means this tap landed, so skipping it dropped a
  genuine unhonoured tap with nothing in `events` (at the time; since the
  ruling it would be recorded as a skip, which is worse — a tap that never
  landed, on record as one that did). Those convert under a fresh
  id again, as they did before the skip, and are pinned both ways ("… is
  still converted, under a fresh id"), with main's `armed_tap_event_id`
  payload linking each back to its armed row. Such rows are reachable on
  current code, not only from old deploys: `armTap`'s refusal holds only as
  of arming, and `tapIn`/`unlock` never consult `armed_taps`. This narrows the
  skip, and so narrows what finding (a) above leaves for the owner's ruling;
  it does not decide that ruling. Nothing is weakened: the armed tap's id exists to de-dupe
  ARMING, and the conversion was already exactly-once, consumed in the same
  transaction. Both reviewers on the tap-replay step reproduced this
  independently and flagged it as worse than anything that step fixed; it is
  pre-existing on `main`, reproduced there before the fix.
  This also removes the sharp edge under the tap path's refusals: each of them
  is a 409 the outbox keeps retrying, and this was where that retrying ended
  up. The contract question — a tap that landed but is no longer current has
  no honest `200` — was open for the owner then, and it can no longer cost a
  teacher their day. (Since the ruling the `409`s stand; the honest terminal
  answer belongs to Phase 3's tap-side outbox disposition — see the entry at
  the top of this log.)
- **2026-09-22** — #22's own review found the same class of hole one level up
  from the one #22 fixed. That PR extracted `streamErrorLevel` so the stream
  route's log decision could be asserted, but the listener then RE-BRANCHED on
  what it returned, and that branch was hand-written and unseen: swapping its
  two bodies left the whole api suite green (verified — 244 passed) while
  every ordinary tab-close would log at `warn` in production, which is the
  exact noise the split existed to avoid. A pinned function with an unpinned
  call site pins nothing. The helper now returns the level AND the line
  together (`streamErrorLog`) and the listener dispatches on what comes back,
  so there is no branch left outside the tested function. Inverting the helper
  turns all five of its cases red.
  The same lesson twice, because the review also measured the stalled-reader
  test's own loop. It claimed to queue "until the socket genuinely stops
  draining, rather than trusting a byte count measured on one machine" — but
  `write()` returns false on the very first 1 MiB chunk (the stream high-water
  mark is 64 KiB and says nothing about the socket), so the loop exited after
  one iteration, the pad was a fixed 5 MiB, and the assertion guarding it was
  true before the socket had done anything. It watches `writableLength` now —
  what has been handed over and not yet accepted — so a round where it grows
  by the whole chunk is a round where nothing drained. The magic number is
  gone and both mutations still kill the test.
  Also from that review: the crash-regression test's socket is registered with
  the same `extraSockets` net its neighbour already had, and its `'request'`
  listener is removed once it has what it needs — a `waitFor` timing out
  before the `try` used to leave a live streaming connection attached to an
  app the suite was about to close.
  Worth knowing for anyone re-running CI locally: `npm test --
  --hookTimeout=60000` at the repo root silently DROPS the flag (the root
  script is `npm test -ws --if-present`, so npm takes the extra argument as
  its own), and on a loaded box PGlite's `beforeEach` then reports phantom
  "Hook timed out in 10000ms" failures. Run `npx vitest run --root <workspace>
  --hookTimeout=120000` per workspace instead.

- **2026-09-22** — Three defects in `armTap`, two of them the same shape: a
  read-then-write where the database could have arbitrated.
  (1) `armTap`'s insert had no `ON CONFLICT`, so two pre-bell taps from one
  phone both passed the selects and the loser surfaced a raw 23505 as a 500 to
  a student walking to their seat. It now lets the waiting-tap index arbitrate
  and reads the winner's tap back, the way `insertEvent` does. The insert and
  its re-read are bounded-retried rather than throwing: `ON CONFLICT DO
  NOTHING` takes no lock on the row it conflicted with, so a Start can consume
  that row in between and leave neither a row nor a standing tap — throwing
  there would have been the same 500 on the same path.
  (2) A consumed armed tap could end up naming an event no `tap_in` ever
  recorded — the transient table and the permanent history disagreeing about
  which tap was converted. Two interleavings, both closed: the refresh guarded
  on `consumed_at IS NULL` (for a conversion that commits before the update),
  and `convertArmedTaps` taking `FOR UPDATE` on the taps it reads (for a
  refresh landing inside its read→consume gap, where the guard sees NULL and
  passes). The second was reproducing 6/6 with only the guard in place.
  Accepted residual, unchanged by either: a student whose tap is consumed
  under them keeps a fresh waiting tap, so the teacher's next session that day
  converts them without another tap. Decision 5 says a tap is a tap, and
  end-of-day expiry bounds it.
  The third finding in this pair, `createBlock` answering `tag_taken` to the
  teacher who already owns the tag, was **split out and waiting on the owner**
  (ruled in 2026-09-22 and landed as its own PR — see the ruling entry):
  fixing it means `POST /v1/blocks` answering 200 where it answers 409 today,
  and ARCHITECTURE.md decision 2 sends behaviour changes on a shipped endpoint
  to `/v2`. Nothing would be renamed or removed and `BlockDetail` is
  unchanged, and no client can break today (the portal never calls it, the
  only caller in the tree is the demo script, and there is no iOS app yet) —
  but that is the owner's call, not a code-review one, so the rest ships
  without it rather than waiting.
  Race coverage runs on the real-Postgres lane only — PGlite is
  single-connection and cannot contend, so the fast lane would pass either
  way. The warm-up in the race suite is load-bearing for round 0: with a fix
  reverted and a cold pool, the first round passes vacuously.
- **2026-09-22** — Follow-ups from #18's review, and a claim of mine that a
  reviewer disproved. The stream route's `'error'` listener logged at `debug`
  while production runs at `info`, so the fix that stopped the crash would also
  have hidden anything unexpected that reached it; it now logs the one code
  that actually arrives (`ERR_STREAM_WRITE_AFTER_END`) at `debug` and anything
  else at `warn`. Measured while correcting a wrong rationale: a peer reset
  reaches the socket and the server's `'clientError'`, never a hijacked
  response, and a write after destroy is routed to the write callback rather
  than emitted — so `warn` here means "we have never seen this", not "a proxy
  is resetting connections". The `streamFailed` disjunct after `subscribe` is
  removed: nothing between the hijack and that check is asynchronous, so it had
  never fired (a reviewer instrumented it across the whole suite on both lanes
  to confirm).
  I had also recorded that two of the route's guards could not be pinned by a
  test, having written three that all passed against the broken version. That
  was wrong, and the counterexample was one entry above it in this same file:
  under backpressure `'finish'` never fires, so the request's `'close'` never
  arrives, the subscription stays live, and the hub's next read hands a frame
  to a write on an ended response. The technique is to **stall the flush** —
  a client that never reads holds the window open — and with it the guard is
  observably load-bearing: softened to a silent `return`, the per-teacher slot
  leaks and the teacher sits permanently at their cap. That test now ships.
  Its reach is exact and worth knowing: softening the guard turns it red, but
  deleting the guard outright leaves the suite green, because the route's own
  'error' listener then releases the slot a tick later. The guard is the
  synchronous path; the listener is the net. That is written above the guard
  so a green run is not read as permission to remove it.
  The reusable lesson is not "this cannot be tested" but "the obvious
  end-to-end reproduction is rescued by another guard; hold the window open
  yourself".

- **2026-09-22** — The live grid's crash-safety was borrowed; the stream route
  now owns it. A write after `end()` on the hijacked SSE response does not
  throw — it returns false and emits `'error'` a tick later, so the hub's
  try/catch never sees it, and an `'error'` with no listener is an
  uncaughtException. Fastify does attach one, but only under
  `hasLogger || onResponse hook || handlerTimeout` (`lib/route.js`), and it
  removes itself from both `'finish'` and `'error'` the first time either fires
  (`lib/reply.js`). Measured on the running route with the app exactly as it
  ships: a late write in the same tick, on a microtask, or **resuming from an
  awaited `getEventsSince`** all die with an uncaught
  `ERR_STREAM_WRITE_AFTER_END`; only a backpressured write survives, because
  `'finish'` cannot fire while data is queued so the borrowed listener is still
  there. The `getEventsSince` case is the hub's own path — a teacher closing a
  tab while a read is in flight killed the API process and every other class's
  grid with it. Two changes: the route installs an `'error'` listener it never
  removes (verified: borrowed → crash, own → survives), and the hub stops
  handing over the rest of a page to a subscriber it has already torn down.
  The audit reported this as a crash and it was twice written off as
  theoretical here; it was real, and the lesson is that a probe which attaches
  its own listener can only ever observe the emission, never the crash.
- **2026-09-20** — Retroactive audit of the pre-gates Phase 1/2 code: ten leads
  checked against the code, nine reproduced and are being fixed as a series of
  gated PRs (status in **Now**; this entry records what the audit decided, not
  work already on `main`). Four of the nine are idempotency or race holes on
  paths whose *happy* case was already tested — the shape of what the gates
  miss, and the argument for keeping the real-Postgres lane required.
  `POST /v1/classes`'s missing idempotency key (below) was the one lead
  rejected: re-examined and deliberately left as it stands.
- **2026-09-20** — The offset-timestamp fix closes a spelling, not a class. Any
  4xx on an unlock body still means the outbox keeps the record and retries
  forever — a malformed `eventId` would do it too. That is the contract working
  as written (`retry_and_surface` also requires the client to *surface* it, so
  it is never silent), and the exposure it leaves is a server that refuses a
  well-formed client. Removing that for timestamps is the fix; the general
  guard — never let validation be the reason an unlock is unrecordable — is a
  standing constraint on anything added to the unlock body.
- **2026-09-20** — The exit demo runs in two worlds behind one seam
  (`apps/api/scripts/demo/world.ts`): in-process (default — server, Postgres and
  issuer all local, time compressed by backdating rows) and remote
  (`DEMO_API_URL` — a deployed API with real Cognito sign-ins). Remote mode does
  **not** get a database handle, and deliberately: with no way to backdate, the
  silence and expiry incidents wait out the real threshold and the deployment's
  own cron, which is what makes a dev run evidence about the deployment rather
  than about the script. The other phones keep heartbeating through those waits,
  so "Ben went quiet" stays about Ben. Cost: a remote run takes minutes where a
  local one takes seconds; `npm run demo` is unchanged and still needs nothing.
- **2026-09-20** — The demo now asserts two guarantees it previously only
  implied: that events reach the teacher's grid **live over SSE** (the stream is
  opened before the incidents, and every event written afterwards must arrive on
  it), and that a session **expires by itself** — the sweep ends it, the grid
  learns live, participations close, and the phone reconciles on its next
  check-in. Both were named Phase 2 exit criteria with no assertion behind them.
- **2026-09-20** — Web sessions install dependencies via a repo-tracked
  SessionStart hook (`.claude/hooks/session-start.sh`), not the cloud
  environment's setup-script field (it ran outside the repo root and broke
  every web session at startup; the field stays empty). Tracked hook means
  checking out a branch runs that branch's hook — accepted for a
  single-owner repo; revisit before adding outside contributors. The hook's
  drift guard deliberately tolerates a session's own uncommitted dependency
  work: it hashes the lockfile immediately before and after its own install and
  compares those two, rather than comparing against the git index, so only what
  that install changed counts as drift. Both the hash and an install run on
  every web SessionStart (`npm ci` on a fresh container, `npm install` on a cached
  one); CI's `npm ci` remains the backstop that catches a lockfile genuinely
  out of step with the manifests.
- **2026-09-20** — CI reviewer billing: Claude Review and `@claude` authenticate
  with the owner's Max subscription (`CLAUDE_CODE_OAUTH_TOKEN`), replacing
  prepaid API credits; reviewer model unchanged. The token also lives in the
  Dependabot secrets store, since GitHub withholds Actions secrets from
  Dependabot-triggered workflows.
- **2026-09-20** — Dependabot policy: alerts and security PRs stay on. The plan
  backstop exempts Dependabot's manifest-only PRs (author and content both
  checked); patch/minor bumps get auto-merge armed
  automatically (merge still requires every required check green); majors are
  handled deliberately by a session. First case: postcss's high-severity alert
  is fixed by a root npm override to `^8.5.23` instead of riding Dependabot's
  Next 15→16 major (#8); the override retires when Next 16 lands as its own
  task.
- **2026-09-20** — `last_seen_at` is stamped with the server's clock, not the
  device's clamped timestamp. The clamp orders events; liveness is an
  observation the server makes. Keying silence off the device's claim let a
  phone with a fast clock pin `last_seen_at` to `ends_at` and stay green for the
  rest of the lesson (rule 3's v2 bug), and a slow one flap the episode open and
  shut against decision 7's "exactly once".
- **2026-09-20** — An `event_id` identifies one event, checked at `insertEvent`.
  Reusing an id for a *different* event is a client bug, not a replay: treating
  it as one silently dropped the write, and on the unlock path 'replay' is a
  recorded outcome, so the phone would delete a record the server never stored —
  v2's lost-unlock bug through a different door. It is now `EVENT_ID_CONFLICT` →
  409, which the unlock contract reads as "keep the record, retry, surface".
- **2026-09-20** — Emergency unlock gets the one authorization check the rule
  allows. `POST /v1/sessions/:id/unlock` previously accepted any valid token for
  any session id, so a stranger could write permanent rows into another
  teacher's history and live grid. A refusal is still forbidden (the phone would
  read it as "discard"), so a caller with no participation row in the session
  *and* no active enrollment in its class now records as an orphan
  (`recorded_as: 'not_enrolled'`, no session/class attached, the claimed id in
  the payload) — durable, but unattached. A student removed mid-session keeps
  their ended participation row, so ISSUES #2's actual case is unchanged.
- **2026-09-20** — `extendSession`'s idempotency key is checked ahead of the
  ended-session guard and scoped to this session's own `session_extended` rows.
  An id already spent on a different event is now a 409 rather than a reported
  "extended" for a write that never happened: `insertEvent` de-dupes on
  `event_id`, so carrying on would have moved the end time with no matching
  event row — the session and its history disagreeing.
- **2026-09-20** — `POST /v1/classes` ships without an idempotency key: a lost
  response that the client retries leaves two identically named classes with
  different join codes. Accepted for now because it is visible and correctable
  by the teacher, and because classes do not pass through the event log, so the
  fix needs its own mechanism rather than an `event_id`. Tracked here; it lands
  with the portal work that actually calls it.
- **2026-09-20** — Portal auth ships access-token-only for the Phase 2 skeleton:
  no refresh token is requested or stored, so a teacher is signed out when the
  ~1h Cognito access token expires. Deliberate for the walking skeleton and
  written down rather than silently omitted; token renewal lands with the real
  portal UI (ARCHITECTURE.md auth decision 2 assumes it).
- **2026-09-20** — Bali Design System created at [Bali Design System](https://claude.ai/artifact/UPEBLz6nAmGXrzYnQ75qVz)
  (tokens, brand book, reference screens); UI work designs against it.
- **2026-09-19** — Plan-then-go (no plan-approval gate) and no-Claude-attribution
  adopted as standing rules; ecc `/plan` and `/santa-loop` ported as the loop's
  planner and verifier.
- **2026-09-19** — Quality gates: `main` protected (PRs only, no human-approval
  requirement while the team is 1), Claude Review is a required blocking check
  (Opus), "Plan doc updated" backstop with `[no-plan]` escape, tests required
  with every code change. CodeRabbit et al. skipped (free tier doesn't review
  private repos).
- **2026-09-19** — Merge policy: auto-merge on green. Every PR gets auto-merge
  (squash) enabled at open; GitHub merges the moment all required checks pass.
- **2026-09-19** — OpenAPI snapshot check deferred to Phase 4 (needs
  `@fastify/swagger` wiring; avoid conflicting with the unmerged Phase 2 branch).
- Earlier design decisions live in `docs/ARCHITECTURE.md` (dated inline).
