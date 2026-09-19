#!/bin/bash
# Update LiteLLM IP and Restart API
# New IP: 8.231.119.9

set -e

echo "=========================================="
echo "LiteLLM IP Update Script"
echo "Old IP: 34.14.174.141"
echo "New IP: 8.231.119.9"
echo "=========================================="
echo ""

# Check if in correct directory
if [ ! -f "docker-compose.prod.yml" ]; then
    echo "❌ Error: Run this from /data/apps/docmode/PAL directory"
    exit 1
fi

echo "Step 1: Pulling latest code from git..."
git pull origin main || {
    echo "⚠️  Git pull failed, continuing anyway..."
}
echo ""

echo "Step 2: Verifying .env.production has new IP..."
if grep -q "8.231.119.9" .env.production; then
    echo "✅ .env.production contains new IP"
else
    echo "❌ .env.production does NOT contain new IP"
    echo "   Expected: OPENAI_API_BASE=http://8.231.119.9:4000/v1"
    exit 1
fi
echo ""

echo "Step 3: Restarting API container..."
docker-compose -f docker-compose.prod.yml restart api
echo "✅ API container restarted"
echo ""

echo "Step 4: Waiting for container to start (10 seconds)..."
sleep 10
echo ""

echo "Step 5: Verifying environment variables..."
echo "OPENAI_API_BASE:"
docker exec pal-prod-api env | grep OPENAI_API_BASE || echo "❌ NOT SET"
echo ""
echo "HINDSIGHT_API_BASE:"
docker exec pal-prod-api env | grep HINDSIGHT_API_BASE || echo "❌ NOT SET"
echo ""

echo "Step 6: Testing new LiteLLM server connectivity..."
if curl -s -f -m 5 http://8.231.119.9:4000/health > /dev/null 2>&1; then
    echo "✅ LiteLLM server at 8.231.119.9 is reachable"
    echo "   UI: http://8.231.119.9:4000/ui"
else
    echo "❌ LiteLLM server at 8.231.119.9 is NOT reachable"
    echo "   Check if server is running"
fi
echo ""

echo "Step 7: Checking API logs for errors..."
echo "Recent logs:"
docker logs pal-prod-api --tail 20
echo ""

echo "=========================================="
echo "✅ Update Complete!"
echo "=========================================="
echo ""
echo "LiteLLM Server:"
echo "  IP: 8.231.119.9"
echo "  API: http://8.231.119.9:4000/v1"
echo "  UI: http://8.231.119.9:4000/ui"
echo ""
echo "🧪 Test Hermes chat:"
echo "  curl -X POST http://localhost:8001/hermes/chat \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"query\":\"Hello\",\"patient_id\":\"00000000-0000-0000-0000-000000000001\"}'"
echo ""
echo "📊 Monitor logs:"
echo "  docker logs -f pal-prod-api"
echo ""
