# PAL Platform - Integrated Setup Guide

## ✅ MCP Server Now Integrated!

The MCP API server is **now part of the main PAL project**. Everything runs together with one command!

---

## 🚀 Quick Start - ONE Command to Start Everything

```bash
docker-compose up -d
```

Or use the batch file:
```bash
start-all.bat
```

This starts **ALL services**:
- ✅ PostgreSQL Database (Port 5432)
- ✅ Redis Cache (Port 6379)
- ✅ FastAPI Backend (Port 8000)
- ✅ Next.js Frontend (Port 3000)
- ✅ **MCP API Server** (Port 3001) ⭐ NEW

---

## 📂 Project Structure

```
c:\PAL\
├── api/                    # FastAPI backend (Python)
├── web/                    # Next.js frontend (React)
├── mcp-server/            # MCP API server (Node.js) ⭐ NEW
│   ├── server.js          # Express.js API
│   ├── package.json       # Node dependencies
│   ├── Dockerfile         # Container config
│   └── .env              # MCP settings
├── docker-compose.yml     # ALL services (updated) ⭐
├── .env                   # Main config (updated) ⭐
├── start-all.bat         # Start everything ⭐ NEW
├── stop-all.bat          # Stop everything ⭐ NEW
└── test-mcp.bat          # Test MCP API ⭐ NEW
```

---

## 🎯 How to Use

### 1️⃣ Start the Entire Platform

**Option A: Docker Compose (Recommended)**
```bash
cd c:\PAL
docker-compose up -d
```

**Option B: Batch File**
```bash
cd c:\PAL
start-all.bat
```

**What happens:**
- Builds all 4 containers (db, api, web, mcp-api)
- Connects them to the same network
- All services share the same PostgreSQL database
- Everything starts automatically!

---

### 2️⃣ Check Service Status

```bash
docker-compose ps
```

You should see:
```
NAME           IMAGE        STATUS         PORTS
pal-api-1      pal-api      Up X minutes   0.0.0.0:8000->8000/tcp
pal-db-1       pgvector     Up X minutes   0.0.0.0:5432->5432/tcp
pal-mcp-api    pal-mcp-api  Up X minutes   0.0.0.0:3001->3001/tcp
pal-redis-1    redis        Up X minutes   0.0.0.0:6379->6379/tcp
pal-web-1      pal-web      Up X minutes   0.0.0.0:3000->3000/tcp
```

✅ All services should show "Up" status with healthy!

---

### 3️⃣ Test the MCP API

**Option A: Interactive Test Menu**
```bash
cd c:\PAL
test-mcp.bat
```
Choose option **9** to run all tests.

**Option B: Manual Test**
```bash
# Health check
curl http://localhost:3001/health

# Search patient
curl -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients?phone=%2B917892828182"

# Get complete records
curl -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/records"
```

---

## 🌐 Access Points

| Service | URL | Purpose |
|---------|-----|---------|
| **Web App** | http://localhost:3000 | Main web interface |
| **FastAPI** | http://localhost:8000 | Python backend API |
| **MCP API** | http://localhost:3001 | Mobile app API ⭐ |
| **Database** | localhost:5432 | PostgreSQL |
| **Redis** | localhost:6379 | Cache |

---

## 🔑 Configuration

All configuration is in **one place**: `c:\PAL\.env`

```env
# Database
POSTGRES_USER=pal
POSTGRES_PASSWORD=change_me_in_prod
POSTGRES_DB=pal

# Redis
REDIS_URL=redis://redis:6379/0

# MCP API Server (for mobile apps) ⭐ NEW
PAL_API_KEY=pal-secret-key-12345
```

**Change the API key for production!**

---

## 📊 Service Dependencies

```
┌─────────────┐
│  Database   │ ←─┐
│ (PostgreSQL)│   │
└─────────────┘   │
                  │
┌─────────────┐   │
│    Redis    │   │
└─────────────┘   │
                  │
┌─────────────┐   │
│  FastAPI    │───┤ All connect to
│  (Python)   │   │ same database
└─────────────┘   │
                  │
┌─────────────┐   │
│   Next.js   │   │
│   (React)   │   │
└─────────────┘   │
                  │
┌─────────────┐   │
│  MCP API    │───┘
│  (Node.js)  │ ⭐ NEW
└─────────────┘
```

---

## 🛠️ Common Commands

### Start Everything
```bash
docker-compose up -d
# or
start-all.bat
```

### Stop Everything
```bash
docker-compose down
# or
stop-all.bat
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f mcp-api
docker-compose logs -f api
docker-compose logs -f web
```

### Restart a Service
```bash
docker-compose restart mcp-api
```

### Rebuild After Code Changes
```bash
# Rebuild MCP server
docker-compose up -d --build mcp-api

# Rebuild all
docker-compose up -d --build
```

---

## 🧪 Testing

### Test MCP API Server
```bash
cd c:\PAL
test-mcp.bat
```

### Test Web App
Open browser: http://localhost:3000

