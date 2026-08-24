# PDF/Image Upload - Required Parameters Guide

## What You Need to Upload

When uploading a medical document (PDF, JPEG, PNG), you need to pass **3 required parameters**:

### 1. `file` - The actual file
```
Type: File upload (multipart/form-data)
Formats: PDF, JPEG, PNG
Max Size: 20 MB
```

### 2. `tenant_id` - Organization/Account ID
```
Type: UUID string
Your Value: 00000000-0000-0000-0000-000000000001
Why: Links upload to your tenant (organization)
```

### 3. `member_id` - Patient ID (NOT user_id!)
```
Type: UUID string  
Your Value: (Patient's UUID from database)
Why: Links upload to the specific patient
```

---

## ⚠️ IMPORTANT: `member_id` = Patient ID, NOT User ID!

### Common Confusion:

```
❌ WRONG: member_id = user_id (fd950a6e-414c-4ca2-b46f-e3c753e4d295)
✅ CORRECT: member_id = patient_id (from patients table)
```

### Why the Difference?

**Your system has TWO separate concepts:**

1. **User** = Login account (authentication)
   - Table: `users`
   - Used for: Login, password, sessions
   - Your user: `sharma2003` (tejas@gmail.com)
   
2. **Patient** = Health record profile (medical data)
   - Table: `patients`
   - Used for: Medical records, lab tests, prescriptions
   - Links to user via email

```
User (sharma2003)
├── id: fd950a6e-414c-4ca2-b46f-e3c753e4d295
├── username: sharma2003
├── email: tejas@gmail.com
└── Used for: Login ✅

Patient Profile
├── id: <DIFFERENT UUID>  ← This is member_id!
├── email: tejas@gmail.com (links to user)
├── full_name: Your name
└── Used for: Medical records ✅
```

---

## How to Get Your Patient ID

### Option 1: Query Database
```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT 
    p.id as patient_id,
    p.full_name,
    p.email,
    u.username as linked_user
FROM patients p
LEFT JOIN users u ON u.email = p.email
WHERE p.email = 'tejas@gmail.com';
"
```

### Option 2: API Endpoint (Check if exists)
```bash
# Get user profile (might return patient_id)
curl -X GET http://localhost:8000/user/profile \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Option 3: Check API Code
The `/user/profile` endpoint should return both user info and patient info.

---

## Your Current Setup (sharma2003)

Based on your database:

```bash
User:
├── user_id: fd950a6e-414c-4ca2-b46f-e3c753e4d295
├── username: sharma2003
└── email: tejas@gmail.com

Patient:
├── patient_id: <We need to find this!>
├── email: tejas@gmail.com
└── full_name: (your name)

Tenant:
└── tenant_id: 00000000-0000-0000-0000-000000000001
```

Let me check your patient ID...

---

## Upload Request Examples

### Via Frontend (React/Next.js)

```javascript
// Upload form component
async function uploadLabReport(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('tenant_id', '00000000-0000-0000-0000-000000000001');
  formData.append('member_id', patientId); // ← Get from user profile API
  
  const response = await fetch('http://localhost:8000/medical/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`
    },
    body: formData
  });
  
  return await response.json();
}
```

### Via curl (Command Line)

```bash
# 1. Login to get token
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"sharma2003","password":"YOUR_PASSWORD"}' \
  | jq -r '.access_token')

