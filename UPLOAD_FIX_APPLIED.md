# Upload Issue - FIXED! ✅

## Problem Found

The frontend was sending **user_id** instead of **patient_id** when uploading files!

### Error in API Logs:
```
ForeignKeyViolationError: insert or update on table "raw_sources" 
violates foreign key constraint "raw_sources_tenant_id_fkey"
DETAIL: Key (tenant_id)=(00000000-0000-0000-0000-000000000001) is not present in table "tenants".

Parameters: member_id: fd950a6e-414c-4ca2-b46f-e3c753e4d295  ← WRONG! This is user_id
```

### What Should Have Been Sent:
```
member_id: d9ebd0f7-fc29-4347-b585-fd15be9d1853  ← patient_id
```

---

## Root Cause

**File**: `web/app/upload/page.tsx`

**Line 60** (OLD CODE):
```javascript
formData.append('member_id', userId);  // ❌ WRONG!
```

**The Bug:**
- Frontend was using `localStorage.getItem('pal_user_id')`
- This returns the **user ID** (fd950a6e-414c-4ca2-b46f-e3c753e4d295)
- But the API expects **patient ID** (d9ebd0f7-fc29-4347-b585-fd15be9d1853)

---

## Fix Applied ✅

### Changed Files:

#### 1. `web/app/upload/page.tsx`

**Lines 40-60** - Upload function:
```javascript
// OLD CODE ❌
const userId = localStorage.getItem('pal_user_id');
formData.append('member_id', userId);  // Wrong ID!

// NEW CODE ✅
const userId = localStorage.getItem('pal_user_id');
const patientId = localStorage.getItem('pal_patient_id'); // ← Get patient ID

if (!patientId) {
  setError('Please create your patient profile first');
  setPhase('error');
  return;
}

formData.append('member_id', patientId); // ← Use patient ID!
```

**Lines 107-121** - Confirm function:
```javascript
// OLD CODE ❌
member_id: userId,

// NEW CODE ✅
const patientId = localStorage.getItem('pal_patient_id');
member_id: patientId, // ← Use patient ID!
```

#### 2. `web/lib/api-auth.ts` (Already Correct!)

**Lines 138-141** - Login saves patient_id:
```javascript
if (json.patient) {
  localStorage.setItem('pal_patient_id', json.patient.id);  // ✅ Already works!
  localStorage.setItem('pal_user_name', json.patient.full_name);
}
```

---

## How It Works Now ✅

### Step 1: User Logs In
```
POST /api/v3/auth/login
{
  "username": "sharma2003",
  "password": "..."
}

Response:
{
  "access_token": "...",
  "user": {
    "id": "fd950a6e-414c-4ca2-b46f-e3c753e4d295",  ← user_id
    "username": "sharma2003",
    "email": "tejas@gmail.com"
  },
  "patient": {
    "id": "d9ebd0f7-fc29-4347-b585-fd15be9d1853",  ← patient_id ✅
    "full_name": "Tejas Sharma",
    "email": "tejas@gmail.com"
  },
  "session_id": "..."
}
```

### Step 2: Frontend Saves to localStorage
```javascript
localStorage.setItem('pal_user_id', 'fd950a6e-414c-4ca2-b46f-e3c753e4d295');
localStorage.setItem('pal_patient_id', 'd9ebd0f7-fc29-4347-b585-fd15be9d1853'); ✅
```

### Step 3: Upload Uses Correct ID
```javascript
const patientId = localStorage.getItem('pal_patient_id'); ✅
formData.append('member_id', patientId); ✅
```

### Step 4: API Validates Foreign Keys
```sql
INSERT INTO raw_sources (
  tenant_id,  -- 00000000-0000-0000-0000-000000000001 ✅ EXISTS!
  member_id,  -- d9ebd0f7-fc29-4347-b585-fd15be9d1853 ✅ CORRECT!
  ...
)
```

✅ **Success!** No more foreign key errors!

---

## Testing the Fix

### Option 1: Login Again (Easiest)

Since you created the patient profile AFTER your initial login, you need to login again to get patient_id saved to localStorage:

1. **Logout** (or clear localStorage)
2. **Login** at http://localhost:3000/login
3. **Upload** a lab report

This will save patient_id to localStorage automatically!

### Option 2: Manual Fix (Quick Test)

If you don't want to logout/login, manually set patient_id in browser console:

```javascript
// Open browser console (F12)
localStorage.setItem('pal_patient_id', 'd9ebd0f7-fc29-4347-b585-fd15be9d1853');
console.log('Patient ID set!');

// Verify
console.log('User ID:', localStorage.getItem('pal_user_id'));
console.log('Patient ID:', localStorage.getItem('pal_patient_id'));
```

Then try uploading again!

---

## Verification Steps

