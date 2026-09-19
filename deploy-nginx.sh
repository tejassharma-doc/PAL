#!/bin/bash
# Nginx Deployment Script for palcare.life
# This script deploys the HTTP-only Nginx config and starts Docker containers

set -e  # Exit on error

echo "=========================================="
echo "PAL Nginx Deployment Script"
echo "Domain: palcare.life"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run with sudo: sudo bash deploy-nginx.sh"
    exit 1
fi

# Step 1: Backup existing config if it exists
echo "Step 1: Backing up existing Nginx config..."
if [ -f /etc/nginx/sites-available/palcare.life ]; then
    cp /etc/nginx/sites-available/palcare.life /etc/nginx/sites-available/palcare.life.backup.$(date +%Y%m%d_%H%M%S)
    echo "✅ Backup created"
else
    echo "ℹ️  No existing config to backup"
fi

# Step 2: Copy new HTTP-only config
echo ""
echo "Step 2: Installing HTTP-only Nginx config..."
cp /data/apps/docmode/PAL/NGINX_PALCARE_LIFE_HTTP.conf /etc/nginx/sites-available/palcare.life
echo "✅ Config copied to /etc/nginx/sites-available/palcare.life"

# Step 3: Enable the site
echo ""
echo "Step 3: Enabling site..."
ln -sf /etc/nginx/sites-available/palcare.life /etc/nginx/sites-enabled/palcare.life
echo "✅ Site enabled"

# Step 4: Remove default site if it exists
echo ""
echo "Step 4: Removing default Nginx site..."
if [ -f /etc/nginx/sites-enabled/default ]; then
    rm /etc/nginx/sites-enabled/default
    echo "✅ Default site removed"
else
    echo "ℹ️  Default site already removed"
fi

# Step 5: Test Nginx configuration
echo ""
echo "Step 5: Testing Nginx configuration..."
if nginx -t; then
    echo "✅ Nginx configuration is valid"
else
    echo "❌ Nginx configuration test failed!"
    echo "Restoring backup if available..."
    if [ -f /etc/nginx/sites-available/palcare.life.backup.* ]; then
        cp /etc/nginx/sites-available/palcare.life.backup.* /etc/nginx/sites-available/palcare.life
        echo "⚠️  Backup restored"
    fi
    exit 1
fi

# Step 6: Reload Nginx
echo ""
echo "Step 6: Reloading Nginx..."
systemctl reload nginx
echo "✅ Nginx reloaded"

# Step 7: Check Nginx status
echo ""
echo "Step 7: Checking Nginx status..."
systemctl status nginx --no-pager | head -10
echo ""

# Step 8: Start Docker containers
echo ""
echo "Step 8: Starting Docker containers..."
cd /data/apps/docmode/PAL

# Pull latest changes
echo "Pulling latest code from git..."
sudo -u tejash git pull origin main || echo "⚠️  Git pull failed or not needed"

# Start containers
echo "Starting Docker containers..."
docker-compose -f docker-compose.prod.yml up -d

echo ""
echo "Waiting for containers to start (10 seconds)..."
sleep 10

# Check container status
echo ""
echo "Container Status:"
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "🌐 Your site should now be accessible at:"
echo "   http://palcare.life"
echo ""
echo "🧪 Test commands:"
echo "   curl http://palcare.life"
echo "   curl http://palcare.life/api/health"
echo ""
echo "🔒 To add SSL certificate (HTTPS), run:"
echo "   sudo certbot --nginx -d palcare.life -d www.palcare.life"
echo ""
echo "📊 Monitor logs:"
echo "   sudo tail -f /var/log/nginx/access.log"
echo "   sudo tail -f /var/log/nginx/error.log"
echo "   docker-compose -f docker-compose.prod.yml logs -f"
echo ""
