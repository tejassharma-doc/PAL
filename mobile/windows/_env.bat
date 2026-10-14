@echo off
rem Shared environment for the PAL build scripts. Called by the numbered scripts.

rem --- Android SDK (Android Studio's default location) ---
if "%ANDROID_HOME%"=="" if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if "%ANDROID_SDK_ROOT%"=="" set "ANDROID_SDK_ROOT=%ANDROID_HOME%"

rem --- Java: use Android Studio's bundled JDK when JAVA_HOME is not set ---
if "%JAVA_HOME%"=="" if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
if "%JAVA_HOME%"=="" if exist "%LOCALAPPDATA%\Programs\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=%LOCALAPPDATA%\Programs\Android Studio\jbr"

if not "%JAVA_HOME%"=="" set "PATH=%JAVA_HOME%\bin;%PATH%"
if not "%ANDROID_HOME%"=="" set "PATH=%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%PATH%"
exit /b 0
