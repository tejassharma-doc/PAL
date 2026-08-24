# PAL Health — Android App

React Native 0.76.9 · New Architecture (Hermes + Fabric) · Kotlin

This is the standalone Android project for PAL Health. It is a complete, self-contained
React Native app that can be opened in Android Studio or built from the command line.

---

## ⚙️ Gemma 4 API Key — Required for MDT Lab Extraction

> **This key must be set before medical document upload will extract lab values.**

PAL Health uses **Google Health's Medical Data Toolkit (MDT)** to extract FHIR R4 data
from uploaded lab reports (PDF, JPEG, PNG). MDT runs Gemma 4 for document understanding.
There are two inference modes:

| Mode | When | How to configure |
|---|---|---|
| **Cloud inference** (Gemma 4 via GCP Vertex AI) | Key is provided | Set `GEMMA_4_API_KEY` in `.env` |
| **Local inference** (Gemma weights bundled in MDT container) | Key is empty | Leave `GEMMA_4_API_KEY=` blank |

### Step 1 — Get a Gemma 4 API key from GCP

1. Go to **Google Cloud Console → Vertex AI → Model Garden**
2. Find **Gemma 4** and enable the API
3. Create a service account key or use a Bearer token:
   ```
   gcloud auth print-access-token
   ```
4. Copy the token value

### Step 2 — Add the key to `.env`

```bash
cp .env.example .env
```

Edit `.env`:

```env
# PAL backend API URL (Android emulator → host machine)
PAL_API_URL=http://10.0.2.2:8000

# Enable Universal Search
UNIVERSAL_SEARCH=true

# ─── Gemma 4 API Key ────────────────────────────────────────────────────────
# GCP Vertex AI Bearer token — forwarded to the MDT container for cloud Gemma inference.
# Leave empty to use local Gemma weights bundled inside the MDT Docker image.
# Format: the output of `gcloud auth print-access-token` (refreshes every hour).
GEMMA_4_API_KEY=ya29.your_actual_token_here
```

### Step 3 — Pass the key to the MDT backend

The key is forwarded from the PAL backend (not the app). Add it to the **backend** `.env`:

```env
# D:\Paulson\PAL\api\.env
MDT_ENABLED=true
MDT_URL=http://localhost:8080
GEMMA_4_API_KEY=ya29.your_actual_token_here
```

The Android app itself never holds the Gemma key — it sends files to the PAL API,
and the API forwards the key to the MDT container as an internal Bearer token.

### Step 4 — Start MDT Docker container

```bash
docker run -p 8080:8080 gcr.io/cloud-medical-data-toolkit/mdt:latest
```

> **Without the Gemma key:** MDT uses local Gemma weights (slower, no GCP cost).
> Documents are still saved; extraction is attempted with local inference.
>
> **Without MDT running:** `MDT_ENABLED=false` in backend `.env` — documents are
> stored as reference files but no FHIR/lab values are extracted. The app still works.

---

## Project structure

```
Pal Android claude/
├── android/                        ← Android native layer (hand to Android team)
│   ├── build.gradle                ← Top-level Gradle (SDK versions, Kotlin, AGP)
│   ├── settings.gradle             ← Module list + RN autolinking (0.76 style)
│   ├── gradle.properties           ← JVM flags, newArchEnabled, hermesEnabled
│   ├── gradlew                     ← Gradle wrapper script (Linux/macOS/WSL)
│   ├── gradlew.bat                 ← Gradle wrapper script (Windows)
│   ├── gradle/wrapper/
│   │   ├── gradle-wrapper.properties   ← Pins Gradle 8.10.2
│   │   └── gradle-wrapper.jar          ← ⚠️ Binary — generate with step below
│   └── app/
│       ├── build.gradle            ← App-level Gradle (applicationId, signing, deps)
│       ├── proguard-rules.pro      ← R8 minification rules for release
│       └── src/main/
│           ├── AndroidManifest.xml ← Permissions + deep links
│           ├── java/com/palhealth/
│           │   ├── MainActivity.kt     ← Single-activity RN host
│           │   └── MainApplication.kt  ← PackageList autolinking, Hermes + Fabric
│           └── res/
│               ├── values/strings.xml
│               ├── values/styles.xml
│               ├── values-night/styles.xml     ← Dark mode splash
│               └── xml/network_security_config.xml
├── src/
│   ├── lib/api.ts              ← PAL API client (auth, health facts, MDT upload)
│   ├── theme/index.ts          ← Design tokens (PAL colour palette)
│   ├── navigation/AppNavigator.tsx
│   ├── screens/
│   │   ├── AskScreen.tsx       ← Chat + MDT document upload (paperclip button)
│   │   ├── RecordsScreen.tsx
│   │   ├── HistoryScreen.tsx
│   │   ├── VisitsScreen.tsx
│   │   └── SettingsScreen.tsx
│   ├── components/
│   │   ├── SearchBar.tsx           ← Input + 📎 attach button
│   │   ├── SafetyBanner.tsx        ← Emergency / crisis banner
│   │   └── VerificationSheet.tsx   ← MDT lab review bottom-sheet modal
│   └── services/
│       └── fuguRouter.ts       ← On-device intent + safety classifier
├── App.tsx
├── index.js                    ← AppRegistry entry point
├── app.json                    ← App name (must match getMainComponentName)
├── package.json
├── babel.config.js
├── metro.config.js
├── tsconfig.json
└── .env.example                ← Copy to .env and fill in keys
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 18 | |
| Java JDK | 17 | Gradle 8 requires Java 17 |
| Android Studio | Ladybug 2024.2+ | |
| Android SDK | API 35 (Android 15) | Install via SDK Manager |
| Android NDK | 27.1.12297006 | Install via SDK Manager → SDK Tools |
| Gradle | auto-downloaded | No manual install needed (see below) |

Full RN environment guide: https://reactnative.dev/docs/set-up-your-environment

---

## First-time setup

### 1 — Generate the Gradle wrapper JAR

The `gradle-wrapper.jar` binary is required for `./gradlew` to work.
It is not included in the repo (binary file). Generate it once:

```bash
# Option A — if Gradle is already installed on your machine:
cd android
gradle wrapper --gradle-version 8.10.2 --distribution-type all

