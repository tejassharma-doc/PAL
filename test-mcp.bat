@echo off
color 0A
title PAL MCP API - Quick Test

echo ========================================
echo   PAL MCP API - Quick Test
echo ========================================
echo.

:menu
echo.
echo Please select a test:
echo.
echo 1. Health Check (No auth)
echo 2. Search Patient by Phone
echo 3. Get Patient Details
echo 4. Get Complete Records (All-in-One)
echo 5. Get Latest Prescription
echo 6. Get Lab Tests
echo 7. List Appointments
echo 8. Push Vitals (POST test)
echo 9. Run ALL Tests
echo 0. Exit
echo.
set /p choice="Enter your choice (0-9): "

if "%choice%"=="0" goto end
if "%choice%"=="1" goto health
if "%choice%"=="2" goto search
if "%choice%"=="3" goto details
if "%choice%"=="4" goto records
if "%choice%"=="5" goto prescription
if "%choice%"=="6" goto labs
if "%choice%"=="7" goto appointments
if "%choice%"=="8" goto vitals
if "%choice%"=="9" goto all

echo Invalid choice. Please try again.
goto menu

:health
echo.
echo ========================================
echo Testing: Health Check
echo ========================================
curl -s http://localhost:3001/health
echo.
echo.
pause
goto menu

:search
echo.
echo ========================================
echo Testing: Search Patient by Phone
echo ========================================
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients?phone=%%2B917892828182"
echo.
echo.
pause
goto menu

:details
echo.
echo ========================================
echo Testing: Get Patient Details
echo ========================================
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"
echo.
echo.
pause
goto menu

:records
echo.
echo ========================================
echo Testing: Get Complete Records
echo (Patient + Appointments + Prescriptions + Lab Tests)
echo ========================================
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/records"
echo.
echo.
pause
goto menu

:prescription
echo.
echo ========================================
echo Testing: Get Latest Prescription with SOAP Notes
echo ========================================
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/prescriptions/latest"
echo.
echo.
pause
goto menu

:labs
echo.
echo ========================================
echo Testing: Get Lab Tests
echo ========================================
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/lab-tests"
echo.
echo.
pause
goto menu

:appointments
echo.
echo ========================================
echo Testing: List Appointments
echo ========================================
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/appointments?patientId=5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"
echo.
echo.
pause
goto menu

:vitals
echo.
echo ========================================
echo Testing: Push Vitals (POST Request)
echo ========================================
curl -s -X POST -H "X-API-Key: pal-secret-key-12345" -H "Content-Type: application/json" -d "{\"heightCm\":175,\"weightKg\":72,\"bpSystolic\":120,\"bpDiastolic\":80,\"pulseRate\":75,\"temperature\":98.6}" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/vitals"
echo.
echo.
pause
goto menu

:all
echo.
echo ========================================
echo Running ALL Tests
echo ========================================
echo.

echo [1/8] Health Check...
curl -s http://localhost:3001/health
echo.
echo.
timeout /t 1 >nul

echo [2/8] Search Patient...
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients?phone=%%2B917892828182"
echo.
echo.
timeout /t 1 >nul

echo [3/8] Get Patient Details...
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"
echo.
echo.
timeout /t 1 >nul

echo [4/8] Get Complete Records...
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/records"
echo.
echo.
timeout /t 1 >nul

echo [5/8] Get Latest Prescription...
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/prescriptions/latest"
echo.
echo.
timeout /t 1 >nul

echo [6/8] Get Lab Tests...
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/lab-tests"
echo.
echo.
timeout /t 1 >nul

echo [7/8] List Appointments...
curl -s -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/appointments?patientId=5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"
echo.
echo.
timeout /t 1 >nul

echo [8/8] Push Vitals...
curl -s -X POST -H "X-API-Key: pal-secret-key-12345" -H "Content-Type: application/json" -d "{\"heightCm\":175,\"weightKg\":72,\"bpSystolic\":120,\"bpDiastolic\":80,\"pulseRate\":75,\"temperature\":98.6}" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/vitals"
echo.
echo.

echo ========================================
echo All tests completed!
echo ========================================
echo.
pause
goto menu

:end
echo.
echo Exiting... Goodbye!
timeout /t 1 >nul
exit
