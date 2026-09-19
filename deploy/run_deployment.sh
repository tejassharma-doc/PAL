#!/bin/bash
# ===================================================================
# PAL Family Chat - Server Deployment Script
# ===================================================================
# Run this ON THE SERVER after files are copied
# ===================================================================

set -e  # Exit on error

echo "=========================================="
echo " PAL Family Chat Deployment"
echo " Server: $(hostname)"
echo " Date: $(date)"
echo "=========================================="
echo ""

# Change to PAL directory
cd /home/ubuntu/PAL

# Step 1: Copy production config
echo "Step 1: Copying production configuration..."
if [ -f "api/.env.production" ]; then
    cp api/.env.production api/.env
    echo "✓ Production .env copied"
else
    echo "ERROR: api/.env.production not found!"
    exit 1
fi

# Step 2: Check Centrifugo secrets
echo ""
echo "Step 2: Verifying Centrifugo secrets..."
if grep -q "CENTRIFUGO_API_KEY=c027c156" api/.env && \
   grep -q "CENTRIFUGO_TOKEN_HMAC_SECRET=aca5a052" api/.env; then
    echo "✓ Centrifugo secrets verified"
else
    echo "ERROR: Centrifugo secrets not found in api/.env!"
    exit 1
fi

# Step 3: Stop existing containers
echo ""
echo "Step 3: Stopping existing containers..."
docker compose -f docker-compose.prod.yml down
echo "✓ Containers stopped"

# Step 4: Build new containers
echo ""
echo "Step 4: Building containers..."
docker compose -f docker-compose.prod.yml build
echo "✓ Containers built"

# Step 5: Run database migrations
echo ""
echo "Step 5: Running database migrations..."
docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head
echo "✓ Migrations complete"

# Step 6: Start containers with Centrifugo
echo ""
echo "Step 6: Starting containers with Centrifugo..."
docker compose -f docker-compose.prod.yml \
               -f deploy/centrifugo/docker-compose.centrifugo.yml \
               up -d
echo "✓ Containers started"

# Step 7: Wait for containers to be healthy
echo ""
echo "Step 7: Waiting for containers to be healthy..."
sleep 15

# Step 8: Verify containers
echo ""
echo "Step 8: Verifying deployment..."
echo ""
echo "Container Status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep pal

echo ""
echo "Testing API Health:"
if curl -s http://localhost:8001/health > /dev/null; then
    echo "✓ API is healthy"
    curl -s http://localhost:8001/health | jq -r '.chat_enabled, .family_plan_enabled' | \
        sed 's/^/  Chat Enabled: /; s/true/YES/; s/false/NO/' | head -2
else
    echo "⚠ API health check failed"
fi

echo ""
echo "Testing Chat Config:"
if curl -s http://localhost:8001/chat/realtime/config > /dev/null; then
    echo "✓ Chat config endpoint working"
    curl -s http://localhost:8001/chat/realtime/config | jq -r '.transport' | \
        sed 's/^/  Transport: /'
else
    echo "⚠ Chat config failed"
fi

echo ""
echo "Testing Centrifugo:"
if curl -s http://localhost:8100/health > /dev/null; then
    echo "✓ Centrifugo is healthy"
else
    echo "⚠ Centrifugo health check failed"
fi

echo ""
echo "=========================================="
echo " Deployment Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Check logs: docker logs -f pal-prod-api"
echo "  2. Check Centrifugo: docker logs -f pal-centrifugo"
echo "  3. Test in browser: https://pal-agent.medmode.org"
echo ""
echo "To rollback:"
echo "  nano api/.env"
echo "  Set: CHAT_ENABLED=false"
echo "  Run: docker restart pal-prod-api"
echo ""
