@echo off
rem ============================================================================
rem  PAL Android - step 1: check this PC, install packages, run all tests.
rem  Double-click, or run from a terminal:   mobile\windows\1-setup-and-test.bat
rem ============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0.."
call windows\_env.bat
set FAILED=0

echo.
echo ===== 1/5  Checking tools =====
where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  goto :fail
)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if !NODE_MAJOR! LSS 18 (
  echo [X] Node.js !NODE_MAJOR! is too old. Install Node 20 or 22 LTS.
  goto :fail
)
echo [OK] Node.js major version !NODE_MAJOR!

if "%JAVA_HOME%"=="" (
  echo [X] No Java found. Install Android Studio ^(it includes Java^) or set JAVA_HOME to a JDK 17.
  goto :fail
)
"%JAVA_HOME%\bin\java" -version >nul 2>nul || (echo [X] JAVA_HOME is set but java does not run: %JAVA_HOME% & goto :fail)
echo [OK] Java at %JAVA_HOME%

if "%ANDROID_HOME%"=="" (
  echo [X] Android SDK not found. Open Android Studio once and finish its setup wizard
  echo     ^(it installs the SDK to %%LOCALAPPDATA%%\Android\Sdk^), then run this again.
  goto :fail
)
echo [OK] Android SDK at %ANDROID_HOME%
if not exist "%ANDROID_HOME%\platforms\android-35" echo [!] Android 15 ^(API 35^) SDK Platform is missing - install it in Android Studio: Settings ^> Languages ^& Frameworks ^> Android SDK.
if not exist "%ANDROID_HOME%\build-tools\35.0.0" echo [!] Build-Tools 35.0.0 is missing - install it in the SDK Tools tab ^(tick "Show Package Details"^).
if not exist "%ANDROID_HOME%\ndk\26.1.10909125" echo [!] NDK 26.1.10909125 is missing - Gradle will try to download it; or install it in SDK Tools ^> NDK ^(Side by side^).

rem Tell Gradle where the SDK is (Android Studio also writes this file).
set "SDKDIR=%ANDROID_HOME:\=\\%"
set "SDKDIR=!SDKDIR::=\:!"
> android\local.properties echo sdk.dir=!SDKDIR!
echo [OK] wrote android\local.properties

echo.
echo ===== 2/5  Installing JavaScript packages (npm ci) =====
call npm ci --no-audit --no-fund || goto :fail

echo.
echo ===== 3/5  Type check =====
call npx tsc --noEmit || set FAILED=1

echo.
echo ===== 4/5  Unit tests =====
call npx jest --ci || set FAILED=1

echo.
echo ===== 5/5  End-to-end tests against a PAL server =====
if "%PAL_TEST_API%"=="" (
  echo [skip] Set PAL_TEST_API to run them, e.g.:
  echo        set PAL_TEST_API=http://localhost:8001
  echo        windows\1-setup-and-test.bat
  echo        ^(needs a TEST server with the test account seeded - never production^)
) else (
  call npx jest __tests__/integration --runInBand --ci || set FAILED=1
)

echo.
if "%FAILED%"=="1" goto :fail
echo ===== ALL CHECKS PASSED - next: windows\2-run-on-device.bat or windows\3-build-apk.bat =====
exit /b 0

:fail
echo.
echo ===== SOMETHING FAILED - scroll up for the first [X] or error =====
exit /b 1
