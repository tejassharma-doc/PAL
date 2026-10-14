@echo off
rem ============================================================================
rem  PAL Android - step 3: build installable APKs.
rem    dist\PAL-release.apk  -> talks to https://palcare.life/api (share this one)
rem    dist\PAL-debug.apk    -> talks to your PC at 10.0.2.2:8001, needs Metro
rem  Add  install  to also install the release APK on the connected device:
rem    windows\3-build-apk.bat install
rem ============================================================================
setlocal
cd /d "%~dp0.."
call windows\_env.bat

if not exist node_modules (
  echo [!] node_modules missing - running npm ci first
  call npm ci --no-audit --no-fund || exit /b 1
)

pushd android
call gradlew.bat assembleRelease assembleDebug --stacktrace
if errorlevel 1 (
  popd
  echo.
  echo ===== BUILD FAILED - copy the first "What went wrong" block and send it to Claude =====
  exit /b 1
)
popd

if not exist dist mkdir dist
copy /y android\app\build\outputs\apk\release\app-release.apk dist\PAL-release.apk >nul
copy /y android\app\build\outputs\apk\debug\app-debug.apk dist\PAL-debug.apk >nul
echo.
echo ===== BUILT =====
echo   %CD%\dist\PAL-release.apk
echo   %CD%\dist\PAL-debug.apk

if /i "%1"=="install" (
  adb install -r dist\PAL-release.apk
)
exit /b 0
