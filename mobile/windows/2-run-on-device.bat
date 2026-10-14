@echo off
rem ============================================================================
rem  PAL Android - step 2: run the DEBUG app on an emulator or a USB phone.
rem  Start an emulator in Android Studio (Device Manager > Play) or plug in a
rem  phone with USB debugging on, then run this.
rem  Debug builds talk to http://10.0.2.2:8001 (docker-compose API on your PC) - see src\config.ts.
rem ============================================================================
setlocal
cd /d "%~dp0.."
call windows\_env.bat

adb devices | findstr /c:"	device" >nul
if errorlevel 1 (
  echo [X] No emulator or phone found. Start one in Android Studio ^(Device Manager^), or
  echo     plug in your phone and allow USB debugging, then run this again.
  adb devices
  exit /b 1
)

rem Make localhost:8001 on the PC reachable from a USB phone as well.
adb reverse tcp:8001 tcp:8001 >nul 2>nul
adb reverse tcp:8081 tcp:8081 >nul 2>nul

echo Starting Metro (JavaScript server) in a new window...
start "PAL Metro" cmd /k "npx react-native start"
timeout /t 5 >nul
call npx react-native run-android --no-packager
