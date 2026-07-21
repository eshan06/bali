# Bali Student (Android)

Compose-based student app. Talks to the same Cognito User Pool and `/api` endpoints as the web admin.

- Package: `com.bali.student`
- `compileSdk` / `targetSdk`: 35
- `minSdk`: 26
- Auth: Amplify (Cognito) — email/password + Google via Hosted UI

## Prerequisites

1. **JDK 17 or newer.** AGP/Kotlin will not run on JDK 8. The clearest sign you have the wrong JDK is `gradlew` failing with:
   ```
   Error occurred during initialization of VM
   Could not reserve enough space for 2097152KB object heap
   ```
   Fix: install a JDK 17+ (Temurin, Oracle, or use Android Studio's bundled JBR at `<Studio install>/jbr`) and set `JAVA_HOME` to it system-wide. On Windows: Settings → Environment Variables → New `JAVA_HOME`.
2. **Android Studio** (Hedgehog or newer) with:
   - **Android SDK Platform 35** installed
   - An **AVD** (e.g. Pixel 7, API 35) created in Device Manager
3. **`android/local.properties`** — not committed. Either open the project once in Android Studio (it auto-creates one) or create the file manually with a single line:
   ```
   sdk.dir=<absolute path to your Android SDK>
   ```
   Examples: `C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk` on Windows, `/Users/<you>/Library/Android/sdk` on macOS.

## Build & install

From `android/`:

```bash
# build the debug APK and install it on the running emulator/device
./gradlew installDebug

# launch
adb shell monkey -p com.bali.student -c android.intent.category.LAUNCHER 1
```

The debug build points at `http://10.0.2.2:3001/api/` — that's the host machine's `localhost:3001` as seen from the emulator. Make sure the API (`packages/api`) is running locally on port 3001, or change `API_BASE_URL` in `app/build.gradle.kts`.

## Google sign-on

Wired via Cognito Hosted UI with Google as a federated IdP. The Android side needs no per-developer setup beyond what's in the repo — the OAuth config lives in `app/src/main/res/raw/amplifyconfiguration.json`, and the OAuth redirect comes back through the custom URI scheme `balistudent://`, declared in `AndroidManifest.xml`.

Cognito-side (already configured, recorded here for reference):

- App client → Hosted UI → Allowed callback URLs include `balistudent://callback/`
- Allowed sign-out URLs include `balistudent://signout/`
- Identity providers: Google enabled
- OAuth grant type: Authorization code
- Scopes: `openid`, `email`, `profile`

## Troubleshooting

- **Daemon fails with heap/init error** — JDK 8 on PATH. See Prerequisites #1.
- **"Unable to delete directory `app/build/...`"** — Android Studio's own Gradle daemon is holding a lock. Either close Studio's project, run `./gradlew --stop`, or delete `app/build/` and rebuild.
- **`redirect_mismatch` from Cognito after tapping "Continue with Google"** — the callback URL in Cognito doesn't match `balistudent://callback/` exactly (trailing slash matters).
