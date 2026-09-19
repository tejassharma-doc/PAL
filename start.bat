@echo off
echo ================================
echo PAL Health Platform - Quick Start
echo ================================
echo.

echo Checking Docker...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker is not installed or not running!
    echo Please install Docker Desktop and try again.
    pause
    exit /b 1
)

echo Docker is running!
echo.

echo Starting services...
docker-compose up -d

if %errorlevel% equ 0 (
    echo.
    echo ================================
    echo SUCCESS! Services are starting...
    echo ================================
    echo.
    echo Please wait 30 seconds for all services to start, then access:
    echo.
    echo   Website:     http://localhost
    echo   API Docs:    http://localhost/api/docs
    echo   Frontend:    http://localhost:3000
    echo   Backend:     http://localhost:8000/docs
    echo.
    echo To view logs:        docker-compose logs -f
    echo To stop services:    docker-compose down
    echo.

    timeout /t 5 >nul
    echo Opening website in browser...
    start http://localhost
) else (
    echo.
    echo ERROR: Failed to start services!
    echo Check the logs with: docker-compose logs
)

pause
