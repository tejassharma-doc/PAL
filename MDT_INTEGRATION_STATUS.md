# Medical Data Toolkit Integration - IN PROGRESS

## What We're Doing

Integrating the **Google Health Medical Data Toolkit** to enable automatic extraction of lab values from uploaded PDF/image reports.

---

## Current Status: 🔨 BUILDING MDT DOCKER IMAGE

The Medical Data Toolkit needs to run as a separate Docker container that provides a REST API endpoint for FHIR extraction.

### What's Happening Now:

1. **✅ Cloned Repository:** `https://github.com/Google-Health/medical-data-toolkit`
2. **🔨 Building Docker Image:** `medical-data-toolkit-image` (in progress...)
3. **✅ Added to docker-compose.yml:** MDT service will run on port 8080
4. **✅ Updated .env:** `MDT_URL=http://mdt:8080`

---

## Architecture

```
User uploads PDF/Image
    ↓
PAL API (/api/medical/upload)
    ↓
Save to ./uploads/ (content-addressed)
    ↓
POST to MDT Container (http://mdt:8080/document_to_fhir)
    ↓
MDT Processing:
  1. Document Classification (lab report, prescription, etc.)
  2. Structured Information Extraction (per-document schema)
  3. Medical Coding (LOINC mapping)
  4. FHIR R4 Conversion (DiagnosticReport + Observations)
    ↓
Return FHIR Bundle
    ↓
PAL API parses FHIR → Extract observations
    ↓
Frontend: Show VerificationCard with extracted data
    ↓
User confirms → Save to lab_tests table
```

---

## MDT Docker Container

**Image:** `medical-data-toolkit-image`
**Port:** `8080`
**Endpoint:** `POST /document_to_fhir`

**Request:**
- Method: POST
- Headers: `Content-Type: application/pdf` (or `image/jpeg`, `image/png`)
- Body: Raw file bytes

**Response:**
```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "DiagnosticReport",
        "code": {
          "text": "Complete Blood Count"
        },
        "effectiveDateTime": "2026-07-26",
        "result": [
          {
            "reference": "Observation/1"
          }
        ]
      }
    },
    {
      "resource": {
        "resourceType": "Observation",
        "code": {
          "coding": [
            {
              "system": "http://loinc.org",
              "code": "718-7",
              "display": "Hemoglobin"
            }
          ]
        },
        "valueQuantity": {
          "value": 14.5,
          "unit": "g/dL"
        },
        "referenceRange": [
          {
            "low": { "value": 13.5 },
            "high": { "value": 17.5 }
          }
        ]
      }
    }
  ]
}
```

---

## Files Modified

### Docker Compose:
- **docker-compose.yml** - Added `mdt` service

### Environment:
- **.env** - Updated MDT configuration:
  ```
  MDT_ENABLED=true
  MDT_URL=http://mdt:8080
  GEMMA_4_API_KEY=
  upload_dir=./uploads
  ```

### Backend (Already Done):
- **api/services/mdt/client.py** - HTTP client for MDT
- **api/services/mdt/fhir_parser.py** - FHIR Bundle parser
- **api/routers/medical_doc.py** - Upload + Confirm endpoints

### Frontend (Already Done):
- **web/app/upload/page.tsx** - Upload page with verification flow
- **web/app/page.tsx** - Upload tab in navigation

---

## Next Steps

1. **Wait for Docker build to complete** (~5-10 minutes)
2. **Start MDT container:** `docker-compose up -d mdt`
3. **Test upload flow:**
   - Upload a lab report PDF
   - MDT extracts FHIR data
   - Verification card shows extracted values
   - Save to lab_tests table

---

## MDT Features

### Supported Document Types:
- ✅ Diagnostic Reports (Lab Tests)
- ✅ Laboratory Reports
- ❌ Prescriptions (not yet supported by MDT)
- ❌ Handwritten documents (not supported)

### Supported File Formats:
- ✅ PDF
- ✅ JPEG/JPG
- ✅ PNG

### FHIR Standard:
- **Version:** FHIR R4
- **Implementation Guide:** ABDM (India)
- **Coding Systems:** LOINC for lab tests

### Medical Coding Features:
- **Core-Analyte Prediction:** Extracts primary substance (e.g., "Glucose")
- **Offline Knowledge Base:** Pre-computed LOINC mappings
- **Signature Matching:** Handles OCR noise and word-order variations

---

## Build Progress

**Command:**
```bash
cd medical-data-toolkit
docker build -t medical-data-toolkit-image .
```

**Expected Duration:** 5-10 minutes

**Layers:**
1. Base image: `python:3.12-slim`
2. Install system dependencies (nginx, curl, etc.)
3. Install Python dependencies (requirements.txt)
4. Copy source code
5. Setup nginx configuration
6. Configure startup script

---

## Troubleshooting

### If Build Fails:
- Check Docker is running
- Check internet connection (for downloading dependencies)
- Check disk space

### If MDT Container Won't Start:
- Check logs: `docker logs pal-mdt`
- Check health: `curl http://localhost:8080/health`

### If Upload Fails:
- Check MDT is running: `docker ps | grep mdt`
- Check API logs: `docker logs pal-api-1`
- Check browser console for errors

---

## Status: ⏳ WAITING FOR BUILD

Once the build completes, we'll:
1. Start the MDT container
2. Test the upload flow end-to-end
3. Verify FHIR extraction works correctly
4. Save extracted data to lab_tests table

---

**Started:** 2026-07-26 16:55  
**Current Step:** Building Docker image  
**ETA:** ~5 minutes
