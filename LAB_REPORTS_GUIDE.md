# Lab Tests Migration to Report-Based Structure

## ✅ Migration Complete!

The `lab_tests` table has been upgraded to support modern lab report workflows including OCR, PDF uploads, and FHIR compliance.

---

## 📋 What Changed

### ❌ Removed Columns:
- `test_name` → **Replaced with** `report_name`
- `reference_range` → **Moved into** `results` JSON (per observation)
- `abnormal_flag` → **Replaced with** `has_abnormal_values`

### ➕ Added Columns:

#### Report Identification
- **`report_name`** (VARCHAR 255, NOT NULL) - E.g., "Complete Blood Count"
- **`report_type`** (VARCHAR 100) - E.g., CBC, LFT, KFT, Lipid Profile
- **`has_abnormal_values`** (BOOLEAN) - Report-level flag

#### File Metadata
- **`report_format`** (VARCHAR 50) - PDF, Image, Scanned PDF, HL7, FHIR
- **`file_name`** (VARCHAR 512) - Original filename
- **`file_size`** (BIGINT) - File size in bytes
- **`mime_type`** (VARCHAR 128) - E.g., application/pdf, image/jpeg
- **`storage_path`** (VARCHAR 512) - Path in object storage

#### Processing Metadata
- **`processing_status`** (VARCHAR 50) - pending, processing, completed, failed
- **`confidence_score`** (FLOAT) - OCR confidence (0.0 - 1.0)
- **`processed_at`** (TIMESTAMP) - When extraction completed
- **`extraction_model`** (VARCHAR 100) - E.g., claude-3-sonnet, gpt-4-vision
- **`extraction_version`** (VARCHAR 50) - Extraction pipeline version

#### Structured Data
- **`raw_extracted_json`** (JSONB) - Raw OCR output before normalization
- **`fhir_json`** (JSONB) - FHIR DiagnosticReport representation
- **`verified_date`** (DATE) - If different from result_date

---

## 🔄 Migration Steps

### Step 1: Run the Migration

```bash
cd c:\PAL

# Start database
docker-compose up -d db

# Wait for database to be ready
sleep 5

# Run migration
docker exec pal-api-1 alembic upgrade head
```

### Step 2: Verify Migration

```bash
# Check table structure
docker exec pal-db-1 psql -U pal -d pal -c "\d lab_tests"

# Check existing data was migrated
docker exec pal-db-1 psql -U pal -d pal -c "SELECT id, report_name, report_type, has_abnormal_values FROM lab_tests LIMIT 5;"
```

### Step 3: Restart Services

```bash
# Rebuild API (new models)
docker-compose up -d --build api

# Rebuild MCP server (new columns)
docker-compose up -d --build mcp-api
```

---

## 📊 New Results JSON Structure

### Old Format (Deprecated):
```json
{
  "cholesterol_total": {"value": 200, "unit": "mg/dL"},
  "ldl": {"value": 162, "unit": "mg/dL"}
}
```

### New Format (Recommended):
```json
[
  {
    "name": "Cholesterol Total",
    "value": 200,
    "unit": "mg/dL",
    "range": "125-200",
    "abnormal": false
  },
  {
    "name": "LDL",
    "value": 162,
    "unit": "mg/dL",
    "range": "<100",
    "abnormal": true
  },
  {
    "name": "HDL",
    "value": 45,
    "unit": "mg/dL",
    "range": ">40",
    "abnormal": false
  }
]
```

**Benefits:**
- ✅ Per-observation reference ranges
- ✅ Per-observation abnormal flags
- ✅ Consistent array structure
- ✅ Easy to render in UI

---

## 🔧 API Changes

### MCP Server Endpoints

#### GET /api/v1/patients/:id/lab-tests
**Old Response:**
```json
{
  "test_name": "Lipid Panel",
  "abnormal_flag": true,
  "reference_range": "See individual parameters"
}
```

**New Response:**
```json
{
  "report_name": "Lipid Panel",
  "report_type": "Lipid Profile",
  "has_abnormal_values": true,
  "report_format": "PDF",
  "processing_status": "completed",
  "confidence_score": 0.95
}
```

#### POST /api/v1/patients/:id/lab-tests
**Old Request:**
```json
{
  "testName": "Lipid Panel",
  "abnormalFlag": true
}
```

**New Request:**
```json
{
  "reportName": "Lipid Panel",
  "reportType": "Lipid Profile",
  "hasAbnormalValues": true,
  "reportFormat": "PDF",
  "fileName": "lipid_panel_2026.pdf",
  "processingStatus": "completed"
}
```

### FastAPI Router

**Updated routes:**
- `GET /lab-tests/patient/{patient_id}` - List all lab reports
- `GET /lab-tests/{test_id}` - Get detailed report with all metadata
- `POST /lab-tests/patient/{patient_id}` - Create new lab report

