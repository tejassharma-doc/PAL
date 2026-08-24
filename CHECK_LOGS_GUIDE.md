# How to Check API Logs - PAL Project

## Quick Commands

### 1. View Live API Logs (Real-time)
```bash
docker-compose logs -f api
```
- `-f` follows the logs in real-time (like `tail -f`)
- Press `Ctrl+C` to stop following

### 2. View Last 50 Lines
```bash
docker-compose logs --tail 50 api
```

### 3. View Last 100 Lines with Timestamps
```bash
docker-compose logs --tail 100 -t api
```

### 4. View All API Logs
```bash
docker-compose logs api
```

### 5. View Logs Since Specific Time
```bash
# Last 10 minutes
docker-compose logs --since 10m api

# Last 1 hour
docker-compose logs --since 1h api

# Since specific timestamp
docker-compose logs --since 2024-07-27T10:00:00 api
```

## Using Docker Commands Directly

### View Logs for Specific Container
```bash
# By container name
docker logs pal-api-v2

# Follow logs
docker logs -f pal-api-v2

# Last 100 lines
docker logs --tail 100 pal-api-v2

# With timestamps
docker logs -t pal-api-v2
```

## Check Multiple Service Logs

### All Services at Once
```bash
docker-compose logs -f
```

### Multiple Specific Services
```bash
docker-compose logs -f api web mcp-api
```

### All Logs Since Last Restart
```bash
docker-compose logs --since $(docker inspect -f '{{.State.StartedAt}}' pal-api-v2) api
```

## Search/Filter Logs

### Search for Errors
```bash
docker-compose logs api | grep -i error
```

### Search for Specific Endpoint
```bash
docker-compose logs api | grep "/health"
```

### Search for Status Codes
```bash
docker-compose logs api | grep "200\|201\|400\|500"
```

### Search for Recent Errors (Last 100 lines)
```bash
docker-compose logs --tail 100 api | grep -i "error\|exception\|traceback"
```

## Save Logs to File

### Save Current Logs
```bash
docker-compose logs api > api-logs.txt
```

### Save with Timestamps
```bash
docker-compose logs -t api > api-logs-$(date +%Y%m%d-%H%M%S).txt
```

### Save Last 1000 Lines
```bash
docker-compose logs --tail 1000 api > api-logs-recent.txt
```

## Advanced Log Monitoring

### Watch for Errors in Real-time
```bash
docker-compose logs -f api | grep --color=always -i "error\|exception\|traceback"
```

### Monitor Multiple Services with Color Coding
```bash
docker-compose logs -f --tail 50 api web mcp-api
```

### Check Log File Size
```bash
docker inspect pal-api-v2 --format='{{.LogPath}}' | xargs ls -lh
```

## Troubleshooting Commands

### Check if API is Running
```bash
docker ps | grep api
```

### Check API Container Status
```bash
docker inspect pal-api-v2 --format='{{.State.Status}}'
```

### Restart API and Watch Logs
```bash
docker-compose restart api && docker-compose logs -f api
```

### Check API Health Endpoint
```bash
curl http://localhost:8000/health
```

### Check Last 20 Lines and Follow
```bash
docker-compose logs --tail 20 -f api
```

## Common Log Patterns to Look For

### Startup Messages
```bash
docker-compose logs api | grep -i "startup\|running\|started"
```

### Database Connection Issues
```bash
docker-compose logs api | grep -i "database\|postgres\|connection"
```

### HTTP Request Logs
```bash
docker-compose logs api | grep "GET\|POST\|PUT\|DELETE\|PATCH"
```

### Python Exceptions
```bash
docker-compose logs api | grep -A 10 "Traceback"
```
(Shows 10 lines after each "Traceback" for full stack trace)

## Quick Access Aliases (Add to .bashrc or .bash_profile)

```bash
# Add these to your shell config for quick access
alias logs-api="docker-compose logs -f api"
alias logs-api-errors="docker-compose logs api | grep -i error"
alias logs-all="docker-compose logs -f"
alias logs-tail="docker-compose logs --tail 100 -f"
```

## Windows PowerShell Alternatives

### View Logs
```powershell
docker-compose logs -f api
```

### Search Logs
```powershell
docker-compose logs api | Select-String "error"
```

### Save to File
```powershell
docker-compose logs api | Out-File -FilePath api-logs.txt
```

## Real-time Dashboard (Optional)

### Install ctop (Container Top)
```bash
# Windows (via Scoop)
scoop install ctop

# Mac
brew install ctop

# Then run
ctop
```
This gives you a real-time dashboard of all containers with CPU, memory, and easy log access.

---

## Quick Reference Card

| Command | Description |
|---------|-------------|
| `docker-compose logs -f api` | Follow API logs in real-time |
| `docker-compose logs --tail 50 api` | Last 50 lines |
| `docker logs pal-api-v2` | Direct container logs |
| `docker-compose logs api \| grep error` | Search for errors |
| `docker-compose logs -t api` | Logs with timestamps |
| `docker-compose logs --since 10m api` | Last 10 minutes |
| `docker-compose restart api && docker-compose logs -f api` | Restart and watch |

---

**Tip**: Keep a terminal window open with `docker-compose logs -f api` while developing to see requests in real-time!
