# PAL Health Platform - Complete Integrated System

## ✅ What You Have Now

**ONE unified platform** with all services integrated:

```
PAL Platform
├── FastAPI Backend (Python) - Port 8000
├── Next.js Frontend (React) - Port 3000
├── MCP API Server (Node.js) - Port 3001 ⭐ NEW
├── PostgreSQL Database - Port 5432
└── Redis Cache - Port 6379
```

**All services share the same database and run together!**

---

## 🚀 Quick Start Guide

### Start Everything (ONE Command):
```bash
cd c:\PAL
docker-compose up -d
```

Or double-click: **`start-all.bat`**

### Stop Everything:
```bash
docker-compose down
```

Or double-click: **`stop-all.bat`**

### Test MCP API:
```bash
test-mcp.bat
```

**That's it! Three simple commands.** ✅

---

## 📊 Service Overview

| Service | Technology | Port | Purpose |
|---------|-----------|------|---------|
| **Web App** | Next.js + React | 3000 | Patient/doctor web interface |
| **API Backend** | FastAPI (Python) | 8000 | Main application logic |
| **MCP API** ⭐ | Express.js (Node.js) | 3001 | Mobile app REST API |
| **Database** | PostgreSQL 16 + pgvector | 5432 | Data storage |
| **Cache** | Redis | 6379 | Session & cache |

---

## 🎯 Why This Architecture?

### Web Users → Next.js (Port 3000)
- Beautiful UI for patients and doctors
- Server-side rendering
- React components

### Mobile Apps → MCP API (Port 3001) ⭐
- Simple REST API
- Lightweight responses
- Perfect for Android/iOS
- ABDM integration ready

### Both Use Same Database ✅
- No data duplication
- Real-time sync
- Single source of truth

---

## 📱 For Mobile App Developers

### Base Configuration:
```javascript
const MCP_API_URL = "http://YOUR_SERVER_IP:3001"
const API_KEY = "pal-secret-key-12345"  // Change in production!
```

### Example: Get Patient Records
```javascript
// Android (Kotlin)
val response = apiService.getPatientRecords(
    patientId = "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
    apiKey = "pal-secret-key-12345"
)

// Returns: patient + appointments + prescriptions + lab tests
```

### Example: Push Vitals
```javascript
// iOS (Swift)
let vitals = VitalsRequest(
    heightCm: 175,
    weightKg: 72,
    bpSystolic: 120,
    bpDiastolic: 80,
    pulseRate: 75,
    temperature: 98.6
)

apiClient.pushVitals(patientId: id, vitals: vitals)
```

**Complete API docs**: [mcp-server/README.md](mcp-server/README.md)

---

## 🔧 Development Workflow

### 1. Start Platform
```bash
docker-compose up -d
```

### 2. Make Changes
```bash
# Edit files in:
- api/       (FastAPI Python code)
- web/       (Next.js React code)
- mcp-server/ (MCP Node.js code)
```

### 3. Restart Affected Service
```bash
# After changing MCP server
docker-compose restart mcp-api

# After changing FastAPI
docker-compose restart api

# After changing frontend
docker-compose restart web
```

### 4. View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f mcp-api
```

### 5. Test Changes
```bash
# Test MCP API
test-mcp.bat

# Test web app
# Open: http://localhost:3000
```

---

## 📂 Project Structure

```
c:\PAL\
│
├── api/                         # FastAPI Backend (Python)
│   ├── main.py                 # API entry point
│   ├── models/                 # Database models
│   ├── routers/                # API endpoints
│   └── requirements.txt        # Python dependencies
│
├── web/                         # Next.js Frontend (React)
│   ├── app/                    # Next.js 13+ app directory
│   ├── components/             # React components
│   └── package.json            # Node dependencies
│
├── mcp-server/                  # MCP API Server (Node.js) ⭐
│   ├── server.js               # Express.js API
│   ├── package.json            # Node dependencies
│   ├── Dockerfile              # Container config
│   ├── README.md               # API documentation
│   └── USAGE_GUIDE.md          # Usage examples
│
├── docker-compose.yml          # ALL services configuration ⭐
├── .env                        # Environment variables ⭐
│
├── start-all.bat              # Start everything ⭐
├── stop-all.bat               # Stop everything ⭐
├── test-mcp.bat               # Test MCP API ⭐
│
└── Documentation/
    ├── INTEGRATED_SETUP.md    # Integration guide
    ├── MCP_SERVER_SETUP.md    # MCP overview
    ├── CLEANUP_SUMMARY.md     # Database cleanup
    └── HOW_TO_TEST_MCP.md     # Testing guide
```

---

## 🌐 Access Points

After running `docker-compose up -d`:

| URL | Service | Purpose |
|-----|---------|---------|
| http://localhost:3000 | **Web App** | Main patient/doctor interface |
| http://localhost:8000/docs | **FastAPI Docs** | API documentation (Swagger) |
| http://localhost:3001/health | **MCP Health** | Mobile API health check |
| http://localhost:3001/api/v1/... | **MCP API** | Mobile app endpoints |

---

## 🔑 Configuration

### Main Config File: `.env`
```env
# Database
POSTGRES_USER=pal
POSTGRES_PASSWORD=change_me_in_prod
POSTGRES_DB=pal

