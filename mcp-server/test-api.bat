@echo off
echo Testing PAL MCP API...
echo.

echo 1. Health Check:
curl -s http://localhost:3001/health
echo.
echo.

echo 2. Search Patient by Phone:
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients?phone=%%2B917892828182"
echo.
echo.

echo 3. Get Patient Details:
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"
echo.
echo.

echo 4. Get Patient Records:
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/records"
echo.
echo.

echo 5. Get Latest Prescription:
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/prescriptions/latest"
echo.
echo.

echo Tests complete!
pause
