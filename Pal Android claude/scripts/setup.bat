@echo off
REM PAL Health Android — first-time setup script (Windows)
REM Run from the project root: scripts\setup.bat
REM
REM What this script does:
REM   1. Downloads gradle-wrapper.jar (required for ./gradlew commands)
REM   2. Generates PNG launcher icons for API 24-25 devices (requires Python + Pillow)

setlocal EnableDelayedExpansion
set "PROJECT_ROOT=%~dp0.."
set "WRAPPER_DIR=%PROJECT_ROOT%\android\gradle\wrapper"
set "WRAPPER_JAR=%WRAPPER_DIR%\gradle-wrapper.jar"

echo.
echo ========================================
echo  PAL Health Android — setup
echo ========================================
echo.

REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 1 — gradle-wrapper.jar
REM ──────────────────────────────────────────────────────────────────────────────

if exist "%WRAPPER_JAR%" (
    echo [OK] gradle-wrapper.jar already exists. Skipping download.
) else (
    echo [1/2] Downloading gradle-wrapper.jar ...

    REM Try Method A: use locally installed Gradle
    where gradle >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo      Gradle found — running 'gradle wrapper' ...
        pushd "%PROJECT_ROOT%\android"
        gradle wrapper --gradle-version 8.10.2 --distribution-type all
        popd
        if exist "%WRAPPER_JAR%" (
            echo [OK] gradle-wrapper.jar generated via local Gradle.
        ) else (
            echo      Local Gradle failed — falling back to download.
            goto :download_jar
        )
    ) else (
        echo      Gradle not installed — downloading JAR directly.
        goto :download_jar
    )
    goto :icons
)
goto :icons

:download_jar
REM Method B: download from the React Native template on GitHub
REM This is the canonical wrapper JAR used by every RN project.
set "JAR_URL=https://raw.githubusercontent.com/facebook/react-native/main/template/android/gradle/wrapper/gradle-wrapper.jar"

powershell -NoProfile -Command ^
    "$ProgressPreference='SilentlyContinue'; " ^
    "try { " ^
    "  Invoke-WebRequest -Uri '%JAR_URL%' -OutFile '%WRAPPER_JAR%' -UseBasicParsing; " ^
    "  Write-Host '[OK] gradle-wrapper.jar downloaded.' " ^
    "} catch { " ^
    "  Write-Host '[ERROR] Download failed: ' + $_.Exception.Message; " ^
    "  exit 1 " ^
    "}"

if not exist "%WRAPPER_JAR%" (
    echo.
    echo [ERROR] Could not download gradle-wrapper.jar automatically.
    echo.
    echo Manual options:
    echo   Option A ^(if Gradle is installed^):
    echo     cd android
    echo     gradle wrapper --gradle-version 8.10.2 --distribution-type all
    echo.
    echo   Option B ^(curl — Windows 10+^):
    echo     curl -L %JAR_URL% -o android\gradle\wrapper\gradle-wrapper.jar
    echo.
    echo   Option C: copy from Android Studio bundled Gradle:
    echo     Look in C:\Program Files\Android\Android Studio\gradle\
    echo.
)

:icons
REM ──────────────────────────────────────────────────────────────────────────────
REM STEP 2 — PNG launcher icons (API 24-25 fallbacks)
REM ──────────────────────────────────────────────────────────────────────────────

echo.
echo [2/2] Generating PNG launcher icons for API 24-25 devices ...

where python >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    where python3 >nul 2>&1
)

if !ERRORLEVEL! EQU 0 (
    python "%PROJECT_ROOT%\scripts\generate_icons.py"
    if !ERRORLEVEL! NEQ 0 (
        echo      Pillow not installed. Running: pip install Pillow ...
        pip install Pillow --quiet
        python "%PROJECT_ROOT%\scripts\generate_icons.py"
    )
) else (
    echo      Python not found. Skipping PNG icon generation.
    echo      API 26+ icons are already in mipmap-anydpi-v26/ and will work fine.
    echo      To generate API 24-25 fallbacks later:
    echo        pip install Pillow
    echo        python scripts\generate_icons.py
)

echo.
echo ========================================
echo  Setup complete.
echo.
echo  Next steps:
echo    1. npm install
echo    2. cp .env.example .env  ^(fill in PAL_API_URL^)
echo    3. npm run android
echo ========================================
echo.
