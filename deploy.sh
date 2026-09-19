#!/bin/bash
# PAL Production Deployment Script

set -e  # Exit on error

echo "========================================="
echo "PAL Production Deployment"
echo "========================================="
echo ""

# Check if .env exists, if not copy from .env.production
if [ ! -f .env ]; then
    echo "Creating .env from .env.production..."
    cp .env.production .env
    echo "⚠️  IMPORTANT: Edit .env and set secure passwords!"
    echo ""
fi

# Stop any running containers
echo "Stopping any existing containers..."
docker-compose -f docker-compose.prod.yml down 2>/dev/null || true
echo ""

# Clean up old images (optional)
echo "Cleaning up old images..."
docker system prune -f
echo ""

# Pull base images
echo "Pulling base images..."
docker pull pgvector/pgvector:pg16
docker pull redis:7-alpine
echo ""

# Build the services
echo "Building services (this may take a few minutes)..."
docker-compose -f docker-compose.prod.yml build --no-cache
echo ""

# Start the services
echo "Starting services..."
docker-compose -f docker-compose.prod.yml up -d
echo ""

# Wait for services to be healthy
echo "Waiting for services to be healthy..."
sleep 15

# Create audit_logs table if not exists
if [ -f create_audit_log_table.sql ]; then
    echo "Ensuring audit_logs table exists..."
    cat create_audit_log_table.sql | docker exec -i pal-prod-db psql -U pal -d pal 2>/dev/null || true
    echo ""
fi

# Show status
echo ""
echo "========================================="
echo "Deployment Status"
echo "========================================="
docker-compose -f docker-compose.prod.yml ps
echo ""

# Show recent logs
echo "Recent logs:"
docker-compose -f docker-compose.prod.yml logs --tail=20
echo ""

echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo ""
echo "Services are running on:"
echo "  - Web Frontend:  http://34.14.174.141:3002"
echo "  - API Backend:   http://34.14.174.141:8001"
echo "  - API Docs:      http://34.14.174.141:8001/docs"
echo "  - MCP Server:    http://34.14.174.141:3003"
echo "  - MDT Service:   http://34.14.174.141:8081"
echo "  - PostgreSQL:    localhost:5433"
echo "  - Redis:         localhost:6380"
echo ""
echo "NOTE: Port 3000 is kept free for BusinessAgent frontend"
echo ""
echo "Useful commands:"
echo "  View logs:   docker-compose -f docker-compose.prod.yml logs -f"
echo "  Stop all:    docker-compose -f docker-compose.prod.yml down"
echo "  Restart:     docker-compose -f docker-compose.prod.yml restart"
echo "  DB backup:   docker exec pal-prod-db pg_dump -U pal pal > backup_\$(date +%Y%m%d).sql"
echo ""
