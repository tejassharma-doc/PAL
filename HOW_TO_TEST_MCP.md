# How to Test MCP Server - Simple Guide

## 🚀 Quick Start (3 Steps)

### Step 1: Start the Server
Double-click this file:
```
c:\PAL\mcp-server\start-mcp.bat
```

You should see:
```
PAL MCP API listening on :3001
Database: pal@localhost:5432
```

**✅ Server is running!**

---

### Step 2: Run the Test Script
Open a **NEW** command prompt and double-click:
```
c:\PAL\mcp-server\quick-test.bat
```

You'll see a menu:
```
========================================
  PAL MCP API - Quick Test
========================================

Please select a test:

1. Health Check (No auth)
2. Search Patient by Phone
3. Get Patient Details
4. Get Complete Records (All-in-One)
5. Get Latest Prescription
6. Get Lab Tests
7. List Appointments
8. Push Vitals (POST test)
9. Run ALL Tests
0. Exit

Enter your choice (0-9):
```

**Try option 9 to run all tests!**

---

### Step 3: Check Results

If you see JSON responses like this, **it's working!** ✅

```json
{
  "status": "ok",
  "service": "pal-mcp-api"
}
```

```json
[
  {
    "id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
    "full_name": "Tejash Sharma",
    "email": "tejash@gmail.com",
    ...
  }
]
```

---

## 🧪 What Gets Tested

| Test | What It Does | Expected Result |
|------|--------------|-----------------|
| **Health Check** | Tests server is alive | `{"status": "ok"}` |
| **Search Patient** | Find patient by phone | Patient data returned |
| **Get Details** | Get patient by ID | Full patient info |
| **Complete Records** | All data in one call | Patient + Appointments + Prescriptions + Labs |
| **Latest Prescription** | Get recent prescription | Medications with SOAP notes |
| **Lab Tests** | Get test results | All lab tests with parameters |
| **Appointments** | List appointments | Appointment schedule |
| **Push Vitals** | Test POST endpoint | Vitals saved successfully |

---

## 📊 Success Indicators

### ✅ Server Working:
- Server starts without errors
- Port 3001 is open
- Health check returns OK

### ✅ Database Connected:
- Patient search returns data
- No "connection error" messages

### ✅ Authentication Working:
- Requests with API key succeed
- Requests without API key fail

### ✅ All Endpoints Working:
- All 8 tests pass
- JSON responses received
- No error messages

---

## 🔧 Troubleshooting

### Problem: "Failed to connect"
**Solution:**
```bash
cd c:\PAL\mcp-server
npm start
```
Keep server running in one window, tests in another.

### Problem: "Invalid API Key"
**Solution:** Check `.env` file has:
```
PAL_API_KEY=pal-secret-key-12345
```

### Problem: "Patient not found"
**Solution:** Check database has patient:
```bash
docker exec -i pal-db-1 psql -U pal -d pal -c "SELECT id, full_name, email FROM patients WHERE email='tejash@gmail.com';"
```

### Problem: Empty response `[]`
**Solution:** Patient data might be missing. Check database:
```bash
docker exec -i pal-db-1 psql -U pal -d pal -c "SELECT COUNT(*) FROM patients;"
```

---

## 📁 File Locations

All test files are in: `c:\PAL\mcp-server\`

- **start-mcp.bat** - Start the server
- **quick-test.bat** - Interactive test menu
- **test-api.bat** - Automated test script
- **TEST_MCP.md** - Detailed testing guide

---

## 🎯 Quick Commands

### Start Server:
```bash
cd c:\PAL\mcp-server
npm start
```

### Test Health (No Auth):
```bash
curl http://localhost:3001/health
```

### Test with Auth:
```bash
curl -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients?phone=%2B917892828182"
```

---

## ✅ Verification Checklist

Run through this checklist:

- [ ] Server starts on port 3001
- [ ] Health check returns `{"status": "ok"}`
- [ ] Patient search finds Tejash
- [ ] Patient details show complete info
- [ ] Complete records show appointments + prescriptions + lab tests
- [ ] Latest prescription includes medications
- [ ] Lab tests show results with parameters
- [ ] Appointments list shows schedule
- [ ] Vitals POST request succeeds

**If all checked: MCP Server is fully functional! 🎉**

---

## 📞 Next Steps

### For Mobile App Development:
1. Use base URL: `http://YOUR_SERVER_IP:3001`
2. Add header: `X-API-Key: pal-secret-key-12345`
3. See examples in [USAGE_GUIDE.md](mcp-server/USAGE_GUIDE.md)

### For Production Deployment:
1. Change API key in `.env`
2. Deploy with Docker: `docker-compose up -d`
3. Setup nginx with SSL
4. See [README.md](mcp-server/README.md) for details

---

## 📚 Documentation

- **[TEST_MCP.md](mcp-server/TEST_MCP.md)** - Detailed testing guide
- **[README.md](mcp-server/README.md)** - Complete API documentation
- **[USAGE_GUIDE.md](mcp-server/USAGE_GUIDE.md)** - Usage examples
- **[MCP_SERVER_SETUP.md](MCP_SERVER_SETUP.md)** - Setup summary

---

**That's it! Your MCP server is ready to test! 🚀**
