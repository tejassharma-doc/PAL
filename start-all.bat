@echo off
echo ========================================
echo Starting PAL Health Platform
echo ========================================
echo.
echo Services starting:
echo - PostgreSQL Database (Port 5432)
echo - Redis Cache (Port 6379)
echo - FastAPI Backend (Port 8000)
echo - Next.js Frontend (Port 3000)
echo - MCP API Server (Port 3001)
echo.
echo Please wait...
echo.

docker-compose up -d

echo.
echo ========================================
echo Checking service status...
echo ========================================
timeout /t 5 >nul

docker-compose ps

echo.
echo ========================================
echo PAL Platform Started!
echo ========================================
echo.
echo Access points:
echo - Web App:     http://localhost:3000
echo - FastAPI:     http://localhost:8000
echo - MCP API:     http://localhost:3001
echo - Database:    localhost:5432
echo.
echo To view logs: docker-compose logs -f
echo To stop:      docker-compose down
echo.
pause