### Test FastAPI
Open browser: http://localhost:8000/docs

---

## 🔄 Development Workflow

### 1. Make Changes to MCP Server
```bash
# Edit c:\PAL\mcp-server\server.js
# Save the file
```

### 2. Restart MCP Service
```bash
docker-compose restart mcp-api
```

### 3. Test Changes
```bash
test-mcp.bat
```

---

## 📱 Mobile App Integration

### Connection Settings:
```javascript
// For Android/iOS app
const BASE_URL = "http://YOUR_SERVER_IP:3001"
const API_KEY = "pal-secret-key-12345"

// Example request
fetch(`${BASE_URL}/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/records`, {
  headers: {
    'X-API-Key': API_KEY
  }
})
```

### Available Endpoints:
- `GET /health` - Health check (no auth)
- `GET /api/v1/patients?phone=XXX` - Search patients
- `GET /api/v1/patients/:id` - Get patient details
- `GET /api/v1/patients/:id/records` - Complete records (all-in-one)
- `GET /api/v1/patients/:id/prescriptions/latest` - Latest prescription
- `GET /api/v1/patients/:id/lab-tests` - Lab test results
- `GET /api/v1/appointments?patientId=XXX` - List appointments
- `POST /api/v1/patients/:id/vitals` - Push vitals
- More endpoints in [README.md](mcp-server/README.md)

---

## 🔒 Security

### Development (Current):
- API Key: `pal-secret-key-12345`
- Database Password: `change_me_in_prod`
- All services on localhost

### Production Checklist:
- [ ] Change `PAL_API_KEY` to strong random key
- [ ] Change `POSTGRES_PASSWORD` to strong password
- [ ] Use HTTPS (nginx reverse proxy)
- [ ] Implement rate limiting
- [ ] Setup firewall rules
- [ ] Enable Docker secrets for sensitive data

---

## 📚 Documentation

- **[MCP_SERVER_SETUP.md](MCP_SERVER_SETUP.md)** - MCP server overview
- **[mcp-server/README.md](mcp-server/README.md)** - Complete API reference
- **[mcp-server/USAGE_GUIDE.md](mcp-server/USAGE_GUIDE.md)** - Usage examples
- **[CLEANUP_SUMMARY.md](CLEANUP_SUMMARY.md)** - Database cleanup details

---

## 🎯 Key Benefits of Integration

### Before (Separate):
- ❌ Two different docker-compose files
- ❌ Two separate .env files
- ❌ Start services separately
- ❌ Manage dependencies manually

### After (Integrated):
- ✅ **One** docker-compose file
- ✅ **One** .env file
- ✅ **One** command to start everything
- ✅ All services connected automatically
- ✅ Shared database (no duplication)
- ✅ Unified logging and monitoring

---

## ✅ Verification Checklist

After starting the platform, verify:

- [ ] Database running: `docker-compose ps | grep db`
- [ ] Redis running: `docker-compose ps | grep redis`
- [ ] FastAPI running: `curl http://localhost:8000/health`
- [ ] Web app accessible: Open http://localhost:3000
- [ ] **MCP API running**: `curl http://localhost:3001/health`
- [ ] **MCP API authenticated**: Run `test-mcp.bat`

If all checked, **the integrated platform is working!** 🎉

---

## 🚨 Troubleshooting

### Issue: MCP API not starting
**Check logs:**
```bash
docker-compose logs mcp-api
```

**Common fixes:**
```bash
# Rebuild the container
docker-compose up -d --build mcp-api

# Check if port 3001 is free
netstat -ano | findstr :3001
```

### Issue: Database connection error
**Solution:**
```bash
# Restart database
docker-compose restart db

# Wait for healthy status
docker-compose ps
```

### Issue: API key not working
**Check `.env` file:**
```bash
# Should contain:
PAL_API_KEY=pal-secret-key-12345
```

**Restart MCP service:**
```bash
docker-compose restart mcp-api
```

---

## 🎉 Summary

**Everything is now ONE integrated project!**

### To Start:
```bash
docker-compose up -d
# or
start-all.bat
```

### To Test MCP:
```bash
test-mcp.bat
```

### To Stop:
```bash
docker-compose down
# or
stop-all.bat
```

**That's it! The MCP server is now fully integrated into PAL!** 🚀

---

## 📦 What Changed?

| File | Change | Status |
|------|--------|--------|
| `docker-compose.yml` | Added mcp-api service | ✅ Updated |
| `.env` | Added PAL_API_KEY | ✅ Updated |
| `mcp-server/Dockerfile` | Simplified for integration | ✅ Updated |
| `mcp-server/docker-compose.yml` | Removed (not needed) | ✅ Deleted |
| `start-all.bat` | Start entire platform | ✅ Created |
| `stop-all.bat` | Stop entire platform | ✅ Created |
| `test-mcp.bat` | Test MCP API | ✅ Created |

**No more separate MCP setup - everything runs together!** 🎊
