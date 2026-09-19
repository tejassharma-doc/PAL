#!/bin/bash
# Gemma/Hermes Diagnostic Script
# Identifies why Hermes chat is returning 500 errors

echo "=========================================="
echo "PAL Hermes/Gemma Diagnostic Tool"
echo "=========================================="
echo ""

# Check if running on server
if [ ! -f "docker-compose.prod.yml" ]; then
    echo "❌ Error: Run this script from /data/apps/docmode/PAL directory"
    exit 1
fi

echo "📊 Step 1: Checking API container status..."
if docker ps | grep -q pal-prod-api; then
    echo "✅ API container is running"
else
    echo "❌ API container is NOT running"
    echo "   Run: docker-compose -f docker-compose.prod.yml up -d"
    exit 1
fi
echo ""

echo "🔧 Step 2: Checking environment variables..."
echo "OPENAI_API_BASE:"
docker exec pal-prod-api env | grep OPENAI_API_BASE || echo "❌ NOT SET"
echo "OPENAI_API_KEY:"
docker exec pal-prod-api env | grep OPENAI_API_KEY | sed 's/=.*/=***HIDDEN***/' || echo "❌ NOT SET"
echo "GEMINI_MODEL:"
docker exec pal-prod-api env | grep GEMINI_MODEL || echo "❌ NOT SET"
echo ""

echo "🌐 Step 3: Testing LiteLLM proxy connectivity..."
LITELLM_BASE=$(docker exec pal-prod-api env | grep OPENAI_API_BASE | cut -d= -f2 | sed 's|/v1||')
if [ -z "$LITELLM_BASE" ]; then
    echo "❌ OPENAI_API_BASE not set"
else
    echo "Testing: $LITELLM_BASE/health"
    if curl -s -f -m 5 "$LITELLM_BASE/health" > /dev/null 2>&1; then
        echo "✅ LiteLLM proxy is reachable"
    else
        echo "❌ LiteLLM proxy is NOT reachable"
        echo "   This is likely the problem!"
        echo "   The LiteLLM server at $LITELLM_BASE is down or unreachable"
    fi
fi
echo ""

echo "📋 Step 4: Checking available models..."
if [ -n "$LITELLM_BASE" ]; then
    echo "Fetching models from $LITELLM_BASE/v1/models"
    curl -s -m 10 "$LITELLM_BASE/v1/models" | python3 -m json.tool 2>/dev/null || echo "❌ Cannot fetch models"
fi
echo ""

echo "📝 Step 5: Checking recent API logs for errors..."
echo "Last 20 ERROR lines:"
docker logs pal-prod-api --tail 500 | grep -i "error\|exception\|traceback" | tail -20
echo ""

echo "🔍 Step 6: Checking Hermes chat endpoint errors..."
echo "Last Hermes errors:"
docker logs pal-prod-api --tail 500 | grep -A 10 "hermes/chat.*500" | tail -30
echo ""

echo "=========================================="
echo "💡 Quick Diagnosis:"
echo "=========================================="

# Check if LiteLLM is reachable
if curl -s -f -m 5 "$LITELLM_BASE/health" > /dev/null 2>&1; then
    echo "✅ LiteLLM server is UP"
    echo ""
    echo "🔍 The issue might be:"
    echo "  1. Wrong model name - Check GEMINI_MODEL"
    echo "  2. Wrong API key - Check OPENAI_API_KEY"
    echo "  3. Code error - Check logs above"
else
    echo "❌ LiteLLM server is DOWN"
    echo ""
    echo "🔧 Recommended fixes:"
    echo ""
    echo "Option 1: Contact team managing $LITELLM_BASE"
    echo ""
    echo "Option 2: Switch to Gemini 2.5 Flash (edit .env.production):"
    echo "  GEMINI_MODEL=vertex_ai/gemini-2.5-flash"
    echo ""
    echo "Option 3: Use different LiteLLM server (edit .env.production):"
    echo "  OPENAI_API_BASE=http://YOUR_SERVER:4000/v1"
fi
echo ""

echo "📊 Full diagnostic log saved to: /tmp/pal-gemma-diagnostic.log"
{
    echo "=== PAL Gemma Diagnostic Report ==="
    echo "Date: $(date)"
    echo ""
    echo "=== Container Status ==="
    docker ps | grep pal-prod-api
    echo ""
    echo "=== Environment Variables ==="
    docker exec pal-prod-api env | grep -E 'OPENAI_API_BASE|GEMINI_MODEL'
    echo ""
    echo "=== Recent API Logs ==="
    docker logs pal-prod-api --tail 200
} > /tmp/pal-gemma-diagnostic.log

echo "✅ Done! Review the output above for the issue."
echo ""
