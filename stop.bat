@echo off
echo ================================
echo PAL Health Platform - Stopping
echo ================================
echo.

echo Stopping all services...
docker-compose down

if %errorlevel% equ 0 (
    echo.
    echo Services stopped successfully!
) else (
    echo.
    echo ERROR: Failed to stop services!
)

echo.
pause
