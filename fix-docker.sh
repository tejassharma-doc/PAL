#!/bin/bash
# Fix Docker dead containers issue for PAL project

echo "=== PAL Docker Container Fix Script ==="
echo ""

# Step 1: Show current state
echo "Step 1: Current container state"
docker ps -a
echo ""

# Step 2: Try to remove dead containers
echo "Step 2: Attempting to remove dead containers..."
DEAD_CONTAINERS=$(docker ps -a --filter "status=dead" -q)
if [ ! -z "$DEAD_CONTAINERS" ]; then
    echo "Found dead containers: $DEAD_CONTAINERS"
    docker rm -f $DEAD_CONTAINERS 2>/dev/null || echo "Could not remove dead containers directly"
else
    echo "No dead containers found via filter"
fi
echo ""

# Step 3: Use updated docker-compose to recreate
echo "Step 3: Starting fresh with docker-compose..."
echo "This will use --force-recreate and --renew-anon-volumes"

# First, bring everything down
docker-compose down 2>/dev/null

# Then start with force recreate
docker-compose up -d --force-recreate --renew-anon-volumes

echo ""
echo "=== Fix Complete ==="
echo ""
echo "Final container state:"
docker ps -a
echo ""
echo "If you still see dead containers, please restart Docker Desktop manually:"
echo "1. Right-click Docker Desktop icon in system tray"
echo "2. Select 'Quit Docker Desktop'"
echo "3. Wait 10 seconds"
echo "4. Start Docker Desktop again"
echo "5. Run: docker-compose up -d"
