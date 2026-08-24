#!/bin/bash
# PAL Production Deployment Script - Sequential Build
# This builds and starts services one at a time to avoid disk space issues

set -e

echo "========================================="
echo "PAL Production Deployment (Sequential)"
echo "========================================="
echo ""

cd ~/PAL

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env from .env.production..."
    cp .env.production .env
    echo ""
fi

# Stop any existing containers
echo "Stopping existing containers..."
docker-compose -f docker-compose.prod.yml down 2>/dev/null || true
echo ""

# Pull base images first
echo "Pulling base images..."
docker pull pgvector/pgvector:pg16
docker pull redis:7-alpine
echo ""

# Start database and redis first (they don't need building)
echo "Starting database and redis..."
docker-compose -f docker-compose.prod.yml up -d db redis
sleep 5
echo ""

# Build and start API
echo "Building API service..."
docker-compose -f docker-compose.prod.yml build --no-cache api
echo "Starting API service..."
docker-compose -f docker-compose.prod.yml up -d api
# Clean up build cache
docker builder prune -af
sleep 5
echo ""

# Build and start MDT
echo "Building MDT service..."
docker-compose -f docker-compose.prod.yml build --no-cache mdt
echo "Starting MDT service..."
docker-compose -f docker-compose.prod.yml up -d mdt
# Clean up build cache
docker builder prune -af
sleep 5
echo ""

# Build and start MCP
echo "Building MCP service..."
docker-compose -f docker-compose.prod.yml build --no-cache mcp-api
echo "Starting MCP service..."
docker-compose -f docker-compose.prod.yml up -d mcp-api
# Clean up build cache
docker builder prune -af
sleep 5
echo ""

# Build and start Web (last, as it's largest)
echo "Building Web service..."
docker-compose -f docker-compose.prod.yml build --no-cache web
echo "Starting Web service..."
docker-compose -f docker-compose.prod.yml up -d web
# Clean up build cache
docker builder prune -af
echo ""

# Wait for all services
echo "Waiting for services to stabilize..."
sleep 10

# Create audit_logs table if exists
if [ -f create_audit_log_table.sql ]; then
    echo "Ensuring audit_logs table exists..."
    cat create_audit_log_table.sql | docker exec -i pal-prod-db psql -U pal -d pal 2>/dev/null || true
fi

echo ""
echo "========================================="
echo "Deployment Status"
echo "========================================="
docker-compose -f docker-compose.prod.yml ps
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
echo ""
echo "NOTE: Port 3000 is kept free for BusinessAgent"
echo ""
echo "Check disk usage: df -h"
echo "View logs: docker-compose -f docker-compose.prod.yml logs -f"
echo ""
