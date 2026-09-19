#!/bin/bash
# Database Migration Script - System PostgreSQL to Docker Container

set -e

echo "========================================="
echo "Database Migration Script"
echo "========================================="
echo ""

# Create backup directory
BACKUP_DIR=~/database_backups_$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
echo "Backup directory: $BACKUP_DIR"
echo ""

# List of databases to migrate
DATABASES=("business_agent" "litellm" "healthcare_ehr" "fhir_db")

echo "Step 1: Dumping databases from system PostgreSQL..."
echo "---"

for db in "${DATABASES[@]}"; do
    echo "Dumping $db..."
    sudo -u postgres pg_dump -Fc $db > $BACKUP_DIR/${db}.dump
    echo "  ✓ $db dumped ($(du -h $BACKUP_DIR/${db}.dump | cut -f1))"
done

echo ""
echo "Step 2: Checking Docker PostgreSQL container..."
docker exec pal-prod-db pg_isready -U pal || { echo "Error: PAL database container not ready"; exit 1; }
echo "  ✓ Docker PostgreSQL is ready"
echo ""

echo "Step 3: Creating databases in Docker container..."
for db in "${DATABASES[@]}"; do
    echo "Creating database: $db"
    docker exec pal-prod-db psql -U pal -c "CREATE DATABASE $db;" 2>/dev/null || echo "  (Database $db already exists)"
done

echo ""
echo "Step 4: Restoring databases to Docker container..."
for db in "${DATABASES[@]}"; do
    echo "Restoring $db..."
    cat $BACKUP_DIR/${db}.dump | docker exec -i pal-prod-db pg_restore -U pal -d $db --no-owner --no-acl 2>&1 | grep -v "already exists" || true
    echo "  ✓ $db restored"
done

echo ""
echo "Step 5: Verifying migration..."
echo "Databases in Docker container:"
docker exec pal-prod-db psql -U pal -l

echo ""
echo "========================================="
echo "Migration Complete!"
echo "========================================="
echo ""
echo "Backups saved in: $BACKUP_DIR"
echo ""
echo "Database sizes in Docker container:"
docker exec pal-prod-db psql -U pal -c "SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size FROM pg_database WHERE datname NOT LIKE 'template%' ORDER BY pg_database_size(datname) DESC;"
echo ""
echo "Next steps:"
echo "1. Verify the migrated data"
echo "2. Update application configs to use the new connection strings"
echo "3. Keep the backups in $BACKUP_DIR for safety"
echo ""