# Option B — download the JAR directly (GitHub release):
mkdir -p android/gradle/wrapper
curl -L https://github.com/gradle/gradle/raw/v8.10.2/gradle/wrapper/gradle-wrapper.jar \
  -o android/gradle/wrapper/gradle-wrapper.jar

# Option C — copy from Android Studio's bundled Gradle installation:
# C:\Program Files\Android\Android Studio\gradle\gradle-8.x\...\gradle-wrapper.jar
```

After generating the JAR, `./gradlew` on Linux/macOS or `gradlew.bat` on Windows will work.

### 2 — Install JS dependencies

```bash
npm install
```

### 3 — Configure environment

```bash
cp .env.example .env
# Edit .env — set PAL_API_URL and GEMMA_4_API_KEY (see top of this README)
```

### 4 — Add launcher icons

Android requires launcher icons in `mipmap-*` folders. Generate them from your
brand asset using **Android Studio → Image Asset** or a tool like
[makeappicon.com](https://makeappicon.com). Place the outputs at:

```
android/app/src/main/res/
├── mipmap-mdpi/ic_launcher.png          (48×48)
├── mipmap-hdpi/ic_launcher.png          (72×72)
├── mipmap-xhdpi/ic_launcher.png         (96×96)
├── mipmap-xxhdpi/ic_launcher.png        (144×144)
├── mipmap-xxxhdpi/ic_launcher.png       (192×192)
└── mipmap-anydpi-v26/ic_launcher.xml    (adaptive icon)
```

---

## Build and run

```bash
# Start Metro bundler (keep this terminal open)
npm start

# In a second terminal — build debug APK and install on device/emulator
npm run android

# Or build APK directly with Gradle (from android/ directory):
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk

# Build release AAB for Play Store:
./gradlew bundleRelease
# Output: android/app/build/outputs/bundle/release/app-release.aab
```

---

## Key Gradle files — for the Android team

### `android/build.gradle` (top-level)

Defines SDK versions shared across all modules:

```groovy
ext {
    compileSdkVersion = 35      // Android 15
    minSdkVersion    = 24       // Android 7.0 — 97% of active devices
    targetSdkVersion  = 35
    kotlinVersion     = "1.9.25"
}
```

Android Gradle Plugin: **8.7.2** · Gradle: **8.10.2**

### `android/app/build.gradle` (app-level)

The file your Android team will edit most:
- `applicationId "com.palhealth"` — change for white-label builds
- `versionCode` / `versionName` — bump for each Play Store release
- `signingConfigs` — add your release keystore credentials here
- `splits.abi { enable false }` — set `true` for split APKs on Play Store

### `android/gradle.properties`

Controls the build architecture:

| Property | Value | Notes |
|---|---|---|
| `newArchEnabled` | `true` | **Do not disable** — app is built for RN New Architecture |
| `hermesEnabled` | `true` | Hermes JS engine — faster startup, lower memory |
| `org.gradle.jvmargs` | `-Xmx4096m` | Increase if build runs OOM on low-RAM machines |

### `android/gradle/wrapper/gradle-wrapper.properties`

Pins the Gradle distribution to **8.10.2**. Update `distributionUrl` to upgrade Gradle.

### `android/settings.gradle`

Uses React Native 0.76's **new autolinking system** — `autolinkLibrariesFromCommand()`
automatically wires all native modules from `node_modules/` (document picker, image picker,
async storage, safe area context, etc.). No manual package registration needed.

---

## MDT document upload feature

### What it does

The paperclip button (📎) in the chat search bar opens a picker:

1. **Choose PDF** → `react-native-document-picker`
2. **Take photo** → `react-native-image-picker` (camera)
3. **Choose from gallery** → `react-native-image-picker` (gallery)

Accepted formats: **PDF, JPEG, PNG** — max 20 MB

### Full flow

```
User taps 📎
    ↓
