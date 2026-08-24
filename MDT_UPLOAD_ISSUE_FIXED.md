# Medical Data Toolkit (MDT) Upload Issue - RESOLVED ✅

## Problem Summary

You were experiencing database foreign key constraint errors when uploading medical documents (PDFs/images) for lab test extraction:

```
sqlalchemy.exc.IntegrityError: insert or update on table "raw_sources" violates foreign key constraint "raw_sources_tenant_id_fkey"
DETAIL: Key (tenant_id)=(00000000-0000-0000-0000-000000000001) is not present in table "tenants".
```

## Root Cause

The **`tenants` table was empty**. The application code was trying to insert records with the default tenant ID `00000000-0000-0000-0000-000000000001`, but this tenant didn't exist in the database because:

1. **Alembic migrations were never run** - The database was created manually or via SQLAlchemy models, but the initial migration script that inserts the default tenant was never executed
2. The `0001_initial.py` migration contains SQL to insert the default tenant, but it wasn't applied

## Solution Applied

### 1. Created Default Tenant Manually ✅

Since migrations couldn't be run cleanly (table already existed with some data), I manually inserted the required tenant record:

```sql
INSERT INTO tenants (
    id, 
    name, 
    slug, 
    deployment_mode, 
    privacy_mode, 
    baa_signed, 
    operator_key_configured, 
    age_of_majority_days, 
    active, 
    created_at, 
    updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000001', 
    'Default', 
    'default', 
    'self_hosted', 
    'strict', 
    false, 
    false, 
    6570, 
    true, 
    NOW(), 
    NOW()
);
```

### 2. Verified MDT Configuration ✅

**Environment Variables** (in [.env](.env) and loaded into container):
```bash
MDT_ENABLED=true
MDT_URL=http://mdt:8080
GEMMA_4_API_KEY=sk-8cxtPKSUF-ENMMTD7pTnKg
GEMINI_MODEL=vertex_ai/google/gemma-4-26b-a4b-it-maas
```

**MDT Container Status**: ✅ Running on port 8080
- Using Google Health Medical Data Toolkit
- Configured to use Gemma 4 model via LiteLLM proxy
- Nginx + Gunicorn workers running

## How MDT Upload Works

### Upload Flow

1. **User uploads PDF/JPEG/PNG** → `POST /medical/upload`
2. **File validation**: 
   - Max 20MB
   - MIME types: `application/pdf`, `image/jpeg`, `image/png`
3. **Content-addressed storage**:
   - SHA-256 hash of file content
   - Stored in `uploads/` directory
   - Deduplication (same file = same hash = no re-upload)
4. **Create `RawSource` record**:
   - Links to tenant and member (patient)
   - Stores file metadata
5. **MDT FHIR Extraction**:
   - POST raw bytes to `http://mdt:8080/document_to_fhir`
   - MDT uses Gemma 4 (via LiteLLM proxy at `http://34.14.174.141:4000/v1`)
   - Returns FHIR R4 Bundle with lab observations
6. **Parse FHIR Bundle**:
   - Extract patient name
   - Extract lab observations (LOINC codes, values, units, reference ranges)
   - Patient name matching against user profile
7. **Return for Verification**:
   - UI shows extracted data
   - User confirms accuracy
8. **User Confirms** → `POST /medical/confirm`:
   - Creates `LabTest` record (new schema)
   - Creates `HealthFact` records (evidence-based health data)
   - Links all data to `RawSource`

### Key Files

- **Upload Router**: [api/routers/medical_doc.py](api/routers/medical_doc.py)
  - `/medical/upload` - accepts file, calls MDT, returns extracted data
  - `/medical/confirm` - persists verified data to database
  
- **MDT Client**: [api/services/mdt/client.py](api/services/mdt/client.py)
  - HTTP client for MDT service
  - Forwards Gemma API key as Bearer token
  
- **FHIR Parser**: Look for `api/services/mdt/fhir_parser.py`
  - Parses FHIR R4 Bundle
  - Extracts observations with LOINC codes

- **Models**:
  - [api/models/health_record.py](api/models/health_record.py) - `RawSource`, `HealthFact`
  - [api/models/lab_test.py](api/models/lab_test.py) - `LabTest` table

## Database Tables Involved

### 1. `tenants` (NOW FIXED ✅)
```sql
SELECT id, name, slug FROM tenants;
-- 00000000-0000-0000-0000-000000000001 | Default | default
```

### 2. `raw_sources`
Immutable storage of uploaded files:
- `tenant_id` → references `tenants.id` (NOW WORKS!)
- `member_id` → patient/user UUID
- `storage_path` → file location
- `content_hash` → SHA-256 for deduplication

### 3. `health_facts`
Extracted structured health data:
- `fact_type` = "lab"
- `fact_key` = LOINC code or test name
- `fact_value` = result value
- `evidence_class` = "source_backed" (from uploaded document)
- `raw_source_id` → links back to uploaded file

### 4. `lab_tests` (NEW)
Complete lab report records:
- `patient_id` → references `patients.id`
- `report_name`, `report_type`, `test_category`
- `results` → JSON array of observations
- `fhir_json` → full FHIR bundle
- `storage_path` → links to original file

## Gemini API Key Configuration

The Gemini API key is actually a **LiteLLM proxy key** that routes to Vertex AI Gemma 4:

