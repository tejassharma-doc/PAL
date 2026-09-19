@echo off
echo ========================================
echo Testing Anthropic API Key and Model
echo ========================================
echo.

cd /d "%~dp0"

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python from https://www.python.org/
    pause
    exit /b 1
)

REM Install required package if needed
echo Checking dependencies...
pip show anthropic >nul 2>&1
if errorlevel 1 (
    echo Installing anthropic package...
    pip install anthropic python-dotenv
)

echo.
echo Running API test...
echo.

REM Run the test script
python test-api-key.py

echo.
pause
