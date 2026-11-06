# Bali for Android

The student app, the iPhone app's twin, over two modules of plain Kotlin (`docs/ARCHITECTURE.md`,
"Android app structure"). Phase 9 builds the engine and Phase 10 the screens
(`docs/PLAN-ANDROID.md`); until then the app is Bali's name, the outbox's file, sign-in's app side, the
lock's service with its cover and a readout for the phone checks (both in the Debug build alone), the
NFC reader, the engine and the enforcer it starts, and the backup rules that keep them on the phone: no
screen a student sees, no icon.

| Folder                      | What it is                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `core/`                     | BaliCore's twin: the wire types, the vocabulary, event ids, the API client and `BlockTag` (AN3) — tests on the JVM        |
| `outbox/`                   | BaliOutbox's twin: the outbox, the sync engine, the lock's rules and which screen shows when (AN4–AN7) — tests on the JVM |
| `app/`                      | The app, `com.bali.bali`: the screens, the lock's service, NFC, sign-in and push                                          |
| `gradle/libs.versions.toml` | Every version the build names                                                                                             |

The app's id is `com.bali.bali`, iOS's `com.bali.Bali` lowercased; it runs on Android 10 and later
(minSdk 29), targets Android 16 (targetSdk 36, Play's rule for new apps and updates since
2026-08-31) and compiles against Android 16's `android-36.1` platform with build tools 36.1.0. Each
has its reason in `docs/DECISIONS.md` (2026-11-04, AN2). The id becomes permanent at the first
upload to Play (AP2).

## On the PC

