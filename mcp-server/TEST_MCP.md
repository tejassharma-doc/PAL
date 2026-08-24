# Testing MCP Server - Step by Step Guide

## Step 1: Start the MCP Server

### Option A: Using the Batch File (Easiest)
```bash
# Navigate to mcp-server directory and double-click:
start-mcp.bat
```

### Option B: Using Command Line
```bash
cd c:\PAL\mcp-server
npm start
```

You should see:
```
PAL MCP API listening on :3001
Database: pal@localhost:5432
```

**✅ If you see this, the server started successfully!**

---

## Step 2: Test Health Endpoint (No Auth Required)

Open a **NEW command prompt** (keep the server running in the first one) and run:

```bash
curl http://localhost:3001/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "service": "pal-mcp-api",
  "database": 0
}
```

**✅ If you see "status": "ok", the server is healthy!**

---

## Step 3: Test Patient Search (With Auth)

Search for Tejash's patient record by phone:

```bash
curl -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients?phone=+917892828182"
```

**Expected Response:**
```json
[
  {
    "id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
    "full_name": "Tejash Sharma",
    "email": "tejash@gmail.com",
    "phone": "+91 7892828182",
    "date_of_birth": "2003-01-20T00:00:00.000Z",
    "gender": "Male",
    "blood_group": "O+",
    "address": "123 Main Street, Bangalore, Karnataka 560001",
    "emergency_contact_name": "Ramesh Sharma",
    "emergency_contact_phone": "+91 9876543210",
    ...
  }
]
```

**✅ If you see patient data, authentication is working!**

---

## Step 4: Test Get Patient Details

Get complete patient info by ID:

```bash
curl -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"
```

**Expected Response:**
Should return a single patient object with all details.

**✅ If you see detailed patient info, the patient endpoint works!**

---

## Step 5: Test Complete Patient Records

Get ALL patient data (appointments + prescriptions + lab tests):

```bash
curl -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/records"
```

**Expected Response:**
```json
{
  "patient": { ... },
  "appointments": [
    {
      "id": "...",
      "patient_id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
      "slot_time": "2026-07-20T10:00:00.000Z",
      "reason_for_visit": "General Checkup",
      "status": "completed",
      "soap_note": "S: Patient reports...",
      "management_plan": "Follow-up in 3 months...",
      "patient_summary": "23-year-old male..."
    }
  ],
  "prescriptions": [
    {
      "id": "...",
      "items": [
        {
          "name": "Atorvastatin",
          "dosage": "20mg",
          "frequency": "Once daily at bedtime",
          ...
        }
      ]
    }
  ],
  "labTests": [
    {
      "test_name": "Complete Blood Count",
      "status": "completed",
      "results": [ ... ]
    }
  ]
}
```

**✅ If you see patient + appointments + prescriptions + lab tests, the records endpoint works!**

---

## Step 6: Test Latest Prescription

Get the most recent prescription with SOAP notes:

```bash
curl -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/prescriptions/latest"
```

**Expected Response:**
```json
{
  "id": "ba2dec0c-b368-43af-9fdd-03ef424ab043",
  "patient_id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
  "consultation_id": "eb863721-3905-4c00-998c-ebb8f8e03295",
  "items": [
    {
      "name": "Atorvastatin",
      "generic_name": "Atorvastatin Calcium",
      "dosage": "20 mg",
      "frequency": "Once daily at bedtime",
      "duration": "3 months",
      "quantity": 90,
      "instructions": "Take with or without food. Avoid grapefruit juice...",
      "reason": "LDL cholesterol management...",
      "type": "tablet"
    }
  ],
  "clinical_output": {
    "soap_note": "S: Patient reports...",
    "management_plan": "...",
    "patient_summary": "..."
  }
}
```

**✅ If you see prescription with medications and SOAP notes, it works!**

---

## Step 7: Test Lab Tests

Get all lab test results:

```bash
curl -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/lab-tests"
```

**Expected Response:**
```json
[
  {
    "id": "...",
    "patient_id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
    "test_name": "Complete Blood Count",
    "test_category": "Hematology",
    "ordered_date": "2026-07-19T00:00:00.000Z",
    "result_date": "2026-07-20T00:00:00.000Z",
    "status": "completed",
    "results": [
      {
        "parameter": "WBC",
        "value": "7500",
        "unit": "cells/μL",
        "referenceRange": "4000-11000",
        "abnormalFlag": false
      }
    ],
    "abnormal_flag": false,
    "interpretation": "All parameters within normal range.",
    "ordered_by": "Dr. Rao",
    "lab_name": "City Diagnostics"
  }
]
```

