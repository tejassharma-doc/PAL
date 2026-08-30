#!/bin/bash
# Force Fresh Deployment Script
# Ensures no Docker cache is used and new code is deployed

set -e

echo "=========================================="
echo "🔄 PAL Fresh Deployment"
echo "This will force rebuild without cache"
echo "=========================================="
echo ""

# Check if in correct directory
if [ ! -f "docker-compose.prod.yml" ]; then
    echo "❌ Error: Run this from /data/apps/docmode/PAL directory"
    exit 1
fi

# Confirmation
read -p "This will rebuild all containers. Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Step 1: Pulling latest code from git..."
git pull origin main || {
    echo "⚠️  Git pull failed, continuing with local code..."
}
echo "✅ Code updated"
echo ""

echo "Step 2: Stopping all containers..."
docker-compose -f docker-compose.prod.yml down
echo "✅ Containers stopped"
echo ""

echo "Step 3: Removing old images (local only)..."
docker-compose -f docker-compose.prod.yml down --rmi local || {
    echo "⚠️  Some images couldn't be removed (may be in use)"
}
echo "✅ Old images removed"
echo ""

echo "Step 4: Building fresh images (NO CACHE)..."
echo "This may take 5-10 minutes..."
docker-compose -f docker-compose.prod.yml build --no-cache --pull
echo "✅ Fresh images built"
echo ""

echo "Step 5: Starting containers..."
docker-compose -f docker-compose.prod.yml up -d
echo "✅ Containers started"
echo ""

echo "Step 6: Waiting for services to start (15 seconds)..."
sleep 15
echo ""

echo "=========================================="
echo "✅ Fresh Deployment Complete!"
echo "=========================================="
echo ""

echo "📊 Container Status:"
docker-compose -f docker-compose.prod.yml ps
echo ""

echo "🔍 Image Build Times (should be recent):"
docker images | grep pal-prod | head -5
echo ""

echo "🧪 Verification Commands:"
echo ""
echo "# 1. Check environment variables:"
echo "docker exec pal-prod-api env | grep OPENAI_API_BASE"
echo ""
echo "# 2. Check container logs:"
echo "docker logs pal-prod-api --tail 50"
echo ""
echo "# 3. Test Hermes endpoint:"
echo "curl http://localhost:8001/health"
echo ""

echo "Running automatic verification..."
echo ""

echo "Environment Variables:"
docker exec pal-prod-api env | grep -E 'OPENAI_API_BASE|GEMINI_MODEL' || echo "⚠️  Not set"
echo ""

echo "API Health Check:"
sleep 5  # Give API a moment to fully start
if curl -s -f -m 5 http://localhost:8001/health > /dev/null 2>&1; then
    echo "✅ API is responding"
else
    echo "⚠️  API not responding yet (may still be starting)"
fi
echo ""

echo "📝 Recent API logs:"
docker logs pal-prod-api --tail 10
echo ""

echo "=========================================="
echo "🎉 Deployment Finished!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Test Hermes chat: curl http://localhost:8001/hermes/chat"
echo "2. Open UI: http://palcare.life"
echo "3. Monitor logs: docker logs -f pal-prod-api"
echo ""