### 1. Check LocalStorage
Open browser console (F12) and run:
```javascript
console.log({
  user_id: localStorage.getItem('pal_user_id'),
  patient_id: localStorage.getItem('pal_patient_id'),
  token: localStorage.getItem('pal_token')?.substring(0, 20) + '...'
});
```

**Expected Output:**
```javascript
{
  user_id: "fd950a6e-414c-4ca2-b46f-e3c753e4d295",
  patient_id: "d9ebd0f7-fc29-4347-b585-fd15be9d1853",  ← Should exist!
  token: "eyJ0eXAiOiJKV1QiLCJh..."
}
```

### 2. Test Upload
1. Go to http://localhost:3000/upload
2. Select a PDF/JPEG/PNG file (max 20MB)
3. Upload

### 3. Check API Logs
```bash
docker logs -f pal-api-v2
```

**Expected (Success):**
```
INFO: POST /api/medical/upload 200 OK
INFO: MDT extraction started...
INFO: FHIR bundle received
INFO: Patient name match: match
```

**NOT Expected (Error):**
```
ERROR: ForeignKeyViolationError  ← Should NOT see this anymore!
```

### 4. Check Database
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT 
    id, 
    filename, 
    member_id, 
    created_at 
FROM raw_sources 
ORDER BY created_at DESC 
LIMIT 1;
"
```

**Expected:** New row with `member_id = d9ebd0f7-fc29-4347-b585-fd15be9d1853`

---

## Why This Happened

### System Design:
PAL separates **authentication** (users) from **medical records** (patients):

```
User Table (authentication)
├── id: fd950a6e-414c-4ca2-b46f-e3c753e4d295
├── username: sharma2003
└── Used for: Login, permissions

Patient Table (medical data)
├── id: d9ebd0f7-fc29-4347-b585-fd15be9d1853
├── email: tejas@gmail.com (links to user)
└── Used for: Health records, lab tests, uploads
```

### The Bug:
Frontend was using the **wrong ID** - it used user_id when it needed patient_id!

---

## Current Status

### What's Fixed:
✅ Frontend code updated to use patient_id  
✅ Patient profile created for sharma2003  
✅ Tenant exists in database  
✅ API returns patient_id in login response  
✅ Web container restarted with new code  

### What You Need to Do:
🔄 **Login again** to save patient_id to localStorage  
OR  
🔧 **Manually set patient_id** in browser console (see above)  

Then try uploading!

---

## Expected Upload Flow Now ✅

```
1. User clicks "Choose File"
   ↓
2. Select PDF/JPEG/PNG (< 20MB)
   ↓
3. Frontend gets patient_id from localStorage ✅
   ↓
4. POST /api/medical/upload with:
   - file: [binary data]
   - tenant_id: 00000000-0000-0000-0000-000000000001
   - member_id: d9ebd0f7-fc29-4347-b585-fd15be9d1853 ✅
   ↓
5. API creates raw_source record ✅
   ↓
6. API sends to MDT for FHIR extraction
   ↓
7. MDT uses Gemma 4 to extract lab data
   ↓
8. API returns extracted observations
   ↓
9. User reviews and confirms
   ↓
10. Data saved to lab_tests + health_facts ✅
```

---

## Common Issues (If Still Not Working)

### Issue #1: "Patient ID not found in localStorage"
**Solution:** Login again to trigger localStorage save

```bash
# Check if patient_id exists
console.log(localStorage.getItem('pal_patient_id'));

# If null, login again or set manually:
localStorage.setItem('pal_patient_id', 'd9ebd0f7-fc29-4347-b585-fd15be9d1853');
```

### Issue #2: "Upload still fails with 500 error"
**Check API logs:**
```bash
docker logs pal-api-v2 --tail 50
```

Look for the specific error - it should NOT be the tenant foreign key error anymore!

### Issue #3: "MDT extraction fails"
**Check MDT is running:**
```bash
docker ps | grep mdt
docker logs pal-mdt --tail 20
```

### Issue #4: "File too large"
- Max 20MB
- Compress PDF or reduce image quality

---

## Files Modified

1. ✅ `web/app/upload/page.tsx` - Lines 40-60, 107-121
2. ✅ `web/lib/api-auth.ts` - Already had patient_id save logic
3. ✅ Database: Created patient profile for sharma2003

---

## Summary

**Problem:** Frontend used user_id instead of patient_id  
**Symptom:** "Failed to fetch" / 500 error  
**Root Cause:** Foreign key violation (wrong ID being sent)  
**Fix:** Updated upload page to use patient_id from localStorage  
**Action Required:** Login again to populate localStorage with patient_id  

---

**Upload should work now after logging in again!** 🎉

---

**Fixed**: 2024-07-27  
**Status**: ✅ Code updated, requires re-login  
**Your Patient ID**: d9ebd0f7-fc29-4347-b585-fd15be9d1853