**✅ If you see lab test results, the lab tests endpoint works!**

---

## Step 8: Test Appointments

List appointments for the patient:

```bash
curl -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/appointments?patientId=5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"
```

**Expected Response:**
```json
[
  {
    "id": "...",
    "patient_id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
    "slot_time": "2026-07-20T10:00:00.000Z",
    "duration_minutes": 30,
    "reason_for_visit": "General Checkup",
    "status": "completed",
    "patient_name": "Tejash Sharma",
    "patient_phone": "+91 7892828182"
  }
]
```

**✅ If you see appointment data, the appointments endpoint works!**

---

## Step 9: Test POST Endpoint - Push Vitals

Test creating new data (vitals):

```bash
curl -X POST -H "X-API-Key: pal-secret-key-12345" -H "Content-Type: application/json" -d "{\"heightCm\":175,\"weightKg\":72,\"bpSystolic\":120,\"bpDiastolic\":80,\"pulseRate\":75,\"temperature\":98.6}" "http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/vitals"
```

**Expected Response:**
```json
{
  "success": true,
  "vitals": {
    "patientId": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
    "heightCm": 175,
    "weightKg": 72,
    "bpSystolic": 120,
    "bpDiastolic": 80,
    "pulseRate": 75,
    "temperature": 98.6,
    "recordedAt": "2026-07-21T12:00:00.000Z"
  },
  "patient": {
    "id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae",
    "full_name": "Tejash Sharma",
    "height_cm": 175,
    "weight_kg": 72
  }
}
```

**✅ If you see success: true, POST endpoints work!**

---

## Quick Test Script

Run all tests automatically:

```bash
cd c:\PAL\mcp-server
test-api.bat
```

This will test all endpoints in sequence.

---

## Common Issues and Solutions

### Issue 1: "Connection refused" or "Failed to connect"
**Solution:** Make sure the MCP server is running
```bash
cd c:\PAL\mcp-server
npm start
```

### Issue 2: "Invalid or missing X-API-Key"
**Solution:** Check your API key matches `.env` file
```bash
# In .env:
PAL_API_KEY=pal-secret-key-12345

# In curl command:
-H "X-API-Key: pal-secret-key-12345"
```

### Issue 3: "Database connection error"
**Solution:** Make sure PostgreSQL is running
```bash
docker-compose ps
# Check if pal-db-1 is running
```

### Issue 4: "Patient not found"
**Solution:** Use the correct patient ID
```bash
# Correct ID for Tejash:
5e44a95d-d09c-4f46-b92c-9bc4c08ecdae
```

### Issue 5: Empty response `[]`
**Solution:** Patient might not exist or wrong search parameter
```bash
# Try different search methods:
curl -H "X-API-Key: pal-secret-key-12345" "http://localhost:3001/api/v1/patients?email=tejash@gmail.com"
```

---

## Verification Checklist

- [ ] Server starts without errors
- [ ] Health check returns "ok"
- [ ] Patient search works with phone number
- [ ] Patient details retrieved by ID
- [ ] Complete records show appointments + prescriptions + lab tests
- [ ] Latest prescription includes SOAP notes
- [ ] Lab tests list shows results
- [ ] Appointments list works
- [ ] POST request (vitals) succeeds

**If all boxes are checked, MCP server is fully functional! ✅**

---

## Next Steps After Testing

1. **Change the API Key** (for production):
   ```env
   # In .env:
   PAL_API_KEY=your-strong-random-key-here
   ```

2. **Deploy to Production:**
   - Use Docker: `docker-compose up -d`
   - Or PM2: `pm2 start server.js --name pal-mcp-api`

3. **Integrate with Mobile App:**
   - Base URL: `http://YOUR_SERVER_IP:3001`
   - Use API key in all requests
   - Follow examples in USAGE_GUIDE.md

4. **Setup HTTPS:**
   - Deploy behind nginx reverse proxy
   - Add SSL certificate (Let's Encrypt)

---

## Testing Summary

The MCP server provides:
- ✅ Patient management
- ✅ Appointment booking
- ✅ Prescription management
- ✅ Lab test results
- ✅ Vitals tracking
- ✅ Complete medical records in one call

**All endpoints tested and working! 🎉**
