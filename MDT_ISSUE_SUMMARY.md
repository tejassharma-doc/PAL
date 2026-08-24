# MDT Extraction Issue - Root Cause Found

## Problem

MDT cannot extract data from PDFs because **the MDT container has a hardcoded model name that doesn't exist**.

### Error from MDT Logs:
```
google.genai.errors.ClientError: 404 NOT_FOUND. 
{'error': {'code': 404, 'message': 'models/gemini-2.0-flash-exp is not found for API version v1beta'}}
```

---

## Root Cause

The `medical-data-toolkit-image` Docker container is **pre-compiled** with:
- Hardcoded model: `gemini-2.0-flash-exp` 
- This model **doesn't exist** in Google's Gemini API yet

**We cannot change the model** because:
1. The container is pre-built (`.pyc` files, not source code)
2. Environment variables `GEMINI_MODEL` are not being used by the container
3. The config file `/src/config.yaml` is baked into the image

---

## What Happens When You Upload

### Current Flow (MDT Enabled):
```
1. User uploads PDF
   ↓
2. API saves to raw_sources ✅
   ↓
3. API calls MDT at http://mdt:8080/document_to_fhir
   ↓
4. MDT tries to use: gemini-2.0-flash-exp
   ↓
5. Google API returns: 404 NOT_FOUND ❌
   ↓
6. MDT fails, returns empty FHIR bundle
   ↓
7. UI shows:
   - Patient: Not extracted ❌
   - Date: Not specified ❌
   - No observations ❌
```

---

## Temporary Solution Applied

### MDT Disabled
```env
MDT_ENABLED=false
```

### What Happens Now:
```
1. User uploads PDF
   ↓
2. API saves to raw_sources ✅
   ↓
3. API skips MDT extraction
   ↓
4. Returns success message:
   "Document saved to your record.
    Medical Data Toolkit is not configured — FHIR extraction skipped."
```

**Result:** File uploads successfully, but no automatic extraction.

---

## Long-Term Solutions

### Option 1: Build Custom MDT Container (Recommended)
```bash
# Clone Google's MDT repository
git clone https://github.com/google/medical-data-toolkit

# Modify config to use gemini-1.5-flash
# Build new Docker image
docker build -t medical-data-toolkit-custom .

# Update docker-compose.yml to use custom image
```

### Option 2: Use Different Extraction Service

Instead of MDT, implement extraction using:

**A. Direct Gemini API Call**
```python
# In api/services/gemini_extractor.py
from google import genai

client = genai.Client(api_key="AIzaSyDUd-lkQq4A25xWTkuXT8HoIKBZtYi-Uyo")

async def extract_lab_data(pdf_content: bytes):
    prompt = """
    Extract lab test information from this medical report.
    Return JSON with:
    - patient_name
    - report_date
    - observations: [{name, value, unit, reference_range, loinc_code}]
    """
    
    response = await client.models.generate_content(
        model="gemini-1.5-flash",
        contents=[
            {"mime_type": "application/pdf", "data": pdf_content},
            {"text": prompt}
        ]
    )
    
    return parse_json(response.text)
```

**B. Use Claude API (Anthropic)**
```python
# You already have Anthropic integration for Hermes
# Could use Claude for document extraction too
from anthropic import Anthropic

client = Anthropic(api_key=settings.anthropic_api_key)

# Claude supports PDF analysis natively
```

**C. Use OpenAI GPT-4 Vision**
```python
# Convert PDF to images, send to GPT-4 Vision
```

### Option 3: Manual Entry Mode

Allow users to manually enter lab values from the uploaded PDF:
```
1. Upload PDF ✅ (stored)
2. View PDF in browser
3. Manual data entry form
4. Save to lab_tests table
```

---

## Recommended Next Steps

### Immediate (Now):
1. ✅ MDT disabled - uploads work but no extraction
2. ✅ Files are still saved to `raw_sources` table
3. ⚠️ Users see "FHIR extraction skipped" message

### Short-Term (This Week):
**Implement Option 2A - Direct Gemini Extraction:**