Document/image selected
    ↓
POST /medical/upload  (multipart — file + tenant_id + member_id)
    ↓
PAL backend stores file (SHA-256 content-addressed)
    ↓ (if MDT_ENABLED=true)
MDT container: POST /document_to_fhir  ← Gemma 4 key forwarded here
    ↓
FHIR R4 Bundle returned (Observations with LOINC codes)
    ↓
Backend compares patient name on document vs profile
    ↓
Response: pending_verification JSON
    ↓
VerificationSheet modal shown to user:
  • Name match badge (green / amber / red)
  • Extracted lab values table (LOINC, value, unit, ref range)
  ↓
User taps "Save to my record"
    ↓
POST /medical/confirm  → HealthFact rows saved to database
```

### Android permissions (already in AndroidManifest.xml)

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
    android:maxSdkVersion="32" />
```

These permissions are requested at runtime by `react-native-image-picker` automatically.

### Patient name verification badge

| Badge colour | Status | Meaning |
|---|---|---|
| 🟢 Green | `match` | Name on document matches profile |
| 🟡 Amber | `partial` | Some name tokens match — user should verify |
| 🔴 Red | `no_match` | Names don't match — may be wrong patient |

The user can still save regardless of colour, but the button label changes to
**"Save anyway (this is my document)"** on a red mismatch.

---

## Security invariants (must remain in all builds)

- **All PHI through the phi guard** — the app sends a scope flag; the backend enforces
  consent checks before accessing member records. Raw PHI never sent from client.
- **Default-deny PHI** — no cross-member PHI without a live consent grant.
- **Every PHI cloud hop is audited** — MDT URL is internal-only by default.
- **Confirm-token write gates** — booking/messaging: app proposes in chat; backend
  write gate requires a separate confirm-token before dispatching.
- **Safety triage runs first** — keyword-deterministic check in `fuguRouter.ts` fires
  before any API call. Emergency / crisis → `SafetyBanner` immediately.
- **On-device LLM does triage only** — FuguRouter classifies intent; it never
  generates clinical answers.

---

## Building a release APK / AAB

### 1. Generate signing keystore (one-time)

```bash
keytool -genkey -v -keystore palhealth-release.keystore \
  -alias palhealth -keyalg RSA -keysize 2048 -validity 10000
```

Store the keystore **outside the repo** (never commit it).

### 2. Add signing config to `android/app/build.gradle`

```groovy
signingConfigs {
    release {
        storeFile     file('/path/to/palhealth-release.keystore')
        storePassword 'your_store_password'
        keyAlias      'palhealth'
        keyPassword   'your_key_password'
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        // ...
    }
}
```

### 3. Build

```bash
cd android
./gradlew bundleRelease
# Upload android/app/build/outputs/bundle/release/app-release.aab to Play Console
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `./gradlew: Permission denied` | Run `chmod +x android/gradlew` |
| `SDK location not found` | Create `android/local.properties`: `sdk.dir=C\:\\Users\\you\\AppData\\Local\\Android\\Sdk` |
| `Could not find com.facebook.react:react-android` | Run `npm install` first |
| `NDK not found` | In Android Studio: SDK Manager → SDK Tools → install NDK 27.1.12297006 |
| Metro port conflict | `npm start -- --port 8082` |
| API connection refused on physical device | Set `PAL_API_URL=http://192.168.x.x:8000` (LAN IP, not 10.0.2.2) |
| Gradle OOM | In `gradle.properties`: increase `-Xmx4096m` to `-Xmx6144m` |
| MDT returns empty observations | Check `GEMMA_4_API_KEY` — token may have expired (GCP tokens refresh hourly) |
| MDT connection refused | Run `docker run -p 8080:8080 gcr.io/cloud-medical-data-toolkit/mdt:latest` |
| Image picker camera crash | Ensure `CAMERA` permission was granted at runtime — test on API 29+ device |

---

## Contact

PAL Health Engineering.
Hand the entire `Pal Android claude/` folder to the Android development team.
The `android/` directory can be opened directly in Android Studio as a Gradle project.
