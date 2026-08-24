# Docker Cleanup & Restart Guide

## If you get "orphan containers" or "Dead" containers error:

### Quick Fix:

```bash
# 1. Stop everything
docker-compose down --remove-orphans

# 2. Remove dead containers
docker container prune -f

# 3. Check clean state
docker ps -a
# Should show: CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
# (empty table)

# 4. Rebuild and start
docker-compose build
docker-compose up -d

# 5. Check running
docker ps
```

### If still having issues:

```bash
# Nuclear option - removes EVERYTHING (including data!)
docker system prune -a --volumes -f

# Then rebuild MDT
cd mdt-source
docker build -t medical-data-toolkit-custom:latest .
cd ..

# Rebuild and start
docker-compose build
docker-compose up -d

# Recreate database tables
cat create_audit_log_table.sql | docker exec -i pal-db psql -U pal -d pal
```

### Check services:

```bash
docker ps

# Should show:
# pal-api-v2
# pal-web
# pal-mcp-api-v2
# pal-mdt
# pal-db
# pal-redis
```

### View logs:

```bash
docker logs pal-api-v2
docker logs pal-web
docker logs pal-mdt
```

### Access frontend:

http://localhost:3000
