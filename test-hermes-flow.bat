@echo off
color 0A
title Test Hermes AI Flow

echo ========================================
echo   Testing Hermes AI Complete Flow
echo ========================================
echo.
echo Flow:
echo User Question -> FastAPI -> MCP Server -> Vertex AI -> Response
echo.
pause

echo.
echo ========================================
echo Step 1: Check Hermes Health
echo ========================================
curl -s http://localhost:8000/hermes/health
echo.
echo.
pause

echo ========================================
echo Step 2: Test MCP Server
echo ========================================
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/records" | head -100
echo.
echo.
pause

echo ========================================
echo Step 3: Test Hermes Chat (No Auth)
echo ========================================
echo Testing with patient data...
curl -X POST http://localhost:8000/hermes/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"What are my recent lab results?\",\"patient_id\":\"5e44a95d-d09c-4f46-b92c-9bc4c08ecdae\"}"
echo.
echo.
pause

echo ========================================
echo Step 4: Check Logs
echo ========================================
echo.
echo FastAPI logs:
docker-compose logs --tail=20 api
echo.
echo.
pause

echo ========================================
echo All Tests Complete!
echo ========================================
echo.
echo Next: Open http://localhost:3000
echo Login and try the Ask tab!
echo.
pause
