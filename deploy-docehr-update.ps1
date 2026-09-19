# ===================================================================
# PAL Production Deployment - DocEHR MCP Update
# ===================================================================
# This script updates the DocEHR MCP URL on the production server
# and rebuilds the API container.
#
# Server: ubuntu@34.93.245.214
# Key: pal-server.ppk (passphrase: docmode)
# ===================================================================

param(
    [string]$PPKFile = "$env:TEMP\pal-server.ppk",
    [string]$ServerIP = "34.93.245.214",
    [string]$Username = "ubuntu",
    [string]$NewMCPUrl = "https://mcp-doc-ehr.medmode.org"
)

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "PAL Production Deployment - DocEHR MCP Update" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if plink exists
$plinkPath = Get-Command plink -ErrorAction SilentlyContinue
if (-not $plinkPath) {
    Write-Host "ERROR: plink.exe not found!" -ForegroundColor Red
    Write-Host "Please install PuTTY from: https://www.putty.org/" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Alternative: Run these commands manually using PuTTY:" -ForegroundColor Yellow
    Write-Host "1. Open PuTTY and connect to ubuntu@34.93.245.214" -ForegroundColor White
    Write-Host "2. Load the PPK key (Auth > Private key file)" -ForegroundColor White
    Write-Host "3. Enter passphrase: docmode" -ForegroundColor White
    Write-Host "4. Run the following commands:" -ForegroundColor White
    Write-Host ""
    Write-Host @"
cd /home/ubuntu/PAL

# Backup current .env files
cp .env .env.backup-`$(date +%Y%m%d_%H%M%S)
cp .env.production .env.production.backup-`$(date +%Y%m%d_%H%M%S)

# Update .env file
sed -i 's|DOCEHR_MCP_URL=.*|DOCEHR_MCP_URL=https://mcp-doc-ehr.medmode.org|g' .env

# Update .env.production file - add DocEHR config if not present
if ! grep -q "DOCEHR_MCP_URL" .env.production; then
    echo "" >> .env.production
    echo "# DocEHR Integration (External MCP Server)" >> .env.production
    echo "DOCEHR_ENABLED=true" >> .env.production
    echo "DOCEHR_MCP_URL=https://mcp-doc-ehr.medmode.org" >> .env.production
else
    sed -i 's|DOCEHR_MCP_URL=.*|DOCEHR_MCP_URL=https://mcp-doc-ehr.medmode.org|g' .env.production
fi

# Verify changes
echo "=== Checking .env ==="
grep DOCEHR .env

echo ""
echo "=== Checking .env.production ==="
grep DOCEHR .env.production

# Rebuild and restart API container
echo ""
echo "=== Rebuilding API container ==="
docker-compose -f docker-compose.prod.yml build api

echo ""
echo "=== Restarting API container ==="
docker-compose -f docker-compose.prod.yml up -d api

echo ""
echo "=== Checking API container status ==="
docker-compose -f docker-compose.prod.yml ps api

echo ""
echo "=== Checking API logs for MCP-DocEHR ==="
docker-compose -f docker-compose.prod.yml logs --tail=50 api | grep MCP-DocEHR
"@ -ForegroundColor Green
    Write-Host ""
    exit 1
}

Write-Host "Step 1: Connecting to production server..." -ForegroundColor Yellow
Write-Host "Server: $Username@$ServerIP" -ForegroundColor White
Write-Host "Key: $PPKFile" -ForegroundColor White
Write-Host ""

# Create the update script
$updateScript = @"
#!/bin/bash
set -e

echo "====================================================================="
echo "PAL Production Update - DocEHR MCP Endpoint"
echo "====================================================================="
echo ""

cd /home/ubuntu/PAL || { echo "ERROR: PAL directory not found!"; exit 1; }

echo "Step 1: Backing up current .env files..."
cp .env .env.backup-`$(date +%Y%m%d_%H%M%S)
cp .env.production .env.production.backup-`$(date +%Y%m%d_%H%M%S)
echo "✓ Backups created"
echo ""

echo "Step 2: Updating .env file..."
sed -i 's|DOCEHR_MCP_URL=.*|DOCEHR_MCP_URL=$NewMCPUrl|g' .env
echo "✓ .env updated"
echo ""

echo "Step 3: Updating .env.production file..."
if ! grep -q "DOCEHR_MCP_URL" .env.production; then
    echo "" >> .env.production
    echo "# DocEHR Integration (External MCP Server)" >> .env.production
    echo "DOCEHR_ENABLED=true" >> .env.production
    echo "DOCEHR_MCP_URL=$NewMCPUrl" >> .env.production
    echo "✓ DocEHR config added to .env.production"
