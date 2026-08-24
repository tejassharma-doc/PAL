#!/bin/bash
# PAL Production Deployment - Single Command
# DocEHR MCP URL Update: http://34.14.174.212:8001 → https://mcp-doc-ehr.medmode.org

set -e  # Exit on error

echo "======================================================================"
echo "PAL Production Deployment - DocEHR MCP Update"
echo "======================================================================"
echo ""

# Navigate to PAL directory
cd /home/ubuntu/PAL || { echo "ERROR: PAL directory not found"; exit 1; }
echo "✓ In directory: $(pwd)"
echo ""

# Step 1: Backup
echo "Step 1: Creating backups..."
cp .env .env.backup-$(date +%Y%m%d_%H%M%S)
cp .env.production .env.production.backup-$(date +%Y%m%d_%H%M%S)
echo "✓ Backups created"
echo ""

# Step 2: Update .env
echo "Step 2: Updating .env..."
sed -i 's|DOCEHR_MCP_URL=.*|DOCEHR_MCP_URL=https://mcp-doc-ehr.medmode.org|g' .env
echo "✓ .env updated"
echo ""

# Step 3: Update .env.production
echo "Step 3: Updating .env.production..."
if ! grep -q "DOCEHR_MCP_URL" .env.production; then
    echo "" >> .env.production
    echo "# DocEHR Integration (External MCP Server)" >> .env.production
    echo "DOCEHR_ENABLED=true" >> .env.production
    echo "DOCEHR_MCP_URL=https://mcp-doc-ehr.medmode.org" >> .env.production
    echo "✓ Added DOCEHR configuration"
else
    sed -i 's|DOCEHR_MCP_URL=.*|DOCEHR_MCP_URL=https://mcp-doc-ehr.medmode.org|g' .env.production
    echo "✓ Updated DOCEHR_MCP_URL"
fi
echo ""

# Verify changes
echo "=== Verification ==="
echo "--- .env ---"
grep DOCEHR .env | head -4
echo ""
echo "--- .env.production ---"
grep -A 2 "DocEHR Integration" .env.production
echo ""

# Step 4: Rebuild API
echo "Step 4: Rebuilding API container..."
docker-compose -f docker-compose.prod.yml build api
echo "✓ Build complete"
echo ""

# Step 5: Restart API
echo "Step 5: Restarting API container..."
docker-compose -f docker-compose.prod.yml up -d api
echo "✓ Container restarted"
echo ""

# Step 6: Wait and verify
echo "Step 6: Waiting for container to start (10 seconds)..."
sleep 10
echo ""

echo "=== Deployment Complete ==="
echo ""

# Final verification
echo "Container Status:"
docker-compose -f docker-compose.prod.yml ps api
echo ""

echo "MCP-DocEHR Logs (last 10 lines):"
docker-compose -f docker-compose.prod.yml logs --tail=100 api | grep -i "MCP-DocEHR" | tail -10 || echo "No MCP-DocEHR logs yet (may still be starting)"
echo ""

echo "Environment Variables:"
docker exec pal-prod-api env | grep DOCEHR
echo ""

echo "======================================================================"
echo "✅ Deployment Complete!"
echo "======================================================================"
echo ""
echo "Next: Test in Hermes Chat at https://pal-agent.medmode.org"
echo ""
