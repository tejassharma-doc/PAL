@echo off
color 0A
echo ========================================
echo   Starting PAL with Hermes AI
echo ========================================
echo.
echo Services:
echo - PostgreSQL Database (Port 5432)
echo - Redis Cache (Port 6379)
echo - FastAPI Backend (Port 8000) + Hermes AI
echo - Next.js Frontend (Port 3000)
echo - MCP API Server (Port 3001)
echo.
echo Please wait...
echo.

docker-compose up -d --build

echo.
echo ========================================
echo Waiting for services to start...
echo ========================================
timeout /t 10 >nul

docker-compose ps

echo.
echo ========================================
echo Testing Hermes AI...
echo ========================================
echo.

curl -s http://localhost:8000/hermes/health

echo.
echo.
echo ========================================
echo PAL with Hermes AI Started!
echo ========================================
echo.
echo Access points:
echo - Web App:        http://localhost:3000
echo - FastAPI:        http://localhost:8000
echo - MCP API:        http://localhost:3001
echo - Hermes Health:  http://localhost:8000/hermes/health
echo.
echo Try asking in the Ask tab:
echo - "What are my lab results?"
echo - "What medications am I taking?"
echo - "When was my last appointment?"
echo.
pause