You need JDK 21 (Android Studio's own, its JBR, as `JAVA_HOME`) and Android's SDK with the
`android-36.1` platform and build tools 36.1.0, which the PC whose clone is `C:\dev\bali` has
(`docs/PLAN-ANDROID.md`, "Who builds what"). Run Gradle from Git Bash, in this folder.

1. Tell Gradle where the SDK is, once: Android Studio writes `local.properties` when it opens this
   folder; from a shell, write `sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk` there, or
   set `ANDROID_HOME`. Git ignores the file.
2. `./gradlew build` builds the app (its debug and release APKs), runs Android Lint, every
   module's JVM tests and the check of Android 10's API (below).
   `./gradlew :core:test :outbox:test` runs the contract tests alone; they need a JDK and no SDK.
3. To see the debug build install, start one of the PC's test emulators, `Bali_Spike_API35`, `36` or
   `37` (never the owner's `Pixel_7`, and never signed in to a Google account), then
   `./gradlew :app:installDebug`, and stop it after with `adb -s emulator-5554 emu kill`
   (`docs/GOTCHAS.md`, "Android's SDK on Windows"). The launcher lists the Debug build's readout as
   Bali readout (Debug), with Android's own icon; a Release build has no screen: Settings → Apps lists
   it as Bali.
4. The app's instrumented tests (`app/src/androidTest`) run on one of those emulators, started as
   in 3: `./gradlew :app:connectedDebugAndroidTest` installs the app and its test app, runs them and
   uninstalls both. They show what the JVM's tests can't: that the app opens the outbox's file on
   Android's Room, writes it through the store at FULL and settles a send's answer there; the
   sign-in's tokens sealed by the Keystore; the hosted UI's tab and its answer back, against the
   emulator's own Chrome, which stops at its first run: a test closes it with Back and force-stops
   Chrome after, never accepting its terms, and puts back the font scale it changes; and the lock's
   service, switched on and off as a student would, through the shell of a UiAutomation that leaves
   accessibility services running (one that doesn't has Android unbind them all), the screen turned
   off and on, each put back as found; the Debug readout, driven as a tester drives it; and the cover,
   over Android's own apps and a blocked app of the tests' own (`StandIn.java`, in Java since it runs in
   the test app's process, which has no Kotlin), with split screen made through System UI's shell and a
   call to the emulator's own pretend network, its call log put back; and the readout's Scan on a phone
   with no NFC, as the emulators are, a real tag being the phone check's. A Debug
   build's start opens the app's own outbox, `outbox.sqlite`, in the tests' process too, so each test
   opens a file of its own, and one that starts a run of its own waits for the app's start first
   (`BaliApp.launched`). CI builds them but has no emulator to run them, so a step that changes what
   they reach runs them here and puts the result in its PR.

The build installs nothing: `gradle.properties` turns off the Android plugin's own installs, so a
missing platform or build tools fails the build by name, and Gradle never downloads a JDK. A step
that needs a new SDK package names it, its source and its size for the owner first.

## `core` and `outbox`

Both are plain Kotlin, so their tests run on a JDK alone, as BaliCore's and BaliOutbox's run on
Linux. Their tests read the repo's `contracts/` in place, never a copy, and `core`'s read
`@bali/shared`'s lists (`packages/shared/src/`) so too: Gradle names each folder in a system
property (`bali.contracts`, `bali.shared`) and makes it an input of the test task, so a changed
fixture or list runs them again. Run outside Gradle, the properties are unset and they fail, never
passing on nothing. They compile to Java 17's bytecode, which the app's build turns into Android's.
Every body is coded with kotlinx.serialization, its compiler plugin Kotlin's own (`core`'s
`Json.kt`).

**Android 10's API, which Android Lint can't see in them.** The app's lint reads their code
(`checkDependencies`; each applies `com.android.lint`, without which it reads nothing of theirs),
but they're built against the JDK, not Android, so lint's check for an API newer than the app's
minSdk (NewApi) never reaches them. So animal-sniffer checks their compiled classes against
Android 10's API, the gummy-bears API 29 signatures, in `check` and in `android.yml`
(`./gradlew :core:animalsnifferMain :outbox:animalsnifferMain`): a call Android 10 lacks fails it,
such as a list's `removeFirst()` (Android 15) or `java.util.HexFormat` (Android 14). What D8
rewrites for Android 10 passes, as it should: `List.of` (Android 11) becomes D8's own copy in the
app. Kotlin's own work everywhere (`listOf`, `removeAt(0)`). The check takes no exceptions: never
loosen it to pass code.

**The API client** (`core`'s `ApiClient.kt`, BaliCore's `APIClient.swift`) puts each request on the
wire through `HttpTransport`; the app's is `OkHttpTransport`, OkHttp set up as iOS's URLSession is:
no cache or cookies, 15 s for each wait and 30 s for a whole exchange, and no redirect followed. A
request with a body goes once, whatever comes back; a read goes again on a fresh connection when
its pooled one turns out closed, as URLSession's does. Its tests run against MockWebServer on a
local port. Gradle picks OkHttp's Android build for the app and its JVM build for `core`'s tests.
Its calls suspend (kotlinx.coroutines), as Swift's are async.

**Sign-in** (`core`'s `SignIn.kt` and `TokenStore.kt`, BaliCore's `SignIn.swift` but `deleteUser`,
AN9's) has its parts (AN6a): the hosted UI's address with PKCE, its verifier and state from
`SecureRandom`; the code in its answer, taken only at the redirect URI and only for its attempt, the
answer read with `java.net.URI`, since OkHttp's `HttpUrl` reads only http and https; and the tokens,
kept in a form of their own that reads tokens kept before a field existed, and their claims, read
unverified: a token the phone can't read gives none, never a crash. `SignIn` itself (AN6b) keeps the
tokens: the API client's `TokenProvider`, whose token never throws, and the engine's refresh. Swift's
actor is a lock each stretch holds, as the engine's, a stretch that can't suspend, on
`Dispatchers.IO`, since the store's calls block as the Keychain's do. One renewal at a time, in the
app's scope, which every caller waits for: one cancelled stops waiting, and it goes on for the
others. Only Cognito refusing the refresh token signs anyone out, and no token reaches Bali's API
before the 13+ check but the check's own read and a deletion's. The token endpoint is reached over
the API client's OkHttp. No token, code, verifier or state reaches a log line or an error's message.
`SyncEngine.make` is the app's engine over it.

**Sign-in's app side** (`app`'s `KeystoreTokenStore.kt`, `HostedUi.kt`, `HostedUiActivity.kt` and
`BaliApp.kt`, AN6c): the tokens sealed with AES-GCM under a Keystore key of the app's own, in
`no_backup/`, a file that can never be opened again read as nothing saved; Cognito's hosted UI in the
phone's browser, an Auth Tab where it has one, else a Custom Tab, ephemeral where it offers that,
hosted by an activity that draws nothing; and its answer at `com.bali.bali:/auth/callback`, a Custom
Tab's taken only for the waiting sign-in with its state. `BaliApp` holds the app's scope, one
transport, the build's config and the sign-in, for the engine and the screens to take. The build's
values (`app/build.gradle.kts`, under iOS's settings' names) are string resources the manifest names
under iOS's Info.plist keys, read into `AppConfig`; `core`'s AppConfigTest pins the three together,
and the client id stays empty, sign-in not set up, until the owner's (`docs/DEPLOY.md`).

**The lock's service** (`app`'s `ServiceLock.kt`, `LockService.kt` and `BaliApp`'s `start`, AN7c; iOS's
`PhoneScreenTime` and BaliApp.swift's `start`): Bali's Accessibility service, declared in `app/src/debug`
alone with a developer's label until AS3 or AS5 declares it in main with AS0's words, and the `Lock`
over it. Its switch is Android's list of switched-on services and the service's binding; its lock, an
end kept by the phone's clock, the service listening to nothing outside a lesson and to window events
in one (`setServiceInfo`), never a window's contents; its file in `no_backup/` keeps the lock for the
next run, which reads it once as it starts. Its calls run on the main thread. The service hears the
screen go on and off for the engine's check-ins, and runs rule 3's check as it binds and unbinds;
`BaliApp`'s `start` runs the engine and the enforcer in place of any run before, with the check as the
app starts and at each change of the switch, and none while sign-in isn't set up but a Debug build's
(below).

**The Debug readout** (`app/src/debug`'s `ReadoutActivity.kt` and `ThisBuild.kt`, AN7d; iOS's
`Readout`): a developer's screen for the phone checks, in the Debug build alone with a launcher entry of
its own, in plain Views, its words a developer's, never a student's, until Phase 10's screens. It shows
the engine, its link and the server's last answer, the sign-in, the standing, what rule 3's check found
of the lock, the service and how long it read starting after the run's first check (`ServiceLock`'s own
measure, against the grace), and the outbox; with Sign in and Sign out, Open Accessibility settings, Scan
and Read block code (AN8, below), a typed tap, Emergency Unlock, the phone check's 15-minute cap, kept in
its own preferences and read at each start, and Try again where the start failed. In front, it tells the app (`BaliApp.front`), which
reads the truth and runs the check. While sign-in isn't set up, a Debug build's start runs the engine
all the same, over no token at the build's API, as a signed-out phone, so a typed tap locks offline to
its cap and nothing reaches the network; a Release build's makes none, as on iOS (`app/src/release`'s
`ThisBuild`, pinned on the JVM by Release's own tests, which `gradle.properties` turns on). A start that
fails is held (`BaliApp.startFailed`) for a screen to say, never swallowed.

**The cover** (`outbox`'s `Cover.kt`, the rule, on the JVM; `app`'s `AllowList.kt`, `Covers.kt` and
`LockService`'s window events, AN7e; no iOS twin, the shields covering every app at once): while a lock
holds, the service names each window from that window's own state event, never its contents, and covers
each window of an app the allow-list doesn't hold where it is, within the screen but its bars, with a
plain overlay of Bali's own, AS5's block screen its content in Phase 10. A full-screen app is sent home
once its cover lands; a split half and a picture-in-picture window stay covered, the latter's touches
going through to System UI, which still moves or closes it. A cover keeps clear of every window above its
own that isn't covered (the shade, a notification, the keyboard), but for a picture-in-picture window's own
menu, and the covers go at the lock's end with no event. Android 10 measures no insets outside a window, so
there the screen but its bars is worked out from the display's sizes (`safeOnAndroid10`). The allow-list is
asked of Android as a lock comes on, through the `<queries>` beside the service in the Debug manifest (a
protected broadcast's receiver shows through none, so the emergency alerts app is seen by its list of
alerts): the parts the student chooses whoever holds them, the parts asked by what they do only where a
system app holds them. A window no event has named is never covered, so one already on screen
as the lock comes on stays bare until it changes or the student touches it (`docs/ISSUES.md` #6).

**The tap over NFC** (`app`'s `BlockReader.kt`, AN8; iOS's `BlockReader`): a block read in Android's
reader mode while a screen of Bali's own is in front, one tag a scan, its NDEF records as Android read
them when it found the tag handed to `core`'s `BlockTag` as they come, the answer a `BlockRead` for the
engine's `tap(read)`. In the main source set, since AS4's "hold your phone to the block" screen will use
it; the Debug readout's Scan until then. A scan ends with the first tag (let go while it stays on the
phone, so Android hands it to no other app after), Bali's screen leaving the front (cancelled), NFC
switched off (`NfcOff`, Android's alone, as it starts or during it), or the caller's cancel; one at a
time; reader mode off at its end however it ends. A phone with no NFC reads as one that can't
(`Unsupported`), as on iOS: the manifest asks for NFC without requiring it (`docs/DECISIONS.md`,
2026-11-05, AN8). Its rules (`scan`) run on the JVM over a reader of the tests' own; the emulators have no
NFC, so a real tag is the phone check's (`docs/ANDROID-PHONE-TESTS.md`, AN8). A block's link doesn't open
Bali: that waits for AN1's part 2 and Phase 10.

**The outbox tables** (`core`'s `UnlockContract.kt` and `OutboxContract.kt`, BaliCore's twins) say
what the outbox does with a record after each send; no answer ever drops an unlock the server hasn't
recorded. `outbox`'s tests run every `contracts/outbox/` case against them, and `core`'s check each
fixture's disposition.

**The records** (`outbox`'s `OutboxRecord.kt`, BaliOutbox's twin) are what the phone did (`Change`)
and the request each one sends, the same on every attempt. A record's `send` puts it through the
client once and reads the answer by its own kind's table: the only way to make a `Sent`, what the
store settles. Their tests send a record of each kind through every `contracts/outbox/` case and
every outbox fixture.

**The outbox's file** (`outbox`'s `OutboxDatabase.kt` and `Outbox.kt`, BaliOutbox's `Outbox`) is
Room's: its JVM build in `outbox`'s tests and its Android build in the app, Gradle picking each, over
the SQLite Room bundles (`BundledSQLiteDriver`), the same on the JVM and on the phone. KSP generates
Room's code from `OutboxDatabase.kt`, and Room writes each version's schema to `outbox/schemas/` as
the build runs: commit it with the version, so a migration is checked against the schema it starts
from. The table is iOS's, its checks included, which Room can't declare: they're made with it as the
file is created, and a migration that makes the table again carries them, as iOS's do. The app opens
the file in its own storage (`app`'s `OutboxFile.kt`); its backup rules (`app/src/main/res/xml/`)
leave everything of Bali's out of a backup and of a transfer to a new phone.

**The outbox's rules** (`outbox`'s `Outbox.kt`, BaliOutbox's `Outbox`) record what the phone did,
with the standing it leaves (`Standing.kt`, kept in a form of its own), in one write, and send it:
`nextDue` names the next record in the order the phone acted, and `settle` applies a send's answer,
which its own kind's table has read, keeping a record until its answer ends it, an unlock until
recorded. A kept record waits 2 s, 4 s, 8 s… up to a minute, plus up to as much again at random
(`Outbox.open`'s `random`, which the tests choose), and is stuck at a refusal or after 8 answers that
leave it unsettled. Each write is one transaction on Room's writer connection, set to
`synchronous = FULL` first, since Room opens every connection at NORMAL: so a write reaches the disk
as it commits, and an Emergency Unlock's record outlives the phone losing power right after
(`docs/DECISIONS.md`, 2026-11-04, AN4d). The file stays in WAL. The SQL is iOS's, run on Room's
connection, each number bound as a number, never as text, which SQLite ranks above every number
(AN4e).

**The sync engine** (`outbox`'s `SyncEngine.kt` and `SyncState.kt`, BaliOutbox's `SyncEngine`) is
the one owner of the phone's server communication, built in five steps from its frame (AN5a); the
app records what the phone did through it, never the outbox itself. Swift's actor is a lock each
stretch holds, Room's calls included, let go at each `await`; no stretch is cut short by a cancel;
and each public call runs in the engine's own scope, the app's, so a screen cancelled stops waiting
while the write goes on: an Emergency Unlock's record is never discarded. Room runs a write to its
end whatever its caller, so a cancel landing as it returned would skip the state it leaves
(`docs/DECISIONS.md`, 2026-11-04, AN5a). Its drain (AN5b) sends the queue one record at a time, in
the order the phone acted, and applies each answer in one step, the queue read again with it. A
send cancelled with the engine's run makes no answer, so its record stays as it was, due, and on its
way until a send of it settles, and goes again at the next run under its event id, where iOS counts
it an attempt with no answer. Its read
loop (AN5c) follows the screen, as the lock's service hears it (`setScreenOn`, AN7c's): a check-in
every 30 s while it is on and one as it comes on or goes off, out of a session the truth read as it
comes on instead, rule 3's check before each, then nothing while it is off. A read applies only as
the reconcile allows, and never puts the lock back on over an Emergency Unlock the server hasn't
recorded. A 401 asks the sign-in for a fresh token once per rejection, one refresh at a time, which
both loops wait on. Its wait for the Start (AN5d): a tap answered armed waits until the next
midnight in the zone the phone is in as it arms, by java.time's calendar, so a day the clocks change
is 23 or 25 hours long; the end is kept in the file for a relaunch, the truth is read at each wake
while the screen is on, and offline the wait ends at the first wake past its end. Its Emergency
Unlock (AN5e) is filed under a tap not yet answered, else in the phone's session, or, where it stood
unread, once that is known (B6b); its send waits 15 s for the student's reason, never past the bell;
a reason goes with it while it has never been sent, and after, as a change of the one recorded. The
lock back on returns the phone where it stood before protection off or, not known, past the unlock
guard. When the lock is on is `SyncState.shieldedUntil`'s, and each call's failure is a type, the
words the screens' (AN10). Its tests run on
a rig of their own (`EngineSupport.kt`, BaliOutbox's `EngineSupport.swift`): a clock the test moves,
in a zone of the test's own, since coroutines-test's virtual time can't drive Room's queries, a
server answered by hand, and the bundled driver watched, which sees each commit as GRDB's
`TransactionObserver` does, and can refuse a statement as a failing disk would.

**The lock's rules** (`outbox`'s `Enforcer.kt` and `Lock.kt`, BaliOutbox's `Enforcement`, AN7a): the
enforcer follows the engine's state and keeps the lock where it says, through a seam of the lock's own
(`Lock`), which the app's Accessibility service fills (AN7c). The lock carries its end, the bell or a
tap's cap, and stops there by the phone's clock with nothing woken; the enforcer puts it on again as
the end moves, never over the switch off. Over a standing the file won't give back, the last run's
lock stays until the phone knows where it stands or the student unlocks. Rule 3's check, at each of the
engine's wakes, puts back a lock gone behind Bali's back, and reports the switch found off in a session
the phone's clock says still runs, with iOS's events (AN7b): a report the outbox couldn't queue is shown
and tried again at the next check, and the switch on again, the service bound, in the class it was off
in before its bell, puts the phone back where it stood (#167). A switch starting, on Android's list but
not bound yet, is off only once that lasts 30 s by the time the phone has run, checked again every
second meanwhile. Swift's actor is a lock each stretch holds, as
the engine's, let go at each call into the lock or the engine, so a check lands while a pass waits on the
lock; each call runs in the enforcer's own scope, so no caller cancelled cuts a pass short. What a screen
may claim of the lock (`Protection`) is what the last pass found, never the standing alone. Its tests run
on the engine's rig, with a fake lock (`LockSupport.kt`).

## Android Lint

The app's lint fails on any warning, in every module, but four checks of versions (a newer release
trips them, not the code; targetSdk follows Play's rule, not the newest Android) and the app's
missing icon, waived in the manifest until an icon is drawn and approved. Room's generated code in
`outbox` is left out by `outbox/lint.xml`, as lint leaves an Android module's generated code out by
itself: in a plain Kotlin module it can't tell it apart.
Lint can keep its last report after a change to the manifest alone:
`./gradlew :app:lint --rerun-tasks` reads everything again. CI's runs start clean.

## Updating

- **Gradle:** `./gradlew wrapper --gradle-version <version> --gradle-distribution-sha256-sum <sum>`,
  twice (the second run writes that version's own scripts and jar), the sum from
  [Gradle's checksums](https://gradle.org/release-checksums/). CI checks the jar against Gradle's
  published sums. A `gradlew` added from Windows goes in without its executable bit, which CI's
  Linux needs: `git update-index --chmod=+x android/gradlew` sets it. `.gitattributes` keeps
  `gradlew` LF and `gradlew.bat` CRLF.
- **The Android plugin and Kotlin:** `gradle/libs.versions.toml`. The plugin's own Kotlin is lifted
  to the catalog's. Each plugin release names the Gradle and build tools it needs.
  kotlinx.serialization's library follows Kotlin: each release names the Kotlin it was built with.
- **OkHttp** stays on 5.4.0 while compileSdk is 36.1: 5.5's Android build needs compileSdk 37,
  Android 17's platform, the owner's to add (`docs/PLAN-ANDROID.md`, Open owner items, 6).
- **androidx.browser and androidx.activity:** each the newest stable that builds on compileSdk 36.1;
  androidx.activity is named because the sign-in's host compiles against it, the browser's own being
  a runtime dependency.
- **Room and KSP:** Room's runtime, compiler and Gradle plugin share one version. KSP's version is
  its own since 2.3, not Kotlin's. `androidx.sqlite`'s bundled driver may be newer than the Room it
  serves: Room names the oldest it takes.
- **animal-sniffer's plugin** (2.0.1) calls two Gradle features Gradle 10 removes, which every
  build warns of. Upgrading to Gradle 10 needs a release of it that doesn't, or the same check made
  another way: never the check dropped.
- **compileSdk and the build tools:** only to packages the PC's SDK and CI's runner both hold
  ([the runner's list](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)).

## CI

The **Android** workflow (`.github/workflows/android.yml`) runs on every PR that touches `android/`
or the workflow: it builds the app, its instrumented tests (never run: no emulator) and the modules,
checks the modules against Android 10's API, runs the app's Android Lint and every module's JVM
tests, on Linux with JDK 21 and the runner's SDK, deciding whether to run as `ios.yml` does.
`core`'s and `outbox`'s tests also run on every PR but a docs-only one ("Android contract tests
(JVM)" in `ci.yml`), as BaliCore's Swift tests do, so a server change that breaks the phone's
reading of an answer goes red on its own PR.