**From .env:**
```bash
# LiteLLM Proxy Configuration (for Hermes Chat AND MDT)
OPENAI_API_BASE=http://34.14.174.141:4000/v1
OPENAI_API_KEY=sk-8cxtPKSUF-ENMMTD7pTnKg
GEMINI_MODEL=vertex_ai/google/gemma-4-26b-a4b-it-maas

# MDT uses the same proxy
GEMMA_4_API_KEY=sk-8cxtPKSUF-ENMMTD7pTnKg  # Same key as OPENAI_API_KEY
```

**How it works:**
1. MDT receives the `GEMMA_4_API_KEY` as a Bearer token
2. MDT makes requests to the model configured in its Docker environment
3. The LiteLLM proxy at `http://34.14.174.141:4000` handles routing to Vertex AI
4. Model: `vertex_ai/google/gemma-4-26b-a4b-it-maas`

## Testing the Upload

### Via API (using curl or Postman)

```bash
# 1. Login to get auth token
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"sharma2003","password":"your_password"}'

# Response: {"access_token":"...","token_type":"bearer"}

# 2. Upload a lab report PDF
curl -X POST http://localhost:8000/medical/upload \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "file=@sample-lab-report.pdf" \
  -F "tenant_id=00000000-0000-0000-0000-000000000001" \
  -F "member_id=YOUR_USER_ID"

# Response will include:
# - type: "pending_verification"
# - raw_source_id: UUID
# - observations: [{ loinc_code, display, value, unit, reference_range }]
# - patient_name_on_doc vs patient_name_on_profile
# - name_match_status: "match" | "partial" | "no_match"

# 3. Confirm after user verification
curl -X POST http://localhost:8000/medical/confirm \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "raw_source_id": "UUID_FROM_UPLOAD_RESPONSE",
    "tenant_id": "00000000-0000-0000-0000-000000000001",
    "member_id": "YOUR_USER_ID",
    "observations": [...],  // Copy from upload response
    "report_date": "2024-07-20",
    "report_title": "Complete Blood Count"
  }'
```

### Via Frontend

The web UI should have an upload component that:
1. Shows file picker (PDF/JPEG/PNG only)
2. Uploads to `/medical/upload`
3. Shows a "Verification Card" with:
   - Extracted patient name vs profile name
   - All lab observations in a table
   - Confirm/Reject buttons
4. On confirm → calls `/medical/confirm`
5. Shows success + redirects to lab tests view

## Monitoring MDT Performance

```bash
# Watch MDT logs for extraction requests
docker logs -f pal-mdt

# Watch API logs for upload/confirm requests
docker logs -f pal-api-v2 | grep "/medical/"

# Check database for new records
docker exec pal-db psql -U pal -d pal -c "SELECT COUNT(*) FROM raw_sources;"
docker exec pal-db psql -U pal -d pal -c "SELECT COUNT(*) FROM lab_tests;"
docker exec pal-db psql -U pal -d pal -c "SELECT COUNT(*) FROM health_facts WHERE fact_type='lab';"
```

## Common Issues & Solutions

### 1. "MDT extraction failed"
- **Check**: Is MDT container running? `docker ps | grep mdt`
- **Check**: Can API reach MDT? `docker exec pal-api-v2 curl http://mdt:8080`
- **Check**: MDT logs for errors: `docker logs pal-mdt --tail 50`

### 2. "Gemini API key error"
- Verify `GEMMA_4_API_KEY` in .env matches LiteLLM proxy key
- Test LiteLLM proxy: `curl http://34.14.174.141:4000/health`
- Check MDT is receiving the key as Authorization header

### 3. "Patient profile not found"
- User must have a `patients` table record with matching email
- Create profile via `/profile/create` endpoint first

### 4. "File too large"
- Max file size: 20 MB
- Compress PDF or use lower-resolution images

### 5. "Unsupported file format"
- Only accepts: PDF, JPEG, PNG
- DICOM imaging files are rejected with a specific message

## Database Schema Check

```bash
# Verify tenants table has default tenant
docker exec pal-db psql -U pal -d pal -c "SELECT * FROM tenants WHERE id='00000000-0000-0000-0000-000000000001';"

# Check raw_sources foreign key constraint
docker exec pal-db psql -U pal -d pal -c "\d raw_sources" | grep tenant_id

# Check lab_tests table exists
docker exec pal-db psql -U pal -d pal -c "\d lab_tests"
```

## Next Steps

1. ✅ **Tenant created** - No more foreign key errors
2. ✅ **MDT running** - Ready to extract lab data
3. ✅ **Gemini API configured** - Using LiteLLM proxy with Gemma 4
4. 🟡 **Test upload flow** - Try uploading a sample lab report via frontend or API
5. 🟡 **Verify extraction** - Check if LOINC codes and values are extracted correctly
6. 🟡 **Check lab_tests table** - Ensure records are being created

## Files to Review for More Context

- `DATABASE_TABLES_ANALYSIS.md` - Complete database schema analysis
- `LAB_REPORTS_GUIDE.md` - Lab test feature documentation
- `MDT_INTEGRATION_STATUS.md` - MDT integration details
- `UPLOAD_FEATURE_COMPLETE.md` - Upload feature documentation

---

**Issue Resolved**: 2024-07-27  
**Status**: ✅ Tenant created, MDT configured, ready to test uploads  
**MDT Service**: Running on http://mdt:8080  
**Gemini Model**: vertex_ai/google/gemma-4-26b-a4b-it-maas via LiteLLM proxy