---

## 🎯 Use Cases Enabled

### 1. **PDF Upload Workflow**
```python
# Upload PDF report
lab_test = LabTest(
    patient_id=patient_id,
    report_name="Complete Blood Count",
    report_type="CBC",
    report_format="PDF",
    file_name="cbc_report.pdf",
    file_size=245678,
    mime_type="application/pdf",
    storage_path="s3://bucket/patient123/cbc_report.pdf",
    processing_status="pending"
)
```

### 2. **OCR Extraction Tracking**
```python
# After OCR processing
lab_test.processing_status = "completed"
lab_test.processed_at = datetime.now()
lab_test.extraction_model = "claude-3-sonnet"
lab_test.extraction_version = "v2.1"
lab_test.confidence_score = 0.95
lab_test.raw_extracted_json = {...}  # Raw OCR output
lab_test.results = [...]  # Normalized observations
```

### 3. **FHIR Compliance**
```python
# Generate FHIR representation
lab_test.fhir_json = {
    "resourceType": "DiagnosticReport",
    "id": str(lab_test.id),
    "status": "final",
    "code": {
        "coding": [{
            "system": "http://loinc.org",
            "code": "24331-1",
            "display": "Lipid panel"
        }]
    },
    "result": [...]
}
```

---

## 🧪 Testing

### Test 1: Check Migration
```bash
docker exec pal-db-1 psql -U pal -d pal -c "
SELECT 
  id,
  report_name,
  report_type,
  has_abnormal_values,
  processing_status
FROM lab_tests
LIMIT 5;
"
```

### Test 2: Create New Lab Report
```bash
curl -X POST http://localhost:3001/api/v1/patients/5e44a95d-d09c-4f46-b92c-9bc4c08ecdae/lab-tests \
  -H "X-API-Key: pal-secret-key-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "reportName": "Complete Blood Count",
    "reportType": "CBC",
    "orderedDate": "2026-07-26",
    "results": [
      {"name": "Hemoglobin", "value": 14.5, "unit": "g/dL", "range": "13.5-17.5", "abnormal": false},
      {"name": "WBC", "value": 12.5, "unit": "10^3/μL", "range": "4.5-11.0", "abnormal": true}
    ],
    "hasAbnormalValues": true,
    "reportFormat": "PDF",
    "processingStatus": "completed"
  }'
```

### Test 3: Query via Hermes Chat
```bash
curl -X POST http://localhost:8000/hermes/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What were my CBC results?",
    "patient_id": "5e44a95d-d09c-4f46-b92c-9bc4c08ecdae"
  }'
```

---

## 📁 Files Changed

### Backend:
1. ✅ **`api/alembic/versions/005_migrate_lab_tests_to_reports.py`** - Migration script
2. ✅ **`api/models/lab_test.py`** - Updated SQLAlchemy model
3. ✅ **`api/routers/lab_tests.py`** - Updated router with new columns
4. ✅ **`api/routers/hermes_chat.py`** - Updated to use `report_name` and `has_abnormal_values`

### MCP Server:
5. ✅ **`mcp-server/server.js`** - Updated GET/POST endpoints for new columns

---

## ⚠️ Breaking Changes

### API Clients Must Update:
- ❌ `test_name` → ✅ `report_name`
- ❌ `abnormal_flag` → ✅ `has_abnormal_values`
- ❌ `reference_range` (top-level) → ✅ Inside `results` array per observation

### Database Queries:
```sql
-- Old query (will fail after migration)
SELECT test_name, abnormal_flag FROM lab_tests;

-- New query
SELECT report_name, has_abnormal_values FROM lab_tests;
```

---

## 🔄 Rollback (If Needed)

```bash
# Revert migration
docker exec pal-api-1 alembic downgrade -1

# This will:
# - Restore test_name, reference_range, abnormal_flag
# - Remove new columns
# - Migrate data back
```

---

## ✅ Migration Checklist

After running migration:
- [ ] Database schema updated successfully
- [ ] Existing data migrated (test_name → report_name)
- [ ] API container rebuilt with new models
- [ ] MCP server rebuilt with new columns
- [ ] FastAPI endpoints return new column names
- [ ] Hermes chat works with new structure
- [ ] Frontend displays lab reports correctly

---

## 🎉 What's Next?

1. **Upload PDF Reports:** Implement file upload endpoint
2. **OCR Integration:** Connect Claude Vision or Tesseract for extraction
3. **FHIR Export:** Generate FHIR DiagnosticReport JSON
4. **Report Viewer:** Build UI to display PDF + extracted data side-by-side

---

**Migration created:** 2026-07-26
**Revision ID:** 005_lab_reports
**Status:** ✅ Ready to apply