# MCP API Key (for mobile apps)
PAL_API_KEY=pal-secret-key-12345
```

**⚠️ Change these in production!**

---

## 🧪 Testing Checklist

Run this after starting the platform:

```bash
# 1. Check all services are running
docker-compose ps

# 2. Test database connection
docker exec -i pal-db-1 psql -U pal -d pal -c "SELECT COUNT(*) FROM patients;"

# 3. Test FastAPI
curl http://localhost:8000/health

# 4. Test MCP API
curl http://localhost:3001/health

# 5. Test web app
# Open browser: http://localhost:3000

# 6. Run MCP API tests
test-mcp.bat
```

✅ **All should pass!**

---

## 📚 Available MCP API Endpoints

### Patient Management
- `GET /api/v1/patients?phone=XXX` - Search patients
- `GET /api/v1/patients/:id` - Get patient details
- `PUT /api/v1/patients/:id` - Update patient
- `GET /api/v1/patients/:id/records` - Complete records (all-in-one) ⭐

### Appointments
- `GET /api/v1/appointments?patientId=XXX` - List appointments
- `GET /api/v1/appointments/:id` - Get with SOAP notes
- `POST /api/v1/appointments` - Book appointment

### Prescriptions
- `GET /api/v1/patients/:id/prescriptions` - All prescriptions
- `GET /api/v1/patients/:id/prescriptions/latest` - Latest with SOAP
- `POST /api/v1/patients/:id/prescriptions` - Create prescription

### Lab Tests
- `GET /api/v1/patients/:id/lab-tests` - All lab tests
- `POST /api/v1/patients/:id/lab-tests` - Add test result

### Vitals
- `POST /api/v1/patients/:id/vitals` - Push vitals from mobile

### Health
- `GET /health` - Server health (no auth required)

**Full documentation**: [mcp-server/README.md](mcp-server/README.md)

---

## 🚀 Deployment to Production

### 1. Update Configuration
```bash
# Edit .env file
PAL_API_KEY=your-strong-random-production-key-here
POSTGRES_PASSWORD=strong-database-password-here
```

### 2. Build and Start
```bash
docker-compose up -d --build
```

### 3. Setup Reverse Proxy (nginx)
```nginx
# /etc/nginx/sites-available/pal

# Web App
server {
    listen 80;
    server_name app.yourpal.com;
    location / {
        proxy_pass http://localhost:3000;
    }
}

# MCP API
server {
    listen 80;
    server_name api.yourpal.com;
    location / {
        proxy_pass http://localhost:3001;
    }
}
```

### 4. Enable HTTPS
```bash
sudo certbot --nginx -d app.yourpal.com -d api.yourpal.com
```

---

## 🔒 Security Checklist

For production deployment:

- [ ] Change `PAL_API_KEY` to strong random key (32+ characters)
- [ ] Change `POSTGRES_PASSWORD` to strong password
- [ ] Change `SECRET_KEY` to random secret
- [ ] Enable HTTPS (Let's Encrypt)
- [ ] Setup firewall (only 80, 443 open)
- [ ] Use Docker secrets for sensitive data
- [ ] Enable rate limiting on MCP API
- [ ] Setup monitoring and alerts
- [ ] Regular backups of PostgreSQL
- [ ] Keep API key private (never commit to git)

---

## 💡 Common Tasks

### View Service Status
```bash
docker-compose ps
```

### Restart a Service
```bash
docker-compose restart mcp-api
docker-compose restart api
docker-compose restart web
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f mcp-api
```

### Rebuild After Code Changes
```bash
# Rebuild specific service
docker-compose up -d --build mcp-api

# Rebuild all
docker-compose up -d --build
```

### Access Database
```bash
docker exec -it pal-db-1 psql -U pal -d pal
```

### Backup Database
```bash
docker exec pal-db-1 pg_dump -U pal pal > backup_$(date +%Y%m%d).sql
```

### Restore Database
```bash
docker exec -i pal-db-1 psql -U pal -d pal < backup_20260722.sql
```

---

## 🎉 Summary

### What Changed:
- ✅ MCP server **integrated** into main project
- ✅ **One** docker-compose file (not two)
- ✅ **One** .env file (not two)
- ✅ **One** command to start everything
- ✅ All services connected automatically
- ✅ Shared database (no duplication)

### How to Use:
```bash
# Start everything
docker-compose up -d

# Test MCP API
test-mcp.bat

# Stop everything
docker-compose down
```

**That's it! The MCP server is now fully integrated into PAL!** 🚀

---

## 📖 Documentation

- **[INTEGRATED_SETUP.md](INTEGRATED_SETUP.md)** - This integration guide
- **[mcp-server/README.md](mcp-server/README.md)** - Complete MCP API reference
- **[mcp-server/USAGE_GUIDE.md](mcp-server/USAGE_GUIDE.md)** - API usage examples
- **[HOW_TO_TEST_MCP.md](HOW_TO_TEST_MCP.md)** - Testing guide
- **[MCP_SERVER_SETUP.md](MCP_SERVER_SETUP.md)** - MCP overview
- **[CLEANUP_SUMMARY.md](CLEANUP_SUMMARY.md)** - Database cleanup details

---

**Need help? Check the documentation or run `test-mcp.bat` to verify everything works!** 🎊