else
    sed -i 's|DOCEHR_MCP_URL=.*|DOCEHR_MCP_URL=$NewMCPUrl|g' .env.production
    echo "✓ .env.production updated"
fi
echo ""

echo "Step 4: Verifying changes..."
echo "--- .env ---"
grep DOCEHR .env || echo "WARNING: DOCEHR not found in .env"
echo ""
echo "--- .env.production ---"
grep DOCEHR .env.production || echo "WARNING: DOCEHR not found in .env.production"
echo ""

echo "Step 5: Rebuilding API container..."
docker-compose -f docker-compose.prod.yml build api
echo "✓ API container rebuilt"
echo ""

echo "Step 6: Restarting API container..."
docker-compose -f docker-compose.prod.yml up -d api
echo "✓ API container restarted"
echo ""

echo "Step 7: Waiting for container to start (10 seconds)..."
sleep 10
echo ""

echo "Step 8: Checking API container status..."
docker-compose -f docker-compose.prod.yml ps api
echo ""

echo "Step 9: Checking API logs for MCP-DocEHR connection..."
docker-compose -f docker-compose.prod.yml logs --tail=100 api | grep -i "MCP-DocEHR" || echo "No MCP-DocEHR logs yet (container may still be starting)"
echo ""

echo "====================================================================="
echo "✓ Deployment Complete!"
echo "====================================================================="
echo ""
echo "Next steps:"
echo "1. Monitor logs: docker-compose -f docker-compose.prod.yml logs -f api | grep MCP-DocEHR"
echo "2. Test endpoint: curl https://mcp-doc-ehr.medmode.org/tools/list"
echo "3. Verify in Hermes Chat UI"
echo ""
"@

# Save the script to a temp file
$scriptPath = "$env:TEMP\pal-update-docehr.sh"
$updateScript | Out-File -FilePath $scriptPath -Encoding UTF8 -NoNewline

Write-Host "Step 2: Uploading update script to server..." -ForegroundColor Yellow

# Upload the script using pscp
$pscpPath = Get-Command pscp -ErrorAction SilentlyContinue
if (-not $pscpPath) {
    Write-Host "WARNING: pscp.exe not found. Using plink to create script on server..." -ForegroundColor Yellow

    # Create script directly on server using plink
    $scriptContent = $updateScript -replace '"', '\"'
    & plink -i "$PPKFile" -batch "$Username@$ServerIP" "cat > /tmp/pal-update-docehr.sh << 'EOFSCRIPT'`n$updateScript`nEOFSCRIPT`nchmod +x /tmp/pal-update-docehr.sh"
} else {
    & pscp -i "$PPKFile" -batch "$scriptPath" "$Username@$ServerIP:/tmp/pal-update-docehr.sh"
}

Write-Host "✓ Script uploaded" -ForegroundColor Green
Write-Host ""

Write-Host "Step 3: Executing update script on server..." -ForegroundColor Yellow
Write-Host "This will:" -ForegroundColor White
Write-Host "  - Backup .env files" -ForegroundColor White
Write-Host "  - Update DOCEHR_MCP_URL to $NewMCPUrl" -ForegroundColor White
Write-Host "  - Rebuild API container" -ForegroundColor White
Write-Host "  - Restart API container" -ForegroundColor White
Write-Host ""

# Execute the script
& plink -i "$PPKFile" -batch "$Username@$ServerIP" "bash /tmp/pal-update-docehr.sh"

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "Deployment completed!" -ForegroundColor Green
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Verification commands:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Check API logs:" -ForegroundColor White
Write-Host "   plink -i $PPKFile $Username@$ServerIP 'cd PAL && docker-compose -f docker-compose.prod.yml logs -f api | grep MCP-DocEHR'" -ForegroundColor Green
Write-Host ""
Write-Host "2. Test MCP endpoint:" -ForegroundColor White
Write-Host "   curl https://mcp-doc-ehr.medmode.org/tools/list" -ForegroundColor Green
Write-Host ""
Write-Host "3. Check container status:" -ForegroundColor White
Write-Host "   plink -i $PPKFile $Username@$ServerIP 'cd PAL && docker-compose -f docker-compose.prod.yml ps'" -ForegroundColor Green
Write-Host ""

# Cleanup
Remove-Item -Path $scriptPath -Force -ErrorAction SilentlyContinue
