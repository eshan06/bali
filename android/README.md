# Bali for Android

The student app, the iPhone app's twin, over two modules of plain Kotlin (`docs/ARCHITECTURE.md`,
"Android app structure"). Phase 9 builds the engine and Phase 10 the screens
(`docs/PLAN-ANDROID.md`); until then the app is Bali's name and nothing else: no screen, no icon.

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
   (`docs/GOTCHAS.md`, "Android's SDK on Windows"). With no screen there's no icon to tap: Settings →
   Apps lists it as Bali.

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

**The outbox tables** (`core`'s `UnlockContract.kt` and `OutboxContract.kt`, BaliCore's twins) say
what the outbox does with a record after each send; no answer ever drops an unlock the server hasn't
recorded. `outbox`'s tests run every `contracts/outbox/` case against them, and `core`'s check each
fixture's disposition.

**The records** (`outbox`'s `OutboxRecord.kt`, BaliOutbox's twin) are what the phone did (`Change`)
and the request each one sends, the same on every attempt. A record's `send` puts it through the
client once and reads the answer by its own kind's table: the only way to make a `Sent`, what the
store settles. Their tests send a record of each kind through every `contracts/outbox/` case and
every outbox fixture. AN4c picks the outbox's store; Room's JVM build keeps its tests here, on the
JVM.

## Android Lint

The app's lint fails on any warning, in every module, but four checks of versions (a newer release
trips them, not the code; targetSdk follows Play's rule, not the newest Android) and the app's
missing icon, waived in the manifest until an icon is drawn and approved.
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
- **animal-sniffer's plugin** (2.0.1) calls two Gradle features Gradle 10 removes, which every
  build warns of. Upgrading to Gradle 10 needs a release of it that doesn't, or the same check made
  another way: never the check dropped.
- **compileSdk and the build tools:** only to packages the PC's SDK and CI's runner both hold
  ([the runner's list](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)).

## CI

The **Android** workflow (`.github/workflows/android.yml`) runs on every PR that touches `android/`
or the workflow: it builds the app and the modules, checks the modules against Android 10's API,
runs the app's Android Lint and every module's JVM tests, on Linux with JDK 21 and the runner's SDK,
deciding whether to run as `ios.yml` does.
`core`'s and `outbox`'s tests also run on every PR but a docs-only one ("Android contract tests
(JVM)" in `ci.yml`), as BaliCore's Swift tests do, so a server change that breaks the phone's
reading of an answer goes red on its own PR.
