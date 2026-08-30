#!/bin/bash
# Diagnose Backend 500 Error

echo "=========================================="
echo "🔍 Diagnosing Backend 500 Error"
echo "=========================================="
echo ""

cd /data/apps/docmode/PAL 2>/dev/null || cd .

echo "Step 1: Checking if API container is running..."
if docker ps | grep -q pal-prod-api; then
    echo "✅ API container is running"
else
    echo "❌ API container is NOT running!"
    echo "Start it with: docker-compose -f docker-compose.prod.yml up -d"
    exit 1
fi
echo ""

echo "Step 2: Checking environment variables in container..."
echo "OPENAI_API_BASE:"
docker exec pal-prod-api env | grep OPENAI_API_BASE || echo "❌ NOT SET"
echo "OPENAI_API_KEY:"
docker exec pal-prod-api env | grep OPENAI_API_KEY | sed 's/=.*/=***/' || echo "❌ NOT SET"
echo "GEMINI_MODEL:"
docker exec pal-prod-api env | grep GEMINI_MODEL || echo "❌ NOT SET"
echo ""

echo "Step 3: Getting LAST ERROR from API logs..."
echo "=========================================="
docker logs pal-prod-api --tail 500 | grep -A 30 "hermes/chat.*500" | tail -50
echo "=========================================="
echo ""

echo "Step 4: Getting ACTUAL EXCEPTION from logs..."
echo "=========================================="
docker logs pal-prod-api --tail 500 | grep -B 5 -A 20 "Exception\|ERROR\|Traceback" | tail -50
echo "=========================================="
echo ""

echo "Step 5: Testing LiteLLM server connectivity..."
LITELLM_URL=$(docker exec pal-prod-api env | grep OPENAI_API_BASE | cut -d= -f2 | sed 's|/v1||')
if [ -n "$LITELLM_URL" ]; then
    echo "Testing: $LITELLM_URL/health"
    if curl -s -f -m 5 "$LITELLM_URL/health" 2>&1; then
        echo ""
        echo "✅ LiteLLM server is reachable"
    else
        echo ""
        echo "❌ LiteLLM server is NOT reachable at $LITELLM_URL"
    fi
else
    echo "❌ OPENAI_API_BASE not set in container"
fi
echo ""

echo "Step 6: Testing models endpoint..."
if [ -n "$LITELLM_URL" ]; then
    echo "Testing: $LITELLM_URL/v1/models"
    curl -s -m 10 "$LITELLM_URL/v1/models" | python3 -m json.tool 2>/dev/null || echo "❌ Cannot fetch models"
fi
echo ""

echo "Step 7: Checking when container was last started..."
docker ps --format "{{.Names}}\t{{.Status}}" | grep pal-prod-api
echo ""

echo "Step 8: Checking image build time..."
docker images | grep pal-prod-api
echo ""

echo "=========================================="
echo "📋 DIAGNOSIS SUMMARY"
echo "=========================================="
echo ""

# Check if env vars are correct
ENV_CHECK=$(docker exec pal-prod-api env | grep OPENAI_API_BASE | grep "8.231.119.9")
if [ -n "$ENV_CHECK" ]; then
    echo "✅ Environment variables updated (new IP: 8.231.119.9)"
else
    echo "❌ Environment variables NOT updated (still using old IP)"
    echo "   FIX: docker-compose -f docker-compose.prod.yml down"
    echo "        docker-compose -f docker-compose.prod.yml build --no-cache api"
    echo "        docker-compose -f docker-compose.prod.yml up -d"
fi
echo ""

# Check LiteLLM connectivity
if [ -n "$LITELLM_URL" ] && curl -s -f -m 5 "$LITELLM_URL/health" > /dev/null 2>&1; then
    echo "✅ LiteLLM server is reachable"
else
    echo "❌ LiteLLM server is NOT reachable"
    echo "   CHECK: Is 8.231.119.9:4000 accessible?"
    echo "   TEST: curl http://8.231.119.9:4000/health"
fi
echo ""

echo "=========================================="
echo "💡 RECOMMENDED FIX"
echo "=========================================="
echo ""
echo "Run these commands to fix:"
echo ""
echo "cd /data/apps/docmode/PAL"
echo "git pull origin main"
echo "docker-compose -f docker-compose.prod.yml down"
echo "docker-compose -f docker-compose.prod.yml build --no-cache api"
echo "docker-compose -f docker-compose.prod.yml up -d"
echo ""
echo "Then check logs:"
echo "docker logs -f pal-prod-api"
echo ""
