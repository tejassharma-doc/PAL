@echo off
REM ===================================================================
REM PAL Production Deployment - DocEHR MCP Update
REM ===================================================================
REM
REM This batch file will connect to the production server and
REM execute the deployment commands.
REM
REM Server: ubuntu@34.93.245.214
REM Passphrase: docmode (will be prompted)
REM ===================================================================

echo.
echo ===================================================================
echo PAL Production Deployment - DocEHR MCP Update
echo ===================================================================
echo.
echo Server: ubuntu@34.93.245.214
echo Using PuTTY plink for connection
echo.
echo NOTE: You will be prompted for the PPK passphrase: docmode
echo.
pause

REM Set variables
set SERVER=ubuntu@34.93.245.214
set PPK_FILE=%TEMP%\pal-server.ppk
set NEW_URL=https://mcp-doc-ehr.medmode.org

REM Check if PPK file exists
if not exist "%PPK_FILE%" (
    echo ERROR: PPK file not found at %PPK_FILE%
    echo Please run the main PowerShell script first to create the PPK file.
    pause
    exit /b 1
)

echo.
echo Step 1: Backing up current configuration...
echo.

plink -i "%PPK_FILE%" %SERVER% "cd /home/ubuntu/PAL && cp .env .env.backup-$(date +%%Y%%m%%d_%%H%%M%%S) && cp .env.production .env.production.backup-$(date +%%Y%%m%%d_%%H%%M%%S) && ls -la .env*.backup* | tail -2"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Failed to backup files
    echo Please check your connection and try again
    pause
    exit /b 1
)

echo.
echo Step 2: Updating .env file...
echo.

plink -i "%PPK_FILE%" %SERVER% "cd /home/ubuntu/PAL && sed -i 's|DOCEHR_MCP_URL=.*|DOCEHR_MCP_URL=%NEW_URL%|g' .env && echo '=== Updated .env ===' && grep DOCEHR .env"

echo.
echo Step 3: Updating .env.production file...
echo.

plink -i "%PPK_FILE%" %SERVER% "cd /home/ubuntu/PAL && if ! grep -q 'DOCEHR_MCP_URL' .env.production; then echo '' >> .env.production && echo '# DocEHR Integration (External MCP Server)' >> .env.production && echo 'DOCEHR_ENABLED=true' >> .env.production && echo 'DOCEHR_MCP_URL=%NEW_URL%' >> .env.production; else sed -i 's|DOCEHR_MCP_URL=.*|DOCEHR_MCP_URL=%NEW_URL%|g' .env.production; fi && echo '=== Updated .env.production ===' && grep -A 2 'DocEHR Integration' .env.production"

echo.
echo Step 4: Rebuilding API container...
echo.

plink -i "%PPK_FILE%" %SERVER% "cd /home/ubuntu/PAL && docker-compose -f docker-compose.prod.yml build api"

echo.
echo Step 5: Restarting API container...
echo.

plink -i "%PPK_FILE%" %SERVER% "cd /home/ubuntu/PAL && docker-compose -f docker-compose.prod.yml up -d api"

echo.
echo Step 6: Waiting for container to start (10 seconds)...
timeout /t 10 /nobreak

echo.
echo Step 7: Verifying deployment...
echo.

plink -i "%PPK_FILE%" %SERVER% "cd /home/ubuntu/PAL && echo '=== Container Status ===' && docker-compose -f docker-compose.prod.yml ps api && echo '' && echo '=== MCP-DocEHR Logs ===' && docker-compose -f docker-compose.prod.yml logs --tail=50 api | grep -i MCP-DocEHR && echo '' && echo '=== Environment Variables ===' && docker exec -it pal-prod-api env | grep DOCEHR"

echo.
echo ===================================================================
echo Deployment Complete!
echo ===================================================================
echo.
echo Please verify:
echo 1. Container status shows "Up"
echo 2. Logs show "External MCP enabled: https://mcp-doc-ehr.medmode.org"
echo 3. No error messages
echo.
echo Test the endpoint:
echo curl https://mcp-doc-ehr.medmode.org/tools/list
echo.
pause
