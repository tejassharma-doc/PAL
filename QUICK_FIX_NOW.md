# ⚡ Quick Fix - Do This Now!

## Fix Ghost Containers in 5 Minutes:

### Step 1: Stop Everything
```bash
cd c:/PAL
docker-compose down
```

### Step 2: Quit Docker Desktop
1. Find Docker Desktop icon in **system tray** (bottom-right corner, near clock)
2. **Right-click** the whale icon
3. Click **"Quit Docker Desktop"**
4. **Wait 30 seconds**

### Step 3: Start Docker Desktop
1. Open **Docker Desktop** from Start Menu
2. **Wait** for it to fully start (whale icon stops animating)

### Step 4: Verify Clean
```bash
docker ps -a
```

**Expected output:**
```
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
```
**(Empty = SUCCESS!)**

### Step 5: Start Services
```bash
docker-compose up -d
```

**Expected output:**
```
✅ Creating network "pal_default"
✅ Creating pal-db
✅ Creating pal-redis
✅ Creating pal-mdt
✅ Creating pal-api
✅ Creating pal-web
✅ Creating pal-mcp-api
```

**NO errors about "No such container"!**

### Step 6: Verify Running
```bash
docker ps
```

**Expected container names:**
- `pal-db` ✅
- `pal-redis` ✅
- `pal-api` ✅ (NOT `9f6caf29300a_pal-api`)
- `pal-web` ✅
- `pal-mcp-api` ✅ (NOT `0b4703714fe5_pal-mcp-api`)
- `pal-mdt` ✅

**Clean names = Fixed!** 🎉

---

## If That Didn't Work:

### Nuclear Option (5 more minutes):

1. **Quit Docker Desktop**

2. **Open PowerShell as Administrator:**
   - Press `Win + X`
   - Click "Windows PowerShell (Admin)"

3. **Run these commands:**
   ```powershell
   Remove-Item -Path "$env:LOCALAPPDATA\Docker" -Recurse -Force
   Remove-Item -Path "$env:APPDATA\Docker" -Recurse -Force
   ```

4. **Restart your computer**

5. **Start Docker Desktop**

6. **Rebuild:**
   ```bash
   cd c:/PAL
   docker-compose build
   docker-compose up -d
   ```

7. **Recreate tables:**
   ```bash
   cat create_audit_log_table.sql | docker exec -i pal-db psql -U pal -d pal
   ```

**100% guaranteed to work!**

---

## After Fix:

### Test It:
```bash
# Check services
docker ps

# Test frontend
curl http://localhost:3000

# Test API
curl http://localhost:8000/docs
```

### Going Forward:
```bash
# Always stop properly:
docker-compose down

# Not Ctrl+C during startup!
```

---

## TL;DR:

1. `docker-compose down`
2. Quit Docker Desktop (system tray)
3. Wait 30 seconds
4. Start Docker Desktop
5. `docker-compose up -d`
6. Check: `docker ps` (should show clean names)

**Done! No more ghosts!** 👻➡️✅