# 2. Get patient ID from profile
PATIENT_ID=$(curl -s -X GET http://localhost:8000/user/profile \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '.patient_id')  # or wherever patient_id is returned

# 3. Upload PDF
curl -X POST http://localhost:8000/medical/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/lab-report.pdf" \
  -F "tenant_id=00000000-0000-0000-0000-000000000001" \
  -F "member_id=$PATIENT_ID"
```

### Via Postman

```
POST http://localhost:8000/medical/upload

Headers:
- Authorization: Bearer YOUR_TOKEN

Body (form-data):
- file: [Select PDF file]
- tenant_id: 00000000-0000-0000-0000-000000000001
- member_id: <your-patient-uuid>
```

---

## Backend Code (How It's Used)

From `api/routers/medical_doc.py`:

```python
@router.post("/upload")
async def upload_medical_document(
    file: UploadFile = File(...),
    tenant_id: str = Form(...),        # ← Required!
    member_id: str = Form(...),         # ← Required! (patient_id)
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Convert to UUIDs
    t_id = uuid.UUID(tenant_id)
    m_id = uuid.UUID(member_id)  # This is patient_id
    
    # Create raw source record
    raw_source = RawSource(
        tenant_id=t_id,      # Links to tenant
        member_id=m_id,      # Links to patient (NOT user!)
        source_type="upload",
        filename=file.filename,
        # ...
    )
```

**Note:** The `member_id` parameter name is a bit confusing - it's actually the `patient_id`!

---

## Database Relationship Flow

When you upload a file:

```
Upload Request
├── tenant_id: 00000000-0000-0000-0000-000000000001
├── member_id: <patient-uuid>
└── file: lab-report.pdf

↓

raw_sources table
├── id: <new-uuid>
├── tenant_id: 00000000-0000-0000-0000-000000000001 → tenants.id ✅
├── member_id: <patient-uuid>  ← Stored as-is (patient ID)
└── storage_path: uploads/abc123.pdf

↓ (After MDT extraction and confirmation)

lab_tests table
├── id: <new-uuid>
├── patient_id: <patient-uuid>  ← From raw_source.member_id
├── report_name: "Complete Blood Count"
└── results: [{...}]

health_facts table
├── tenant_id: 00000000-0000-0000-0000-000000000001
├── member_id: <patient-uuid>  ← Same as raw_source.member_id
├── fact_type: "lab"
└── fact_value: "120 mg/dL"
```

**All linked by patient_id (stored as member_id in some tables)!**

---

## Why Two IDs? (User vs Patient)

### Design Pattern: Separation of Concerns

**User Table** (Authentication & Authorization)
```sql
users
├── id: UUID
├── username: VARCHAR    ← Login credential
├── email: VARCHAR
├── hashed_password      ← Security
├── roles: JSONB         ← Permissions
└── is_active: BOOLEAN
```
**Purpose:** Security, authentication, permissions

**Patient Table** (Medical Data)
```sql
patients
├── id: UUID
├── email: VARCHAR        ← Links to user
├── full_name: VARCHAR
├── date_of_birth: DATE
├── blood_group: VARCHAR
├── allergies: TEXT[]
├── chronic_conditions: TEXT[]
└── current_medications: TEXT[]
```
**Purpose:** Health records, medical data

### Why Separate?

1. **One user can have multiple patients**
   - Parent managing child's records
   - Caregiver managing elderly parent's records
   - Family account

2. **One patient can have multiple users accessing**
   - Patient themselves
   - Doctor
   - Nurse
   - Family member (with consent)

3. **Different lifecycles**
   - User might be deleted (account closed)
   - Patient record must be retained (legal requirement)

4. **Security isolation**
   - User credentials separate from medical data
   - Easier to audit access

---

## Frontend Flow (How to Handle This in UI)

### Step 1: User Logs In
```javascript
// Login response
{
  "access_token": "eyJ0eXAi...",
  "token_type": "bearer",
  "user": {
    "id": "fd950a6e-414c-4ca2-b46f-e3c753e4d295",
    "username": "sharma2003",
    "email": "tejas@gmail.com"
  }
}
```

### Step 2: Fetch User Profile (Including Patient Info)
```javascript
// GET /user/profile
{
  "user_id": "fd950a6e-414c-4ca2-b46f-e3c753e4d295",
  "username": "sharma2003",
  "email": "tejas@gmail.com",
  "patient": {
    "id": "<patient-uuid>",  // ← This is what you need!
    "full_name": "Tejas Sharma",
    "date_of_birth": "2003-01-01",
    // ...
  }
}
```

### Step 3: Store Patient ID in State
```javascript
const [patientId, setPatientId] = useState(null);

useEffect(() => {
  async function fetchProfile() {
    const profile = await fetch('/user/profile');
    setPatientId(profile.patient.id);
  }
  fetchProfile();
}, []);
```

### Step 4: Use Patient ID in Upload
```javascript
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('tenant_id', TENANT_ID);
  formData.append('member_id', patientId); // ← From state
  
  await fetch('/medical/upload', {
    method: 'POST',
    body: formData
  });
}
```

---

## API Endpoint to Get Patient ID

You might want to create/update an endpoint to return patient info:

```python
# In api/routers/auth_new.py or api/routers/records.py

@router.get("/user/profile")
async def get_user_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Get patient record linked to user email
    patient = await db.execute(
        select(Patient).where(Patient.email == user.email)
    )
    patient = patient.scalar_one_or_none()
    
    return {
        "user_id": str(user.id),
        "username": user.username,
        "email": user.email,
        "patient": {
            "id": str(patient.id) if patient else None,
            "full_name": patient.full_name if patient else None,
            # ...
        } if patient else None
    }
```

---

## Quick Check: Get Your Patient ID Now

Run this command to get your patient ID:

```bash
docker exec pal-db psql -U pal -d pal -c "
SELECT id, full_name, email 
FROM patients 
WHERE email = 'tejas@gmail.com';
"
```

**Save this UUID - you'll need it for uploads!**

---

## Summary: Upload Parameters Checklist

```
✅ file              - PDF/JPEG/PNG (max 20MB)
✅ tenant_id         - 00000000-0000-0000-0000-000000000001 (your default tenant)
✅ member_id         - <patient_id from patients table> (NOT user_id!)
✅ Authorization     - Bearer token from login
```

---

## Common Errors

### ❌ Error: "Invalid UUID"
```
Cause: Wrong format for tenant_id or member_id
Fix: Use proper UUID format (with dashes)
```

### ❌ Error: "Foreign key violation - tenant_id"
```
Cause: Tenant doesn't exist in database
Fix: Already fixed! ✅ Default tenant created
```

### ❌ Error: "Patient not found"
```
Cause: member_id doesn't match any patient
Fix: Get correct patient_id from database/API
```

### ❌ Error: "File too large"
```
Cause: File > 20MB
Fix: Compress PDF or reduce image quality
```

---

## Testing the Upload

### 1. Get Your Patient ID
```bash
PATIENT_ID=$(docker exec pal-db psql -U pal -d pal -t -c "
SELECT id FROM patients WHERE email = 'tejas@gmail.com';
" | tr -d ' ')

echo "Your patient ID: $PATIENT_ID"
```

### 2. Test Upload
```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"sharma2003","password":"YOUR_PASSWORD"}' \
  | jq -r '.access_token')

# Upload
curl -X POST http://localhost:8000/medical/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@sample.pdf" \
  -F "tenant_id=00000000-0000-0000-0000-000000000001" \
  -F "member_id=$PATIENT_ID" \
  | jq
```

---

**Bottom Line:** Yes, you need to pass patient_id (as `member_id` parameter) along with `tenant_id` and the file itself when uploading!