1. Create `api/services/gemini_extractor.py`
2. Update `api/routers/medical_doc.py` to use it instead of MDT
3. Test with your Gemini API key
4. Enable extraction again

### Medium-Term (Next Week):
1. Build custom MDT container with correct model
2. OR stick with Gemini extraction if it works well
3. Add manual entry UI as fallback

---

## Code to Implement Gemini Extraction

### Step 1: Install Google GenAI SDK
```bash
# Add to api/requirements.txt
google-generativeai>=0.3.0
```

### Step 2: Create Extractor Service
```python
# api/services/gemini_extractor.py
import json
import base64
from typing import Optional
from google import genai

class GeminiExtractor:
    def __init__(self, api_key: str, model: str = "gemini-1.5-flash"):
        self.client = genai.Client(api_key=api_key)
        self.model = model
    
    async def extract_from_pdf(self, pdf_bytes: bytes) -> dict:
        """Extract lab data from PDF using Gemini"""
        
        # Convert bytes to base64
        pdf_base64 = base64.b64encode(pdf_bytes).decode()
        
        prompt = """
        You are a medical data extraction assistant. Extract structured information from this lab report.
        
        Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
        {
          "patient_name": "Full Name",
          "report_date": "YYYY-MM-DD",
          "report_title": "Type of Report",
          "observations": [
            {
              "display": "Test Name",
              "value": "123.4",
              "unit": "mg/dL",
              "reference_range": "70-100",
              "loinc_code": "2345-7"
            }
          ]
        }
        
        Rules:
        - Extract ALL lab values you can find
        - Use LOINC codes if identifiable (optional)
        - Include units and reference ranges when available
        - Parse date in YYYY-MM-DD format
        """
        
        response = await self.client.models.generate_content(
            model=self.model,
            contents=[
                {
                    "parts": [
                        {"inline_data": {"mime_type": "application/pdf", "data": pdf_base64}},
                        {"text": prompt}
                    ]
                }
            ]
        )
        
        # Parse JSON from response
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:-3].strip()
        elif text.startswith("```"):
            text = text[3:-3].strip()
        
        return json.loads(text)
```

### Step 3: Update Medical Router
```python
# In api/routers/medical_doc.py

# Replace MDTClient import with:
from services.gemini_extractor import GeminiExtractor

# In upload endpoint, replace:
if settings.mdt_enabled:
    client = MDTClient(...)
    fhir_bundle = await client.document_to_fhir(content, mime)

# With:
if settings.gemini_api_key:
    extractor = GeminiExtractor(
        api_key=settings.gemini_api_key,
        model=settings.mdt_model
    )
    extracted = await extractor.extract_from_pdf(content)
    
    # Convert to expected format
    observations = extracted.get("observations", [])
    patient_name = extracted.get("patient_name")
    report_date = extracted.get("report_date")
    # ... rest of processing
```

---

## Why This Happens

### MDT Container Structure:
```
medical-data-toolkit-image/
├── /src/
│   ├── rest_server.pyc           ← Compiled Python (can't edit)
│   ├── config.yaml               ← Baked into image
│   └── document_to_fhir/
│       └── classifier.py         ← Hardcoded model reference
├── /data/
│   └── loinc_kb_minimal/         ← LOINC knowledge base
└── nginx.conf                    ← Web server config
```

The model name `gemini-2.0-flash-exp` is **compiled into the Python bytecode** (`.pyc` files), so we can't change it without rebuilding the container.

---

## Current Status

```
✅ File Uploads: Working
✅ File Storage: Working  
✅ Database: Working
❌ MDT Extraction: Disabled (model not found)
❌ Patient Name: Not extracted
❌ Lab Values: Not extracted
```

---

## Decision Needed

Which approach do you prefer?

1. **Quick Fix**: Implement direct Gemini extraction (1-2 hours)
2. **Proper Fix**: Rebuild MDT container with correct model (1 day)
3. **Alternative**: Manual entry UI for lab values (2-3 hours)

Let me know and I'll implement it!

---

**Issue Identified**: 2024-07-27  
**MDT Status**: Temporarily disabled  
**Uploads**: Still working (file saved, no extraction)
